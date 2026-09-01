use crate::endpoint::{ConsumerRegistration, ConsumerSlot};
use crate::stream::pump_bidirectional;
use crate::{
    snapshot_for_connection, validate_loopback_bind_addr, validate_loopback_target,
    AcceptedIrohConnection, IrohAlpn, IrohCapProfile, IrohError, IrohPathSnapshot, Result,
    MACHINE_ALPN, TUNNEL_PREAMBLE,
};
use iroh::RelayUrl;
use std::net::{IpAddr, Ipv4Addr, SocketAddr};
use std::str::FromStr;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::mpsc;
use tokio::task::{JoinHandle, JoinSet};

pub const MAX_MACHINE_HANDSHAKE_BYTES: usize = 64 * 1024;
pub const MACHINE_CONTROL_TIMEOUT: Duration = Duration::from_secs(10);
pub const MACHINE_ADMISSION_PATH: &str = "/v1/iroh/machine/admit";
pub const MACHINE_REMOTE_ENDPOINT_HEADER: &str = "X-Happier-Iroh-Remote-Endpoint-Id";
/// Header of the trusted local admission response that selects the
/// application loopback port for the just-admitted stream. Only the locally
/// trusted admission owner may select a destination after it verified the
/// canonical handshake; the remote peer can never name a host or port.
pub const IROH_MACHINE_APPLICATION_PORT_HEADER: &str = "X-Happier-Iroh-Application-Port";
pub const IROH_MACHINE_APPLICATION_CAPABILITY_HEADER: &str =
    "X-Happier-Iroh-Application-Capability";
pub const IROH_MACHINE_HTTP_LOCAL_CAPABILITY_HEADER: &str =
    "X-Happier-Machine-Local-Capability";
pub const MACHINE_LOCAL_CAPABILITY_BYTES: usize = 32;
pub const MACHINE_LOCAL_CAPABILITY_HEX_LENGTH: usize = MACHINE_LOCAL_CAPABILITY_BYTES * 2;
const MAX_ADMISSION_RESPONSE_BYTES: usize = 16 * 1024;
const CONSUMER_CHANNEL_CAPACITY: usize = 16;
pub const MACHINE_STREAM_ACCEPT_BYTE: u8 = 0x01;
pub const MACHINE_STREAM_REJECT_BYTE: u8 = 0x00;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MachineFailureCode {
    InvalidPreamble,
    InvalidControl,
    AdmissionRejected,
    EndpointIdentityMismatch,
    Transport,
}

impl MachineFailureCode {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::InvalidPreamble => "invalid-preamble",
            Self::InvalidControl => "machine-control-invalid",
            Self::AdmissionRejected => "machine-admission-rejected",
            Self::EndpointIdentityMismatch => "endpoint-identity-mismatch",
            Self::Transport => "transport-unavailable",
        }
    }
}

#[derive(Debug, Clone, Copy)]
pub struct MachineAcceptorConfig {
    pub admission_target: SocketAddr,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MachineAcceptorStatus {
    pub running: bool,
    pub connections_accepted: u64,
    pub connections_active: u64,
    pub streams_accepted: u64,
    pub streams_rejected: u64,
    pub last_path: Option<IrohPathSnapshot>,
    pub last_failure: Option<MachineFailureCode>,
}

#[derive(Default)]
struct AcceptorState {
    streams_accepted: AtomicU64,
    streams_rejected: AtomicU64,
    last_failure: Mutex<Option<MachineFailureCode>>,
}

pub struct MachineAcceptor {
    task: JoinHandle<()>,
    state: Arc<AcceptorState>,
    slot: Arc<ConsumerSlot>,
    _registration: ConsumerRegistration,
}

impl MachineAcceptor {
    pub fn start(endpoint: &crate::IrohEndpoint, config: MachineAcceptorConfig) -> Result<Self> {
        validate_target(config.admission_target)?;
        let (sender, mut receiver) = mpsc::channel(CONSUMER_CHANNEL_CAPACITY);
        let registration = endpoint.register_consumer(IrohAlpn::Machine, sender)?;
        let slot = registration.slot().clone();
        let state = Arc::new(AcceptorState::default());
        let loop_state = Arc::clone(&state);
        let task = tokio::spawn(async move {
            let mut connections = JoinSet::new();
            loop {
                tokio::select! {
                    accepted = receiver.recv() => {
                        let Some(accepted) = accepted else { break };
                        connections.spawn(pump_connection(accepted, config, Arc::clone(&loop_state)));
                    }
                    Some(_) = connections.join_next(), if !connections.is_empty() => {}
                }
            }
            drop(connections);
        });
        Ok(Self {
            task,
            state,
            slot,
            _registration: registration,
        })
    }

    pub fn status(&self) -> MachineAcceptorStatus {
        let counters = &self.slot.counters;
        MachineAcceptorStatus {
            running: !self.task.is_finished(),
            connections_accepted: counters.connections_accepted.load(Ordering::Relaxed),
            connections_active: counters.connections_active.load(Ordering::Relaxed),
            streams_accepted: self.state.streams_accepted.load(Ordering::Relaxed),
            streams_rejected: self.state.streams_rejected.load(Ordering::Relaxed),
            last_path: counters
                .last_path
                .lock()
                .ok()
                .and_then(|value| value.clone()),
            last_failure: self.state.last_failure.lock().ok().and_then(|value| *value),
        }
    }
    pub fn stop(self) {
        self.task.abort();
    }
}
impl Drop for MachineAcceptor {
    fn drop(&mut self) {
        self.task.abort();
    }
}

fn validate_target(target: SocketAddr) -> Result<()> {
    validate_loopback_target(&target.ip().to_string(), target.port())
}

async fn pump_connection(
    accepted: AcceptedIrohConnection,
    config: MachineAcceptorConfig,
    state: Arc<AcceptorState>,
) {
    let remote_endpoint_id = accepted.remote_endpoint_id.clone();
    let mut streams = JoinSet::new();
    loop {
        tokio::select! {
            opened = accepted.connection.accept_bi() => match opened {
                Ok((send, recv)) => { streams.spawn(pump_stream(send, recv, config, remote_endpoint_id.clone(), Arc::clone(&state))); }
                Err(_) => break,
            },
            Some(_) = streams.join_next(), if !streams.is_empty() => {}
        };
    }
    drop(streams);
}

async fn pump_stream(
    mut send: iroh::endpoint::SendStream,
    mut recv: iroh::endpoint::RecvStream,
    config: MachineAcceptorConfig,
    remote_endpoint_id: String,
    state: Arc<AcceptorState>,
) {
    let admitted = tokio::time::timeout(MACHINE_CONTROL_TIMEOUT, async {
        let mut preamble = [0u8; 1];
        recv.read_exact(&mut preamble)
            .await
            .map_err(|_| MachineFailureCode::InvalidPreamble)?;
        if preamble[0] != TUNNEL_PREAMBLE {
            return Err(MachineFailureCode::InvalidPreamble);
        }
        let mut encoded_length = [0u8; 4];
        recv.read_exact(&mut encoded_length)
            .await
            .map_err(|_| MachineFailureCode::InvalidControl)?;
        let length = u32::from_be_bytes(encoded_length) as usize;
        if length == 0 || length > MAX_MACHINE_HANDSHAKE_BYTES {
            return Err(MachineFailureCode::InvalidControl);
        }
        let mut handshake = vec![0u8; length];
        recv.read_exact(&mut handshake)
            .await
            .map_err(|_| MachineFailureCode::InvalidControl)?;
        let text =
            std::str::from_utf8(&handshake).map_err(|_| MachineFailureCode::InvalidControl)?;
        let parsed: serde_json::Value =
            serde_json::from_str(text).map_err(|_| MachineFailureCode::InvalidControl)?;
        if !parsed.is_object() {
            return Err(MachineFailureCode::InvalidControl);
        }
        authorize(config.admission_target, &remote_endpoint_id, &handshake).await
    })
    .await;
    let application_target = match admitted {
        Ok(Ok(target)) => target,
        _ => {
            let failure = match admitted {
                Ok(Err(failure)) => failure,
                _ => MachineFailureCode::Transport,
            };
            if let Ok(mut last) = state.last_failure.lock() {
                *last = Some(failure);
            }
            state.streams_rejected.fetch_add(1, Ordering::Relaxed);
            let _ = send.write_all(&[MACHINE_STREAM_REJECT_BYTE]).await;
            let _ = send.finish();
            return;
        }
    };
    // The application host is hard-coded loopback; only the port comes from
    // the trusted local admission response that verified the canonical
    // handshake. No request or peer field can supply a destination.
    let app_target = SocketAddr::new(IpAddr::V4(Ipv4Addr::LOCALHOST), application_target.port);
    let Ok(mut app) = TcpStream::connect(app_target).await else {
        state.streams_rejected.fetch_add(1, Ordering::Relaxed);
        let _ = send.write_all(&[MACHINE_STREAM_REJECT_BYTE]).await;
        let _ = send.finish();
        return;
    };
    if let Some(local_capability) = application_target.local_capability {
        if app.write_all(local_capability.as_bytes()).await.is_err() {
            state.streams_rejected.fetch_add(1, Ordering::Relaxed);
            let _ = send.write_all(&[MACHINE_STREAM_REJECT_BYTE]).await;
            let _ = send.finish();
            return;
        }
    }
    if send.write_all(&[MACHINE_STREAM_ACCEPT_BYTE]).await.is_err() {
        return;
    }
    state.streams_accepted.fetch_add(1, Ordering::Relaxed);
    let (mut app_read, mut app_write) = app.split();
    pump_bidirectional(&mut app_read, &mut app_write, &mut recv, &mut send).await;
}

async fn authorize(
    target: SocketAddr,
    remote_endpoint_id: &str,
    body: &[u8],
) -> std::result::Result<MachineApplicationTarget, MachineFailureCode> {
    let mut socket = TcpStream::connect(target)
        .await
        .map_err(|_| MachineFailureCode::Transport)?;
    let head = format!("POST {MACHINE_ADMISSION_PATH} HTTP/1.1\r\nHost: {target}\r\nContent-Type: application/json\r\nContent-Length: {}\r\n{MACHINE_REMOTE_ENDPOINT_HEADER}: {remote_endpoint_id}\r\nConnection: close\r\n\r\n", body.len());
    socket
        .write_all(head.as_bytes())
        .await
        .map_err(|_| MachineFailureCode::Transport)?;
    socket
        .write_all(body)
        .await
        .map_err(|_| MachineFailureCode::Transport)?;
    let mut response = Vec::new();
    let head_end = loop {
        if response.len() == MAX_ADMISSION_RESPONSE_BYTES {
            return Err(MachineFailureCode::Transport);
        }
        let mut chunk = [0u8; 1024];
        let remaining = MAX_ADMISSION_RESPONSE_BYTES - response.len();
        let read_capacity = remaining.min(chunk.len());
        let read = socket
            .read(&mut chunk[..read_capacity])
            .await
            .map_err(|_| MachineFailureCode::Transport)?;
        if read == 0 {
            return Err(MachineFailureCode::Transport);
        }
        response.extend_from_slice(&chunk[..read]);
        if let Some(index) = response.windows(4).position(|window| window == b"\r\n\r\n") {
            break index + 4;
        }
    };
    if head_end > MAX_ADMISSION_RESPONSE_BYTES {
        return Err(MachineFailureCode::Transport);
    }
    let head = std::str::from_utf8(&response[..head_end - 4])
        .map_err(|_| MachineFailureCode::Transport)?;
    let mut lines = head.split("\r\n");
    let code = lines
        .next()
        .and_then(|line| line.split_ascii_whitespace().nth(1))
        .and_then(|value| value.parse::<u16>().ok())
        .ok_or(MachineFailureCode::Transport)?;
    if !(200..300).contains(&code) {
        return Err(MachineFailureCode::AdmissionRejected);
    }
    // One bounded pass over the bounded response head: exactly one
    // remote-endpoint echo must match the authenticated transport identity,
    // and exactly one well-formed application-port header may exist.
    let mut echoed: Option<&str> = None;
    let mut application_port: Option<&str> = None;
    let mut application_capability: Option<&str> = None;
    for line in lines {
        let Some((name, value)) = line.split_once(':') else {
            continue;
        };
        if name.eq_ignore_ascii_case(MACHINE_REMOTE_ENDPOINT_HEADER) {
            // The exact-header contract: a second (or comma-folded) echo
            // header is ambiguous and fails closed before any application
            // connection.
            if echoed.replace(value.trim()).is_some() {
                return Err(MachineFailureCode::EndpointIdentityMismatch);
            }
        } else if name.eq_ignore_ascii_case(IROH_MACHINE_APPLICATION_PORT_HEADER)
            && application_port.replace(value).is_some()
        {
            // Duplicate (or comma-folded) application-port headers are
            // ambiguous and fail closed before any application connection.
            return Err(MachineFailureCode::AdmissionRejected);
        } else if name.eq_ignore_ascii_case(IROH_MACHINE_APPLICATION_CAPABILITY_HEADER)
            && application_capability.replace(value).is_some()
        {
            return Err(MachineFailureCode::AdmissionRejected);
        }
    }
    let echoed = echoed.ok_or(MachineFailureCode::EndpointIdentityMismatch)?;
    if echoed != remote_endpoint_id {
        return Err(MachineFailureCode::EndpointIdentityMismatch);
    }
    let port =
        parse_application_port(application_port.ok_or(MachineFailureCode::AdmissionRejected)?)?;
    let local_capability = application_capability
        .map(parse_local_capability)
        .transpose()?;
    Ok(MachineApplicationTarget {
        port,
        local_capability,
    })
}

struct MachineApplicationTarget {
    port: u16,
    local_capability: Option<String>,
}

/// Strict canonical decimal port. Optional RFC 7230 OWS (SP/HTAB) around the
/// field value is stripped first, so a normally serialized
/// `X-Happier-Iroh-Application-Port: 46001` header is accepted. The remainder
/// must be ASCII digits only — no sign, internal whitespace, or comma
/// folding — without leading zeros, nonzero, and within 1..=65535.
fn parse_application_port(value: &str) -> std::result::Result<u16, MachineFailureCode> {
    let value = value.trim_matches(|character| character == ' ' || character == '\t');
    let bytes = value.as_bytes();
    let canonical = !bytes.is_empty()
        && bytes.len() <= 5
        && bytes[0] != b'0'
        && bytes.iter().all(|byte| byte.is_ascii_digit());
    if !canonical {
        return Err(MachineFailureCode::AdmissionRejected);
    }
    value
        .parse::<u16>()
        .ok()
        .filter(|port| *port >= 1)
        .ok_or(MachineFailureCode::AdmissionRejected)
}

fn parse_local_capability(value: &str) -> std::result::Result<String, MachineFailureCode> {
    let value = value.trim_matches(|character| character == ' ' || character == '\t');
    if value.len() != MACHINE_LOCAL_CAPABILITY_HEX_LENGTH
        || !value
            .as_bytes()
            .iter()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(byte))
    {
        return Err(MachineFailureCode::AdmissionRejected);
    }
    Ok(value.to_owned())
}

fn generate_local_capability() -> Result<String> {
    let mut bytes = [0u8; MACHINE_LOCAL_CAPABILITY_BYTES];
    getrandom::fill(&mut bytes).map_err(|_| IrohError::TransportClosed)?;
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut encoded = String::with_capacity(MACHINE_LOCAL_CAPABILITY_HEX_LENGTH);
    for byte in bytes {
        encoded.push(HEX[(byte >> 4) as usize] as char);
        encoded.push(HEX[(byte & 0x0f) as usize] as char);
    }
    Ok(encoded)
}

fn capabilities_equal(left: &[u8], right: &[u8]) -> bool {
    if left.len() != right.len() {
        return false;
    }
    left.iter()
        .zip(right)
        .fold(0u8, |difference, (left, right)| difference | (left ^ right))
        == 0
}

#[derive(Debug, Clone)]
pub struct MachineTunnelConfig {
    pub endpoint_id: String,
    pub bind_addr: SocketAddr,
    pub direct_addresses: Vec<SocketAddr>,
    pub relay_urls: Vec<RelayUrl>,
    pub handshake_json: String,
    /// Logical machine-flow cap. The shared endpoint keeps the machine_bulk
    /// physical QUIC ceiling; workspace_sync narrows concurrent local streams
    /// here without creating a second endpoint or interpreting handshake data.
    pub cap_profile: IrohCapProfile,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MachineTunnelStatus {
    pub local_port: u16,
    pub connection_active: bool,
    pub streams_opened: u64,
    /// Normalized authenticated remote endpoint identity this tunnel dials,
    /// surfaced so production adapters can construct authenticated carrier
    /// results without trusting a separate caller-supplied string.
    pub remote_endpoint_id: String,
    pub observed_path: IrohPathSnapshot,
    pub last_failure: Option<MachineFailureCode>,
}

#[derive(Default)]
struct TunnelState {
    connection_active: AtomicBool,
    streams_opened: AtomicU64,
    streams_active: AtomicU64,
    max_streams: u64,
    single_stream: bool,
    local_stream_claimed: AtomicBool,
    last_failure: Mutex<Option<MachineFailureCode>>,
}

pub struct MachineTunnel {
    local_addr: SocketAddr,
    connection: iroh::endpoint::Connection,
    remote_endpoint_id: String,
    local_capability: String,
    task: JoinHandle<()>,
    state: Arc<TunnelState>,
}

/// Fetch-facing loopback lease over the capability-gated machine listener.
///
/// The public listener accepts ordinary HTTP/TCP bytes. Its Rust-owned bridge
/// connects to the private machine listener and writes the ephemeral local
/// capability before copying application bytes. The capability and payload
/// never cross a language binding.
pub struct MachineHttpTunnel {
    local_addr: SocketAddr,
    local_capability: String,
    tunnel: MachineTunnel,
    task: JoinHandle<()>,
}

async fn read_capability_gated_http_request(
    socket: &mut TcpStream,
    expected_capability: &[u8],
) -> std::io::Result<Option<Vec<u8>>> {
    let mut request = Vec::with_capacity(1024);
    let mut chunk = [0u8; 1024];
    loop {
        if request.len() >= MAX_ADMISSION_RESPONSE_BYTES {
            return Ok(None);
        }
        let read = socket.read(&mut chunk).await?;
        if read == 0 {
            return Ok(None);
        }
        request.extend_from_slice(&chunk[..read]);
        if request.windows(4).any(|window| window == b"\r\n\r\n") {
            break;
        }
    }
    let Some(header_end) = request.windows(4).position(|window| window == b"\r\n\r\n") else {
        return Ok(None);
    };
    let Some(request_line_end) = request[..header_end]
        .windows(2)
        .position(|window| window == b"\r\n")
    else {
        return Ok(None);
    };
    let mut capability_line: Option<(usize, usize)> = None;
    let mut line_start = request_line_end + 2;
    while line_start <= header_end {
        let Some(relative_end) = request[line_start..header_end + 2]
            .windows(2)
            .position(|window| window == b"\r\n")
        else {
            break;
        };
        let line_end = line_start + relative_end;
        let line = &request[line_start..line_end];
        if let Some(colon) = line.iter().position(|byte| *byte == b':') {
            let name = line[..colon].trim_ascii_start().trim_ascii_end();
            if name.eq_ignore_ascii_case(IROH_MACHINE_HTTP_LOCAL_CAPABILITY_HEADER.as_bytes()) {
                if capability_line.is_some() {
                    return Ok(None);
                }
                let supplied = line[colon + 1..]
                    .trim_ascii_start()
                    .trim_ascii_end();
                if !capabilities_equal(supplied, expected_capability) {
                    return Ok(None);
                }
                capability_line = Some((line_start, line_end + 2));
            }
        }
        line_start = line_end + 2;
    }
    let Some((capability_start, capability_end)) = capability_line else {
        return Ok(None);
    };
    let mut sanitized = Vec::with_capacity(request.len() - (capability_end - capability_start));
    sanitized.extend_from_slice(&request[..capability_start]);
    sanitized.extend_from_slice(&request[capability_end..]);
    Ok(Some(sanitized))
}

impl MachineHttpTunnel {
    pub async fn start(endpoint: &crate::IrohEndpoint, config: MachineTunnelConfig) -> Result<Self> {
        let tunnel = MachineTunnel::start(endpoint, config).await?;
        let private_addr = tunnel.local_addr()?;
        let local_capability = tunnel.local_capability().to_owned();
        let capability = Arc::<[u8]>::from(local_capability.as_bytes());
        let listener = match TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).await {
            Ok(listener) => listener,
            Err(_) => {
                tunnel.stop();
                return Err(IrohError::LoopbackBindFailed);
            }
        };
        let local_addr = match listener.local_addr() {
            Ok(local_addr) => local_addr,
            Err(_) => {
                tunnel.stop();
                return Err(IrohError::LoopbackBindFailed);
            }
        };
        let task = tokio::spawn(async move {
            let mut streams = JoinSet::new();
            loop {
                tokio::select! {
                    accepted = listener.accept() => {
                        let Ok((mut application, _)) = accepted else { break };
                        let capability = Arc::clone(&capability);
                        streams.spawn(async move {
                            let Ok(Ok(Some(initial_request))) = tokio::time::timeout(
                                MACHINE_CONTROL_TIMEOUT,
                                read_capability_gated_http_request(&mut application, &capability),
                            ).await else { return };
                            let Ok(mut secured) = TcpStream::connect(private_addr).await else { return };
                            if secured.write_all(&capability).await.is_err() { return; }
                            if secured.write_all(&initial_request).await.is_err() { return; }
                            let _ = tokio::io::copy_bidirectional(&mut application, &mut secured).await;
                        });
                    }
                    Some(_) = streams.join_next(), if !streams.is_empty() => {}
                }
            }
            drop(streams);
        });
        Ok(Self { local_addr, local_capability, tunnel, task })
    }

    pub fn local_addr(&self) -> Result<SocketAddr> {
        Ok(self.local_addr)
    }

    pub fn local_port(&self) -> u16 {
        self.local_addr.port()
    }

    pub fn local_capability(&self) -> &str {
        &self.local_capability
    }

    pub fn status(&self) -> MachineTunnelStatus {
        let mut status = self.tunnel.status();
        status.local_port = self.local_port();
        status
    }

    pub fn stop(self) {
        self.task.abort();
        self.tunnel.stop();
    }
}

impl MachineTunnel {
    pub async fn start(
        endpoint: &crate::IrohEndpoint,
        config: MachineTunnelConfig,
    ) -> Result<Self> {
        validate_loopback_bind_addr(config.bind_addr)?;
        validate_handshake(&config.handshake_json)?;
        if !matches!(
            config.cap_profile,
            IrohCapProfile::MachineBulk | IrohCapProfile::WorkspaceSync
        ) {
            return Err(IrohError::EndpointConfigConflict);
        }
        endpoint.ensure_relay_urls(&config.relay_urls).await?;
        let endpoint_id = iroh::EndpointId::from_str(&config.endpoint_id)
            .map_err(|_| IrohError::InvalidDescriptor)?;
        let remote_endpoint_id = endpoint_id.to_string();
        let mut remote = iroh::EndpointAddr::new(endpoint_id);
        for relay in config.relay_urls {
            remote = remote.with_relay_url(relay);
        }
        for addr in config.direct_addresses {
            remote = remote.with_ip_addr(addr);
        }
        let connecting = endpoint
            .endpoint()
            .connect_with_opts(
                remote,
                MACHINE_ALPN,
                iroh::endpoint::ConnectOptions::new()
                    .with_transport_config(config.cap_profile.transport_config()?),
            )
            .await
            .map_err(|_| IrohError::TransportClosed)?;
        let connection = connecting.await.map_err(|_| IrohError::TransportClosed)?;
        let listener = TcpListener::bind(config.bind_addr)
            .await
            .map_err(|_| IrohError::LoopbackBindFailed)?;
        let local_addr = listener
            .local_addr()
            .map_err(|_| IrohError::LoopbackBindFailed)?;
        let handshake = Arc::<[u8]>::from(config.handshake_json.into_bytes());
        let local_capability = generate_local_capability()?;
        let pump_local_capability = Arc::<[u8]>::from(local_capability.as_bytes());
        let state = Arc::new(TunnelState {
            connection_active: AtomicBool::new(true),
            streams_opened: AtomicU64::new(0),
            streams_active: AtomicU64::new(0),
            max_streams: config.cap_profile.limits().max_streams as u64,
            single_stream: config.cap_profile == IrohCapProfile::WorkspaceSync,
            local_stream_claimed: AtomicBool::new(false),
            last_failure: Mutex::new(None),
        });
        let watcher_state = Arc::clone(&state);
        let watcher_connection = connection.clone();
        tokio::spawn(async move {
            watcher_connection.closed().await;
            watcher_state
                .connection_active
                .store(false, Ordering::Release);
        });
        let loop_connection = connection.clone();
        let loop_state = Arc::clone(&state);
        let task = tokio::spawn(async move {
            let mut streams = JoinSet::new();
            loop {
                tokio::select! {
                    accepted = listener.accept() => {
                        let Ok((socket, _)) = accepted else { break };
                        if !loop_state.connection_active.load(Ordering::Acquire) { break; }
                        let previous = loop_state.streams_active.fetch_add(1, Ordering::AcqRel);
                        if previous >= loop_state.max_streams {
                            loop_state.streams_active.fetch_sub(1, Ordering::AcqRel);
                            drop(socket);
                            continue;
                        }
                        streams.spawn(pump_local(
                            loop_connection.clone(),
                            socket,
                            Arc::clone(&handshake),
                            Arc::clone(&pump_local_capability),
                            Arc::clone(&loop_state),
                        ));
                    }
                    Some(_) = streams.join_next(), if !streams.is_empty() => {}
                }
            }
            drop(streams);
        });
        Ok(Self {
            local_addr,
            connection,
            remote_endpoint_id,
            local_capability,
            task,
            state,
        })
    }
    pub fn local_addr(&self) -> Result<SocketAddr> {
        Ok(self.local_addr)
    }
    pub fn local_port(&self) -> u16 {
        self.local_addr.port()
    }
    pub fn local_capability(&self) -> &str {
        &self.local_capability
    }
    pub fn status(&self) -> MachineTunnelStatus {
        MachineTunnelStatus {
            local_port: self.local_addr.port(),
            connection_active: self.state.connection_active.load(Ordering::Acquire),
            streams_opened: self.state.streams_opened.load(Ordering::Relaxed),
            remote_endpoint_id: self.remote_endpoint_id.clone(),
            observed_path: snapshot_for_connection(&self.connection),
            last_failure: self.state.last_failure.lock().ok().and_then(|value| *value),
        }
    }
    pub fn stop(self) {
        self.task.abort();
        self.connection
            .close(0u32.into(), b"machine_tunnel_released");
    }
}

async fn pump_local(
    connection: iroh::endpoint::Connection,
    mut socket: TcpStream,
    handshake: Arc<[u8]>,
    local_capability: Arc<[u8]>,
    state: Arc<TunnelState>,
) {
    struct ActiveStream(Arc<TunnelState>);
    impl Drop for ActiveStream {
        fn drop(&mut self) {
            self.0.streams_active.fetch_sub(1, Ordering::AcqRel);
        }
    }
    let _active = ActiveStream(state);
    let mut supplied_capability = [0u8; MACHINE_LOCAL_CAPABILITY_HEX_LENGTH];
    let capability_result = tokio::time::timeout(
        MACHINE_CONTROL_TIMEOUT,
        socket.read_exact(&mut supplied_capability),
    )
    .await;
    if !matches!(capability_result, Ok(Ok(_)))
        || !capabilities_equal(&supplied_capability, &local_capability)
    {
        return;
    }
    if _active.0.single_stream
        && _active
            .0
            .local_stream_claimed
            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .is_err()
    {
        return;
    }
    _active.0.streams_opened.fetch_add(1, Ordering::Relaxed);
    let Ok((mut send, mut recv)) = connection.open_bi().await else {
        if let Ok(mut last) = _active.0.last_failure.lock() {
            *last = Some(MachineFailureCode::Transport);
        }
        return;
    };
    if send.write_all(&[TUNNEL_PREAMBLE]).await.is_err()
        || send
            .write_all(&(handshake.len() as u32).to_be_bytes())
            .await
            .is_err()
        || send.write_all(&handshake).await.is_err()
    {
        if let Ok(mut last) = _active.0.last_failure.lock() {
            *last = Some(MachineFailureCode::Transport);
        }
        return;
    }
    let mut decision = [0u8; 1];
    let decision_result =
        tokio::time::timeout(MACHINE_CONTROL_TIMEOUT, recv.read_exact(&mut decision)).await;
    if !matches!(decision_result, Ok(Ok(()))) {
        if let Ok(mut last) = _active.0.last_failure.lock() {
            *last = Some(MachineFailureCode::Transport);
        }
        return;
    }
    if decision[0] != MACHINE_STREAM_ACCEPT_BYTE {
        if let Ok(mut last) = _active.0.last_failure.lock() {
            *last = Some(MachineFailureCode::AdmissionRejected);
        }
        return;
    }
    let (mut socket_read, mut socket_write) = socket.split();
    pump_bidirectional(&mut socket_read, &mut socket_write, &mut recv, &mut send).await;
}

fn validate_handshake(value: &str) -> Result<()> {
    if value.is_empty() || value.len() > MAX_MACHINE_HANDSHAKE_BYTES {
        return Err(IrohError::ResourceLimit);
    }
    let parsed: serde_json::Value =
        serde_json::from_str(value).map_err(|_| IrohError::InvalidDescriptor)?;
    if !parsed.is_object() {
        return Err(IrohError::InvalidDescriptor);
    }
    Ok(())
}
