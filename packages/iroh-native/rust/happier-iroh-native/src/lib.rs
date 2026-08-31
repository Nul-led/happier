//! Native lifecycle boundary for the Iroh Home transport.
//!
//! One process endpoint per identity (shared by repeated acceptor/tunnel
//! leases), the handle-based lifecycle from the Lane 06 plan
//! (create/reuse endpoint, start/stop Home acceptor, ensure/release Home
//! tunnel, status, explicit shutdown), and the legacy mobile JSON ops as thin
//! adapters over that single owner. Status/metadata only: no tunnel payload
//! byte ever crosses this boundary.

use base64::{engine::general_purpose::STANDARD as BASE64_STANDARD, Engine as _};
use happier_iroh_core::{
    validate_endpoint_id, validate_loopback_target, EndpointConfig, EndpointIdentity,
    EndpointKeyStore, EndpointManager, EndpointSeed, HomeAcceptor, HomeAcceptorConfig, HomeTunnel,
    HomeTunnelConfig, IrohCapProfile, IrohEndpoint, MachineAcceptor, MachineAcceptorConfig,
    MachineTunnel, MachineTunnelConfig, RelayPolicy, RelaySelection,
};
use serde::Deserialize;
use serde_json::{json, Value};
#[cfg(feature = "test-relay-fixture")]
use std::any::Any;
use std::collections::HashMap;
use std::ffi::{CStr, CString};
use std::net::{IpAddr, SocketAddr};
use std::os::raw::c_char;
use std::path::{Path, PathBuf};
use std::sync::{
    atomic::{AtomicU64, Ordering},
    Mutex, OnceLock,
};
use tokio::runtime::{Builder, Runtime};
use zeroize::Zeroize;

fn default_relay_policy() -> String {
    "automatic".to_owned()
}

fn default_cap_profile() -> String {
    IrohCapProfile::HomeInteractive.id().to_owned()
}

fn default_target_host() -> String {
    "127.0.0.1".to_owned()
}

fn default_machine_cap_profile() -> String {
    IrohCapProfile::MachineBulk.id().to_owned()
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct StartRequest {
    home_server_identity_id: String,
    endpoint_id: String,
    #[serde(default = "default_relay_policy")]
    relay_policy: String,
    #[serde(default)]
    direct_addresses: Vec<SocketAddr>,
    /// Relay hints from the endpoint descriptor. Validated with the Iroh-owned
    /// RelayUrl parser; the descriptor is transport metadata only and never
    /// carries credentials.
    #[serde(default)]
    relay_urls: Vec<String>,
    /// Monotonic descriptor composition revision (protocol: positive integer).
    #[serde(default)]
    descriptor_revision: Option<u64>,
    /// Persistent endpoint identity key path (runtime credential layout).
    /// Missing keys are created on first use; corrupt keys fail closed and
    /// are never silently rotated.
    #[serde(default)]
    endpoint_key_path: Option<String>,
    /// Native-only mobile secure-store seed. This field is injected by the
    /// Swift/Kotlin host immediately before C/JNI and is intentionally absent
    /// from the public TypeScript request type.
    #[serde(default)]
    endpoint_seed_base64: Option<String>,
    #[serde(default = "default_cap_profile")]
    cap_profile: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateEndpointRequest {
    #[serde(default)]
    key_path: Option<String>,
    #[serde(default = "default_relay_policy")]
    relay_policy: String,
    #[serde(default)]
    relay_urls: Vec<String>,
    #[serde(default = "default_cap_profile")]
    cap_profile: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StartHomeAcceptorRequest {
    endpoint_handle: String,
    #[serde(default = "default_target_host")]
    target_host: String,
    target_port: u16,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct EndpointHandleRequest {
    endpoint_handle: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct EnsureTunnelRequest {
    endpoint_handle: String,
    home_server_identity_id: String,
    endpoint_id: String,
    #[serde(default)]
    direct_addresses: Vec<SocketAddr>,
    #[serde(default)]
    relay_urls: Vec<String>,
    #[serde(default)]
    descriptor_revision: Option<u64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TunnelHandleRequest {
    tunnel_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StartMachineAcceptorRequest {
    endpoint_handle: String,
    #[serde(default = "default_target_host")]
    admission_host: String,
    admission_port: u16,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StartMachineTunnelRequest {
    endpoint_handle: String,
    endpoint_id: String,
    #[serde(default)]
    direct_addresses: Vec<SocketAddr>,
    #[serde(default)]
    relay_urls: Vec<String>,
    handshake_json: String,
    #[serde(default = "default_machine_cap_profile")]
    cap_profile: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct MachineTunnelHandleRequest {
    machine_tunnel_id: String,
}

struct AcceptorEntry {
    acceptor: HomeAcceptor,
    target: SocketAddr,
}

struct TunnelLease {
    home_server_identity_id: String,
    endpoint_handle: String,
    tunnel: HomeTunnel,
    runtime_origin: String,
    started_at_ms: u64,
    descriptor_revision: Option<u64>,
}

struct MachineAcceptorEntry {
    acceptor: MachineAcceptor,
    admission_target: SocketAddr,
}

struct MachineTunnelLease {
    endpoint_handle: String,
    tunnel: MachineTunnel,
    started_at_ms: u64,
}

#[cfg(feature = "test-relay-fixture")]
enum TestTopology {
    Automatic,
    DirectOnly,
    RelayOnly {
        relay_url: String,
        // The pinned test relay stops when this drop guard is released. Its
        // concrete server type is deliberately erased so the lifecycle crate
        // does not grow a second relay-server API.
        _relay_server: Box<dyn Any + Send>,
    },
}

#[cfg(feature = "test-relay-fixture")]
struct TestFixtureState {
    topology: TestTopology,
    observed_path: &'static str,
}

/// The one process runtime: shared endpoints, acceptors, and tunnel leases.
/// Direct lifecycle state only — no registry framework.
struct NativeRuntime {
    manager: EndpointManager,
    endpoint_handles: Mutex<HashMap<String, EndpointIdentity>>,
    acceptors: Mutex<HashMap<String, AcceptorEntry>>,
    tunnels: Mutex<HashMap<String, TunnelLease>>,
    machine_acceptors: Mutex<HashMap<String, MachineAcceptorEntry>>,
    machine_tunnels: Mutex<HashMap<String, MachineTunnelLease>>,
    next_id: AtomicU64,
    #[cfg(feature = "test-relay-fixture")]
    test_operation: Mutex<()>,
    #[cfg(feature = "test-relay-fixture")]
    test_fixture: Mutex<TestFixtureState>,
}

static RUNTIME: OnceLock<Runtime> = OnceLock::new();
static STATE: OnceLock<NativeRuntime> = OnceLock::new();

fn runtime() -> &'static Runtime {
    RUNTIME.get_or_init(|| {
        Builder::new_multi_thread()
            .enable_all()
            .build()
            .expect("Iroh runtime must build")
    })
}

fn state() -> &'static NativeRuntime {
    STATE.get_or_init(|| NativeRuntime {
        manager: EndpointManager::new(),
        endpoint_handles: Mutex::new(HashMap::new()),
        acceptors: Mutex::new(HashMap::new()),
        tunnels: Mutex::new(HashMap::new()),
        machine_acceptors: Mutex::new(HashMap::new()),
        machine_tunnels: Mutex::new(HashMap::new()),
        next_id: AtomicU64::new(1),
        #[cfg(feature = "test-relay-fixture")]
        test_operation: Mutex::new(()),
        #[cfg(feature = "test-relay-fixture")]
        test_fixture: Mutex::new(TestFixtureState {
            topology: TestTopology::Automatic,
            observed_path: "unknown",
        }),
    })
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|v| v.as_millis() as u64)
        .unwrap_or(0)
}

fn next_id() -> String {
    format!("iroh-{}", state().next_id.fetch_add(1, Ordering::Relaxed))
}

fn response(value: Value) -> *mut c_char {
    CString::new(value.to_string())
        .expect("JSON has no NUL bytes")
        .into_raw()
}

type OpError = (&'static str, String);

fn parse_json<T: for<'de> Deserialize<'de>>(value: *const c_char) -> Result<T, OpError> {
    if value.is_null() {
        return Err(("invalid-request", "request is required".to_owned()));
    }
    let raw = unsafe { CStr::from_ptr(value) }
        .to_str()
        .map_err(|_| ("invalid-request", "request is not UTF-8".to_owned()))?;
    serde_json::from_str(raw).map_err(|error| ("invalid-request", error.to_string()))
}

fn error_response(code: &str, message: impl Into<String>) -> Value {
    json!({"ok": false, "error": {"code": code, "message": message.into()}})
}

/// Interprets a C UTF-8 request pointer for the safe JSON entry points below.
fn c_request_str<'a>(value: *const c_char) -> Result<&'a str, OpError> {
    if value.is_null() {
        return Err(("invalid-request", "request is required".to_owned()));
    }
    unsafe { CStr::from_ptr(value) }
        .to_str()
        .map_err(|_| ("invalid-request", "request is not UTF-8".to_owned()))
}

fn parse_relay_policy(value: &str) -> Result<RelayPolicy, &'static str> {
    match value {
        "automatic" => Ok(RelayPolicy::Automatic),
        "disabled" => Ok(RelayPolicy::Disabled),
        _ => Err("relayPolicy must be automatic or disabled"),
    }
}

fn parse_cap_profile(value: &str) -> Result<IrohCapProfile, &'static str> {
    IrohCapProfile::parse(value)
        .map_err(|_| "capProfile must be homeInteractive, machineBulk, or workspaceSync")
}

fn key_path_option(value: &Option<String>) -> Result<Option<PathBuf>, &'static str> {
    match value {
        Some(path) if path.trim().is_empty() => Err("endpointKeyPath must not be empty"),
        Some(path) => Ok(Some(PathBuf::from(path))),
        None => Ok(None),
    }
}

fn endpoint_seed_option(value: &mut Option<String>) -> Result<Option<EndpointSeed>, &'static str> {
    let Some(mut encoded) = value.take() else {
        return Ok(None);
    };
    if encoded.is_empty() {
        encoded.zeroize();
        return Err("endpoint seed is invalid");
    }
    let decoded = BASE64_STANDARD.decode(encoded.as_bytes());
    encoded.zeroize();
    let mut decoded = decoded.map_err(|_| "endpoint seed is invalid")?;
    if decoded.len() != 32 {
        decoded.zeroize();
        return Err("endpoint seed is invalid");
    }
    let mut bytes = [0u8; 32];
    bytes.copy_from_slice(&decoded);
    decoded.zeroize();
    Ok(Some(EndpointSeed::from_bytes(bytes)))
}

/// Corrupt existing identity keys fail closed before any transport starts; a
/// missing key is provisioned exactly once on first use with restrictive
/// permissions.
fn ensure_endpoint_key(key_path: Option<&Path>) -> Result<(), OpError> {
    if let Some(path) = key_path {
        EndpointKeyStore::ensure(path).map_err(|_| {
            (
                "endpoint_key_unavailable",
                "endpoint identity key is missing or corrupt; explicit re-pair is required"
                    .to_owned(),
            )
        })?;
    }
    Ok(())
}

fn endpoint_handle_for(key_path: Option<&Path>) -> String {
    match key_path {
        Some(path) => path.to_string_lossy().into_owned(),
        None => next_id(),
    }
}

/// Keyless handles map to unshared ephemeral identities (first-provisioning
/// and test callers only; production always passes key paths).
fn ephemeral_identity() -> EndpointIdentity {
    static NEXT_EPHEMERAL: AtomicU64 = AtomicU64::new(1);
    EndpointIdentity::Ephemeral(NEXT_EPHEMERAL.fetch_add(1, Ordering::Relaxed))
}

fn register_endpoint_handle(handle: &str, identity: EndpointIdentity) {
    state()
        .endpoint_handles
        .lock()
        .expect("endpoint handle lock poisoned")
        .insert(handle.to_owned(), identity);
}

fn endpoint_identity_for(handle: &str) -> Option<EndpointIdentity> {
    state()
        .endpoint_handles
        .lock()
        .expect("endpoint handle lock poisoned")
        .get(handle)
        .cloned()
}

fn endpoint_config(
    key_path: Option<PathBuf>,
    key_seed: Option<EndpointSeed>,
    relay_policy: RelayPolicy,
    relay_urls: Vec<String>,
    caps: IrohCapProfile,
) -> EndpointConfig {
    let config = EndpointConfig {
        key_path,
        key_seed,
        relay_policy,
        relay_urls,
        caps,
        disable_ip_transports: false,
        ..EndpointConfig::default()
    };
    #[cfg(feature = "test-relay-fixture")]
    {
        let mut config = config;
        let fixture = state()
            .test_fixture
            .lock()
            .expect("test fixture lock poisoned");
        match &fixture.topology {
            TestTopology::Automatic => {}
            TestTopology::DirectOnly => {
                config.relay_policy = RelayPolicy::Disabled;
                config.relay_urls.clear();
            }
            TestTopology::RelayOnly { relay_url, .. } => {
                config.relay_policy = RelayPolicy::Automatic;
                config.relay_urls = vec![relay_url.clone()];
                config.disable_ip_transports = true;
                config.insecure_relay_tls = true;
            }
        }
        return config;
    }
    #[cfg(not(feature = "test-relay-fixture"))]
    config
}

#[cfg(feature = "test-relay-fixture")]
fn test_fixture_has_active_endpoints() -> bool {
    !state()
        .endpoint_handles
        .lock()
        .expect("endpoint handle lock poisoned")
        .is_empty()
}

#[cfg(feature = "test-relay-fixture")]
fn test_fixture_busy_response() -> Value {
    error_response(
        "test-fixture-busy",
        "Iroh test topology cannot change while native endpoints are active",
    )
}

#[cfg(feature = "test-relay-fixture")]
fn force_direct_only_for_tests() -> Value {
    let _operation = state()
        .test_operation
        .lock()
        .expect("test operation lock poisoned");
    if test_fixture_has_active_endpoints() {
        return test_fixture_busy_response();
    }
    let mut fixture = state()
        .test_fixture
        .lock()
        .expect("test fixture lock poisoned");
    fixture.topology = TestTopology::DirectOnly;
    fixture.observed_path = "unknown";
    json!({"ok": true})
}

#[cfg(feature = "test-relay-fixture")]
fn force_relay_only_for_tests() -> Value {
    let _operation = state()
        .test_operation
        .lock()
        .expect("test operation lock poisoned");
    if test_fixture_has_active_endpoints() {
        return test_fixture_busy_response();
    }
    let relay = runtime().block_on(iroh::test_utils::run_relay_server_with(false));
    let (_, relay_url, relay_server) = match relay {
        Ok(value) => value,
        Err(error) => {
            return error_response(
                "test-fixture-unavailable",
                format!("local Iroh test relay failed to start: {error}"),
            )
        }
    };
    let mut fixture = state()
        .test_fixture
        .lock()
        .expect("test fixture lock poisoned");
    fixture.topology = TestTopology::RelayOnly {
        relay_url: relay_url.to_string(),
        _relay_server: Box::new(relay_server),
    };
    fixture.observed_path = "unknown";
    json!({"ok": true})
}

#[cfg(feature = "test-relay-fixture")]
fn restore_automatic_for_tests() -> Value {
    let _operation = state()
        .test_operation
        .lock()
        .expect("test operation lock poisoned");
    if test_fixture_has_active_endpoints() {
        return test_fixture_busy_response();
    }
    let mut fixture = state()
        .test_fixture
        .lock()
        .expect("test fixture lock poisoned");
    fixture.topology = TestTopology::Automatic;
    fixture.observed_path = "unknown";
    json!({"ok": true})
}

#[cfg(feature = "test-relay-fixture")]
fn record_test_observed_path(observed_path: &'static str) {
    let mut fixture = state()
        .test_fixture
        .lock()
        .expect("test fixture lock poisoned");
    fixture.observed_path = observed_path;
}

#[cfg(feature = "test-relay-fixture")]
fn test_observed_path() -> &'static str {
    state()
        .test_fixture
        .lock()
        .expect("test fixture lock poisoned")
        .observed_path
}

#[cfg(feature = "test-relay-fixture")]
fn test_relay_url() -> Option<String> {
    let fixture = state()
        .test_fixture
        .lock()
        .expect("test fixture lock poisoned");
    match &fixture.topology {
        TestTopology::RelayOnly { relay_url, .. } => Some(relay_url.clone()),
        TestTopology::Automatic | TestTopology::DirectOnly => None,
    }
}

/// Creates or returns the shared process endpoint for a handle. Incompatible
/// relay/cap configuration on an existing identity fails typed and closed.
async fn acquire_shared_endpoint(
    handle: String,
    identity: EndpointIdentity,
    config: EndpointConfig,
) -> Result<std::sync::Arc<IrohEndpoint>, Value> {
    register_endpoint_handle(&handle, identity.clone());
    match state().manager.acquire_identified(identity, &config).await {
        Ok(endpoint) => Ok(endpoint),
        Err(happier_iroh_core::IrohError::EndpointConfigConflict) => Err(error_response(
            "endpoint_config_conflict",
            "endpoint identity already bound with an incompatible relay or cap configuration",
        )),
        Err(_) => Err(error_response(
            "transport-unavailable",
            "Iroh endpoint bind failed",
        )),
    }
}

fn tunnel_start_error(error: happier_iroh_core::IrohError) -> Value {
    use happier_iroh_core::IrohError;
    match error {
        IrohError::InvalidDescriptor => {
            error_response("invalid_descriptor", "Home tunnel descriptor is invalid")
        }
        IrohError::UnsupportedAlpn => {
            error_response("unsupported_alpn", "Home tunnel ALPN is unsupported")
        }
        IrohError::InvalidPreamble => {
            error_response("invalid_preamble", "Home tunnel preamble is invalid")
        }
        IrohError::EndpointConfigConflict => error_response(
            "endpoint_config_conflict",
            "Home tunnel endpoint configuration conflicts with the shared endpoint",
        ),
        IrohError::ResourceLimit => {
            error_response("resource_limit", "Home tunnel resource limit reached")
        }
        IrohError::LoopbackBindFailed => {
            error_response("loopback_bind_failed", "Home tunnel loopback bind failed")
        }
        IrohError::TransportTimeout => {
            error_response("transport_timeout", "Home tunnel transport timed out")
        }
        IrohError::TransportClosed => {
            error_response("transport_closed", "Home tunnel transport closed")
        }
        IrohError::Cancelled => error_response("cancelled", "Home tunnel start was cancelled"),
        IrohError::Io(_) => error_response(
            "transport-unavailable",
            "Home tunnel transport is unavailable",
        ),
    }
}

fn machine_start_error(error: happier_iroh_core::IrohError) -> Value {
    use happier_iroh_core::IrohError;
    match error {
        IrohError::InvalidDescriptor => error_response(
            "machine-control-invalid",
            "machine handshake control is invalid",
        ),
        IrohError::UnsupportedAlpn => {
            error_response("unsupported-alpn", "machine ALPN is unsupported")
        }
        IrohError::InvalidPreamble => {
            error_response("invalid-preamble", "machine stream preamble is invalid")
        }
        IrohError::EndpointConfigConflict => error_response(
            "endpoint_config_conflict",
            "machine endpoint configuration conflicts with the shared endpoint",
        ),
        IrohError::ResourceLimit => {
            error_response("resource-limit", "machine carrier resource limit reached")
        }
        IrohError::LoopbackBindFailed => error_response(
            "loopback-bind-failed",
            "machine tunnel loopback bind failed",
        ),
        _ => error_response("transport-unavailable", "machine transport is unavailable"),
    }
}

fn observed_path_string(tunnel: &HomeTunnel) -> &'static str {
    tunnel
        .status()
        .observed_path
        .map(|snapshot| snapshot.observed_path.as_str())
        .unwrap_or("unknown")
}

fn insert_lease(
    tunnel_id: String,
    home_server_identity_id: String,
    endpoint_handle: String,
    tunnel: HomeTunnel,
    descriptor_revision: Option<u64>,
) -> (String, String, u64, &'static str) {
    let runtime_origin = tunnel.local_origin().unwrap_or_default();
    let observed_path = observed_path_string(&tunnel);
    #[cfg(feature = "test-relay-fixture")]
    record_test_observed_path(observed_path);
    let started_at_ms = now_ms();
    state().tunnels.lock().expect("lease lock poisoned").insert(
        tunnel_id.clone(),
        TunnelLease {
            home_server_identity_id: home_server_identity_id.clone(),
            endpoint_handle: endpoint_handle.clone(),
            tunnel,
            runtime_origin: runtime_origin.clone(),
            started_at_ms,
            descriptor_revision,
        },
    );
    (tunnel_id, runtime_origin, started_at_ms, observed_path)
}

// ---------------------------------------------------------------------------
// Legacy mobile JSON ops (thin adapters over the shared runtime)
// ---------------------------------------------------------------------------

fn start(value: *const c_char) -> Value {
    match c_request_str(value) {
        Ok(request) => start_home_tunnel_json(request),
        Err((code, message)) => error_response(&code, message),
    }
}

/// Safe JSON lifecycle entry point (legacy Home tunnel lease: the shared
/// process endpoint plus one tunnel lease in a single op). Consumed by the
/// C/JNI wrappers and the desktop (Tauri/Electron) hosts; responses are the
/// strict `{ok,result}|{ok,error}` envelopes and never contain key material.
pub fn start_home_tunnel_json(request: &str) -> Value {
    #[cfg(feature = "test-relay-fixture")]
    let _test_operation = state()
        .test_operation
        .lock()
        .expect("test operation lock poisoned");
    let mut input = match serde_json::from_str::<StartRequest>(request) {
        Ok(v) => v,
        Err(error) => return error_response("invalid-request", error.to_string()),
    };
    if input.home_server_identity_id.trim().is_empty() {
        return error_response("invalid-request", "homeServerIdentityId is required");
    }
    if validate_endpoint_id(&input.endpoint_id).is_err() {
        return error_response("endpoint-identity-invalid", "endpointId is invalid");
    }
    let relay_policy = match parse_relay_policy(&input.relay_policy) {
        Ok(v) => v,
        Err(message) => return error_response("invalid-request", message),
    };
    let caps = match parse_cap_profile(&input.cap_profile) {
        Ok(v) => v,
        Err(message) => return error_response("invalid-request", message),
    };
    // The Iroh RelayUrl parser owns the grammar; the descriptor policy owns
    // scheme/credentials/bounds. Invalid relay URLs are typed invalid-request.
    let relay_selection = match RelaySelection::resolve(&relay_policy, &input.relay_urls) {
        Ok(v) => v,
        Err(_) => return error_response("invalid-request", "relayUrls entry is invalid"),
    };
    if input.descriptor_revision == Some(0) {
        return error_response(
            "invalid-request",
            "descriptorRevision must be a positive integer",
        );
    }
    let key_path = match key_path_option(&input.endpoint_key_path) {
        Ok(v) => v,
        Err(message) => return error_response("invalid-request", message),
    };
    let key_seed = match endpoint_seed_option(&mut input.endpoint_seed_base64) {
        Ok(value) => value,
        Err(message) => return error_response("invalid-request", message),
    };
    if key_path.is_some() && key_seed.is_some() {
        return error_response(
            "invalid-request",
            "endpointKeyPath and native endpoint seed are mutually exclusive",
        );
    }
    if let Err((code, message)) = ensure_endpoint_key(key_path.as_deref()) {
        return error_response(code, message);
    }

    let handle = match &key_seed {
        Some(seed) => format!("mobile:{}", seed.endpoint_id()),
        None => endpoint_handle_for(key_path.as_deref()),
    };
    let identity = match (&key_path, &key_seed) {
        (_, Some(seed)) => EndpointIdentity::Seeded(seed.endpoint_id()),
        (Some(path), None) => EndpointIdentity::Keyed(path.clone()),
        (None, None) => ephemeral_identity(),
    };
    let endpoint = match runtime().block_on(acquire_shared_endpoint(
        handle.clone(),
        identity,
        endpoint_config(
            key_path,
            key_seed,
            relay_policy,
            input.relay_urls.clone(),
            caps,
        ),
    )) {
        Ok(endpoint) => endpoint,
        Err(error) => return error,
    };
    let tunnel = match runtime().block_on(HomeTunnel::start(
        &endpoint,
        HomeTunnelConfig {
            endpoint_id: input.endpoint_id.clone(),
            direct_addresses: input.direct_addresses.clone(),
            relay_urls: relay_selection.relay_urls().to_vec(),
            ..HomeTunnelConfig::default()
        },
    )) {
        Ok(tunnel) => tunnel,
        Err(error) => return tunnel_start_error(error),
    };
    let (lease_id, runtime_origin, started_at_ms, observed_path) = insert_lease(
        next_id(),
        input.home_server_identity_id.clone(),
        handle.clone(),
        tunnel,
        input.descriptor_revision,
    );
    json!({"ok": true, "result": {
        "leaseId": lease_id, "homeServerIdentityId": input.home_server_identity_id,
        "homeEndpointId": input.endpoint_id, "runtimeOrigin": runtime_origin,
        "carrier": "iroh", "observedPath": observed_path, "startedAtMs": started_at_ms,
        "descriptorRevision": input.descriptor_revision, "endpointHandle": handle
    }})
}

/// Legacy `stopHomeTunnel` is a lease release only: it never shuts down the
/// shared process endpoint or sibling leases.
fn stop(value: *const c_char) -> Value {
    if value.is_null() {
        return error_response("invalid-request", "leaseId is required");
    }
    match c_request_str(value) {
        Ok(lease_id) => stop_home_tunnel_json(lease_id),
        Err((code, message)) => error_response(&code, message),
    }
}

/// Safe JSON lifecycle entry point for the legacy lease release (idempotent,
/// lease-scoped; the endpoint handle and persistent identity are untouched).
pub fn stop_home_tunnel_json(lease_id: &str) -> Value {
    let lease = state()
        .tunnels
        .lock()
        .expect("lease lock poisoned")
        .remove(lease_id);
    if let Some(lease) = lease {
        lease.tunnel.stop();
    }
    json!({"ok": true})
}

/// Payload-free status polling surface shared by mobile and desktop hosts.
/// The native runtime remains the sole transport-state owner; callers do not
/// provide prior state or receive queued events.
pub fn get_home_tunnel_status_json(home_server_identity_id: &str) -> Value {
    let tunnels = state().tunnels.lock().expect("lease lock poisoned");
    let result = tunnels
        .values()
        .find(|lease| lease.home_server_identity_id == home_server_identity_id)
        .map(|lease| {
            let tunnel_status = lease.tunnel.status();
            json!({
                "observedPath": tunnel_status
                    .observed_path
                    .map(|snapshot| snapshot.observed_path.as_str())
                    .unwrap_or("unknown"),
                "connectionActive": tunnel_status.connection_active,
                "active": tunnel_status.connection_active,
                "endpointHandle": lease.endpoint_handle,
            })
        })
        .unwrap_or(Value::Null);
    json!({"ok": true, "result": result})
}

// ---------------------------------------------------------------------------
// Handle-based lifecycle ops (plan §7.4)
// ---------------------------------------------------------------------------

fn create_endpoint(value: *const c_char) -> Value {
    #[cfg(feature = "test-relay-fixture")]
    let _test_operation = state()
        .test_operation
        .lock()
        .expect("test operation lock poisoned");
    let input = match parse_json::<CreateEndpointRequest>(value) {
        Ok(v) => v,
        Err((code, message)) => return error_response(&code, message),
    };
    let relay_policy = match parse_relay_policy(&input.relay_policy) {
        Ok(v) => v,
        Err(message) => return error_response("invalid-request", message),
    };
    let caps = match parse_cap_profile(&input.cap_profile) {
        Ok(v) => v,
        Err(message) => return error_response("invalid-request", message),
    };
    let relay_selection_valid = RelaySelection::resolve(&relay_policy, &input.relay_urls);
    if relay_selection_valid.is_err() {
        return error_response("invalid-request", "relayUrls entry is invalid");
    }
    let key_path = match key_path_option(&input.key_path) {
        Ok(v) => v,
        Err(message) => return error_response("invalid-request", message),
    };
    if let Err((code, message)) = ensure_endpoint_key(key_path.as_deref()) {
        return error_response(code, message);
    }
    let handle = endpoint_handle_for(key_path.as_deref());
    let identity = match &key_path {
        Some(path) => EndpointIdentity::Keyed(path.clone()),
        None => ephemeral_identity(),
    };
    let endpoint = match runtime().block_on(acquire_shared_endpoint(
        handle.clone(),
        identity,
        endpoint_config(key_path, None, relay_policy, input.relay_urls.clone(), caps),
    )) {
        Ok(endpoint) => endpoint,
        Err(error) => return error,
    };
    json!({"ok": true, "result": {
        "endpointHandle": handle,
        "endpointId": endpoint.id().to_string(),
        "relayMode": endpoint.relay_selection().mode(),
        "capProfile": endpoint.caps().id(),
        "relayUrls": endpoint.relay_selection().relay_urls().iter().map(|url| url.to_string()).collect::<Vec<_>>(),
    }})
}

fn start_home_acceptor(value: *const c_char) -> Value {
    let input = match parse_json::<StartHomeAcceptorRequest>(value) {
        Ok(v) => v,
        Err((code, message)) => return error_response(&code, message),
    };
    if validate_loopback_target(&input.target_host, input.target_port).is_err() {
        return error_response(
            "loopback-bind-failed",
            "Home acceptor target must be a loopback address with a concrete port",
        );
    }
    let target_ip: IpAddr = if input.target_host == "localhost" {
        IpAddr::V4(std::net::Ipv4Addr::LOCALHOST)
    } else {
        match input.target_host.parse() {
            Ok(ip) => ip,
            Err(_) => return error_response("invalid-request", "targetHost is not an IP address"),
        }
    };
    let target = SocketAddr::new(target_ip, input.target_port);
    let Some(identity) = endpoint_identity_for(&input.endpoint_handle) else {
        return error_response("not-found", "endpointHandle is unknown");
    };
    let Some((_, endpoint)) = state().manager.get(&identity) else {
        return error_response("not-found", "endpoint is shut down");
    };
    let mut acceptors = state().acceptors.lock().expect("acceptor lock poisoned");
    if let Some(existing) = acceptors.get(&input.endpoint_handle) {
        if existing.target == target {
            return json!({"ok": true, "result": {
                "endpointHandle": input.endpoint_handle,
                "reused": true,
                "status": acceptor_status_json(existing.acceptor.status()),
            }});
        }
        return error_response(
            "endpoint_config_conflict",
            "an acceptor is already running for this endpoint with a different loopback target",
        );
    }
    // HomeAcceptor::start owns a Tokio accept task. The C ABI is synchronous,
    // so enter the process runtime explicitly before it spawns that task.
    let _runtime_guard = runtime().enter();
    match HomeAcceptor::start(&endpoint, HomeAcceptorConfig { target }) {
        Ok(acceptor) => {
            let status = acceptor.status();
            acceptors.insert(
                input.endpoint_handle.clone(),
                AcceptorEntry { acceptor, target },
            );
            json!({"ok": true, "result": {
                "endpointHandle": input.endpoint_handle,
                "reused": false,
                "status": acceptor_status_json(status),
            }})
        }
        Err(_) => error_response("loopback-bind-failed", "Home acceptor failed to start"),
    }
}

fn stop_home_acceptor(value: *const c_char) -> Value {
    let input = match parse_json::<EndpointHandleRequest>(value) {
        Ok(v) => v,
        Err((code, message)) => return error_response(&code, message),
    };
    if let Some(entry) = state()
        .acceptors
        .lock()
        .expect("acceptor lock poisoned")
        .remove(&input.endpoint_handle)
    {
        entry.acceptor.stop();
    }
    json!({"ok": true})
}

fn ensure_home_tunnel(value: *const c_char) -> Value {
    let input = match parse_json::<EnsureTunnelRequest>(value) {
        Ok(v) => v,
        Err((code, message)) => return error_response(&code, message),
    };
    if input.home_server_identity_id.trim().is_empty() {
        return error_response("invalid-request", "homeServerIdentityId is required");
    }
    if validate_endpoint_id(&input.endpoint_id).is_err() {
        return error_response("invalid-request", "endpointId is invalid");
    }
    if input.descriptor_revision == Some(0) {
        return error_response(
            "invalid-request",
            "descriptorRevision must be a positive integer",
        );
    }
    let Some(identity) = endpoint_identity_for(&input.endpoint_handle) else {
        return error_response("not-found", "endpointHandle is unknown");
    };
    let Some((config, endpoint)) = state().manager.get(&identity) else {
        return error_response("not-found", "endpoint is shut down");
    };
    // Tunnel relay hints respect the endpoint's relay selection: a direct-only
    // endpoint never contacts descriptor relays; an automatic endpoint uses the
    // request's validated hints, falling back to its own configured relays.
    let tunnel_hints = match &config.relay {
        RelaySelection::Disabled => Vec::new(),
        RelaySelection::Custom(_) => {
            let requested =
                match RelaySelection::resolve(&RelayPolicy::Automatic, &input.relay_urls) {
                    Ok(selection) => selection,
                    Err(_) => {
                        return error_response("invalid-request", "relayUrls entry is invalid")
                    }
                };
            if requested.relay_urls().is_empty() {
                config.relay.relay_urls().to_vec()
            } else {
                requested.relay_urls().to_vec()
            }
        }
    };
    let tunnel = match runtime().block_on(HomeTunnel::start(
        &endpoint,
        HomeTunnelConfig {
            endpoint_id: input.endpoint_id.clone(),
            direct_addresses: input.direct_addresses.clone(),
            relay_urls: tunnel_hints,
            ..HomeTunnelConfig::default()
        },
    )) {
        Ok(tunnel) => tunnel,
        Err(error) => return tunnel_start_error(error),
    };
    let (tunnel_id, runtime_origin, started_at_ms, observed_path) = insert_lease(
        next_id(),
        input.home_server_identity_id.clone(),
        input.endpoint_handle.clone(),
        tunnel,
        input.descriptor_revision,
    );
    json!({"ok": true, "result": {
        "tunnelId": tunnel_id,
        "homeServerIdentityId": input.home_server_identity_id,
        "homeEndpointId": input.endpoint_id,
        "runtimeOrigin": runtime_origin,
        "carrier": "iroh",
        "observedPath": observed_path,
        "startedAtMs": started_at_ms,
        "descriptorRevision": input.descriptor_revision,
        "endpointHandle": input.endpoint_handle,
    }})
}

fn release_home_tunnel(value: *const c_char) -> Value {
    let input = match parse_json::<TunnelHandleRequest>(value) {
        Ok(v) => v,
        Err((code, message)) => return error_response(&code, message),
    };
    if let Some(lease) = state()
        .tunnels
        .lock()
        .expect("lease lock poisoned")
        .remove(&input.tunnel_id)
    {
        lease.tunnel.stop();
    }
    json!({"ok": true})
}

fn loopback_target(host: &str, port: u16) -> Result<SocketAddr, Value> {
    if validate_loopback_target(host, port).is_err() {
        return Err(error_response(
            "loopback-bind-failed",
            "target must be a fixed loopback address with a concrete port",
        ));
    }
    let ip = if host == "localhost" {
        IpAddr::V4(std::net::Ipv4Addr::LOCALHOST)
    } else {
        host.parse()
            .map_err(|_| error_response("invalid-request", "target host is not an IP address"))?
    };
    Ok(SocketAddr::new(ip, port))
}

fn start_machine_acceptor(value: *const c_char) -> Value {
    let input = match parse_json::<StartMachineAcceptorRequest>(value) {
        Ok(value) => value,
        Err((code, message)) => return error_response(code, message),
    };
    let admission_target = match loopback_target(&input.admission_host, input.admission_port) {
        Ok(value) => value,
        Err(error) => return error,
    };
    let Some(identity) = endpoint_identity_for(&input.endpoint_handle) else {
        return error_response("not-found", "endpointHandle is unknown");
    };
    let Some((_, endpoint)) = state().manager.get(&identity) else {
        return error_response("not-found", "endpoint is shut down");
    };
    let mut acceptors = state()
        .machine_acceptors
        .lock()
        .expect("machine acceptor lock poisoned");
    if let Some(existing) = acceptors.get(&input.endpoint_handle) {
        if existing.admission_target == admission_target {
            return json!({"ok": true, "result": {"endpointHandle": input.endpoint_handle, "reused": true, "status": machine_acceptor_status_json(existing.acceptor.status())}});
        }
        return error_response(
            "endpoint_config_conflict",
            "a machine acceptor is already running with a different fixed admission target",
        );
    }
    let _guard = runtime().enter();
    match MachineAcceptor::start(&endpoint, MachineAcceptorConfig { admission_target }) {
        Ok(acceptor) => {
            let status = acceptor.status();
            acceptors.insert(
                input.endpoint_handle.clone(),
                MachineAcceptorEntry {
                    acceptor,
                    admission_target,
                },
            );
            json!({"ok": true, "result": {"endpointHandle": input.endpoint_handle, "reused": false, "status": machine_acceptor_status_json(status)}})
        }
        Err(_) => error_response("transport-unavailable", "machine acceptor failed to start"),
    }
}

fn stop_machine_acceptor(value: *const c_char) -> Value {
    let input = match parse_json::<EndpointHandleRequest>(value) {
        Ok(value) => value,
        Err((code, message)) => return error_response(code, message),
    };
    let entry = state()
        .machine_acceptors
        .lock()
        .expect("machine acceptor lock poisoned")
        .remove(&input.endpoint_handle);
    if let Some(entry) = entry {
        entry.acceptor.stop();
    }
    json!({"ok": true})
}

fn start_machine_tunnel(value: *const c_char) -> Value {
    let input = match parse_json::<StartMachineTunnelRequest>(value) {
        Ok(value) => value,
        Err((code, message)) => return error_response(code, message),
    };
    if validate_endpoint_id(&input.endpoint_id).is_err() {
        return error_response("invalid-request", "endpointId is invalid");
    }
    let Some(identity) = endpoint_identity_for(&input.endpoint_handle) else {
        return error_response("not-found", "endpointHandle is unknown");
    };
    let Some((config, endpoint)) = state().manager.get(&identity) else {
        return error_response("not-found", "endpoint is shut down");
    };
    if config.caps != IrohCapProfile::MachineBulk {
        return error_response(
            "endpoint_config_conflict",
            "machine tunnels require the shared endpoint's machineBulk profile",
        );
    }
    let cap_profile = match parse_cap_profile(&input.cap_profile) {
        Ok(profile @ (IrohCapProfile::MachineBulk | IrohCapProfile::WorkspaceSync)) => profile,
        _ => {
            return error_response(
                "invalid-request",
                "machine capProfile must be machineBulk or workspaceSync",
            )
        }
    };
    let relay_urls = match &config.relay {
        RelaySelection::Disabled => Vec::new(),
        RelaySelection::Custom(_) => {
            match RelaySelection::resolve(&RelayPolicy::Automatic, &input.relay_urls) {
                Ok(selection) if selection.relay_urls().is_empty() => {
                    config.relay.relay_urls().to_vec()
                }
                Ok(selection) => selection.relay_urls().to_vec(),
                Err(_) => return error_response("invalid-request", "relayUrls entry is invalid"),
            }
        }
    };
    let tunnel = match runtime().block_on(MachineTunnel::start(
        &endpoint,
        MachineTunnelConfig {
            endpoint_id: input.endpoint_id,
            bind_addr: "127.0.0.1:0".parse().expect("fixed loopback"),
            direct_addresses: input.direct_addresses,
            relay_urls,
            handshake_json: input.handshake_json,
            cap_profile,
        },
    )) {
        Ok(tunnel) => tunnel,
        Err(error) => return machine_start_error(error),
    };
    let id = next_id();
    let status = tunnel.status();
    let started_at_ms = now_ms();
    state()
        .machine_tunnels
        .lock()
        .expect("machine tunnel lock poisoned")
        .insert(
            id.clone(),
            MachineTunnelLease {
                endpoint_handle: input.endpoint_handle.clone(),
                tunnel,
                started_at_ms,
            },
        );
    json!({"ok": true, "result": {"machineTunnelId": id, "endpointHandle": input.endpoint_handle, "localPort": status.local_port, "connectionActive": status.connection_active, "remoteEndpointId": status.remote_endpoint_id, "observedPath": status.observed_path.observed_path.as_str(), "lastErrorCode": status.last_failure.map(|failure| failure.as_str()), "startedAtMs": started_at_ms}})
}

fn stop_machine_tunnel(value: *const c_char) -> Value {
    let input = match parse_json::<MachineTunnelHandleRequest>(value) {
        Ok(value) => value,
        Err((code, message)) => return error_response(code, message),
    };
    let lease = state()
        .machine_tunnels
        .lock()
        .expect("machine tunnel lock poisoned")
        .remove(&input.machine_tunnel_id);
    if let Some(lease) = lease {
        lease.tunnel.stop();
    }
    json!({"ok": true})
}

fn get_machine_tunnel_status(value: *const c_char) -> Value {
    let input = match parse_json::<MachineTunnelHandleRequest>(value) {
        Ok(value) => value,
        Err((code, message)) => return error_response(code, message),
    };
    let tunnels = state()
        .machine_tunnels
        .lock()
        .expect("machine tunnel lock poisoned");
    let Some(lease) = tunnels.get(&input.machine_tunnel_id) else {
        return json!({"ok": true, "result": Value::Null});
    };
    let status = lease.tunnel.status();
    json!({"ok": true, "result": {"machineTunnelId": input.machine_tunnel_id, "endpointHandle": lease.endpoint_handle, "localPort": status.local_port, "connectionActive": status.connection_active, "streamsOpened": status.streams_opened, "remoteEndpointId": status.remote_endpoint_id, "observedPath": status.observed_path.observed_path.as_str(), "lastErrorCode": status.last_failure.map(|failure| failure.as_str()), "startedAtMs": lease.started_at_ms}})
}

fn get_machine_acceptor_status(value: *const c_char) -> Value {
    let input = match parse_json::<EndpointHandleRequest>(value) {
        Ok(value) => value,
        Err((code, message)) => return error_response(code, message),
    };
    let acceptors = state()
        .machine_acceptors
        .lock()
        .expect("machine acceptor lock poisoned");
    json!({"ok": true, "result": acceptors.get(&input.endpoint_handle).map(|entry| machine_acceptor_status_json(entry.acceptor.status()))})
}

fn shutdown_endpoint(value: *const c_char) -> Value {
    match c_request_str(value) {
        Ok(request) => shutdown_endpoint_json(request),
        Err((code, message)) => error_response(&code, message),
    }
}

/// Safe JSON lifecycle entry point for the explicit process shutdown of one
/// endpoint (and its acceptors/leases). The persistent key file is retained;
/// identity is never rotated or deleted.
pub fn shutdown_endpoint_json(request: &str) -> Value {
    #[cfg(feature = "test-relay-fixture")]
    let _test_operation = state()
        .test_operation
        .lock()
        .expect("test operation lock poisoned");
    let input = match serde_json::from_str::<EndpointHandleRequest>(request) {
        Ok(v) => v,
        Err(error) => return error_response("invalid-request", error.to_string()),
    };
    let Some(identity) = endpoint_identity_for(&input.endpoint_handle) else {
        return json!({"ok": true, "result": {"stopped": false}});
    };
    // Explicit process shutdown owns endpoint teardown: its acceptor and all
    // its tunnel leases stop with it.
    if let Some(entry) = state()
        .acceptors
        .lock()
        .expect("acceptor lock poisoned")
        .remove(&input.endpoint_handle)
    {
        entry.acceptor.stop();
    }
    if let Some(entry) = state()
        .machine_acceptors
        .lock()
        .expect("machine acceptor lock poisoned")
        .remove(&input.endpoint_handle)
    {
        entry.acceptor.stop();
    }
    let bound_leases: Vec<String> = state()
        .tunnels
        .lock()
        .expect("lease lock poisoned")
        .iter()
        .filter(|(_, lease)| lease.endpoint_handle == input.endpoint_handle)
        .map(|(id, _)| id.clone())
        .collect();
    for lease_id in bound_leases {
        if let Some(lease) = state()
            .tunnels
            .lock()
            .expect("lease lock poisoned")
            .remove(&lease_id)
        {
            lease.tunnel.stop();
        }
    }
    let machine_leases: Vec<String> = state()
        .machine_tunnels
        .lock()
        .expect("machine tunnel lock poisoned")
        .iter()
        .filter(|(_, lease)| lease.endpoint_handle == input.endpoint_handle)
        .map(|(id, _)| id.clone())
        .collect();
    for lease_id in machine_leases {
        if let Some(lease) = state()
            .machine_tunnels
            .lock()
            .expect("machine tunnel lock poisoned")
            .remove(&lease_id)
        {
            lease.tunnel.stop();
        }
    }
    let stopped = runtime().block_on(state().manager.shutdown(&identity));
    state()
        .endpoint_handles
        .lock()
        .expect("endpoint handle lock poisoned")
        .remove(&input.endpoint_handle);
    json!({"ok": true, "result": {"stopped": stopped}})
}

fn acceptor_status_json(status: happier_iroh_core::HomeAcceptorStatus) -> Value {
    json!({
        "running": status.running,
        "connectionsAccepted": status.connections_accepted,
        "connectionsRefused": status.connections_refused,
        "connectionsActive": status.connections_active,
        "streamsAccepted": status.streams_accepted,
        "streamsRejected": status.streams_rejected,
        "lastPath": status.last_path.map(|snapshot| json!({
            "observedPath": snapshot.observed_path.as_str(),
            "isRelay": snapshot.is_relay,
            "remoteEndpointId": snapshot.remote_endpoint_id,
            "atMs": snapshot.at_ms,
        })),
    })
}

fn machine_acceptor_status_json(status: happier_iroh_core::MachineAcceptorStatus) -> Value {
    json!({
        "running": status.running,
        "connectionsAccepted": status.connections_accepted,
        "connectionsRefused": status.connections_refused,
        "connectionsActive": status.connections_active,
        "streamsAccepted": status.streams_accepted,
        "streamsRejected": status.streams_rejected,
        "lastErrorCode": status.last_failure.map(|failure| failure.as_str()),
        "lastPath": status.last_path.map(|snapshot| json!({
            "observedPath": snapshot.observed_path.as_str(), "isRelay": snapshot.is_relay,
            "remoteEndpointId": snapshot.remote_endpoint_id, "atMs": snapshot.at_ms,
        })),
    })
}

fn get_endpoint_status(value: *const c_char) -> Value {
    let input = match parse_json::<EndpointHandleRequest>(value) {
        Ok(v) => v,
        Err((code, message)) => return error_response(&code, message),
    };
    let Some(identity) = endpoint_identity_for(&input.endpoint_handle) else {
        return json!({"ok": true, "result": Value::Null});
    };
    let Some((config, endpoint)) = state().manager.get(&identity) else {
        return json!({"ok": true, "result": Value::Null});
    };
    let addr = endpoint.endpoint().addr();
    json!({"ok": true, "result": {
        "endpointHandle": input.endpoint_handle,
        "endpointId": endpoint.id().to_string(),
        "relayMode": config.relay.mode(),
        "relayUrls": config.relay.relay_urls().iter().map(|url| url.to_string()).collect::<Vec<_>>(),
        "capProfile": config.caps.id(),
        "directAddresses": addr.ip_addrs().map(|socket| socket.to_string()).collect::<Vec<_>>(),
        "active": true,
    }})
}

pub fn get_tunnel_status_json(request: &str) -> Value {
    let input = match serde_json::from_str::<TunnelHandleRequest>(request) {
        Ok(v) => v,
        Err(error) => return error_response("invalid-request", error.to_string()),
    };
    let tunnels = state().tunnels.lock().expect("lease lock poisoned");
    match tunnels.get(&input.tunnel_id) {
        None => json!({"ok": true, "result": Value::Null}),
        Some(lease) => {
            let tunnel_status = lease.tunnel.status();
            let observed_path = tunnel_status
                .observed_path
                .as_ref()
                .map(|snapshot| snapshot.observed_path.as_str())
                .unwrap_or("unknown");
            #[cfg(feature = "test-relay-fixture")]
            record_test_observed_path(observed_path);
            json!({"ok": true, "result": {
                "tunnelId": input.tunnel_id,
                "homeServerIdentityId": lease.home_server_identity_id,
                "runtimeOrigin": lease.runtime_origin,
                "carrier": "iroh",
                "observedPath": observed_path,
                "connectionActive": tunnel_status.connection_active,
                "streamsOpened": tunnel_status.streams_opened,
                "startedAtMs": lease.started_at_ms,
                "descriptorRevision": lease.descriptor_revision,
                "endpointHandle": lease.endpoint_handle,
            }})
        }
    }
}

fn get_tunnel_status(value: *const c_char) -> Value {
    match c_request_str(value) {
        Ok(request) => get_tunnel_status_json(request),
        Err((code, message)) => error_response(code, message),
    }
}

// ---------------------------------------------------------------------------
// C ABI
// ---------------------------------------------------------------------------

#[no_mangle]
pub extern "C" fn happier_iroh_native_start_home_tunnel_json(value: *const c_char) -> *mut c_char {
    response(start(value))
}
#[no_mangle]
pub extern "C" fn happier_iroh_native_stop_home_tunnel_json(value: *const c_char) -> *mut c_char {
    response(stop(value))
}
#[no_mangle]
pub extern "C" fn happier_iroh_native_get_home_tunnel_status_json(
    value: *const c_char,
) -> *mut c_char {
    if value.is_null() {
        return response(json!({"ok": true, "result": Value::Null}));
    }
    let identity = match unsafe { CStr::from_ptr(value) }.to_str() {
        Ok(value) => value,
        Err(_) => return response(json!({"ok": true, "result": Value::Null})),
    };
    response(get_home_tunnel_status_json(identity))
}

#[no_mangle]
pub extern "C" fn happier_iroh_native_create_endpoint_json(value: *const c_char) -> *mut c_char {
    response(create_endpoint(value))
}
#[no_mangle]
pub extern "C" fn happier_iroh_native_start_home_acceptor_json(
    value: *const c_char,
) -> *mut c_char {
    response(start_home_acceptor(value))
}
#[no_mangle]
pub extern "C" fn happier_iroh_native_stop_home_acceptor_json(value: *const c_char) -> *mut c_char {
    response(stop_home_acceptor(value))
}
#[no_mangle]
pub extern "C" fn happier_iroh_native_ensure_home_tunnel_json(value: *const c_char) -> *mut c_char {
    response(ensure_home_tunnel(value))
}
#[no_mangle]
pub extern "C" fn happier_iroh_native_release_home_tunnel_json(
    value: *const c_char,
) -> *mut c_char {
    response(release_home_tunnel(value))
}
#[no_mangle]
pub extern "C" fn happier_iroh_native_shutdown_endpoint_json(value: *const c_char) -> *mut c_char {
    response(shutdown_endpoint(value))
}
#[no_mangle]
pub extern "C" fn happier_iroh_native_get_endpoint_status_json(
    value: *const c_char,
) -> *mut c_char {
    response(get_endpoint_status(value))
}
#[no_mangle]
pub extern "C" fn happier_iroh_native_get_tunnel_status_json(value: *const c_char) -> *mut c_char {
    response(get_tunnel_status(value))
}

#[cfg(feature = "test-relay-fixture")]
#[no_mangle]
pub extern "C" fn happier_iroh_native_test_force_direct_only_json(
    _value: *const c_char,
) -> *mut c_char {
    response(force_direct_only_for_tests())
}

#[cfg(feature = "test-relay-fixture")]
#[no_mangle]
pub extern "C" fn happier_iroh_native_test_force_relay_only_json(
    _value: *const c_char,
) -> *mut c_char {
    response(force_relay_only_for_tests())
}

#[cfg(feature = "test-relay-fixture")]
#[no_mangle]
pub extern "C" fn happier_iroh_native_test_restore_automatic_json(
    _value: *const c_char,
) -> *mut c_char {
    response(restore_automatic_for_tests())
}

/// Synchronous observed-path read for the test-only controller. This symbol
/// does not exist unless the non-release `test-relay-fixture` feature is set.
#[cfg(feature = "test-relay-fixture")]
pub fn happier_iroh_native_test_observed_path() -> &'static str {
    test_observed_path()
}

/// Fixture relay hint for explicit test-environment descriptor wiring. The
/// production server continues publishing only its configured relay URLs.
#[cfg(feature = "test-relay-fixture")]
pub fn happier_iroh_native_test_relay_url() -> Option<String> {
    test_relay_url()
}

#[no_mangle]
pub extern "C" fn happier_iroh_native_start_machine_acceptor_json(
    value: *const c_char,
) -> *mut c_char {
    response(start_machine_acceptor(value))
}
#[no_mangle]
pub extern "C" fn happier_iroh_native_stop_machine_acceptor_json(
    value: *const c_char,
) -> *mut c_char {
    response(stop_machine_acceptor(value))
}
#[no_mangle]
pub extern "C" fn happier_iroh_native_get_machine_acceptor_status_json(
    value: *const c_char,
) -> *mut c_char {
    response(get_machine_acceptor_status(value))
}
#[no_mangle]
pub extern "C" fn happier_iroh_native_start_machine_tunnel_json(
    value: *const c_char,
) -> *mut c_char {
    response(start_machine_tunnel(value))
}
#[no_mangle]
pub extern "C" fn happier_iroh_native_stop_machine_tunnel_json(
    value: *const c_char,
) -> *mut c_char {
    response(stop_machine_tunnel(value))
}
#[no_mangle]
pub extern "C" fn happier_iroh_native_get_machine_tunnel_status_json(
    value: *const c_char,
) -> *mut c_char {
    response(get_machine_tunnel_status(value))
}

#[no_mangle]
pub extern "C" fn happier_iroh_native_free_string(value: *mut c_char) {
    if !value.is_null() {
        unsafe {
            drop(CString::from_raw(value));
        }
    }
}

#[cfg(target_os = "android")]
mod android {
    use super::*;
    use jni::{
        objects::{JClass, JString},
        sys::jstring,
        JNIEnv,
    };
    fn call(
        env: &mut JNIEnv<'_>,
        input: JString<'_>,
        operation: extern "C" fn(*const c_char) -> *mut c_char,
    ) -> jstring {
        let text = env
            .get_string(&input)
            .map(|v| v.to_string_lossy().into_owned())
            .unwrap_or_default();
        let c = CString::new(text).expect("JNI string has no NUL");
        let out = operation(c.as_ptr());
        if out.is_null() {
            return env.new_string("{\"ok\":false,\"error\":{\"code\":\"engine-internal\",\"message\":\"Native Iroh engine returned no response\"}}").expect("JNI error string").into_raw();
        }
        let result = unsafe { CStr::from_ptr(out) }
            .to_string_lossy()
            .into_owned();
        happier_iroh_native_free_string(out);
        env.new_string(result)
            .expect("JNI result string")
            .into_raw()
    }
    #[no_mangle]
    pub extern "system" fn Java_dev_happier_iroh_HappierIrohNativeRust_startHomeTunnelJson(
        mut env: JNIEnv<'_>,
        _: JClass<'_>,
        input: JString<'_>,
    ) -> jstring {
        call(&mut env, input, happier_iroh_native_start_home_tunnel_json)
    }
    #[no_mangle]
    pub extern "system" fn Java_dev_happier_iroh_HappierIrohNativeRust_stopHomeTunnelJson(
        mut env: JNIEnv<'_>,
        _: JClass<'_>,
        input: JString<'_>,
    ) -> jstring {
        call(&mut env, input, happier_iroh_native_stop_home_tunnel_json)
    }
    #[no_mangle]
    pub extern "system" fn Java_dev_happier_iroh_HappierIrohNativeRust_getHomeTunnelStatusJson(
        mut env: JNIEnv<'_>,
        _: JClass<'_>,
        input: JString<'_>,
    ) -> jstring {
        call(
            &mut env,
            input,
            happier_iroh_native_get_home_tunnel_status_json,
        )
    }
    #[no_mangle]
    pub extern "system" fn Java_dev_happier_iroh_HappierIrohNativeRust_getTunnelStatusJson(
        mut env: JNIEnv<'_>,
        _: JClass<'_>,
        input: JString<'_>,
    ) -> jstring {
        call(&mut env, input, happier_iroh_native_get_tunnel_status_json)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn home_tunnel_failures_keep_their_native_category() {
        let cases = [
            (
                happier_iroh_core::IrohError::InvalidDescriptor,
                "invalid_descriptor",
            ),
            (
                happier_iroh_core::IrohError::UnsupportedAlpn,
                "unsupported_alpn",
            ),
            (
                happier_iroh_core::IrohError::InvalidPreamble,
                "invalid_preamble",
            ),
            (
                happier_iroh_core::IrohError::EndpointConfigConflict,
                "endpoint_config_conflict",
            ),
            (
                happier_iroh_core::IrohError::ResourceLimit,
                "resource_limit",
            ),
            (
                happier_iroh_core::IrohError::LoopbackBindFailed,
                "loopback_bind_failed",
            ),
            (
                happier_iroh_core::IrohError::TransportTimeout,
                "transport_timeout",
            ),
            (
                happier_iroh_core::IrohError::TransportClosed,
                "transport_closed",
            ),
        ];

        for (error, expected_code) in cases {
            let response = tunnel_start_error(error);
            assert_eq!(response["error"]["code"], expected_code);
        }
    }

    fn read(value: *mut c_char) -> Value {
        let raw = unsafe { CStr::from_ptr(value) }
            .to_string_lossy()
            .into_owned();
        happier_iroh_native_free_string(value);
        serde_json::from_str(&raw).expect("valid JSON response")
    }

    /// Calls a JSON op with a request payload and reads the response.
    fn call_op(payload: String, op: extern "C" fn(*const c_char) -> *mut c_char) -> Value {
        let request = CString::new(payload).expect("test JSON has no NUL");
        read(op(request.as_ptr()))
    }

    fn temp_key_path(label: &str) -> String {
        std::env::temp_dir()
            .join(format!(
                "happier-iroh-native-{}-{}-{}.key",
                label,
                std::process::id(),
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap()
                    .as_nanos()
            ))
            .to_string_lossy()
            .replace('\\', "/")
    }

    /// Spawns a TCP echo server on the shared tokio runtime and returns its
    /// loopback address: the acceptor's fixed loopback target.
    fn spawn_echo_target() -> SocketAddr {
        runtime().block_on(async {
            use tokio::io::{AsyncReadExt, AsyncWriteExt};
            let listener = tokio::net::TcpListener::bind(("127.0.0.1", 0))
                .await
                .unwrap();
            let addr = listener.local_addr().unwrap();
            tokio::spawn(async move {
                loop {
                    let Ok((mut socket, _)) = listener.accept().await else {
                        break;
                    };
                    tokio::spawn(async move {
                        let mut buffer = [0u8; 1024];
                        loop {
                            match socket.read(&mut buffer).await {
                                Ok(0) | Err(_) => break,
                                Ok(n) => {
                                    if socket.write_all(&buffer[..n]).await.is_err() {
                                        break;
                                    }
                                }
                            }
                        }
                    });
                }
            });
            addr
        })
    }

    fn create_disabled_endpoint(key_path: &str) -> (String, String, String) {
        let created = call_op(
            format!(r#"{{"keyPath":"{key_path}","relayPolicy":"disabled"}}"#),
            happier_iroh_native_create_endpoint_json,
        );
        assert_eq!(created["ok"], true, "endpoint create: {created}");
        let handle = created["result"]["endpointHandle"]
            .as_str()
            .unwrap()
            .to_owned();
        let status = call_op(
            format!(r#"{{"endpointHandle":"{handle}"}}"#),
            happier_iroh_native_get_endpoint_status_json,
        );
        let endpoint_id = status["result"]["endpointId"].as_str().unwrap().to_owned();
        let direct_address = status["result"]["directAddresses"]
            .as_array()
            .and_then(|addrs| addrs.first())
            .and_then(|value| value.as_str())
            .expect("endpoint status publishes a direct address")
            .to_owned();
        (handle, endpoint_id, direct_address)
    }

    fn ensure_tunnel(
        client_handle: &str,
        identity: &str,
        server_endpoint_id: &str,
        direct_address: &str,
    ) -> Value {
        call_op(
            format!(
                r#"{{"endpointHandle":"{client_handle}","homeServerIdentityId":"{identity}","endpointId":"{server_endpoint_id}","directAddresses":["{direct_address}"]}}"#
            ),
            happier_iroh_native_ensure_home_tunnel_json,
        )
    }

    /// Parses a lease's published HTTP runtime origin into the concrete
    /// loopback socket address the fixture dials. Strictly `http://` +
    /// IP-literal + port, loopback only: the fixture never resolves or dials
    /// an arbitrary destination while still proving the runtimeOrigin HTTP
    /// contract.
    fn loopback_target_of_origin(origin: &str) -> SocketAddr {
        let host_port = origin
            .strip_prefix("http://")
            .expect("runtime origin must be an http:// URL");
        let addr: SocketAddr = host_port
            .parse()
            .expect("runtime origin host must be an IP-literal socket address");
        assert!(
            addr.ip().is_loopback(),
            "runtime origin must stay loopback-only"
        );
        addr
    }

    fn echo_over(origin: &str, payload: &[u8]) {
        runtime().block_on(async {
            use tokio::io::{AsyncReadExt, AsyncWriteExt};
            let mut socket = tokio::net::TcpStream::connect(loopback_target_of_origin(origin))
                .await
                .unwrap();
            socket.write_all(payload).await.unwrap();
            let mut echo = vec![0u8; payload.len()];
            socket.read_exact(&mut echo).await.unwrap();
            assert_eq!(echo, payload);
        });
    }

    #[test]
    fn lifecycle_exports_keep_strict_json_error_and_empty_status_contracts() {
        let request = CString::new(r#"{"homeServerIdentityId":"","endpointId":""}"#).unwrap();
        assert_eq!(
            read(happier_iroh_native_start_home_tunnel_json(request.as_ptr()))["ok"],
            false
        );

        let lease = CString::new("missing").unwrap();
        assert_eq!(
            read(happier_iroh_native_stop_home_tunnel_json(lease.as_ptr()))["ok"],
            true
        );
        let status = read(happier_iroh_native_get_home_tunnel_status_json(
            lease.as_ptr(),
        ));
        assert_eq!(status["ok"], true);
        assert!(status["result"].is_null());
    }

    #[test]
    fn corrupt_endpoint_key_fails_closed_without_silent_rotation() {
        let path = std::env::temp_dir().join(format!(
            "happier-iroh-native-corrupt-key-{}.key",
            std::process::id()
        ));
        std::fs::write(&path, vec![0u8; 16]).expect("write corrupt key");
        let corrupt = std::fs::read(&path).expect("read corrupt key");
        // Forward slashes keep the JSON valid on Windows as well as POSIX hosts.
        let portable_path = path.to_string_lossy().replace('\\', "/");
        let response = call_op(
            format!(
                r#"{{"homeServerIdentityId":"srv_home_a","endpointId":"{}","relayPolicy":"automatic","endpointKeyPath":"{}"}}"#,
                "a".repeat(64),
                portable_path,
            ),
            happier_iroh_native_start_home_tunnel_json,
        );
        assert_eq!(response["ok"], false);
        assert_eq!(
            response["error"]["code"],
            Value::String("endpoint_key_unavailable".to_owned())
        );
        // Fail closed: the corrupt identity bytes are left untouched, never regenerated.
        assert_eq!(std::fs::read(&path).expect("reread corrupt key"), corrupt);
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn descriptor_metadata_is_validated_fail_closed_before_any_transport_start() {
        let base = |extra: String| {
            format!(
                r#"{{"homeServerIdentityId":"srv_home_a","endpointId":"{}","relayPolicy":"automatic"{}"#,
                "a".repeat(64),
                extra,
            )
        };
        let invalid_relay = call_op(
            base(r#","relayUrls":["https://user:pass@relay.example.test"]}"#.to_owned()),
            happier_iroh_native_start_home_tunnel_json,
        );
        assert_eq!(invalid_relay["ok"], false);
        assert_eq!(
            invalid_relay["error"]["code"],
            Value::String("invalid-request".to_owned())
        );

        let zero_revision = call_op(
            base(r#","descriptorRevision":0}"#.to_owned()),
            happier_iroh_native_start_home_tunnel_json,
        );
        assert_eq!(zero_revision["ok"], false);
        assert_eq!(
            zero_revision["error"]["code"],
            Value::String("invalid-request".to_owned())
        );
    }

    #[test]
    fn native_only_endpoint_seed_is_strict_and_mutually_exclusive_with_key_path() {
        let base = |seed: &str, extra: &str| {
            format!(
                r#"{{"homeServerIdentityId":"srv_home_a","endpointId":"{}","relayPolicy":"automatic","endpointSeedBase64":"{seed}"{extra}}}"#,
                "a".repeat(64),
            )
        };
        for seed in [
            "",
            "not-base64!",
            "AQ==",
            "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==",
        ] {
            let response = call_op(base(seed, ""), happier_iroh_native_start_home_tunnel_json);
            assert_eq!(response["ok"], false, "seed {seed:?}: {response}");
            assert_eq!(response["error"]["code"], "invalid-request");
            if !seed.is_empty() {
                assert!(
                    !response.to_string().contains(seed),
                    "secret input leaked in response"
                );
            }
        }

        let valid_seed = "BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc=";
        let response = call_op(
            base(valid_seed, r#", "endpointKeyPath":"/tmp/iroh.key""#),
            happier_iroh_native_start_home_tunnel_json,
        );
        assert_eq!(response["ok"], false, "conflict: {response}");
        assert_eq!(response["error"]["code"], "invalid-request");
        assert!(!response.to_string().contains(valid_seed));
    }

    #[test]
    fn mobile_seed_start_release_start_reuses_one_process_endpoint() {
        let server_key = temp_key_path("mobile-seed-server");
        let target = spawn_echo_target();
        let (server_handle, server_endpoint_id, direct_address) =
            create_disabled_endpoint(&server_key);
        let acceptor = call_op(
            format!(
                r#"{{"endpointHandle":"{server_handle}","targetPort":{}}}"#,
                target.port()
            ),
            happier_iroh_native_start_home_acceptor_json,
        );
        assert_eq!(acceptor["ok"], true, "acceptor: {acceptor}");

        let seed = "DQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0=";
        let start_mobile = |home: &str| {
            call_op(
                format!(
                    r#"{{"homeServerIdentityId":"{home}","endpointId":"{server_endpoint_id}","relayPolicy":"disabled","directAddresses":["{direct_address}"],"endpointSeedBase64":"{seed}"}}"#
                ),
                happier_iroh_native_start_home_tunnel_json,
            )
        };
        let first = start_mobile("srv_mobile_a");
        assert_eq!(first["ok"], true, "first: {first}");
        assert!(!first.to_string().contains(seed));
        echo_over(
            first["result"]["runtimeOrigin"].as_str().unwrap(),
            b"mobile-first",
        );
        let first_handle = first["result"]["endpointHandle"]
            .as_str()
            .unwrap()
            .to_owned();
        let stopped = read(happier_iroh_native_stop_home_tunnel_json(
            CString::new(first["result"]["leaseId"].as_str().unwrap())
                .unwrap()
                .as_ptr(),
        ));
        assert_eq!(stopped["ok"], true);

        let second = start_mobile("srv_mobile_b");
        assert_eq!(second["ok"], true, "second: {second}");
        assert_eq!(second["result"]["endpointHandle"], first_handle);
        echo_over(
            second["result"]["runtimeOrigin"].as_str().unwrap(),
            b"mobile-second",
        );

        let different_seed = call_op(
            format!(
                r#"{{"homeServerIdentityId":"srv_mobile_c","endpointId":"{server_endpoint_id}","relayPolicy":"disabled","directAddresses":["{direct_address}"],"endpointSeedBase64":"Dg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4="}}"#
            ),
            happier_iroh_native_start_home_tunnel_json,
        );
        assert_eq!(different_seed["ok"], true, "different: {different_seed}");
        assert_ne!(different_seed["result"]["endpointHandle"], first_handle);

        for response in [&second, &different_seed] {
            read(happier_iroh_native_stop_home_tunnel_json(
                CString::new(response["result"]["leaseId"].as_str().unwrap())
                    .unwrap()
                    .as_ptr(),
            ));
            call_op(
                format!(
                    r#"{{"endpointHandle":"{}"}}"#,
                    response["result"]["endpointHandle"].as_str().unwrap()
                ),
                happier_iroh_native_shutdown_endpoint_json,
            );
        }
        call_op(
            format!(r#"{{"endpointHandle":"{server_handle}"}}"#),
            happier_iroh_native_shutdown_endpoint_json,
        );
        let _ = std::fs::remove_file(server_key);
    }

    /// The exact desktop-host seam: keyed legacy start → lease release →
    /// keyed start must reuse the one process endpoint identity (handle is
    /// the canonical key path) without rotating or recreating it.
    #[test]
    fn keyed_start_release_start_reuses_one_process_endpoint() {
        let server_key = temp_key_path("keyed-server");
        let client_key = temp_key_path("keyed-client");
        let target = spawn_echo_target();
        let (server_handle, server_endpoint_id, direct_address) =
            create_disabled_endpoint(&server_key);
        let acceptor = call_op(
            format!(
                r#"{{"endpointHandle":"{server_handle}","targetPort":{}}}"#,
                target.port()
            ),
            happier_iroh_native_start_home_acceptor_json,
        );
        assert_eq!(acceptor["ok"], true, "acceptor: {acceptor}");

        let start_client = |home: &str| {
            call_op(
                format!(
                    r#"{{"homeServerIdentityId":"{home}","endpointId":"{server_endpoint_id}","relayPolicy":"disabled","directAddresses":["{direct_address}"],"endpointKeyPath":"{client_key}"}}"#
                ),
                happier_iroh_native_start_home_tunnel_json,
            )
        };
        let first = start_client("srv_home_a");
        assert_eq!(first["ok"], true, "first: {first}");
        assert_eq!(
            first["result"]["endpointHandle"].as_str().unwrap(),
            client_key,
            "the keyed endpoint handle is its canonical key path"
        );
        echo_over(
            first["result"]["runtimeOrigin"].as_str().unwrap(),
            b"keyed-first",
        );

        let stopped = read(happier_iroh_native_stop_home_tunnel_json(
            CString::new(first["result"]["leaseId"].as_str().unwrap())
                .unwrap()
                .as_ptr(),
        ));
        assert_eq!(stopped["ok"], true);

        let second = start_client("srv_home_b");
        assert_eq!(second["ok"], true, "second: {second}");
        assert_eq!(
            second["result"]["endpointHandle"], first["result"]["endpointHandle"],
            "release/start must reuse the persistent keyed endpoint identity"
        );
        echo_over(
            second["result"]["runtimeOrigin"].as_str().unwrap(),
            b"keyed-second",
        );

        call_op(
            format!(
                r#"{{"endpointHandle":"{}"}}"#,
                second["result"]["endpointHandle"].as_str().unwrap()
            ),
            happier_iroh_native_shutdown_endpoint_json,
        );
        call_op(
            format!(r#"{{"endpointHandle":"{server_handle}"}}"#),
            happier_iroh_native_shutdown_endpoint_json,
        );
        let _ = std::fs::remove_file(&server_key);
        let _ = std::fs::remove_file(&client_key);
    }

    /// Full JSON-lifecycle vertical: real endpoints, real acceptor, real
    /// tunnel leases, real loopback bytes — through the exact ops the desktop
    /// composition wave consumes.
    #[test]
    fn json_lifecycle_moves_bytes_over_one_shared_process_endpoint() {
        let server_key = temp_key_path("server");
        let client_key = temp_key_path("client");
        let target = spawn_echo_target();

        let (server_handle, server_endpoint_id, direct_address) =
            create_disabled_endpoint(&server_key);
        let acceptor = call_op(
            format!(
                r#"{{"endpointHandle":"{server_handle}","targetPort":{}}}"#,
                target.port()
            ),
            happier_iroh_native_start_home_acceptor_json,
        );
        assert_eq!(acceptor["ok"], true, "acceptor start: {acceptor}");
        assert_eq!(acceptor["result"]["reused"], false);

        let (client_handle, _, _) = create_disabled_endpoint(&client_key);

        let first = ensure_tunnel(
            &client_handle,
            "srv_home_a",
            &server_endpoint_id,
            &direct_address,
        );
        assert_eq!(first["ok"], true, "first tunnel: {first}");
        let second = ensure_tunnel(
            &client_handle,
            "srv_home_b",
            &server_endpoint_id,
            &direct_address,
        );
        assert_eq!(second["ok"], true, "second tunnel: {second}");
        assert_eq!(
            first["result"]["endpointHandle"], client_handle,
            "compatible leases must share the endpoint handle"
        );

        // Both leases move real bytes over the one shared client endpoint.
        for origin in [
            first["result"]["runtimeOrigin"].as_str().unwrap(),
            second["result"]["runtimeOrigin"].as_str().unwrap(),
        ] {
            echo_over(origin, b"json-lifecycle-bytes");
        }

        // The acceptor saw exactly one Iroh connection carrying two streams.
        let acceptor_status = call_op(
            format!(
                r#"{{"endpointHandle":"{server_handle}","targetPort":{}}}"#,
                target.port()
            ),
            happier_iroh_native_start_home_acceptor_json,
        );
        assert_eq!(acceptor_status["result"]["reused"], true);
        // Two leases = two lease-scoped Iroh connections on the shared client
        // endpoint, each carrying one local stream.
        assert_eq!(
            acceptor_status["result"]["status"]["connectionsAccepted"],
            2
        );
        assert_eq!(acceptor_status["result"]["status"]["streamsAccepted"], 2);

        // Honest direct-path telemetry on the tunnel lease.
        let tunnel_status = call_op(
            format!(
                r#"{{"tunnelId":"{}"}}"#,
                first["result"]["tunnelId"].as_str().unwrap()
            ),
            happier_iroh_native_get_tunnel_status_json,
        );
        assert_eq!(tunnel_status["result"]["observedPath"], "direct");
        assert_eq!(tunnel_status["result"]["connectionActive"], true);

        // Legacy status lookup by Home identity still works and is honest.
        let legacy = read(happier_iroh_native_get_home_tunnel_status_json(
            CString::new("srv_home_a").unwrap().as_ptr(),
        ));
        assert_eq!(legacy["result"]["observedPath"], "direct");
        assert_eq!(legacy["result"]["endpointHandle"], client_handle);

        // First-use key provisioning with restrictive POSIX permissions.
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = std::fs::metadata(&client_key).unwrap().permissions().mode();
            assert_eq!(mode & 0o777, 0o600, "first-provisioned keys stay 0600");
        }

        call_op(
            format!(r#"{{"endpointHandle":"{client_handle}"}}"#),
            happier_iroh_native_shutdown_endpoint_json,
        );
        call_op(
            format!(r#"{{"endpointHandle":"{server_handle}"}}"#),
            happier_iroh_native_shutdown_endpoint_json,
        );
        let _ = std::fs::remove_file(&server_key);
        let _ = std::fs::remove_file(&client_key);
    }

    #[test]
    fn releasing_one_lease_keeps_shared_endpoint_and_sibling_lease() {
        let server_key = temp_key_path("server");
        let client_key = temp_key_path("client");
        let target = spawn_echo_target();

        let (server_handle, server_endpoint_id, direct_address) =
            create_disabled_endpoint(&server_key);
        call_op(
            format!(
                r#"{{"endpointHandle":"{server_handle}","targetPort":{}}}"#,
                target.port()
            ),
            happier_iroh_native_start_home_acceptor_json,
        );
        let (client_handle, _, _) = create_disabled_endpoint(&client_key);

        let first = ensure_tunnel(
            &client_handle,
            "srv_home_a",
            &server_endpoint_id,
            &direct_address,
        );
        let second = ensure_tunnel(
            &client_handle,
            "srv_home_b",
            &server_endpoint_id,
            &direct_address,
        );
        assert_eq!(first["ok"], true);
        assert_eq!(second["ok"], true);
        let first_origin = first["result"]["runtimeOrigin"]
            .as_str()
            .unwrap()
            .to_owned();
        let first_tunnel_id = first["result"]["tunnelId"].as_str().unwrap().to_owned();

        // Release the first lease only (both the handle-based op and the
        // legacy raw-leaseId op stay lease-scoped and idempotent).
        let release = call_op(
            format!(r#"{{"tunnelId":"{first_tunnel_id}"}}"#),
            happier_iroh_native_release_home_tunnel_json,
        );
        assert_eq!(release["ok"], true);
        let legacy_stop = read(happier_iroh_native_stop_home_tunnel_json(
            CString::new(first_tunnel_id.clone()).unwrap().as_ptr(),
        ));
        assert_eq!(legacy_stop["ok"], true);

        // The released lease stops serving its origin.
        let released_down = runtime().block_on(async {
            tokio::time::timeout(
                std::time::Duration::from_secs(5),
                tokio::net::TcpStream::connect(loopback_target_of_origin(&first_origin)),
            )
            .await
            .map(|outcome| outcome.is_err())
            .unwrap_or(true)
        });
        assert!(released_down, "released lease must stop serving its origin");

        // The sibling lease and the shared endpoint remain healthy.
        let sibling_status = call_op(
            format!(
                r#"{{"tunnelId":"{}"}}"#,
                second["result"]["tunnelId"].as_str().unwrap()
            ),
            happier_iroh_native_get_tunnel_status_json,
        );
        assert_eq!(sibling_status["result"]["connectionActive"], true);
        let endpoint_status = call_op(
            format!(r#"{{"endpointHandle":"{client_handle}"}}"#),
            happier_iroh_native_get_endpoint_status_json,
        );
        assert_eq!(endpoint_status["result"]["active"], true);

        call_op(
            format!(r#"{{"endpointHandle":"{client_handle}"}}"#),
            happier_iroh_native_shutdown_endpoint_json,
        );
        call_op(
            format!(r#"{{"endpointHandle":"{server_handle}"}}"#),
            happier_iroh_native_shutdown_endpoint_json,
        );
        let _ = std::fs::remove_file(&server_key);
        let _ = std::fs::remove_file(&client_key);
    }

    #[test]
    fn incompatible_endpoint_configs_fail_clearly_without_a_second_owner() {
        let key = temp_key_path("conflict");
        let original = call_op(
            format!(
                r#"{{"keyPath":"{key}","relayPolicy":"automatic","relayUrls":["https://relay.example.test"]}}"#
            ),
            happier_iroh_native_create_endpoint_json,
        );
        assert_eq!(original["ok"], true, "{original}");
        let handle = original["result"]["endpointHandle"]
            .as_str()
            .unwrap()
            .to_owned();

        // Same key path, different relay configuration: typed conflict.
        let conflicting = call_op(
            format!(r#"{{"keyPath":"{key}","relayPolicy":"disabled"}}"#),
            happier_iroh_native_create_endpoint_json,
        );
        assert_eq!(conflicting["ok"], false, "{conflicting}");
        assert_eq!(
            conflicting["error"]["code"],
            Value::String("endpoint_config_conflict".to_owned())
        );

        // The original shared endpoint keeps serving.
        let status = call_op(
            format!(r#"{{"endpointHandle":"{handle}"}}"#),
            happier_iroh_native_get_endpoint_status_json,
        );
        assert_eq!(status["result"]["relayMode"], "custom");
        assert_eq!(status["result"]["active"], true);

        call_op(
            format!(r#"{{"endpointHandle":"{handle}"}}"#),
            happier_iroh_native_shutdown_endpoint_json,
        );
        let _ = std::fs::remove_file(&key);
    }
}
