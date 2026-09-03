use crate::{
    EndpointConfig, HomeAcceptor, HomeAcceptorConfig, HomeTunnel, HomeTunnelConfig, IrohCapProfile,
    IrohEndpoint, MachineAcceptor, MachineAcceptorConfig, MachineHttpTunnel, MachineTunnel,
    MachineTunnelConfig, RelayPolicy, IROH_MACHINE_APPLICATION_CAPABILITY_HEADER,
    IROH_MACHINE_APPLICATION_PORT_HEADER, IROH_MACHINE_HTTP_LOCAL_CAPABILITY_HEADER,
};
use std::collections::VecDeque;
use std::net::{IpAddr, Ipv4Addr, SocketAddr};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};

async fn endpoint(profile: IrohCapProfile) -> IrohEndpoint {
    IrohEndpoint::bind(&EndpointConfig {
        relay_policy: RelayPolicy::Disabled,
        caps: profile,
        ..EndpointConfig::default()
    })
    .await
    .expect("endpoint")
}

async fn direct_addr(endpoint: &IrohEndpoint) -> SocketAddr {
    for _ in 0..100 {
        if let Some(addr) = endpoint.endpoint().addr().ip_addrs().next() {
            return *addr;
        }
        tokio::time::sleep(std::time::Duration::from_millis(10)).await;
    }
    panic!("direct address unavailable")
}

async fn echo_server(contacts: Arc<AtomicUsize>) -> SocketAddr {
    let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0))
        .await
        .expect("bind app");
    let addr = listener.local_addr().expect("app addr");
    tokio::spawn(async move {
        while let Ok((mut socket, _)) = listener.accept().await {
            contacts.fetch_add(1, Ordering::Relaxed);
            tokio::spawn(async move {
                let (mut read, mut write) = socket.split();
                let mut request = Vec::new();
                if read.read_to_end(&mut request).await.is_ok() {
                    let _ = write.write_all(b"app-reply:").await;
                    let _ = write.write_all(&request).await;
                }
            });
        }
    });
    addr
}

async fn read_http_request(socket: &mut TcpStream) -> Vec<u8> {
    let mut request = Vec::new();
    let header_end = loop {
        let mut chunk = [0u8; 1024];
        let read = socket.read(&mut chunk).await.expect("read request head");
        assert!(read > 0, "request ended before its HTTP head");
        request.extend_from_slice(&chunk[..read]);
        if let Some(index) = request.windows(4).position(|window| window == b"\r\n\r\n") {
            break index + 4;
        }
    };
    let head = std::str::from_utf8(&request[..header_end]).expect("utf8 request head");
    let content_length = head
        .lines()
        .find_map(|line| {
            line.split_once(':').and_then(|(name, value)| {
                name.eq_ignore_ascii_case("content-length")
                    .then(|| value.trim().parse::<usize>().expect("content length"))
            })
        })
        .expect("content length header");
    let body_end = header_end + content_length;
    while request.len() < body_end {
        let mut chunk = vec![0u8; body_end - request.len()];
        let read = socket.read(&mut chunk).await.expect("read request body");
        assert!(read > 0, "request ended before its Content-Length body");
        request.extend_from_slice(&chunk[..read]);
    }
    request.truncate(body_end);
    request
}

/// Admission responses with a per-response queue of application-port header
/// values: each queued entry is the exact set of
/// `{IROH_MACHINE_APPLICATION_PORT_HEADER}` header lines to emit for one
/// admission response. An empty entry omits the header entirely; multiple
/// entries emit duplicate header lines. Every response is a valid 2xx with an
/// exact remote-endpoint echo, so only the application-port selection varies.
async fn admission_server(
    expected_remote: String,
    application_ports: Arc<Mutex<VecDeque<Vec<String>>>>,
    contacts: Arc<AtomicUsize>,
) -> SocketAddr {
    let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0))
        .await
        .expect("bind admission");
    let addr = listener.local_addr().expect("admission addr");
    tokio::spawn(async move {
        while let Ok((mut socket, _)) = listener.accept().await {
            contacts.fetch_add(1, Ordering::Relaxed);
            let request = read_http_request(&mut socket).await;
            let request = String::from_utf8_lossy(&request);
            assert!(request.starts_with("POST /v1/iroh/machine/admit HTTP/1.1\r\n"));
            assert!(request.contains(&format!(
                "X-Happier-Iroh-Remote-Endpoint-Id: {expected_remote}\r\n"
            )));
            // The verified canonical handshake is forwarded to admission as a
            // bounded JSON object body, independent of the handshake content.
            let (_, body) = request.split_once("\r\n\r\n").expect("request head/body");
            let parsed: serde_json::Value =
                serde_json::from_str(body).expect("handshake body must be a JSON object");
            assert!(parsed.is_object());
            let ports = application_ports
                .lock()
                .expect("application port queue")
                .pop_front()
                .unwrap_or_default();
            let mut response = format!(
                "HTTP/1.1 204 No Content\r\nX-Happier-Iroh-Remote-Endpoint-Id: {expected_remote}\r\n"
            );
            for port in ports {
                response.push_str(&format!(
                    "{IROH_MACHINE_APPLICATION_PORT_HEADER}: {port}\r\n"
                ));
            }
            response.push_str("Content-Length: 0\r\nConnection: close\r\n\r\n");
            socket
                .write_all(response.as_bytes())
                .await
                .expect("admission response");
        }
    });
    addr
}

/// Faithful transport behavior of Node's default HTTP server: the request is
/// complete at Content-Length, but a client FIN also closes the server's
/// writable response side when `allowHalfOpen` is false. The production
/// admission client must therefore keep its write half open while awaiting
/// the bounded HTTP response.
async fn node_default_half_close_admission_server(
    expected_remote: String,
    application_port: u16,
) -> SocketAddr {
    let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0))
        .await
        .expect("bind node-like admission");
    let addr = listener.local_addr().expect("node-like admission addr");
    tokio::spawn(async move {
        let (mut socket, _) = listener.accept().await.expect("accept admission");
        let _request = read_http_request(&mut socket).await;

        let mut early_fin_probe = [0u8; 1];
        if matches!(
            tokio::time::timeout(Duration::from_millis(50), socket.read(&mut early_fin_probe))
                .await,
            Ok(Ok(0))
        ) {
            // Node's default allowHalfOpen=false closes this response side.
            return;
        }
        let response = format!(
            "HTTP/1.1 204 No Content\r\nX-Happier-Iroh-Remote-Endpoint-Id: {expected_remote}\r\n{IROH_MACHINE_APPLICATION_PORT_HEADER}: {application_port}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
        );
        socket
            .write_all(response.as_bytes())
            .await
            .expect("write node-like admission response");
    });
    addr
}

/// One full local-loop duplex exchange through a machine tunnel: distinct
/// nonzero bytes out, half-close, echo back.
async fn exchange_echo(local_addr: SocketAddr, payload: &[u8]) -> Vec<u8> {
    let mut socket = TcpStream::connect(local_addr).await.expect("local connect");
    socket.write_all(payload).await.expect("write payload");
    socket.shutdown().await.expect("half close");
    let mut echoed = Vec::new();
    socket.read_to_end(&mut echoed).await.expect("read echo");
    echoed
}

async fn exchange_echo_with_capability(
    local_addr: SocketAddr,
    local_capability: &str,
    payload: &[u8],
) -> Vec<u8> {
    let mut socket = TcpStream::connect(local_addr).await.expect("local connect");
    socket
        .write_all(local_capability.as_bytes())
        .await
        .expect("write local capability");
    socket.write_all(payload).await.expect("write payload");
    socket.shutdown().await.expect("half close");
    let mut echoed = Vec::new();
    socket.read_to_end(&mut echoed).await.expect("read echo");
    echoed
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn one_client_endpoint_identity_moves_home_then_machine_bytes() {
    let home_server = endpoint(IrohCapProfile::HomeInteractive).await;
    let machine_server = endpoint(IrohCapProfile::MachineBulk).await;
    // The application endpoint starts with the interactive incoming default.
    // MachineBulk must be selected on the outgoing connection, not by binding
    // a second endpoint identity.
    let client = endpoint(IrohCapProfile::HomeInteractive).await;
    let client_id = client.id();

    let home_contacts = Arc::new(AtomicUsize::new(0));
    let home_target = echo_server(Arc::clone(&home_contacts)).await;
    let home_acceptor = HomeAcceptor::start(
        &home_server,
        HomeAcceptorConfig {
            target: home_target,
        },
    )
    .expect("home acceptor");
    let home_tunnel = HomeTunnel::start(
        &client,
        HomeTunnelConfig {
            endpoint_id: home_server.id().to_string(),
            direct_addresses: vec![direct_addr(&home_server).await],
            ..HomeTunnelConfig::default()
        },
    )
    .await
    .expect("home tunnel on shared client endpoint");
    assert_eq!(
        exchange_echo(home_tunnel.local_addr().unwrap(), b"home-shared-endpoint").await,
        [b"app-reply:".as_slice(), b"home-shared-endpoint".as_slice()].concat()
    );

    let machine_contacts = Arc::new(AtomicUsize::new(0));
    let machine_port = echo_server(Arc::clone(&machine_contacts)).await.port();
    let admission_target = admission_server(
        client_id.to_string(),
        Arc::new(Mutex::new(VecDeque::from([vec![machine_port.to_string()]]))),
        Arc::new(AtomicUsize::new(0)),
    )
    .await;
    let machine_acceptor =
        MachineAcceptor::start(&machine_server, MachineAcceptorConfig { admission_target })
            .expect("machine acceptor");
    let machine_tunnel = MachineTunnel::start(
        &client,
        MachineTunnelConfig {
            endpoint_id: machine_server.id().to_string(),
            bind_addr: SocketAddr::new(IpAddr::V4(Ipv4Addr::LOCALHOST), 0),
            direct_addresses: vec![direct_addr(&machine_server).await],
            relay_urls: vec![],
            handshake_json: r#"{"v":1,"operationId":"shared-endpoint"}"#.to_owned(),
            cap_profile: IrohCapProfile::MachineBulk,
        },
    )
    .await
    .expect("machine tunnel on the same client endpoint");
    assert_eq!(
        exchange_echo_with_capability(
            machine_tunnel.local_addr().unwrap(),
            machine_tunnel.local_capability(),
            b"machine-shared-endpoint",
        )
        .await,
        [
            b"app-reply:".as_slice(),
            b"machine-shared-endpoint".as_slice()
        ]
        .concat()
    );
    assert_eq!(client.id(), client_id, "one persistent client identity");
    assert_eq!(home_contacts.load(Ordering::Relaxed), 1);
    assert_eq!(machine_contacts.load(Ordering::Relaxed), 1);

    machine_tunnel.stop();
    machine_acceptor.stop();
    home_tunnel.stop();
    home_acceptor.stop();
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn machine_tunnel_moves_duplex_bytes_to_the_admission_selected_application_port() {
    let server = endpoint(IrohCapProfile::MachineBulk).await;
    let client = endpoint(IrohCapProfile::MachineBulk).await;
    let app_contacts = Arc::new(AtomicUsize::new(0));
    let app_port = echo_server(Arc::clone(&app_contacts)).await.port();
    let admission_contacts = Arc::new(AtomicUsize::new(0));
    let admission_target = admission_server(
        client.id().to_string(),
        Arc::new(Mutex::new(VecDeque::from([vec![app_port.to_string()]]))),
        Arc::clone(&admission_contacts),
    )
    .await;
    let acceptor = MachineAcceptor::start(&server, MachineAcceptorConfig { admission_target })
        .expect("machine acceptor");
    let tunnel = MachineTunnel::start(
        &client,
        MachineTunnelConfig {
            endpoint_id: server.id().to_string(),
            bind_addr: SocketAddr::new(IpAddr::V4(Ipv4Addr::LOCALHOST), 0),
            direct_addresses: vec![direct_addr(&server).await],
            relay_urls: vec![],
            handshake_json: r#"{"v":1,"operationId":"op-1"}"#.to_owned(),
            cap_profile: IrohCapProfile::MachineBulk,
        },
    )
    .await
    .expect("machine tunnel");

    let echoed = exchange_echo_with_capability(
        tunnel.local_addr().expect("local addr"),
        tunnel.local_capability(),
        b"machine-native-nonzero-duplex",
    )
    .await;
    assert_eq!(
        echoed,
        [
            b"app-reply:".as_slice(),
            b"machine-native-nonzero-duplex".as_slice()
        ]
        .concat()
    );
    assert_eq!(admission_contacts.load(Ordering::Relaxed), 1);
    assert_eq!(app_contacts.load(Ordering::Relaxed), 1);
    assert_eq!(acceptor.status().streams_accepted, 1);
    // The tunnel surfaces the normalized authenticated remote identity so a
    // production adapter never needs a separate caller-supplied string.
    assert_eq!(tunnel.status().remote_endpoint_id, server.id().to_string());
    tunnel.stop();
    acceptor.stop();
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn machine_http_tunnel_requires_capability_before_opening_a_machine_stream() {
    let server = endpoint(IrohCapProfile::MachineBulk).await;
    let client = endpoint(IrohCapProfile::MachineBulk).await;
    let app_contacts = Arc::new(AtomicUsize::new(0));
    let app_port = echo_server(Arc::clone(&app_contacts)).await.port();
    let admission_contacts = Arc::new(AtomicUsize::new(0));
    let admission_target = admission_server(
        client.id().to_string(),
        Arc::new(Mutex::new(VecDeque::from([vec![app_port.to_string()]]))),
        Arc::clone(&admission_contacts),
    )
    .await;
    let acceptor = MachineAcceptor::start(&server, MachineAcceptorConfig { admission_target })
        .expect("machine acceptor");
    let tunnel = MachineHttpTunnel::start(
        &client,
        MachineTunnelConfig {
            endpoint_id: server.id().to_string(),
            bind_addr: SocketAddr::new(IpAddr::V4(Ipv4Addr::LOCALHOST), 0),
            direct_addresses: vec![direct_addr(&server).await],
            relay_urls: vec![],
            handshake_json: r#"{"v":1,"operationId":"http-op-1"}"#.to_owned(),
            cap_profile: IrohCapProfile::MachineBulk,
        },
    )
    .await
    .expect("machine HTTP tunnel");

    let mut unauthorized = TcpStream::connect(tunnel.local_addr().expect("HTTP loopback addr"))
        .await
        .expect("connect unauthenticated HTTP loopback");
    unauthorized
        .write_all(b"GET /probe HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n")
        .await
        .expect("write unauthenticated request");
    unauthorized
        .shutdown()
        .await
        .expect("shutdown unauthenticated request");
    let mut rejected = Vec::new();
    tokio::time::timeout(
        Duration::from_secs(2),
        unauthorized.read_to_end(&mut rejected),
    )
    .await
    .expect("unauthenticated listener close")
    .expect("read unauthenticated close");
    assert!(rejected.is_empty());
    assert_eq!(admission_contacts.load(Ordering::Relaxed), 0);
    assert_eq!(app_contacts.load(Ordering::Relaxed), 0);

    let mut wrong = TcpStream::connect(tunnel.local_addr().expect("HTTP loopback addr"))
        .await
        .expect("connect wrong-capability HTTP loopback");
    wrong
        .write_all(
            format!(
                "GET /probe HTTP/1.1\r\nHost: 127.0.0.1\r\n{}: {}\r\nConnection: close\r\n\r\n",
                IROH_MACHINE_HTTP_LOCAL_CAPABILITY_HEADER,
                "f".repeat(64),
            )
            .as_bytes(),
        )
        .await
        .expect("write wrong-capability request");
    wrong
        .shutdown()
        .await
        .expect("shutdown wrong-capability request");
    let mut wrong_rejected = Vec::new();
    tokio::time::timeout(
        Duration::from_secs(2),
        wrong.read_to_end(&mut wrong_rejected),
    )
    .await
    .expect("wrong-capability listener close")
    .expect("read wrong-capability close");
    assert!(wrong_rejected.is_empty());
    assert_eq!(admission_contacts.load(Ordering::Relaxed), 0);
    assert_eq!(app_contacts.load(Ordering::Relaxed), 0);

    let authenticated_request = format!(
        "POST /machine-transfers/direct/imports/http-op-1 HTTP/1.1\r\nHost: 127.0.0.1\r\nX-Happier-Test-Preserved: yes\r\n{}: {}\r\nContent-Length: 18\r\nConnection: close\r\n\r\nmachine-body-bytes",
        IROH_MACHINE_HTTP_LOCAL_CAPABILITY_HEADER,
        tunnel.local_capability(),
    );
    let forwarded_request = "POST /machine-transfers/direct/imports/http-op-1 HTTP/1.1\r\nHost: 127.0.0.1\r\nX-Happier-Test-Preserved: yes\r\nContent-Length: 18\r\nConnection: close\r\n\r\nmachine-body-bytes";
    let echoed = exchange_echo(
        tunnel.local_addr().expect("HTTP loopback addr"),
        authenticated_request.as_bytes(),
    )
    .await;
    assert_eq!(
        echoed,
        [b"app-reply:".as_slice(), forwarded_request.as_bytes(),].concat()
    );
    assert_eq!(admission_contacts.load(Ordering::Relaxed), 1);
    assert_eq!(app_contacts.load(Ordering::Relaxed), 1);
    assert_eq!(tunnel.status().streams_opened, 1);
    tunnel.stop();
    acceptor.stop();
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn machine_acceptor_presents_and_strips_the_admission_selected_local_capability() {
    let server = endpoint(IrohCapProfile::MachineBulk).await;
    let client = endpoint(IrohCapProfile::MachineBulk).await;
    let target_capability = "e".repeat(64);
    let app_listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0))
        .await
        .expect("bind capability app");
    let app_port = app_listener.local_addr().expect("app addr").port();
    let app_capability = target_capability.clone();
    tokio::spawn(async move {
        let (mut socket, _) = app_listener.accept().await.expect("accept capability app");
        let mut supplied = [0u8; 64];
        socket
            .read_exact(&mut supplied)
            .await
            .expect("read target local capability");
        assert_eq!(supplied.as_slice(), app_capability.as_bytes());
        let (mut read, mut write) = socket.split();
        let mut payload = Vec::new();
        read.read_to_end(&mut payload)
            .await
            .expect("read app payload");
        write
            .write_all(b"app-reply:")
            .await
            .expect("write app reply");
        write
            .write_all(&payload)
            .await
            .expect("write echoed payload");
    });

    let admission_listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0))
        .await
        .expect("bind capability admission");
    let admission_target = admission_listener.local_addr().expect("admission addr");
    let expected_remote = client.id().to_string();
    tokio::spawn(async move {
        let (mut socket, _) = admission_listener.accept().await.expect("accept admission");
        let _request = read_http_request(&mut socket).await;
        let response = format!(
            "HTTP/1.1 204 No Content\r\nX-Happier-Iroh-Remote-Endpoint-Id: {expected_remote}\r\n{IROH_MACHINE_APPLICATION_PORT_HEADER}: {app_port}\r\n{IROH_MACHINE_APPLICATION_CAPABILITY_HEADER}: {target_capability}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
        );
        socket
            .write_all(response.as_bytes())
            .await
            .expect("write admission response");
    });

    let acceptor = MachineAcceptor::start(&server, MachineAcceptorConfig { admission_target })
        .expect("machine acceptor");
    let tunnel = MachineTunnel::start(
        &client,
        MachineTunnelConfig {
            endpoint_id: server.id().to_string(),
            bind_addr: SocketAddr::new(IpAddr::V4(Ipv4Addr::LOCALHOST), 0),
            direct_addresses: vec![direct_addr(&server).await],
            relay_urls: vec![],
            handshake_json: r#"{"v":1,"operationId":"target-local-capability"}"#.to_owned(),
            cap_profile: IrohCapProfile::MachineBulk,
        },
    )
    .await
    .expect("machine tunnel");
    let echoed = exchange_echo_with_capability(
        tunnel.local_addr().expect("local addr"),
        tunnel.local_capability(),
        b"payload-after-two-local-capabilities",
    )
    .await;
    assert_eq!(echoed, b"app-reply:payload-after-two-local-capabilities");
    tunnel.stop();
    acceptor.stop();
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn machine_tunnel_rejects_an_unauthorized_local_socket_before_opening_a_machine_stream() {
    let server = endpoint(IrohCapProfile::MachineBulk).await;
    let client = endpoint(IrohCapProfile::MachineBulk).await;
    let app_contacts = Arc::new(AtomicUsize::new(0));
    let app_port = echo_server(Arc::clone(&app_contacts)).await.port();
    let admission_contacts = Arc::new(AtomicUsize::new(0));
    let admission_target = admission_server(
        client.id().to_string(),
        Arc::new(Mutex::new(VecDeque::from([vec![app_port.to_string()]]))),
        Arc::clone(&admission_contacts),
    )
    .await;
    let acceptor = MachineAcceptor::start(&server, MachineAcceptorConfig { admission_target })
        .expect("machine acceptor");
    let tunnel = MachineTunnel::start(
        &client,
        MachineTunnelConfig {
            endpoint_id: server.id().to_string(),
            bind_addr: SocketAddr::new(IpAddr::V4(Ipv4Addr::LOCALHOST), 0),
            direct_addresses: vec![direct_addr(&server).await],
            relay_urls: vec![],
            handshake_json: r#"{"v":1,"operationId":"op-local-capability"}"#.to_owned(),
            cap_profile: IrohCapProfile::MachineBulk,
        },
    )
    .await
    .expect("machine tunnel");

    let mut scanner = TcpStream::connect(tunnel.local_addr().expect("local addr"))
        .await
        .expect("scanner connect");
    scanner
        .write_all(b"unauthorized-local-process")
        .await
        .expect("scanner write");
    scanner.shutdown().await.expect("scanner half close");
    let mut closed = Vec::new();
    tokio::time::timeout(Duration::from_secs(1), scanner.read_to_end(&mut closed))
        .await
        .expect("scanner connection closes")
        .expect("scanner read");
    assert_eq!(admission_contacts.load(Ordering::Relaxed), 0);
    assert_eq!(app_contacts.load(Ordering::Relaxed), 0);

    let echoed = exchange_echo_with_capability(
        tunnel.local_addr().expect("local addr"),
        tunnel.local_capability(),
        b"authorized-after-scanner",
    )
    .await;
    assert_eq!(echoed, b"app-reply:authorized-after-scanner");
    assert_eq!(admission_contacts.load(Ordering::Relaxed), 1);
    assert_eq!(app_contacts.load(Ordering::Relaxed), 1);
    tunnel.stop();
    acceptor.stop();
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn machine_admission_keeps_request_write_half_open_for_async_node_response() {
    let server = endpoint(IrohCapProfile::MachineBulk).await;
    let client = endpoint(IrohCapProfile::MachineBulk).await;
    let app_contacts = Arc::new(AtomicUsize::new(0));
    let app_port = echo_server(Arc::clone(&app_contacts)).await.port();
    let admission_target =
        node_default_half_close_admission_server(client.id().to_string(), app_port).await;
    let acceptor = MachineAcceptor::start(&server, MachineAcceptorConfig { admission_target })
        .expect("machine acceptor");
    let tunnel = MachineTunnel::start(
        &client,
        MachineTunnelConfig {
            endpoint_id: server.id().to_string(),
            bind_addr: SocketAddr::new(IpAddr::V4(Ipv4Addr::LOCALHOST), 0),
            direct_addresses: vec![direct_addr(&server).await],
            relay_urls: vec![],
            handshake_json: r#"{"v":1,"operationId":"node-async-op"}"#.to_owned(),
            cap_profile: IrohCapProfile::MachineBulk,
        },
    )
    .await
    .expect("machine tunnel");

    let echoed = exchange_echo_with_capability(
        tunnel.local_addr().expect("local addr"),
        tunnel.local_capability(),
        b"node-async-admission-bytes",
    )
    .await;
    assert_eq!(
        echoed,
        [b"app-reply:".as_slice(), b"node-async-admission-bytes"].concat()
    );
    assert_eq!(app_contacts.load(Ordering::Relaxed), 1);
    assert_eq!(acceptor.status().streams_accepted, 1);
    tunnel.stop();
    acceptor.stop();
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn each_admitted_stream_reaches_only_its_own_selected_application_port() {
    let server = endpoint(IrohCapProfile::MachineBulk).await;
    let client = endpoint(IrohCapProfile::MachineBulk).await;
    let app_a_contacts = Arc::new(AtomicUsize::new(0));
    let app_b_contacts = Arc::new(AtomicUsize::new(0));
    let app_a_port = echo_server(Arc::clone(&app_a_contacts)).await.port();
    let app_b_port = echo_server(Arc::clone(&app_b_contacts)).await.port();
    let admission_contacts = Arc::new(AtomicUsize::new(0));
    // One acceptor, one endpoint: each authenticated stream gets its own
    // trusted admission response selecting a different loopback application
    // listener. The second selection is OWS-padded exactly like a normally
    // serialized `Header: value` line (with optional whitespace after the
    // colon and around the value). Exchanges run sequentially, so admission
    // responses resolve in stream order deterministically.
    let admission_target = admission_server(
        client.id().to_string(),
        Arc::new(Mutex::new(VecDeque::from([
            vec![app_a_port.to_string()],
            vec![format!(" {} ", app_b_port)],
        ]))),
        Arc::clone(&admission_contacts),
    )
    .await;
    let acceptor = MachineAcceptor::start(&server, MachineAcceptorConfig { admission_target })
        .expect("acceptor");
    let tunnel = MachineTunnel::start(
        &client,
        MachineTunnelConfig {
            endpoint_id: server.id().to_string(),
            bind_addr: SocketAddr::new(IpAddr::V4(Ipv4Addr::LOCALHOST), 0),
            direct_addresses: vec![direct_addr(&server).await],
            relay_urls: vec![],
            handshake_json: r#"{"v":1,"operationId":"op-1"}"#.to_owned(),
            cap_profile: IrohCapProfile::MachineBulk,
        },
    )
    .await
    .expect("tunnel");
    let local_addr = tunnel.local_addr().expect("local addr");

    let echoed_a = exchange_echo_with_capability(
        local_addr,
        tunnel.local_capability(),
        b"first-stream-payload-a",
    )
    .await;
    assert_eq!(
        echoed_a,
        [
            b"app-reply:".as_slice(),
            b"first-stream-payload-a".as_slice()
        ]
        .concat()
    );
    assert_eq!(app_a_contacts.load(Ordering::Relaxed), 1);
    assert_eq!(app_b_contacts.load(Ordering::Relaxed), 0);

    let echoed_b = exchange_echo_with_capability(
        local_addr,
        tunnel.local_capability(),
        b"second-stream-payload-b",
    )
    .await;
    assert_eq!(
        echoed_b,
        [
            b"app-reply:".as_slice(),
            b"second-stream-payload-b".as_slice()
        ]
        .concat()
    );
    assert_eq!(app_a_contacts.load(Ordering::Relaxed), 1);
    assert_eq!(app_b_contacts.load(Ordering::Relaxed), 1);

    assert_eq!(admission_contacts.load(Ordering::Relaxed), 2);
    assert_eq!(acceptor.status().streams_accepted, 2);
    tunnel.stop();
    acceptor.stop();
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn invalid_application_port_headers_reject_before_any_application_connection() {
    let server = endpoint(IrohCapProfile::MachineBulk).await;
    let client = endpoint(IrohCapProfile::MachineBulk).await;
    let app_contacts = Arc::new(AtomicUsize::new(0));
    let _never_contacted_app = echo_server(Arc::clone(&app_contacts)).await;
    let admission_contacts = Arc::new(AtomicUsize::new(0));
    // Every response approves the handshake (2xx + exact echo) but supplies
    // exactly one invalid application-port selection. Missing, empty, zero,
    // overflow, comma-folded, duplicated, signed, internal whitespace,
    // non-numeric, and non-canonical forms must all reject before any
    // application dial. Edge OWS alone (a normally serialized
    // `Header: value` line) is valid and covered by the positive tests.
    let cases: Vec<Vec<String>> = [
        vec![],
        vec![""],
        vec!["0"],
        vec!["65536"],
        vec!["99999"],
        vec!["8443,8443"],
        vec!["8443", "8443"],
        vec!["+8443"],
        vec!["84 43"],
        vec!["84\t43"],
        vec!["port"],
        vec!["08443"],
    ]
    .into_iter()
    .map(|ports| ports.into_iter().map(str::to_owned).collect())
    .collect();
    let admission_target = admission_server(
        client.id().to_string(),
        Arc::new(Mutex::new(VecDeque::from(cases.clone()))),
        Arc::clone(&admission_contacts),
    )
    .await;
    let acceptor = MachineAcceptor::start(&server, MachineAcceptorConfig { admission_target })
        .expect("acceptor");
    let tunnel = MachineTunnel::start(
        &client,
        MachineTunnelConfig {
            endpoint_id: server.id().to_string(),
            bind_addr: SocketAddr::new(IpAddr::V4(Ipv4Addr::LOCALHOST), 0),
            direct_addresses: vec![direct_addr(&server).await],
            relay_urls: vec![],
            handshake_json: r#"{"v":1,"operationId":"op-1"}"#.to_owned(),
            cap_profile: IrohCapProfile::MachineBulk,
        },
    )
    .await
    .expect("tunnel");

    for _ in 0..cases.len() {
        let mut socket = TcpStream::connect(tunnel.local_addr().expect("local addr"))
            .await
            .expect("local connect");
        socket
            .write_all(tunnel.local_capability().as_bytes())
            .await
            .expect("local capability");
        socket
            .write_all(b"must-not-reach-app")
            .await
            .expect("local write");
        let mut byte = [0u8; 1];
        let result =
            tokio::time::timeout(std::time::Duration::from_secs(5), socket.read(&mut byte))
                .await
                .expect("bounded reject");
        assert!(matches!(result, Ok(0) | Err(_)));
    }
    tokio::time::sleep(std::time::Duration::from_millis(100)).await;
    assert_eq!(admission_contacts.load(Ordering::Relaxed), cases.len());
    assert_eq!(app_contacts.load(Ordering::Relaxed), 0);
    let status = acceptor.status();
    assert_eq!(status.streams_accepted, 0);
    assert_eq!(status.streams_rejected, cases.len() as u64);
    assert_eq!(
        status.last_failure,
        Some(crate::MachineFailureCode::AdmissionRejected)
    );
    tunnel.stop();
    acceptor.stop();
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn denied_machine_handshake_never_contacts_any_application_listener() {
    let server = endpoint(IrohCapProfile::MachineBulk).await;
    let client = endpoint(IrohCapProfile::MachineBulk).await;
    let app_contacts = Arc::new(AtomicUsize::new(0));
    let _never_contacted_app = echo_server(Arc::clone(&app_contacts)).await;
    let admission_contacts = Arc::new(AtomicUsize::new(0));
    // Denial: the admission owner rejects the grant with a non-2xx response.
    let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0))
        .await
        .expect("bind admission");
    let admission_target = listener.local_addr().expect("admission addr");
    let admission_contacts_for_task = Arc::clone(&admission_contacts);
    tokio::spawn(async move {
        while let Ok((mut socket, _)) = listener.accept().await {
            admission_contacts_for_task.fetch_add(1, Ordering::Relaxed);
            let _request = read_http_request(&mut socket).await;
            socket
                .write_all(
                    b"HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
                )
                .await
                .expect("deny response");
        }
    });
    let acceptor = MachineAcceptor::start(&server, MachineAcceptorConfig { admission_target })
        .expect("machine acceptor");
    let tunnel = MachineTunnel::start(
        &client,
        MachineTunnelConfig {
            endpoint_id: server.id().to_string(),
            bind_addr: SocketAddr::new(IpAddr::V4(Ipv4Addr::LOCALHOST), 0),
            direct_addresses: vec![direct_addr(&server).await],
            relay_urls: vec![],
            handshake_json: r#"{"v":1,"operationId":"op-1"}"#.to_owned(),
            cap_profile: IrohCapProfile::MachineBulk,
        },
    )
    .await
    .expect("machine tunnel");
    let mut socket = TcpStream::connect(tunnel.local_addr().expect("local addr"))
        .await
        .expect("local connect");
    socket
        .write_all(tunnel.local_capability().as_bytes())
        .await
        .expect("local capability");
    socket
        .write_all(b"must-not-reach-app")
        .await
        .expect("local write");
    let mut byte = [0u8; 1];
    let result = tokio::time::timeout(std::time::Duration::from_secs(5), socket.read(&mut byte))
        .await
        .expect("bounded reject");
    assert!(matches!(result, Ok(0) | Err(_)));
    assert_eq!(admission_contacts.load(Ordering::Relaxed), 1);
    assert_eq!(app_contacts.load(Ordering::Relaxed), 0);
    assert_eq!(acceptor.status().streams_rejected, 1);
    assert_eq!(
        tunnel.status().last_failure,
        Some(crate::MachineFailureCode::AdmissionRejected)
    );
    tunnel.stop();
    acceptor.stop();
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn malformed_machine_control_never_reaches_admission_or_app() {
    let server = endpoint(IrohCapProfile::MachineBulk).await;
    let client = endpoint(IrohCapProfile::MachineBulk).await;
    let app_contacts = Arc::new(AtomicUsize::new(0));
    let _never_contacted_app = echo_server(Arc::clone(&app_contacts)).await;
    let admission_contacts = Arc::new(AtomicUsize::new(0));
    let admission_target = admission_server(
        client.id().to_string(),
        Arc::new(Mutex::new(VecDeque::from([vec!["1".to_owned()]]))),
        Arc::clone(&admission_contacts),
    )
    .await;
    let acceptor = MachineAcceptor::start(&server, MachineAcceptorConfig { admission_target })
        .expect("acceptor");
    let remote = iroh::EndpointAddr::new(server.id()).with_ip_addr(direct_addr(&server).await);
    let connection = client
        .endpoint()
        .connect(remote, crate::MACHINE_ALPN)
        .await
        .expect("machine connection");
    let cases: Vec<Vec<u8>> = vec![
        vec![],
        vec![0x02],
        [
            vec![0x01],
            ((crate::MAX_MACHINE_HANDSHAKE_BYTES + 1) as u32)
                .to_be_bytes()
                .to_vec(),
        ]
        .concat(),
        [vec![0x01], 2u32.to_be_bytes().to_vec(), vec![0xff, 0xfe]].concat(),
        [vec![0x01], 1u32.to_be_bytes().to_vec(), b"[".to_vec()].concat(),
    ];
    for bytes in cases {
        let (mut send, mut recv) = connection.open_bi().await.expect("stream");
        send.write_all(&bytes).await.expect("control bytes");
        send.finish().expect("finish control");
        let mut decision = [0u8; 1];
        let read =
            tokio::time::timeout(std::time::Duration::from_secs(2), recv.read(&mut decision))
                .await
                .expect("bounded reject");
        assert!(matches!(read, Ok(None) | Ok(Some(1)) | Err(_)));
        if matches!(read, Ok(Some(1))) {
            assert_eq!(decision[0], 0);
        }
    }
    tokio::time::sleep(std::time::Duration::from_millis(50)).await;
    assert_eq!(admission_contacts.load(Ordering::Relaxed), 0);
    assert_eq!(app_contacts.load(Ordering::Relaxed), 0);
    assert_eq!(acceptor.status().streams_rejected, 5);
    assert_eq!(
        acceptor.status().last_failure,
        Some(crate::MachineFailureCode::InvalidControl)
    );
    acceptor.stop();
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn admission_endpoint_echo_mismatch_never_contacts_any_application_listener() {
    let server = endpoint(IrohCapProfile::MachineBulk).await;
    let client = endpoint(IrohCapProfile::MachineBulk).await;
    let app_contacts = Arc::new(AtomicUsize::new(0));
    let _never_contacted_app = echo_server(Arc::clone(&app_contacts)).await;
    let admission_contacts = Arc::new(AtomicUsize::new(0));
    // The admission response echoes a different endpoint identity than the
    // authenticated transport peer; a valid port selection cannot rescue it.
    let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0))
        .await
        .expect("bind admission");
    let admission_target = listener.local_addr().expect("admission addr");
    let wrong_remote = server.id().to_string();
    let admission_contacts_for_task = Arc::clone(&admission_contacts);
    tokio::spawn(async move {
        while let Ok((mut socket, _)) = listener.accept().await {
            admission_contacts_for_task.fetch_add(1, Ordering::Relaxed);
            let _request = read_http_request(&mut socket).await;
            let response = format!(
                "HTTP/1.1 204 No Content\r\nX-Happier-Iroh-Remote-Endpoint-Id: {wrong_remote}\r\n{IROH_MACHINE_APPLICATION_PORT_HEADER}: 1\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
            );
            socket
                .write_all(response.as_bytes())
                .await
                .expect("echo response");
        }
    });
    let acceptor = MachineAcceptor::start(&server, MachineAcceptorConfig { admission_target })
        .expect("acceptor");
    let tunnel = MachineTunnel::start(
        &client,
        MachineTunnelConfig {
            endpoint_id: server.id().to_string(),
            bind_addr: SocketAddr::new(IpAddr::V4(Ipv4Addr::LOCALHOST), 0),
            direct_addresses: vec![direct_addr(&server).await],
            relay_urls: vec![],
            handshake_json: r#"{"v":1,"operationId":"op-1"}"#.to_owned(),
            cap_profile: IrohCapProfile::MachineBulk,
        },
    )
    .await
    .expect("tunnel");
    let mut socket = TcpStream::connect(tunnel.local_addr().expect("local addr"))
        .await
        .expect("local connect");
    socket
        .write_all(tunnel.local_capability().as_bytes())
        .await
        .expect("local capability");
    socket
        .write_all(b"must-not-reach-app")
        .await
        .expect("write");
    let mut byte = [0u8; 1];
    let _ = tokio::time::timeout(std::time::Duration::from_secs(2), socket.read(&mut byte))
        .await
        .expect("bounded reject");
    assert_eq!(admission_contacts.load(Ordering::Relaxed), 1);
    assert_eq!(app_contacts.load(Ordering::Relaxed), 0);
    assert_eq!(acceptor.status().streams_rejected, 1);
    assert_eq!(
        acceptor.status().last_failure,
        Some(crate::MachineFailureCode::EndpointIdentityMismatch)
    );
    tunnel.stop();
    acceptor.stop();
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn duplicate_or_comma_folded_remote_endpoint_echo_rejects_before_any_application_connection()
{
    let server = endpoint(IrohCapProfile::MachineBulk).await;
    let client = endpoint(IrohCapProfile::MachineBulk).await;
    let app_contacts = Arc::new(AtomicUsize::new(0));
    let _never_contacted_app = echo_server(Arc::clone(&app_contacts)).await;
    let admission_contacts = Arc::new(AtomicUsize::new(0));
    let remote = client.id().to_string();
    // Both echo shapes violate the exact-header contract even though each
    // response is otherwise a valid 2xx admission with a valid application
    // port selection: duplicate echo header lines, then a comma-folded echo
    // value. Neither may reach an application connection.
    let responses = Arc::new(Mutex::new(VecDeque::from([
        format!(
            "HTTP/1.1 204 No Content\r\nX-Happier-Iroh-Remote-Endpoint-Id: {remote}\r\nX-Happier-Iroh-Remote-Endpoint-Id: {remote}\r\n{IROH_MACHINE_APPLICATION_PORT_HEADER}: 1\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
        ),
        format!(
            "HTTP/1.1 204 No Content\r\nX-Happier-Iroh-Remote-Endpoint-Id: {remote}, {remote}\r\n{IROH_MACHINE_APPLICATION_PORT_HEADER}: 1\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
        ),
    ])));
    let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0))
        .await
        .expect("bind admission");
    let admission_target = listener.local_addr().expect("admission addr");
    let admission_contacts_for_task = Arc::clone(&admission_contacts);
    tokio::spawn(async move {
        while let Ok((mut socket, _)) = listener.accept().await {
            admission_contacts_for_task.fetch_add(1, Ordering::Relaxed);
            let _request = read_http_request(&mut socket).await;
            let response = responses
                .lock()
                .expect("response queue")
                .pop_front()
                .expect("queued admission response");
            socket
                .write_all(response.as_bytes())
                .await
                .expect("echo response");
        }
    });
    let acceptor = MachineAcceptor::start(&server, MachineAcceptorConfig { admission_target })
        .expect("acceptor");
    let tunnel = MachineTunnel::start(
        &client,
        MachineTunnelConfig {
            endpoint_id: server.id().to_string(),
            bind_addr: SocketAddr::new(IpAddr::V4(Ipv4Addr::LOCALHOST), 0),
            direct_addresses: vec![direct_addr(&server).await],
            relay_urls: vec![],
            handshake_json: r#"{"v":1,"operationId":"op-1"}"#.to_owned(),
            cap_profile: IrohCapProfile::MachineBulk,
        },
    )
    .await
    .expect("tunnel");
    for _ in 0..2 {
        let mut socket = TcpStream::connect(tunnel.local_addr().expect("local addr"))
            .await
            .expect("local connect");
        socket
            .write_all(tunnel.local_capability().as_bytes())
            .await
            .expect("local capability");
        socket
            .write_all(b"must-not-reach-app")
            .await
            .expect("local write");
        let mut byte = [0u8; 1];
        let result =
            tokio::time::timeout(std::time::Duration::from_secs(5), socket.read(&mut byte))
                .await
                .expect("bounded reject");
        assert!(matches!(result, Ok(0) | Err(_)));
    }
    tokio::time::sleep(std::time::Duration::from_millis(100)).await;
    assert_eq!(admission_contacts.load(Ordering::Relaxed), 2);
    assert_eq!(app_contacts.load(Ordering::Relaxed), 0);
    let status = acceptor.status();
    assert_eq!(status.streams_accepted, 0);
    assert_eq!(status.streams_rejected, 2);
    assert_eq!(
        status.last_failure,
        Some(crate::MachineFailureCode::EndpointIdentityMismatch)
    );
    tunnel.stop();
    acceptor.stop();
}

#[tokio::test]
async fn machine_acceptor_validates_only_the_loopback_admission_target() {
    let endpoint = endpoint(IrohCapProfile::MachineBulk).await;
    let loopback: SocketAddr = "127.0.0.1:1234".parse().unwrap();
    let non_loopback: SocketAddr = "0.0.0.0:1234".parse().unwrap();
    assert!(MachineAcceptor::start(
        &endpoint,
        MachineAcceptorConfig {
            admission_target: non_loopback,
        },
    )
    .is_err());
    // The application destination is not an acceptor input at all: Rust
    // hard-codes the application host to loopback and takes the port only
    // from the trusted local admission response. A loopback admission target
    // starts cleanly; the acceptor guard drops and stops the task.
    let acceptor = MachineAcceptor::start(
        &endpoint,
        MachineAcceptorConfig {
            admission_target: loopback,
        },
    )
    .expect("loopback admission target is accepted");
    acceptor.stop();
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn workspace_sync_accepts_exactly_one_local_socket_for_one_grant() {
    let server = endpoint(IrohCapProfile::MachineBulk).await;
    let client = endpoint(IrohCapProfile::MachineBulk).await;
    let admission_listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).await.unwrap();
    let admission_target = admission_listener.local_addr().unwrap();
    let app_contacts = Arc::new(AtomicUsize::new(0));
    let _never_contacted_app = echo_server(Arc::clone(&app_contacts)).await;
    let acceptor =
        MachineAcceptor::start(&server, MachineAcceptorConfig { admission_target }).unwrap();
    let tunnel = MachineTunnel::start(
        &client,
        MachineTunnelConfig {
            endpoint_id: server.id().to_string(),
            bind_addr: "127.0.0.1:0".parse().unwrap(),
            direct_addresses: vec![direct_addr(&server).await],
            relay_urls: vec![],
            handshake_json: r#"{"v":1,"flow":"workspace_sync","operationId":"workspace"}"#
                .to_owned(),
            cap_profile: IrohCapProfile::MachineBulk,
        },
    )
    .await
    .unwrap();
    let mut sockets = Vec::new();
    for _ in 0..2 {
        let mut socket = TcpStream::connect(tunnel.local_addr().unwrap())
            .await
            .unwrap();
        let _ = socket.write_all(tunnel.local_capability().as_bytes()).await;
        let _ = socket.write_all(b"held").await;
        sockets.push(socket);
    }
    tokio::time::sleep(std::time::Duration::from_millis(100)).await;
    assert_eq!(tunnel.status().streams_opened, 1);
    assert_eq!(app_contacts.load(Ordering::Relaxed), 0);
    drop(sockets);
    drop(admission_listener);
    tunnel.stop();
    acceptor.stop();
}

/// An admitted machine connection that never opens an application stream is
/// released after the same bounded pre-application custody window. Nothing
/// reaches the admission endpoint, because no stream ever existed to carry a
/// handshake.
#[tokio::test]
async fn an_admitted_machine_connection_that_opens_no_stream_drains_after_the_custody_window() {
    let admission_contacts = Arc::new(AtomicUsize::new(0));
    let admission_target = echo_server(Arc::clone(&admission_contacts)).await;
    let server = endpoint(IrohCapProfile::MachineBulk).await;
    let server_addr = direct_addr(&server).await;
    let acceptor = MachineAcceptor::start(&server, MachineAcceptorConfig { admission_target })
        .expect("machine acceptor");
    let client = endpoint(IrohCapProfile::MachineBulk).await;

    let connection = client
        .endpoint()
        .connect(
            iroh::EndpointAddr::new(server.id()).with_ip_addr(server_addr),
            crate::MACHINE_ALPN,
        )
        .await
        .expect("machine dial connects");

    let mut admitted = false;
    for _ in 0..200 {
        if acceptor.status().connections_active == 1 {
            admitted = true;
            break;
        }
        tokio::time::sleep(Duration::from_millis(25)).await;
    }
    assert!(
        admitted,
        "the connection must be admitted before the custody window is measured"
    );

    // The peer never opens a bidirectional application stream.
    tokio::time::timeout(
        crate::endpoint::PRE_APPLICATION_CUSTODY_TIMEOUT + Duration::from_secs(5),
        connection.closed(),
    )
    .await
    .expect("a machine connection that opens no application stream must be released");

    assert_eq!(
        admission_contacts.load(Ordering::Relaxed),
        0,
        "a connection without a first stream must never reach admission"
    );
    assert_eq!(acceptor.status().streams_accepted, 0);

    acceptor.stop();
    client.shutdown().await;
    server.shutdown().await;
}
