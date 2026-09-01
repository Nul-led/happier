use crate::{
    snapshot_for_incoming_addr, IrohAlpn, IrohCapProfile, IrohError, IrohPathSnapshot, Result,
};
use std::collections::HashMap;
use std::fs;
#[cfg(unix)]
use std::io::Read;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::str::FromStr;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};
use tokio::sync::mpsc;
use tokio::task::JoinSet;
use zeroize::{Zeroize, ZeroizeOnDrop};

static ENDPOINT_KEY_STORE_LOCK: Mutex<()> = Mutex::new(());
static ENDPOINT_KEY_TEMP_NONCE: AtomicU64 = AtomicU64::new(1);

/// Descriptor relay-URL bounds mirrored from the canonical protocol descriptor
/// (`packages/protocol/src/connectivity/iroh/endpointDescriptorV1.ts`); the
/// grammar itself is owned by Iroh's `RelayUrl` parser, never re-implemented.
pub const MAX_RELAY_URLS: usize = 8;
pub const MAX_RELAY_URL_UTF8_BYTES: usize = 512;

/// Local relay ownership. `Disabled` never contacts any relay; `Custom`
/// configures exactly the explicit descriptor relay URLs on a custom relay map.
/// There is deliberately no automatic/ambient n0 mode: `RelayMode::Default` is
/// forbidden for this boundary, and an `Automatic` policy with no explicit
/// relay URLs stays direct-only instead of silently selecting ambient
/// infrastructure.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RelaySelection {
    Disabled,
    Custom(Vec<iroh::RelayUrl>),
}

impl RelaySelection {
    /// Validates and resolves descriptor relay URLs with the Iroh-owned
    /// `RelayUrl` parser plus the descriptor policy (absolute HTTP(S), no
    /// credentials, no fragment, bounded count/length).
    pub fn resolve(policy: &RelayPolicy, relay_urls: &[String]) -> Result<Self> {
        if relay_urls.len() > MAX_RELAY_URLS {
            return Err(IrohError::InvalidDescriptor);
        }
        if matches!(policy, RelayPolicy::Disabled) && !relay_urls.is_empty() {
            // A direct-only policy must never silently contact descriptor relays.
            return Err(IrohError::InvalidDescriptor);
        }
        let mut urls = Vec::with_capacity(relay_urls.len());
        for value in relay_urls {
            if value.len() > MAX_RELAY_URL_UTF8_BYTES {
                return Err(IrohError::InvalidDescriptor);
            }
            // Iroh-owned grammar (URL parser); scheme/credential policy on top.
            let url = iroh::RelayUrl::from_str(value).map_err(|_| IrohError::InvalidDescriptor)?;
            let scheme = url.scheme().to_ascii_lowercase();
            if scheme != "http" && scheme != "https" {
                return Err(IrohError::InvalidDescriptor);
            }
            if !url.username().is_empty()
                || url.password().is_some()
                || url.query().is_some()
                || url.fragment().is_some()
            {
                return Err(IrohError::InvalidDescriptor);
            }
            urls.push(url);
        }
        match policy {
            RelayPolicy::Disabled => Ok(Self::Disabled),
            RelayPolicy::Automatic => {
                urls.sort();
                urls.dedup();
                Ok(Self::Custom(urls))
            }
        }
    }

    /// Relay URLs permitted as connection hints under this selection.
    pub fn relay_urls(&self) -> &[iroh::RelayUrl] {
        match self {
            Self::Disabled => &[],
            Self::Custom(urls) => urls,
        }
    }

    pub const fn mode(&self) -> &'static str {
        match self {
            Self::Disabled => "disabled",
            Self::Custom(_) => "custom",
        }
    }
}

/// Per-ALPN connection counters owned by the endpoint dispatcher.
#[derive(Default)]
pub(crate) struct SlotCounters {
    pub(crate) connections_accepted: AtomicU64,
    pub(crate) connections_active: AtomicU64,
    pub(crate) last_path: Mutex<Option<IrohPathSnapshot>>,
}

/// The endpoint's single consumer binding for one ALPN: the dispatch channel
/// plus the per-ALPN counters. Created only through
/// [`IrohEndpoint::register_consumer`]; there is no generic registry, only
/// the fixed Home-tunnel and machine-carrier slots.
pub(crate) struct ConsumerSlot {
    pub(crate) sender: mpsc::Sender<AcceptedIrohConnection>,
    pub(crate) counters: SlotCounters,
}

/// Fixed two-ALPN dispatcher state: exactly one consumer slot per known ALPN.
struct DispatcherState {
    slots: Mutex<[Option<Arc<ConsumerSlot>>; 2]>,
    closed: AtomicBool,
}

impl DispatcherState {
    fn new() -> Self {
        Self {
            slots: Mutex::new([None, None]),
            closed: AtomicBool::new(false),
        }
    }

    fn slot(&self, alpn: IrohAlpn) -> Option<Arc<ConsumerSlot>> {
        let slots = self.slots.lock().ok()?;
        slots.get(alpn as usize)?.clone()
    }

    fn register(&self, alpn: IrohAlpn, slot: Arc<ConsumerSlot>) -> Result<()> {
        let mut slots = self.slots.lock().map_err(|_| IrohError::TransportClosed)?;
        if self.closed.load(Ordering::Relaxed) {
            return Err(IrohError::TransportClosed);
        }
        if slots[alpn as usize].is_some() {
            // A second consumer for one ALPN is a second accept owner; fail
            // typed instead of racing the registered one for dispatched
            // connections.
            return Err(IrohError::EndpointConfigConflict);
        }
        slots[alpn as usize] = Some(slot);
        Ok(())
    }

    /// Releases one registration. Only the live registration for the ALPN is
    /// removed, so a stopped consumer never drops a newer consumer's binding.
    fn release(&self, alpn: IrohAlpn, slot: &Arc<ConsumerSlot>) {
        if let Ok(mut slots) = self.slots.lock() {
            if slots[alpn as usize]
                .as_ref()
                .is_some_and(|current| Arc::ptr_eq(current, slot))
            {
                slots[alpn as usize] = None;
            }
        }
    }

    /// Shuts the dispatcher down: no further registrations, every consumer
    /// slot released so consumer loops observe channel closure.
    fn close(&self) {
        self.closed.store(true, Ordering::Relaxed);
        if let Ok(mut slots) = self.slots.lock() {
            *slots = [None, None];
        }
    }
}

/// Handle that releases one ALPN consumer registration on drop. Consumers
/// keep it for their whole lifetime; stopping or dropping the consumer
/// releases the endpoint slot so the ALPN can be registered again without a
/// stale owner. Endpoint shutdown also releases every slot.
pub struct ConsumerRegistration {
    dispatcher: Arc<DispatcherState>,
    alpn: IrohAlpn,
    slot: Arc<ConsumerSlot>,
}

impl ConsumerRegistration {
    pub(crate) fn slot(&self) -> &Arc<ConsumerSlot> {
        &self.slot
    }

    pub fn alpn(&self) -> IrohAlpn {
        self.alpn
    }
}

impl Drop for ConsumerRegistration {
    fn drop(&mut self) {
        self.dispatcher.release(self.alpn, &self.slot);
    }
}

/// Dispatch channel sender registered for one ALPN consumer.
pub type IrohConsumerSender = mpsc::Sender<AcceptedIrohConnection>;

/// One dispatched authenticated incoming connection for a registered ALPN
/// consumer. The connection has completed the Iroh/TLS handshake, so
/// `remote_endpoint_id` is the authenticated transport identity; `path` is
/// the honest pre-handshake transport-address observation.
pub struct AcceptedIrohConnection {
    pub connection: iroh::endpoint::Connection,
    pub remote_endpoint_id: String,
    pub path: IrohPathSnapshot,
    _lease: ConnectionLease,
}

struct ConnectionLease {
    slot: Arc<ConsumerSlot>,
}

impl Drop for ConnectionLease {
    fn drop(&mut self) {
        self.slot
            .counters
            .connections_active
            .fetch_sub(1, Ordering::Relaxed);
    }
}

impl AcceptedIrohConnection {
    /// Builds the dispatched value for one admitted connection and records
    /// the admission in the slot counters, including the honest pre-handshake
    /// transport-address observation.
    fn new_admitted(
        connection: iroh::endpoint::Connection,
        incoming_addr: &iroh::endpoint::IncomingAddr,
        slot: Arc<ConsumerSlot>,
    ) -> Self {
        let remote_endpoint_id = connection.remote_id().to_string();
        let path = snapshot_for_incoming_addr(incoming_addr, remote_endpoint_id.clone());
        if let Ok(mut slot_path) = slot.counters.last_path.lock() {
            *slot_path = Some(path.clone());
        }
        Self {
            connection,
            remote_endpoint_id,
            path,
            _lease: ConnectionLease { slot },
        }
    }
}

#[derive(Debug, Clone)]
pub struct EndpointConfig {
    pub key_path: Option<PathBuf>,
    /// Native-host supplied installation identity. Mobile platform adapters
    /// keep this seed in Keychain/Keystore-backed storage and inject it only
    /// at the C/JNI boundary; it is never part of the JS API or descriptors.
    pub key_seed: Option<EndpointSeed>,
    pub relay_policy: RelayPolicy,
    /// Descriptor relay URLs (validated with `RelaySelection::resolve`).
    pub relay_urls: Vec<String>,
    /// Incoming-service default enforced at the QUIC transport boundary.
    /// Outgoing operations select their own profile with `connect_with_opts`.
    pub caps: IrohCapProfile,
    /// Test-fixture only: removes all direct IP transports so connections must
    /// traverse the configured relay. Never set by production runtime config;
    /// exposed only for the feature-gated forced-relay fixture.
    pub disable_ip_transports: bool,
    /// Test-fixture only: trust the pinned iroh test relay's discarded
    /// self-signed certificate (`CaTlsConfig::insecure_skip_verify`, the exact
    /// upstream test-relay mechanism). The pinned iroh test relay always serves
    /// HTTPS with a self-signed certificate it never exposes, so this is the
    /// only way an endpoint can connect to it. The field exists only under the
    /// test-only `test-relay-fixture` cargo feature: production builds cannot
    /// name it and always keep normal CA verification.
    #[cfg(feature = "test-relay-fixture")]
    pub insecure_relay_tls: bool,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RelayPolicy {
    Automatic,
    Disabled,
}
impl RelayPolicy {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Automatic => "automatic",
            Self::Disabled => "disabled",
        }
    }
}
impl Default for RelayPolicy {
    fn default() -> Self {
        Self::Automatic
    }
}
impl Default for EndpointConfig {
    fn default() -> Self {
        Self {
            key_path: None,
            key_seed: None,
            relay_policy: RelayPolicy::Automatic,
            relay_urls: Vec::new(),
            caps: IrohCapProfile::HomeInteractive,
            disable_ip_transports: false,
            #[cfg(feature = "test-relay-fixture")]
            insecure_relay_tls: false,
        }
    }
}

/// Opaque 32-byte Iroh secret seed supplied by a native secure-store adapter.
/// Debug output is always redacted and owned bytes are zeroized on drop.
#[derive(Clone, Zeroize, ZeroizeOnDrop)]
pub struct EndpointSeed([u8; 32]);

impl std::fmt::Debug for EndpointSeed {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str("EndpointSeed(REDACTED)")
    }
}

impl EndpointSeed {
    pub fn from_bytes(bytes: [u8; 32]) -> Self {
        Self(bytes)
    }

    pub fn endpoint_id(&self) -> iroh::EndpointId {
        iroh::SecretKey::from_bytes(&self.0).public()
    }

    fn secret_key(&self) -> iroh::SecretKey {
        iroh::SecretKey::from_bytes(&self.0)
    }
}

/// A bound Iroh endpoint shared by the Home acceptor and client dialers.
/// The endpoint owns exactly one incoming accept/ALPN dispatcher: it inspects
/// each negotiated ALPN once and hands the authenticated connection to the
/// one consumer registered for that ALPN. Endpoint construction is
/// asynchronous because Iroh binds its UDP socket and initializes
/// relay/address-discovery workers during `bind`.
pub struct IrohEndpoint {
    inner: iroh::Endpoint,
    relay_policy: RelayPolicy,
    relay_urls: Mutex<Vec<iroh::RelayUrl>>,
    /// Incoming-service default. Outgoing connections select their own flow
    /// profile with `Endpoint::connect_with_opts`.
    caps: IrohCapProfile,
    disable_ip_transports: bool,
    #[cfg(feature = "test-relay-fixture")]
    insecure_relay_tls: bool,
    dispatcher: Arc<DispatcherState>,
}

impl IrohEndpoint {
    pub async fn bind(config: &EndpointConfig) -> Result<Self> {
        // Resolve the relay selection before touching the network: invalid
        // descriptor metadata and direct-only/relay-URL conflicts fail typed
        // and closed, never with ambient infrastructure as a fallback.
        let relay_selection = RelaySelection::resolve(&config.relay_policy, &config.relay_urls)?;
        let secret_key = match (&config.key_path, &config.key_seed) {
            (Some(_), Some(_)) => return Err(IrohError::EndpointConfigConflict),
            (Some(path), None) => {
                let mut key = EndpointKeyStore::ensure(path)?;
                let key_array: [u8; 32] = key
                    .as_slice()
                    .try_into()
                    .map_err(|_| IrohError::TransportClosed)?;
                key.zeroize();
                let secret_key = iroh::SecretKey::from_bytes(&key_array);
                let mut key_array = key_array;
                key_array.zeroize();
                secret_key
            }
            (None, Some(seed)) => seed.secret_key(),
            (None, None) => {
                let mut key = [0u8; 32];
                getrandom::fill(&mut key).map_err(|_| IrohError::TransportClosed)?;
                let secret_key = iroh::SecretKey::from_bytes(&key);
                key.zeroize();
                secret_key
            }
        };
        let relay_mode = match &relay_selection {
            RelaySelection::Disabled => iroh::RelayMode::Disabled,
            RelaySelection::Custom(urls) => iroh::RelayMode::custom(urls.iter().cloned()),
        };
        let mut builder = iroh::Endpoint::builder(iroh::endpoint::presets::Minimal)
            .secret_key(secret_key)
            .alpns(vec![
                crate::HOME_TUNNEL_ALPN.to_vec(),
                crate::MACHINE_ALPN.to_vec(),
            ])
            .relay_mode(relay_mode)
            .transport_config(config.caps.transport_config()?);
        if config.disable_ip_transports {
            builder = builder.clear_ip_transports();
        }
        #[cfg(feature = "test-relay-fixture")]
        if config.insecure_relay_tls {
            // Fixture-only TLS trust for the pinned iroh local test relay
            // (self-signed cert, discarded by the helper). Never a release
            // path: the field cannot even be named without the feature.
            builder = builder.ca_tls_config(iroh::tls::CaTlsConfig::insecure_skip_verify());
        }
        let inner = builder
            .bind()
            .await
            .map_err(|_| IrohError::TransportClosed)?;
        let dispatcher = Arc::new(DispatcherState::new());
        spawn_incoming_dispatcher(inner.clone(), Arc::clone(&dispatcher));
        Ok(Self {
            inner,
            relay_policy: config.relay_policy,
            relay_urls: Mutex::new(relay_selection.relay_urls().to_vec()),
            caps: config.caps,
            disable_ip_transports: config.disable_ip_transports,
            #[cfg(feature = "test-relay-fixture")]
            insecure_relay_tls: config.insecure_relay_tls,
            dispatcher,
        })
    }

    pub fn id(&self) -> iroh::EndpointId {
        self.inner.id()
    }

    pub fn endpoint(&self) -> iroh::Endpoint {
        self.inner.clone()
    }

    pub fn relay_policy(&self) -> RelayPolicy {
        self.relay_policy
    }

    pub fn relay_selection(&self) -> RelaySelection {
        match self.relay_policy {
            RelayPolicy::Disabled => RelaySelection::Disabled,
            RelayPolicy::Automatic => RelaySelection::Custom(
                self.relay_urls
                    .lock()
                    .map(|urls| urls.clone())
                    .unwrap_or_default(),
            ),
        }
    }

    pub fn caps(&self) -> IrohCapProfile {
        self.caps
    }

    pub fn resolved_config(&self) -> ResolvedEndpointConfig {
        ResolvedEndpointConfig {
            relay_policy: self.relay_policy,
            relay: self.relay_selection(),
            caps: self.caps,
        }
    }

    /// Extends the relay set of an automatic endpoint. Relay policy is stable
    /// for the application endpoint lifetime: a disabled endpoint rejects
    /// relay hints, while automatic uses only the validated explicit union and
    /// never selects ambient infrastructure.
    pub async fn ensure_relay_urls(&self, relay_urls: &[iroh::RelayUrl]) -> Result<()> {
        if relay_urls.is_empty() {
            return Ok(());
        }
        if self.relay_policy == RelayPolicy::Disabled {
            return Err(IrohError::EndpointConfigConflict);
        }
        let missing = {
            let current = self
                .relay_urls
                .lock()
                .map_err(|_| IrohError::TransportClosed)?;
            relay_urls
                .iter()
                .filter(|url| !current.contains(url))
                .cloned()
                .collect::<Vec<_>>()
        };
        for url in &missing {
            self.inner
                .insert_relay(
                    url.clone(),
                    std::sync::Arc::new(iroh::RelayConfig::from(url.clone())),
                )
                .await;
        }
        if !missing.is_empty() {
            let mut current = self
                .relay_urls
                .lock()
                .map_err(|_| IrohError::TransportClosed)?;
            current.extend(missing);
            current.sort();
            current.dedup();
        }
        Ok(())
    }

    async fn apply_compatible_config(&self, config: &EndpointConfig) -> Result<()> {
        if self.relay_policy != config.relay_policy
            || self.disable_ip_transports != config.disable_ip_transports
            || {
                #[cfg(feature = "test-relay-fixture")]
                {
                    self.insecure_relay_tls != config.insecure_relay_tls
                }
                #[cfg(not(feature = "test-relay-fixture"))]
                {
                    false
                }
            }
        {
            return Err(IrohError::EndpointConfigConflict);
        }
        let requested = RelaySelection::resolve(&config.relay_policy, &config.relay_urls)?;
        self.ensure_relay_urls(requested.relay_urls()).await
    }

    /// Registers the single consumer for one ALPN. Registration is exclusive:
    /// a second consumer for the same ALPN (a second accept owner) fails with
    /// [`IrohError::EndpointConfigConflict`], and a registration released by a
    /// stopped consumer can be taken again on the same live endpoint. The
    /// registration is released when the returned guard is dropped and on
    /// endpoint shutdown; connections arriving for an unregistered or unknown
    /// ALPN are closed without application streams.
    pub fn register_consumer(
        &self,
        alpn: IrohAlpn,
        sender: IrohConsumerSender,
    ) -> Result<ConsumerRegistration> {
        let slot = Arc::new(ConsumerSlot {
            sender,
            counters: SlotCounters::default(),
        });
        self.dispatcher.register(alpn, Arc::clone(&slot))?;
        Ok(ConsumerRegistration {
            dispatcher: Arc::clone(&self.dispatcher),
            alpn,
            slot,
        })
    }

    /// Explicit full teardown: closes the endpoint and waits until the close
    /// has finished. `iroh::Endpoint` is a shared handle whose `close` and
    /// `closed` operate on the shared state, so shutdown is ownership-correct
    /// through `&self`; the [`EndpointManager`] remains the single canonical
    /// lifecycle owner that decides when an identity is removed and shut down.
    pub async fn shutdown(&self) {
        self.inner.close().await;
        self.inner.closed().await;
    }
}

/// Spawns the endpoint's single incoming accept/ALPN dispatcher: exactly one
/// loop consumes `Endpoint::accept`, inspects each negotiated ALPN exactly
/// once (before the handshake completes), and dispatches the authenticated
/// connection to the one registered consumer for that ALPN. Unknown or
/// unregistered ALPNs are rejected without application streams. Handshake
/// tasks are reaped as they complete instead of being retained for the
/// lifetime of the endpoint.
fn spawn_incoming_dispatcher(endpoint: iroh::Endpoint, state: Arc<DispatcherState>) {
    tokio::spawn(async move {
        let mut handshakes: JoinSet<()> = JoinSet::new();
        loop {
            tokio::select! {
                incoming = endpoint.accept() => {
                    let Some(incoming) = incoming else {
                        // The endpoint was closed: the dispatcher is done.
                        break;
                    };
                    let Ok(mut accepting) = incoming.accept() else {
                        continue;
                    };
                    // Honest incoming transport address, observed before the
                    // handshake completes.
                    let incoming_addr = accepting.remote_addr();
                    // Inspect the negotiated ALPN exactly once.
                    let Ok(negotiated) = accepting.alpn().await else {
                        continue;
                    };
                    let Ok(alpn) = IrohAlpn::parse(&negotiated) else {
                        // Unknown ALPN: dropped here, which rejects the
                        // connection before any application stream exists.
                        continue;
                    };
                    let Some(slot) = state.slot(alpn) else {
                        // Advertised but unregistered: no application access.
                        continue;
                    };
                    handshakes.spawn(dispatch_handshake(
                        accepting,
                        incoming_addr,
                        slot,
                    ));
                }
                // Reap completed handshake tasks (and their retained results)
                // even while no new connection arrives.
                Some(_) = handshakes.join_next(), if !handshakes.is_empty() => {}
            }
        }
        // Aborts still-pending handshakes; each dropped `Accepting` rejects
        // its pending connection.
        drop(handshakes);
        state.close();
    });
}

/// Completes one dispatched handshake and hands the authenticated connection
/// to the registered consumer. Per-connection stream and receive-memory
/// bounds are enforced by the endpoint's QUIC transport configuration.
async fn dispatch_handshake(
    accepting: iroh::endpoint::Accepting,
    incoming_addr: iroh::endpoint::IncomingAddr,
    slot: Arc<ConsumerSlot>,
) {
    let Ok(connection) = accepting.await else {
        // Handshake failure: nothing was admitted.
        return;
    };
    slot.counters
        .connections_active
        .fetch_add(1, Ordering::Relaxed);
    let accepted =
        AcceptedIrohConnection::new_admitted(connection, &incoming_addr, Arc::clone(&slot));
    match slot.sender.send(accepted).await {
        Ok(()) => {
            slot.counters
                .connections_accepted
                .fetch_add(1, Ordering::Relaxed);
        }
        Err(undelivered) => {
            // The consumer is gone: no application streams. The undelivered
            // value's lease releases the admitted slot on drop.
            let undelivered = undelivered.0;
            undelivered
                .connection
                .close(0u32.into(), b"consumer_unavailable");
            drop(undelivered);
        }
    }
}

/// Identity of a shared process endpoint: its persistent key path, or an
/// ephemeral slot for keyless test/first-provisioning endpoints.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub enum EndpointIdentity {
    Keyed(PathBuf),
    /// Public identity derived from a mobile secure-store seed. The secret is
    /// deliberately not retained in the manager's map key.
    Seeded(iroh::EndpointId),
    Ephemeral(u64),
}

/// Snapshot of the configuration currently applied to a shared endpoint.
/// Relay policy and fixture transport mode are lifetime-stable; the explicit
/// relay set may grow as additional Homes contribute validated relay hints.
/// Flow profiles are selected per outgoing connection instead of making this
/// endpoint snapshot a false operation-wide authority.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ResolvedEndpointConfig {
    pub relay_policy: RelayPolicy,
    pub relay: RelaySelection,
    /// Incoming-service default only. Outgoing Home/Machine connections use
    /// their operation profile through `connect_with_opts`.
    pub caps: IrohCapProfile,
}

struct ManagedEndpoint {
    endpoint: std::sync::Arc<IrohEndpoint>,
}

/// One shared process endpoint per identity. Repeated acceptor/tunnel leases
/// reuse a compatible bound endpoint instead of binding one UDP endpoint per
/// lease; releasing a lease never shuts the shared endpoint down — only an
/// explicit shutdown does.
#[derive(Default)]
pub struct EndpointManager {
    endpoints: Mutex<HashMap<EndpointIdentity, ManagedEndpoint>>,
    next_ephemeral: Mutex<u64>,
}

impl EndpointManager {
    pub fn new() -> Self {
        Self::default()
    }

    /// Creates or returns the shared process endpoint for the identity derived
    /// from the config (key path, or a fresh ephemeral slot for keyless test
    /// fixtures).
    pub async fn acquire(&self, config: &EndpointConfig) -> Result<std::sync::Arc<IrohEndpoint>> {
        let identity = match &config.key_path {
            Some(path) => EndpointIdentity::Keyed(path.clone()),
            None if config.key_seed.is_some() => {
                EndpointIdentity::Seeded(config.key_seed.as_ref().expect("checked").endpoint_id())
            }
            None => EndpointIdentity::Ephemeral({
                let mut next = self
                    .next_ephemeral
                    .lock()
                    .map_err(|_| IrohError::TransportClosed)?;
                *next += 1;
                *next
            }),
        };
        self.acquire_identified(identity, config).await
    }

    /// Creates or returns the shared process endpoint for an explicit
    /// identity, letting host runtimes own handle-to-identity mapping.
    ///
    /// - same identity + stable relay policy → reuse, dynamically extending
    ///   the explicit relay set;
    /// - same identity + incompatible application relay policy/test transport
    ///   mode → typed
    ///   [`IrohError::EndpointConfigConflict`] (never a second owner);
    /// - ephemeral identities never share (tests and first-provisioning
    ///   callers only; production passes key paths).
    pub async fn acquire_identified(
        &self,
        identity: EndpointIdentity,
        config: &EndpointConfig,
    ) -> Result<std::sync::Arc<IrohEndpoint>> {
        RelaySelection::resolve(&config.relay_policy, &config.relay_urls)?;
        if let Some((_, existing_endpoint)) = self.get(&identity) {
            existing_endpoint.apply_compatible_config(config).await?;
            return Ok(existing_endpoint);
        }
        let bound = std::sync::Arc::new(IrohEndpoint::bind(config).await?);
        let endpoint = {
            let mut endpoints = self.lock_endpoints()?;
            match endpoints.entry(identity.clone()) {
                std::collections::hash_map::Entry::Occupied(existing) => {
                    existing.get().endpoint.clone()
                }
                std::collections::hash_map::Entry::Vacant(slot) => {
                    slot.insert(ManagedEndpoint {
                        endpoint: bound.clone(),
                    });
                    bound.clone()
                }
            }
        };
        // Lost a race for the identity: close the duplicate and apply this
        // acquire's compatible relay contribution to the winner.
        if !std::sync::Arc::ptr_eq(&endpoint, &bound) {
            bound.shutdown().await;
            endpoint.apply_compatible_config(config).await?;
        }
        Ok(endpoint)
    }

    /// Status of the shared endpoint for an identity, if one is bound.
    pub fn get(
        &self,
        identity: &EndpointIdentity,
    ) -> Option<(ResolvedEndpointConfig, std::sync::Arc<IrohEndpoint>)> {
        let endpoints = self.lock_endpoints().ok()?;
        let managed = endpoints.get(identity)?;
        Some((managed.endpoint.resolved_config(), managed.endpoint.clone()))
    }

    /// Explicit process shutdown of one shared endpoint. Active acceptors and
    /// tunnels bound to it fail with the closed transport; unrelated endpoints
    /// and leases are untouched.
    pub async fn shutdown(&self, identity: &EndpointIdentity) -> bool {
        let removed = self
            .lock_endpoints()
            .ok()
            .and_then(|mut endpoints| endpoints.remove(identity))
            .map(|managed| managed.endpoint);
        match removed {
            Some(endpoint) => {
                endpoint.shutdown().await;
                true
            }
            None => false,
        }
    }

    fn lock_endpoints(&self) -> Result<MutexGuard<'_, HashMap<EndpointIdentity, ManagedEndpoint>>> {
        self.endpoints
            .lock()
            .map_err(|_| IrohError::TransportClosed)
    }
}

/// A bound Iroh endpoint is only ever loopback-facing on this side: the Home
/// acceptor target and the client tunnel listener are both loopback-only, and
/// a fixed target needs a concrete port.
pub fn validate_loopback_target(host: &str, port: u16) -> Result<()> {
    let ip: std::net::IpAddr = if host == "localhost" {
        std::net::IpAddr::V4(std::net::Ipv4Addr::LOCALHOST)
    } else {
        host.parse().map_err(|_| IrohError::LoopbackBindFailed)?
    };
    if ip.is_loopback() && port != 0 {
        Ok(())
    } else {
        Err(IrohError::LoopbackBindFailed)
    }
}

/// The client tunnel listener must bind a loopback address on any port
/// (including the ephemeral port 0).
pub fn validate_loopback_bind_addr(addr: std::net::SocketAddr) -> Result<()> {
    if addr.ip().is_loopback() {
        Ok(())
    } else {
        Err(IrohError::LoopbackBindFailed)
    }
}

pub fn validate_endpoint_id(value: &str) -> Result<()> {
    if value.len() == 64 && value.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Ok(());
    }
    iroh::EndpointId::from_str(value)
        .map(|_| ())
        .map_err(|_| IrohError::TransportClosed)
}

#[cfg(any(windows, test))]
const WINDOWS_KEY_ENVELOPE_MAGIC: &[u8; 8] = b"HPIRKEY\0";
#[cfg(any(windows, test))]
const WINDOWS_KEY_ENVELOPE_VERSION: u8 = 1;
#[cfg(any(windows, test))]
const WINDOWS_KEY_ENVELOPE_HEADER_LEN: usize = WINDOWS_KEY_ENVELOPE_MAGIC.len() + 1 + 4;
#[cfg(any(windows, test))]
const WINDOWS_DPAPI_CIPHERTEXT_MAX: usize = 4096;

#[cfg(any(windows, test))]
fn encode_windows_key_envelope(ciphertext: &[u8]) -> Result<Vec<u8>> {
    if ciphertext.is_empty() || ciphertext.len() > WINDOWS_DPAPI_CIPHERTEXT_MAX {
        return Err(IrohError::TransportClosed);
    }
    let ciphertext_len = u32::try_from(ciphertext.len()).map_err(|_| IrohError::TransportClosed)?;
    let mut envelope = Vec::with_capacity(WINDOWS_KEY_ENVELOPE_HEADER_LEN + ciphertext.len());
    envelope.extend_from_slice(WINDOWS_KEY_ENVELOPE_MAGIC);
    envelope.push(WINDOWS_KEY_ENVELOPE_VERSION);
    envelope.extend_from_slice(&ciphertext_len.to_le_bytes());
    envelope.extend_from_slice(ciphertext);
    Ok(envelope)
}

#[cfg(any(windows, test))]
fn decode_windows_key_envelope(envelope: &[u8]) -> Result<&[u8]> {
    if envelope.len() < WINDOWS_KEY_ENVELOPE_HEADER_LEN
        || &envelope[..WINDOWS_KEY_ENVELOPE_MAGIC.len()] != WINDOWS_KEY_ENVELOPE_MAGIC
        || envelope[WINDOWS_KEY_ENVELOPE_MAGIC.len()] != WINDOWS_KEY_ENVELOPE_VERSION
    {
        return Err(IrohError::TransportClosed);
    }
    let length_offset = WINDOWS_KEY_ENVELOPE_MAGIC.len() + 1;
    let ciphertext_len = u32::from_le_bytes(
        envelope[length_offset..length_offset + 4]
            .try_into()
            .map_err(|_| IrohError::TransportClosed)?,
    ) as usize;
    if ciphertext_len == 0 || ciphertext_len > WINDOWS_DPAPI_CIPHERTEXT_MAX {
        return Err(IrohError::TransportClosed);
    }
    let expected_len = WINDOWS_KEY_ENVELOPE_HEADER_LEN
        .checked_add(ciphertext_len)
        .ok_or(IrohError::TransportClosed)?;
    if envelope.len() != expected_len {
        return Err(IrohError::TransportClosed);
    }
    Ok(&envelope[WINDOWS_KEY_ENVELOPE_HEADER_LEN..])
}

#[cfg(windows)]
fn windows_dpapi_protect(key: &[u8]) -> Result<Vec<u8>> {
    use std::ptr::null;
    use windows_sys::Win32::Foundation::LocalFree;
    use windows_sys::Win32::Security::Cryptography::{
        CryptProtectData, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB,
    };

    if key.len() != 32 {
        return Err(IrohError::TransportClosed);
    }
    let input = CRYPT_INTEGER_BLOB {
        cbData: key.len() as u32,
        pbData: key.as_ptr().cast_mut(),
    };
    let mut output = CRYPT_INTEGER_BLOB::default();
    let protected = unsafe {
        CryptProtectData(
            &input,
            null(),
            null(),
            null(),
            null(),
            CRYPTPROTECT_UI_FORBIDDEN,
            &mut output,
        )
    };
    if protected == 0 {
        return Err(IrohError::TransportClosed);
    }
    let valid = !output.pbData.is_null()
        && output.cbData > 0
        && output.cbData as usize <= WINDOWS_DPAPI_CIPHERTEXT_MAX;
    let ciphertext = if valid {
        Some(unsafe { std::slice::from_raw_parts(output.pbData, output.cbData as usize).to_vec() })
    } else {
        None
    };
    if !output.pbData.is_null() {
        unsafe {
            std::ptr::write_bytes(output.pbData, 0, output.cbData as usize);
            LocalFree(output.pbData.cast());
        }
    }
    ciphertext.ok_or(IrohError::TransportClosed)
}

#[cfg(windows)]
fn windows_dpapi_unprotect(ciphertext: &[u8]) -> Result<Vec<u8>> {
    use std::ptr::{null, null_mut};
    use windows_sys::Win32::Foundation::LocalFree;
    use windows_sys::Win32::Security::Cryptography::{
        CryptUnprotectData, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB,
    };

    if ciphertext.is_empty() || ciphertext.len() > WINDOWS_DPAPI_CIPHERTEXT_MAX {
        return Err(IrohError::TransportClosed);
    }
    let input = CRYPT_INTEGER_BLOB {
        cbData: ciphertext.len() as u32,
        pbData: ciphertext.as_ptr().cast_mut(),
    };
    let mut output = CRYPT_INTEGER_BLOB::default();
    let unprotected = unsafe {
        CryptUnprotectData(
            &input,
            null_mut(),
            null(),
            null(),
            null(),
            CRYPTPROTECT_UI_FORBIDDEN,
            &mut output,
        )
    };
    if unprotected == 0 {
        return Err(IrohError::TransportClosed);
    }
    let mut key = if !output.pbData.is_null() && output.cbData == 32 {
        Some(unsafe { std::slice::from_raw_parts(output.pbData, 32).to_vec() })
    } else {
        None
    };
    if !output.pbData.is_null() {
        unsafe {
            std::ptr::write_bytes(output.pbData, 0, output.cbData as usize);
            LocalFree(output.pbData.cast());
        }
    }
    key.take().ok_or(IrohError::TransportClosed)
}

#[cfg(windows)]
fn windows_path(path: &Path) -> Result<Vec<u16>> {
    use std::os::windows::ffi::OsStrExt;

    let mut wide = path.as_os_str().encode_wide().collect::<Vec<_>>();
    if wide.contains(&0) {
        return Err(IrohError::TransportClosed);
    }
    wide.push(0);
    Ok(wide)
}

#[cfg(windows)]
fn protect_windows_key_file_acl(path: &Path) -> Result<()> {
    use std::ptr::{null, null_mut};
    use windows_sys::Win32::Foundation::{CloseHandle, LocalFree, ERROR_SUCCESS};
    use windows_sys::Win32::Security::Authorization::{
        SetEntriesInAclW, SetNamedSecurityInfoW, EXPLICIT_ACCESS_W, GRANT_ACCESS, SE_FILE_OBJECT,
        TRUSTEE_IS_SID, TRUSTEE_IS_USER, TRUSTEE_W,
    };
    use windows_sys::Win32::Security::{
        GetTokenInformation, TokenUser, DACL_SECURITY_INFORMATION, NO_INHERITANCE,
        OWNER_SECURITY_INFORMATION, PROTECTED_DACL_SECURITY_INFORMATION, TOKEN_QUERY, TOKEN_USER,
    };
    use windows_sys::Win32::Storage::FileSystem::FILE_ALL_ACCESS;
    use windows_sys::Win32::System::Threading::{GetCurrentProcess, OpenProcessToken};

    let wide_path = windows_path(path)?;
    let mut token = null_mut();
    if unsafe { OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token) } == 0 {
        return Err(IrohError::TransportClosed);
    }

    let outcome = (|| -> Result<()> {
        let mut token_len = 0;
        unsafe { GetTokenInformation(token, TokenUser, null_mut(), 0, &mut token_len) };
        if token_len < std::mem::size_of::<TOKEN_USER>() as u32 {
            return Err(IrohError::TransportClosed);
        }
        let mut token_bytes = vec![0u8; token_len as usize];
        if unsafe {
            GetTokenInformation(
                token,
                TokenUser,
                token_bytes.as_mut_ptr().cast(),
                token_len,
                &mut token_len,
            )
        } == 0
        {
            return Err(IrohError::TransportClosed);
        }
        let user_sid = unsafe { (*(token_bytes.as_ptr().cast::<TOKEN_USER>())).User.Sid };
        if user_sid.is_null() {
            return Err(IrohError::TransportClosed);
        }

        let entry = EXPLICIT_ACCESS_W {
            grfAccessPermissions: FILE_ALL_ACCESS,
            grfAccessMode: GRANT_ACCESS,
            grfInheritance: NO_INHERITANCE,
            Trustee: TRUSTEE_W {
                pMultipleTrustee: null_mut(),
                MultipleTrusteeOperation: 0,
                TrusteeForm: TRUSTEE_IS_SID,
                TrusteeType: TRUSTEE_IS_USER,
                ptstrName: user_sid.cast(),
            },
        };
        let mut acl = null_mut();
        let acl_status = unsafe { SetEntriesInAclW(1, &entry, null(), &mut acl) };
        if acl_status != ERROR_SUCCESS || acl.is_null() {
            if !acl.is_null() {
                unsafe {
                    LocalFree(acl.cast());
                }
            }
            return Err(IrohError::TransportClosed);
        }
        let security_status = unsafe {
            SetNamedSecurityInfoW(
                wide_path.as_ptr(),
                SE_FILE_OBJECT,
                OWNER_SECURITY_INFORMATION
                    | DACL_SECURITY_INFORMATION
                    | PROTECTED_DACL_SECURITY_INFORMATION,
                user_sid,
                null_mut(),
                acl,
                null(),
            )
        };
        unsafe {
            LocalFree(acl.cast());
        }
        if security_status != ERROR_SUCCESS {
            return Err(IrohError::TransportClosed);
        }
        Ok(())
    })();

    unsafe {
        CloseHandle(token);
    }
    outcome
}

#[cfg(unix)]
fn ensure_posix_key_parent(path: &Path) -> std::io::Result<&Path> {
    use std::os::unix::fs::{DirBuilderExt, MetadataExt, PermissionsExt};

    let parent = path.parent().ok_or_else(|| {
        std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            "endpoint key path has no parent",
        )
    })?;
    let created = match fs::symlink_metadata(parent) {
        Ok(_) => false,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            let mut builder = fs::DirBuilder::new();
            builder.recursive(true).mode(0o700).create(parent)?;
            true
        }
        Err(error) => return Err(error),
    };
    let metadata = fs::symlink_metadata(parent)?;
    if metadata.file_type().is_symlink() || !metadata.file_type().is_dir() {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            "endpoint key parent is not a real directory",
        ));
    }
    if metadata.uid() != unsafe { libc::geteuid() } {
        return Err(std::io::Error::new(
            std::io::ErrorKind::PermissionDenied,
            "endpoint key parent is not owned by the current user",
        ));
    }
    if created {
        fs::set_permissions(parent, fs::Permissions::from_mode(0o700))?;
    } else if metadata.permissions().mode() & 0o777 != 0o700 {
        return Err(std::io::Error::new(
            std::io::ErrorKind::PermissionDenied,
            "endpoint key parent permissions are not private",
        ));
    }
    let metadata = fs::symlink_metadata(parent)?;
    if metadata.file_type().is_symlink()
        || !metadata.file_type().is_dir()
        || metadata.uid() != unsafe { libc::geteuid() }
        || metadata.permissions().mode() & 0o777 != 0o700
    {
        return Err(std::io::Error::new(
            std::io::ErrorKind::PermissionDenied,
            "endpoint key parent could not be secured",
        ));
    }
    Ok(parent)
}

#[cfg(unix)]
fn load_posix_key(path: &Path) -> std::io::Result<Vec<u8>> {
    use std::os::unix::fs::{MetadataExt, OpenOptionsExt};

    ensure_posix_key_parent(path)?;
    let metadata = fs::symlink_metadata(path)?;
    if metadata.file_type().is_symlink()
        || !metadata.file_type().is_file()
        || metadata.uid() != unsafe { libc::geteuid() }
        || metadata.mode() & 0o777 != 0o600
        || metadata.nlink() != 1
    {
        return Err(std::io::Error::new(
            std::io::ErrorKind::PermissionDenied,
            "endpoint key file is not a private regular file",
        ));
    }
    let mut file = fs::OpenOptions::new()
        .read(true)
        .custom_flags(libc::O_CLOEXEC | libc::O_NOFOLLOW)
        .open(path)?;
    let opened = file.metadata()?;
    if !opened.file_type().is_file()
        || opened.uid() != unsafe { libc::geteuid() }
        || opened.mode() & 0o777 != 0o600
        || opened.nlink() != 1
        || opened.dev() != metadata.dev()
        || opened.ino() != metadata.ino()
    {
        return Err(std::io::Error::new(
            std::io::ErrorKind::PermissionDenied,
            "endpoint key changed during secure open",
        ));
    }
    let mut bytes = Vec::with_capacity(32);
    std::io::Read::by_ref(&mut file)
        .take(33)
        .read_to_end(&mut bytes)?;
    if bytes.len() != 32 {
        bytes.zeroize();
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            "endpoint key has invalid length",
        ));
    }
    Ok(bytes)
}

/// File-backed key seam. `ensure` loads the stored key or creates one when
/// missing; `load` and `write_atomic` move caller-provided bytes. POSIX stores
/// atomic 0600 seed files; Windows stores only a strict DPAPI CurrentUser
/// envelope under a protected current-user-only DACL. Corrupt existing bytes
/// fail closed and are never rotated; this module never logs or serializes key
/// material.
pub struct EndpointKeyStore;
impl EndpointKeyStore {
    pub fn ensure(path: &Path) -> Result<Vec<u8>> {
        // EndpointManager may race two first acquires for the same identity
        // before either async bind reaches the map. Serialize the tiny local
        // file boundary so every caller observes one persistent key.
        let _guard = ENDPOINT_KEY_STORE_LOCK
            .lock()
            .map_err(|_| IrohError::TransportClosed)?;
        match fs::symlink_metadata(path) {
            Ok(_) => return Self::load(path),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(IrohError::from(error)),
        }
        let mut key = vec![0u8; 32];
        if getrandom::fill(&mut key).is_err() {
            key.zeroize();
            return Err(IrohError::TransportClosed);
        }
        let write_result = Self::write_atomic(path, &key);
        key.zeroize();
        if let Err(error) = write_result {
            if matches!(&error, IrohError::Io(inner) if inner.kind() == std::io::ErrorKind::AlreadyExists)
            {
                return Self::load(path);
            }
            return Err(error);
        }
        // Return the authoritative on-disk bytes, never merely the generated
        // candidate, so a future cross-process owner cannot be hidden here.
        Self::load(path)
    }

    pub fn load(path: &Path) -> Result<Vec<u8>> {
        #[cfg(windows)]
        {
            protect_windows_key_file_acl(path)?;
            let envelope = fs::read(path).map_err(IrohError::from)?;
            let ciphertext = decode_windows_key_envelope(&envelope)?;
            return windows_dpapi_unprotect(ciphertext);
        }

        #[cfg(not(windows))]
        load_posix_key(path).map_err(IrohError::from)
    }
    pub fn write_atomic(path: &Path, key: &[u8]) -> Result<()> {
        if key.len() != 32 {
            return Err(IrohError::TransportClosed);
        }

        #[cfg(windows)]
        let payload = {
            let ciphertext = windows_dpapi_protect(key)?;
            encode_windows_key_envelope(&ciphertext)?
        };
        #[cfg(not(windows))]
        let payload = key;

        #[cfg(unix)]
        let parent = ensure_posix_key_parent(path)?;
        #[cfg(windows)]
        let parent = path.parent().ok_or(IrohError::TransportClosed)?;
        #[cfg(windows)]
        fs::create_dir_all(parent)?;
        let file_name = path
            .file_name()
            .and_then(|value| value.to_str())
            .ok_or(IrohError::TransportClosed)?;
        let nonce = ENDPOINT_KEY_TEMP_NONCE.fetch_add(1, Ordering::Relaxed);
        let tmp = parent.join(format!(".{file_name}.tmp-{}-{nonce}", std::process::id()));
        let write_result = (|| -> std::io::Result<()> {
            let mut options = fs::OpenOptions::new();
            options.write(true).create_new(true);
            #[cfg(unix)]
            {
                use std::os::unix::fs::OpenOptionsExt;
                options.mode(0o600);
            }
            let mut file = options.open(&tmp)?;
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                file.set_permissions(fs::Permissions::from_mode(0o600))?;
            }
            file.write_all(&payload)?;
            file.sync_all()?;
            drop(file);
            #[cfg(windows)]
            protect_windows_key_file_acl(&tmp).map_err(std::io::Error::other)?;
            #[cfg(unix)]
            {
                fs::hard_link(&tmp, path)?;
                fs::remove_file(&tmp)?;
                fs::File::open(parent)?.sync_all()?;
            }
            #[cfg(windows)]
            {
                fs::rename(&tmp, path)?;
                protect_windows_key_file_acl(path).map_err(std::io::Error::other)?;
            }
            Ok(())
        })();
        if let Err(error) = write_result {
            let _ = fs::remove_file(&tmp);
            return Err(IrohError::from(error));
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(unix)]
    fn unix_key_test_root(label: &str) -> PathBuf {
        std::env::temp_dir().join(format!(
            "happier-iroh-{label}-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos(),
        ))
    }

    #[cfg(unix)]
    fn create_private_directory(path: &Path) {
        use std::os::unix::fs::PermissionsExt;

        fs::create_dir_all(path).unwrap();
        fs::set_permissions(path, fs::Permissions::from_mode(0o700)).unwrap();
    }

    #[test]
    fn native_endpoint_seed_derives_stable_public_identity_without_exposing_seed_bytes() {
        let first = EndpointSeed::from_bytes([7u8; 32]);
        let same = EndpointSeed::from_bytes([7u8; 32]);
        let different = EndpointSeed::from_bytes([8u8; 32]);

        assert_eq!(first.endpoint_id(), same.endpoint_id());
        assert_ne!(first.endpoint_id(), different.endpoint_id());
        assert_eq!(format!("{first:?}"), "EndpointSeed(REDACTED)");
        assert!(!format!("{first:?}").contains("7"));
    }

    #[tokio::test]
    async fn native_endpoint_seed_survives_manager_teardown_and_conflicts_with_key_path() {
        let config = EndpointConfig {
            key_seed: Some(EndpointSeed::from_bytes([11u8; 32])),
            relay_policy: RelayPolicy::Disabled,
            ..EndpointConfig::default()
        };
        let first_manager = EndpointManager::new();
        let first = first_manager.acquire(&config).await.unwrap();
        let first_id = first.id();
        assert!(
            first_manager
                .shutdown(&EndpointIdentity::Seeded(first_id))
                .await
        );

        let restarted = EndpointManager::new().acquire(&config).await.unwrap();
        assert_eq!(restarted.id(), first_id);
        restarted.shutdown().await;

        let conflict = EndpointConfig {
            key_path: Some(std::env::temp_dir().join("must-not-be-read.key")),
            key_seed: Some(EndpointSeed::from_bytes([12u8; 32])),
            relay_policy: RelayPolicy::Disabled,
            ..EndpointConfig::default()
        };
        assert!(matches!(
            IrohEndpoint::bind(&conflict).await,
            Err(IrohError::EndpointConfigConflict)
        ));
    }

    #[test]
    fn key_store_rejects_wrong_length_and_round_trips_exact_bytes() {
        #[cfg(unix)]
        let root = unix_key_test_root("key-round-trip");
        #[cfg(unix)]
        let path = root.join("identity").join("endpoint.key");
        #[cfg(not(unix))]
        let path = std::env::temp_dir().join(format!("happier-iroh-key-{}", std::process::id()));
        assert_eq!(
            EndpointKeyStore::write_atomic(&path, &[1, 2]),
            Err(IrohError::TransportClosed)
        );
        let key = vec![7u8; 32];
        EndpointKeyStore::write_atomic(&path, &key).unwrap();
        assert_eq!(EndpointKeyStore::load(&path).unwrap(), key);
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = fs::metadata(&path).unwrap().permissions().mode();
            assert_eq!(mode & 0o777, 0o600, "key files stay restrictive on POSIX");
            let parent_mode = fs::metadata(path.parent().unwrap())
                .unwrap()
                .permissions()
                .mode();
            assert_eq!(
                parent_mode & 0o777,
                0o700,
                "key parent stays private on POSIX"
            );
        }
        #[cfg(unix)]
        fs::remove_dir_all(root).unwrap();
        #[cfg(not(unix))]
        let _ = fs::remove_file(path);
    }

    #[cfg(unix)]
    #[test]
    fn posix_key_store_rejects_permissive_file_without_changing_or_rotating_it() {
        use std::os::unix::fs::PermissionsExt;

        let root = unix_key_test_root("permissive-file");
        let parent = root.join("identity");
        create_private_directory(&parent);
        let path = parent.join("endpoint.key");
        let bytes = [0x31; 32];
        fs::write(&path, bytes).unwrap();
        fs::set_permissions(&path, fs::Permissions::from_mode(0o644)).unwrap();

        assert!(EndpointKeyStore::load(&path).is_err());
        assert!(EndpointKeyStore::ensure(&path).is_err());
        assert_eq!(fs::read(&path).unwrap(), bytes);
        assert_eq!(
            fs::metadata(&path).unwrap().permissions().mode() & 0o777,
            0o644
        );

        fs::remove_dir_all(root).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn posix_key_store_rejects_corrupt_regular_file_without_rotation() {
        use std::os::unix::fs::PermissionsExt;

        let root = unix_key_test_root("corrupt-file");
        let parent = root.join("identity");
        create_private_directory(&parent);
        let path = parent.join("endpoint.key");
        let corrupt = [0x3d; 31];
        fs::write(&path, corrupt).unwrap();
        fs::set_permissions(&path, fs::Permissions::from_mode(0o600)).unwrap();

        assert!(EndpointKeyStore::load(&path).is_err());
        assert!(EndpointKeyStore::ensure(&path).is_err());
        assert_eq!(fs::read(&path).unwrap(), corrupt);

        fs::remove_dir_all(root).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn posix_key_store_rejects_a_permissive_existing_parent_without_mutating_it() {
        use std::os::unix::fs::PermissionsExt;

        let root = unix_key_test_root("permissive-parent");
        let parent = root.join("identity");
        fs::create_dir_all(&parent).unwrap();
        fs::set_permissions(&parent, fs::Permissions::from_mode(0o755)).unwrap();
        let path = parent.join("endpoint.key");

        assert!(EndpointKeyStore::ensure(&path).is_err());
        assert!(!path.exists());
        assert_eq!(
            fs::metadata(&parent).unwrap().permissions().mode() & 0o777,
            0o755
        );

        fs::remove_dir_all(root).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn posix_key_store_rejects_key_and_parent_symlinks() {
        use std::os::unix::fs::symlink;

        let root = unix_key_test_root("symlink");
        let identity = root.join("identity");
        let target_parent = root.join("target");
        create_private_directory(&identity);
        create_private_directory(&target_parent);
        let target = target_parent.join("endpoint.key");
        let bytes = [0x47; 32];
        fs::write(&target, bytes).unwrap();
        fs::set_permissions(&target, {
            use std::os::unix::fs::PermissionsExt;
            fs::Permissions::from_mode(0o600)
        })
        .unwrap();

        let key_link = identity.join("endpoint.key");
        symlink(&target, &key_link).unwrap();
        assert!(EndpointKeyStore::load(&key_link).is_err());
        assert!(EndpointKeyStore::ensure(&key_link).is_err());
        assert_eq!(fs::read(&target).unwrap(), bytes);

        let parent_link = root.join("linked-identity");
        symlink(&identity, &parent_link).unwrap();
        let linked_key = parent_link.join("other.key");
        assert!(EndpointKeyStore::ensure(&linked_key).is_err());
        assert!(!identity.join("other.key").exists());

        fs::remove_dir_all(root).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn posix_key_store_rejects_multiply_linked_key_material() {
        let root = unix_key_test_root("hard-link");
        let identity = root.join("identity");
        let other = root.join("other");
        create_private_directory(&identity);
        create_private_directory(&other);
        let path = identity.join("endpoint.key");
        EndpointKeyStore::write_atomic(&path, &[0x49; 32]).unwrap();
        fs::hard_link(&path, other.join("disclosed.key")).unwrap();

        assert!(EndpointKeyStore::load(&path).is_err());
        assert!(EndpointKeyStore::ensure(&path).is_err());

        fs::remove_dir_all(root).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn posix_key_store_never_replaces_an_existing_identity() {
        let root = unix_key_test_root("no-replace");
        let parent = root.join("identity");
        create_private_directory(&parent);
        let path = parent.join("endpoint.key");
        let original = [0x51; 32];
        let replacement = [0x52; 32];

        EndpointKeyStore::write_atomic(&path, &original).unwrap();
        assert!(EndpointKeyStore::write_atomic(&path, &replacement).is_err());
        assert_eq!(EndpointKeyStore::load(&path).unwrap(), original);

        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn key_store_fails_closed_without_leaving_generated_key_material_on_write_error() {
        let root = std::env::temp_dir().join(format!(
            "happier-iroh-key-write-error-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos(),
        ));
        #[cfg(unix)]
        create_private_directory(&root);
        #[cfg(not(unix))]
        fs::create_dir_all(&root).unwrap();
        let key_path = root.join("endpoint.key");
        // A directory at the key path produces a real non-NotFound read/write
        // failure. The key owner must fail closed without rotating it or
        // leaving a generated sibling temporary file behind.
        fs::create_dir(&key_path).unwrap();

        assert!(EndpointKeyStore::ensure(&key_path).is_err());
        let entries = fs::read_dir(&root)
            .unwrap()
            .map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned())
            .collect::<Vec<_>>();
        assert_eq!(entries, vec!["endpoint.key"]);

        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn key_store_concurrent_first_provision_returns_one_persistent_identity() {
        let root = std::env::temp_dir().join(format!(
            "happier-iroh-key-concurrent-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos(),
        ));
        let key_path = root.join("endpoint.key");
        let barrier = std::sync::Arc::new(std::sync::Barrier::new(8));
        let workers = (0..8)
            .map(|_| {
                let path = key_path.clone();
                let barrier = std::sync::Arc::clone(&barrier);
                std::thread::spawn(move || {
                    barrier.wait();
                    EndpointKeyStore::ensure(&path)
                })
            })
            .collect::<Vec<_>>();
        let results = workers
            .into_iter()
            .map(|worker| worker.join().unwrap())
            .collect::<Vec<_>>();

        assert!(results.iter().all(Result::is_ok));
        let persisted = EndpointKeyStore::load(&key_path).unwrap();
        assert!(results
            .into_iter()
            .all(|result| result.unwrap() == persisted));

        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn windows_key_envelope_is_strict_bounded_and_versioned() {
        let ciphertext = vec![0x5au8; 96];
        let envelope = encode_windows_key_envelope(&ciphertext).unwrap();
        assert_eq!(decode_windows_key_envelope(&envelope).unwrap(), ciphertext);

        for truncated_len in [0, WINDOWS_KEY_ENVELOPE_HEADER_LEN - 1, envelope.len() - 1] {
            assert!(decode_windows_key_envelope(&envelope[..truncated_len]).is_err());
        }

        let mut wrong_magic = envelope.clone();
        wrong_magic[0] ^= 0xff;
        assert!(decode_windows_key_envelope(&wrong_magic).is_err());

        let mut future_version = envelope.clone();
        future_version[WINDOWS_KEY_ENVELOPE_MAGIC.len()] = WINDOWS_KEY_ENVELOPE_VERSION + 1;
        assert!(decode_windows_key_envelope(&future_version).is_err());

        let mut trailing = envelope.clone();
        trailing.push(0);
        assert!(decode_windows_key_envelope(&trailing).is_err());

        assert!(encode_windows_key_envelope(&vec![0; WINDOWS_DPAPI_CIPHERTEXT_MAX + 1]).is_err());
    }

    #[cfg(windows)]
    fn windows_key_test_path(label: &str) -> PathBuf {
        std::env::temp_dir().join(format!(
            "happier-iroh-{label}-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos(),
        ))
    }

    #[cfg(windows)]
    #[test]
    fn windows_key_store_round_trip_is_restart_stable_and_never_persists_plaintext() {
        let root = windows_key_test_path("dpapi-round-trip");
        let path = root.join("endpoint.key");

        let plaintext = EndpointKeyStore::ensure(&path).unwrap();
        let disk = fs::read(&path).unwrap();
        assert_ne!(disk, plaintext);
        assert!(!disk
            .windows(plaintext.len())
            .any(|window| window == plaintext));
        assert_eq!(EndpointKeyStore::load(&path).unwrap(), plaintext);
        assert_eq!(EndpointKeyStore::ensure(&path).unwrap(), plaintext);

        fs::remove_dir_all(root).unwrap();
    }

    #[cfg(windows)]
    #[test]
    fn windows_key_store_rejects_corruption_without_rotation() {
        let plaintext = vec![0x3c; 32];
        for (label, corrupt) in [
            ("ciphertext", 0usize),
            ("truncated", 1usize),
            ("future-version", 2usize),
            ("oversized", 3usize),
        ] {
            let root = windows_key_test_path(label);
            let path = root.join("endpoint.key");
            EndpointKeyStore::write_atomic(&path, &plaintext).unwrap();
            let mut bytes = fs::read(&path).unwrap();
            match corrupt {
                0 => *bytes.last_mut().unwrap() ^= 0xff,
                1 => bytes.truncate(WINDOWS_KEY_ENVELOPE_HEADER_LEN - 1),
                2 => bytes[WINDOWS_KEY_ENVELOPE_MAGIC.len()] = WINDOWS_KEY_ENVELOPE_VERSION + 1,
                3 => {
                    let length_offset = WINDOWS_KEY_ENVELOPE_MAGIC.len() + 1;
                    bytes[length_offset..length_offset + 4].copy_from_slice(
                        &((WINDOWS_DPAPI_CIPHERTEXT_MAX + 1) as u32).to_le_bytes(),
                    );
                }
                _ => unreachable!(),
            }
            fs::write(&path, &bytes).unwrap();

            assert!(EndpointKeyStore::load(&path).is_err(), "{label}");
            assert!(EndpointKeyStore::ensure(&path).is_err(), "{label}");
            assert_eq!(fs::read(&path).unwrap(), bytes, "{label} rotated");
            fs::remove_dir_all(root).unwrap();
        }
    }

    #[cfg(windows)]
    #[test]
    fn windows_key_file_dacl_is_protected_and_current_owner_only() {
        use std::os::windows::ffi::OsStrExt;
        use std::ptr::null_mut;
        use windows_sys::Win32::Foundation::{CloseHandle, LocalFree, ERROR_SUCCESS};
        use windows_sys::Win32::Security::Authorization::{GetNamedSecurityInfoW, SE_FILE_OBJECT};
        use windows_sys::Win32::Security::{
            AclSizeInformation, EqualSid, GetAce, GetAclInformation, GetSecurityDescriptorControl,
            GetTokenInformation, TokenUser, ACCESS_ALLOWED_ACE, ACL_SIZE_INFORMATION,
            DACL_SECURITY_INFORMATION, OWNER_SECURITY_INFORMATION, PSECURITY_DESCRIPTOR,
            SE_DACL_PROTECTED, TOKEN_QUERY, TOKEN_USER,
        };
        use windows_sys::Win32::Storage::FileSystem::FILE_ALL_ACCESS;
        use windows_sys::Win32::System::Threading::{GetCurrentProcess, OpenProcessToken};

        let root = windows_key_test_path("owner-dacl");
        let path = root.join("endpoint.key");
        EndpointKeyStore::write_atomic(&path, &[0x17; 32]).unwrap();

        let wide_path = path
            .as_os_str()
            .encode_wide()
            .chain(std::iter::once(0))
            .collect::<Vec<_>>();
        let mut owner = null_mut();
        let mut dacl = null_mut();
        let mut descriptor: PSECURITY_DESCRIPTOR = null_mut();
        let status = unsafe {
            GetNamedSecurityInfoW(
                wide_path.as_ptr(),
                SE_FILE_OBJECT,
                OWNER_SECURITY_INFORMATION | DACL_SECURITY_INFORMATION,
                &mut owner,
                null_mut(),
                &mut dacl,
                null_mut(),
                &mut descriptor,
            )
        };
        assert_eq!(status, ERROR_SUCCESS);
        assert!(!owner.is_null());
        assert!(!dacl.is_null());

        let mut control = 0;
        let mut revision = 0;
        assert_ne!(
            unsafe { GetSecurityDescriptorControl(descriptor, &mut control, &mut revision) },
            0
        );
        assert_ne!(control & SE_DACL_PROTECTED, 0);

        let mut acl_info = ACL_SIZE_INFORMATION::default();
        assert_ne!(
            unsafe {
                GetAclInformation(
                    dacl,
                    (&mut acl_info as *mut ACL_SIZE_INFORMATION).cast(),
                    std::mem::size_of::<ACL_SIZE_INFORMATION>() as u32,
                    AclSizeInformation,
                )
            },
            0
        );
        assert_eq!(acl_info.AceCount, 1);
        let mut ace = null_mut();
        assert_ne!(unsafe { GetAce(dacl, 0, &mut ace) }, 0);
        let allowed = unsafe { &*(ace.cast::<ACCESS_ALLOWED_ACE>()) };
        assert_eq!(allowed.Header.AceType, 0);
        assert_eq!(allowed.Mask, FILE_ALL_ACCESS);
        let ace_sid = std::ptr::addr_of!(allowed.SidStart).cast_mut().cast();
        assert_ne!(unsafe { EqualSid(ace_sid, owner) }, 0);

        let mut token = null_mut();
        assert_ne!(
            unsafe { OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token) },
            0
        );
        let mut token_len = 0;
        unsafe { GetTokenInformation(token, TokenUser, null_mut(), 0, &mut token_len) };
        assert!(token_len >= std::mem::size_of::<TOKEN_USER>() as u32);
        let mut token_bytes = vec![0u8; token_len as usize];
        assert_ne!(
            unsafe {
                GetTokenInformation(
                    token,
                    TokenUser,
                    token_bytes.as_mut_ptr().cast(),
                    token_len,
                    &mut token_len,
                )
            },
            0
        );
        let token_user = unsafe { &*(token_bytes.as_ptr().cast::<TOKEN_USER>()) };
        assert_ne!(unsafe { EqualSid(token_user.User.Sid, owner) }, 0);

        unsafe {
            CloseHandle(token);
            LocalFree(descriptor.cast());
        }
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn endpoint_id_accepts_canonical_iroh_and_protocol_hex_forms() {
        let key = iroh::SecretKey::from_bytes(&[3u8; 32]);
        assert!(validate_endpoint_id(&key.public().to_string()).is_ok());
        assert!(validate_endpoint_id(&"a".repeat(64)).is_ok());
        assert!(validate_endpoint_id("not-an-endpoint").is_err());
    }

    #[test]
    fn relay_selection_uses_the_iroh_parser_and_descriptor_policy() {
        // Valid explicit URLs under automatic produce a custom selection.
        let selection = RelaySelection::resolve(
            &RelayPolicy::Automatic,
            &[
                "https://relay.example.test".to_owned(),
                "http://fallback.example.test:3478/".to_owned(),
            ],
        )
        .unwrap();
        let RelaySelection::Custom(urls) = &selection else {
            panic!("automatic with explicit URLs must be custom");
        };
        assert_eq!(urls.len(), 2);
        assert_eq!(selection.mode(), "custom");

        // Ambient n0 is never selected: automatic without URLs binds an empty
        // custom map that can be extended when another Home is adopted.
        assert_eq!(
            RelaySelection::resolve(&RelayPolicy::Automatic, &[]).unwrap(),
            RelaySelection::Custom(vec![])
        );
        assert_eq!(
            RelaySelection::resolve(&RelayPolicy::Disabled, &[]).unwrap(),
            RelaySelection::Disabled
        );
        assert_eq!(RelaySelection::Disabled.mode(), "disabled");
        assert!(RelaySelection::Disabled.relay_urls().is_empty());

        // Disabled policy rejects relay URLs outright (no silent relay contact).
        assert_eq!(
            RelaySelection::resolve(
                &RelayPolicy::Disabled,
                &["https://relay.example.test".to_owned()]
            ),
            Err(IrohError::InvalidDescriptor)
        );

        // Grammar stays Iroh-owned; policy rejects credentials/fragments/schemes.
        for invalid in [
            "ftp://relay.example.test",
            "https://user:pass@relay.example.test",
            "https://relay.example.test/?token=secret",
            "https://relay.example.test/#fragment",
            "not-a-url",
            "",
        ] {
            assert_eq!(
                RelaySelection::resolve(&RelayPolicy::Automatic, &[invalid.to_owned()]),
                Err(IrohError::InvalidDescriptor),
                "must reject {invalid}"
            );
        }
        assert_eq!(
            RelaySelection::resolve(
                &RelayPolicy::Automatic,
                &(0..MAX_RELAY_URLS + 1)
                    .map(|index| format!("https://relay-{index}.example.test"))
                    .collect::<Vec<_>>()
            ),
            Err(IrohError::InvalidDescriptor)
        );
    }

    #[test]
    fn loopback_validation_covers_fixed_targets_and_bind_addresses() {
        assert!(validate_loopback_target("127.0.0.1", 3000).is_ok());
        assert!(validate_loopback_target("localhost", 8080).is_ok());
        assert!(validate_loopback_target("::1", 3000).is_ok());
        assert!(validate_loopback_target("10.0.0.1", 3000).is_err());
        assert!(validate_loopback_target("0.0.0.0", 3000).is_err());
        assert!(validate_loopback_target("127.0.0.1", 0).is_err());

        let loopback: std::net::SocketAddr = "127.0.0.1:0".parse().unwrap();
        assert!(validate_loopback_bind_addr(loopback).is_ok());
        let wild: std::net::SocketAddr = "0.0.0.0:0".parse().unwrap();
        assert!(validate_loopback_bind_addr(wild).is_err());
    }

    #[tokio::test]
    async fn endpoint_manager_shares_one_endpoint_across_flows_and_unions_relays() {
        let manager = EndpointManager::new();
        let key_root = std::env::temp_dir().join(format!(
            "happier-iroh-manager-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let key_path = key_root.join("identity").join("endpoint.key");
        let identity = EndpointIdentity::Keyed(key_path.clone());

        let base = EndpointConfig {
            key_path: Some(key_path.clone()),
            ..EndpointConfig::default()
        };
        let first = manager.acquire(&base).await.unwrap();
        let second = manager.acquire(&base).await.unwrap();
        assert_eq!(
            first.id(),
            second.id(),
            "compatible acquires must reuse one shared process endpoint"
        );

        // A second Home may contribute another explicit relay, and an outgoing
        // machine flow may require a different per-connection cap. Neither is
        // endpoint identity, so both must reuse the same persistent endpoint.
        let expanded = EndpointConfig {
            key_path: Some(key_path.clone()),
            relay_policy: RelayPolicy::Automatic,
            relay_urls: vec!["https://relay.example.test".to_owned()],
            caps: IrohCapProfile::MachineBulk,
            ..EndpointConfig::default()
        };
        let expanded_endpoint = manager.acquire(&expanded).await.unwrap();
        assert_eq!(expanded_endpoint.id(), first.id());
        let (config, shared) = manager
            .get(&identity)
            .expect("shared endpoint remains registered");
        assert_eq!(
            config.relay.relay_urls(),
            RelaySelection::resolve(
                &RelayPolicy::Automatic,
                &["https://relay.example.test".to_owned()]
            )
            .unwrap()
            .relay_urls()
        );
        assert_eq!(shared.id(), first.id());

        // Direct-only is application-wide and cannot be silently changed by
        // an individual Home descriptor.
        let conflicting_policy = EndpointConfig {
            key_path: Some(key_path.clone()),
            relay_policy: RelayPolicy::Disabled,
            ..EndpointConfig::default()
        };
        assert!(matches!(
            manager.acquire(&conflicting_policy).await,
            Err(IrohError::EndpointConfigConflict)
        ));

        // Keyless acquires get distinct ephemeral endpoints (test fixtures).
        let ephemeral_a = manager.acquire(&EndpointConfig::default()).await.unwrap();
        let ephemeral_b = manager.acquire(&EndpointConfig::default()).await.unwrap();
        assert_ne!(ephemeral_a.id(), ephemeral_b.id());

        // Explicit shutdown closes only the named identity.
        assert!(manager.shutdown(&identity).await);
        assert!(manager.get(&identity).is_none());
        assert!(manager.get(&EndpointIdentity::Ephemeral(1)).is_some());
        first.shutdown().await;
        ephemeral_a.shutdown().await;
        ephemeral_b.shutdown().await;
        let _ = fs::remove_dir_all(&key_root);
    }
}
