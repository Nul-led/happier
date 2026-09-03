//! The `wasm-bindgen` boundary for browser Iroh endpoint and stream custody.
//!
//! A7.1/I10 established the feasibility surface; A7.3/A7.4 add the incremental
//! bidirectional stream boundary consumed by the browser Home HTTP, Socket.IO,
//! and finite machine-transfer carriers. QR and Account Service consume the
//! resulting transport through their existing scoped owners rather than this
//! binding directly. The shared core still owns relay validation, exact
//! EndpointId dialing, ALPN, limits, and cancellation while this boundary owns
//! opaque browser stream handles.

use std::cell::{Cell, RefCell};
use std::collections::{HashMap, HashSet};
use std::future::Future;
use std::rc::Rc;
use std::str::FromStr;

use happier_iroh_core::{
    inbound_alpns, observed_path_for_connection, refuse_inbound_until_closed,
    verified_remote_endpoint_id, InboundStopSignal, IrohEndpoint, IrohObservedPath, RelaySelection,
    TARGET_INBOUND_ALPN_ROLE, TUNNEL_PREAMBLE,
};
use wasm_bindgen::prelude::*;
use zeroize::Zeroize;

use crate::config::{
    browser_observed_path, validate_stream_read_size, validate_stream_write_size,
    BrowserEndpointPlan, BrowserStreamKind,
};

/// A browser has no acceptor at all, so the shared core must resolve this build
/// target to the dial-only inbound role and advertise no inbound ALPN. Checked
/// at compile time because the browser build cannot run the core's host tests.
const _: () = assert!(matches!(
    TARGET_INBOUND_ALPN_ROLE,
    happier_iroh_core::InboundAlpnRole::DialOnly
));

fn to_js<E: std::fmt::Debug>(error: E) -> JsValue {
    JsValue::from_str(&format!("{error:?}"))
}

fn closed_error() -> JsValue {
    JsValue::from_str("endpoint_closed")
}

fn cancelled_error() -> JsValue {
    JsValue::from_str("cancelled")
}

/// Everything a live browser probe owns: the bound endpoint and one live
/// connection per authenticated target EndpointId.
///
/// The seed-bearing [`BrowserEndpointPlan`] is deliberately NOT here: it is
/// consumed by `create` and dropped (zeroizing the seed) as soon as the
/// endpoint is bound, so the browser's persisted identity material has no
/// second copy for the endpoint's lifetime. The applied relay facts are read
/// back from the endpoint, which is their canonical owner.
///
/// The whole struct is held in a single `Option`, so terminal close is one
/// `take`: afterwards the probe retains no transport or key material at all and
/// every later call fails `endpoint_closed`.
struct LiveEndpoint {
    /// Shared so an in-flight operation can await endpoint work without holding
    /// a `RefCell` borrow across it. Terminal close drops this probe's handle
    /// after shutting the endpoint down; a still-unwinding operation's clone
    /// releases with it.
    endpoint: Rc<IrohEndpoint>,
    /// Connection custody under the one browser endpoint. A7.2's concurrent
    /// Homes each keep their own connection instead of evicting one another;
    /// entries are bounded only by the targets a consumer is actually using and
    /// are removed on final lease release, connection death, cancellation, or
    /// probe close.
    /// This is custody, not a second endpoint registry.
    ///
    /// Keyed by target **and protocol**: an Iroh connection is negotiated for
    /// one ALPN, so a Home-tunnel connection is not a machine connection even to
    /// the same EndpointId. Keying by target alone would let a machine open be
    /// silently served over `happier/home-tunnel/1`.
    connections: RefCell<HashMap<ConnectionKey, iroh::endpoint::Connection>>,
    /// Targets with a dial in flight, under the same target+protocol key. One
    /// cold dial per key at a time: concurrent opens for the same key wait for
    /// it instead of racing to replace each other's connection.
    dialing: RefCell<HashSet<ConnectionKey>>,
    /// Incremental stream objects never cross into a tab. The SharedWorker's
    /// wasm endpoint retains both directions behind opaque integer handles.
    streams: RefCell<HashMap<u32, Rc<IncrementalStream>>>,
}

/// One target under one protocol. Both fields are load bearing: see
/// [`LiveEndpoint::connections`].
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
struct ConnectionKey {
    target: iroh::EndpointId,
    kind: BrowserStreamKind,
}

struct IncrementalStream {
    remote_endpoint_id: iroh::EndpointId,
    /// The path the transport actually selected for this stream's connection,
    /// normalized for a relay-only carrier.
    observed_path: IrohObservedPath,
    send: RefCell<Option<iroh::endpoint::SendStream>>,
    recv: RefCell<Option<iroh::endpoint::RecvStream>>,
    generation: Cell<u64>,
    changed: tokio::sync::Notify,
    closed: Cell<bool>,
}

impl IncrementalStream {
    fn cancel(&self) {
        if self.closed.replace(true) {
            return;
        }
        self.generation.set(self.generation.get().wrapping_add(1));
        self.changed.notify_waiters();
        if let Some(mut send) = self.send.borrow_mut().take() {
            let _ = send.reset(0u32.into());
        }
        if let Some(mut recv) = self.recv.borrow_mut().take() {
            let _ = recv.stop(0u32.into());
        }
    }

    async fn await_cancellation(&self, generation: u64) {
        loop {
            let notified = self.changed.notified();
            if self.closed.get() || self.generation.get() != generation {
                return;
            }
            notified.await;
        }
    }
}

impl Drop for IncrementalStream {
    fn drop(&mut self) {
        self.cancel();
    }
}

struct ProbeInner {
    live: RefCell<Option<LiveEndpoint>>,
    /// Cancellation generation. `cancel()` and `close()` bump it and wake
    /// `changed`, so an operation still dialing or still reading a response
    /// rejects promptly instead of completing against a cancelled request.
    generation: Cell<u64>,
    /// Woken whenever the generation changes or a dial settles.
    changed: tokio::sync::Notify,
    /// Stops the dial-only inbound owner. That task holds its own endpoint
    /// clone, so it cannot be ended by dropping this probe's handles alone.
    inbound_stop: Rc<InboundStopSignal>,
    streams_opened: Cell<u32>,
    dials_started: Cell<u32>,
    next_stream_handle: Cell<u32>,
}

impl Drop for ProbeInner {
    /// Defensive backstop only. Terminal release is owned by the probe handle's
    /// own [`Drop`], which runs while operations may still hold this state;
    /// this runs after the last of them has let go. Stopping an already-stopped
    /// signal is a no-op, so the two never fight.
    fn drop(&mut self) {
        self.inbound_stop.stop();
    }
}

/// One persistent browser endpoint. A7.2 requires a single endpoint per
/// browser application/profile; this probe therefore takes the persisted
/// identity seed from its caller instead of minting one.
#[wasm_bindgen]
pub struct HappierBrowserIrohProbe {
    inner: Rc<ProbeInner>,
}

impl Drop for HappierBrowserIrohProbe {
    /// The handle a JS caller holds is the probe's lifetime, so releasing it is
    /// terminal — whether that release is `close`, wasm-bindgen's generated
    /// `free`, or the wrapper being garbage collected.
    ///
    /// This has to happen here rather than on [`ProbeInner`]: an in-flight
    /// `openHomeTunnelStream` holds its own `Rc<ProbeInner>` for as long as its
    /// Promise is pending, so a caller that releases the wrapper while a Home
    /// withholds a response would otherwise leave the endpoint, its
    /// connections, its key material, and its inbound owner alive behind a
    /// Promise nobody can cancel — and the Home's late answer would still
    /// complete an operation whose owner is gone.
    ///
    /// Release is synchronous for exactly that reason: by the time this
    /// returns, pending operations are cancelled, live connections are closed,
    /// the inbound owner is stopped, and the endpoint has been taken out of the
    /// probe so nothing further can be admitted.
    fn drop(&mut self) {
        if let Some(live) = self.inner.take_for_terminal_release(b"closed") {
            // The endpoint is already unreachable; this only lets iroh tell the
            // peers instead of dropping the last handle on them ungracefully.
            // Nothing waits on it: teardown is decided above, not here.
            wasm_bindgen_futures::spawn_local(async move {
                live.endpoint.shutdown().await;
                drop(live);
            });
        }
    }
}

#[wasm_bindgen]
impl HappierBrowserIrohProbe {
    /// Binds the browser endpoint. `secretKey` is the persisted 32-byte
    /// identity; `relayUrls` are the descriptor's explicitly configured relays.
    #[wasm_bindgen(js_name = create)]
    pub async fn create(
        mut secret_key: Vec<u8>,
        relay_urls: Vec<String>,
    ) -> Result<HappierBrowserIrohProbe, JsValue> {
        let plan = BrowserEndpointPlan::resolve(&secret_key, &relay_urls);
        // The Rust-side copy of the inbound seed is wiped as soon as the plan
        // owns it. The JS `Uint8Array` the caller passed in stays the caller's
        // to manage; nothing here retains a second plaintext copy.
        secret_key.zeroize();
        let plan = plan.map_err(to_js)?;
        let endpoint = IrohEndpoint::bind(&plan.endpoint_config())
            .await
            .map_err(to_js)?;
        // The plan has done its one job. Dropping it here zeroizes the seed, so
        // the running probe holds no copy of the browser's persisted identity —
        // only the endpoint iroh itself owns.
        drop(plan);
        // The dial-only role's inbound owner, started here because the browser
        // has no task runtime of its own. It refuses, never accepts. It holds
        // the stop signal this probe raises on close and on drop, so releasing
        // the probe releases the endpoint clone the task holds.
        let inbound_stop = Rc::new(InboundStopSignal::new());
        wasm_bindgen_futures::spawn_local(refuse_inbound_until_closed(
            endpoint.endpoint(),
            Rc::clone(&inbound_stop),
        ));
        Ok(Self {
            inner: Rc::new(ProbeInner {
                live: RefCell::new(Some(LiveEndpoint {
                    endpoint: Rc::new(endpoint),
                    connections: RefCell::new(HashMap::new()),
                    dialing: RefCell::new(HashSet::new()),
                    streams: RefCell::new(HashMap::new()),
                })),
                generation: Cell::new(0),
                changed: tokio::sync::Notify::new(),
                inbound_stop,
                streams_opened: Cell::new(0),
                dials_started: Cell::new(0),
                next_stream_handle: Cell::new(1),
            }),
        })
    }

    /// The inbound ALPNs a browser endpoint advertises, read from the shared
    /// core's target policy. A browser is dial-only, so this is empty and a
    /// native peer's inbound Home or machine handshake fails ALPN negotiation.
    #[wasm_bindgen(js_name = advertisedInboundAlpns)]
    pub fn advertised_inbound_alpns() -> Vec<String> {
        inbound_alpns(TARGET_INBOUND_ALPN_ROLE)
            .into_iter()
            .map(|alpn| String::from_utf8_lossy(&alpn).into_owned())
            .collect()
    }

    #[wasm_bindgen(js_name = endpointId)]
    pub fn endpoint_id(&self) -> Result<String, JsValue> {
        self.inner
            .with_live(|live| live.endpoint.id().to_string())
            .ok_or_else(closed_error)
    }

    /// The relay set actually applied to the bound endpoint, reported from the
    /// endpoint itself rather than from the requested descriptor.
    #[wasm_bindgen(js_name = appliedRelayUrls)]
    pub fn applied_relay_urls(&self) -> Result<Vec<String>, JsValue> {
        self.inner
            .with_live(|live| {
                live.endpoint
                    .relay_selection()
                    .relay_urls()
                    .iter()
                    .map(|url| url.to_string())
                    .collect()
            })
            .ok_or_else(closed_error)
    }

    /// Applies one Home's explicitly configured relay facts to this endpoint
    /// without opening anything, so the browser application/profile's single
    /// endpoint can adopt a second Home's relays as they are configured rather
    /// than only at the moment of a request.
    ///
    /// The core validates the set and unions it into the endpoint's own relay
    /// membership; adopting one Home never evicts another's relay, and there is
    /// no browser-side relay grammar here. This is A7.2 endpoint configuration,
    /// not a route: reachability is still decided per target at dial time.
    #[wasm_bindgen(js_name = applyRelayUrls)]
    pub fn apply_relay_urls(&self, relay_urls: Vec<String>) -> js_sys::Promise {
        let inner = Rc::clone(&self.inner);
        wasm_bindgen_futures::future_to_promise(async move {
            inner.apply_relay_urls(&relay_urls).await?;
            Ok(JsValue::UNDEFINED)
        })
    }

    #[wasm_bindgen(js_name = streamsOpened)]
    pub fn streams_opened(&self) -> u32 {
        self.inner.streams_opened.get()
    }

    /// How many dials this probe has started. Reusing a target's live
    /// connection does not dial again, so this distinguishes real per-target
    /// custody from a single slot that re-dials on every target switch.
    #[wasm_bindgen(js_name = dialsStarted)]
    pub fn dials_started(&self) -> u32 {
        self.inner.dials_started.get()
    }

    /// True once close has taken the endpoint out of the probe. No operation is
    /// admitted afterwards.
    #[wasm_bindgen(js_name = isClosed)]
    pub fn is_closed(&self) -> bool {
        self.inner.live.borrow().is_none()
    }

    #[wasm_bindgen(js_name = hasLiveConnection)]
    pub fn has_live_connection(&self) -> bool {
        !self.live_connection_targets().is_empty()
    }

    /// The authenticated targets this endpoint currently holds a live
    /// connection to, sorted for stable reporting. A target reached under both
    /// protocols is held twice, because those are two connections.
    #[wasm_bindgen(js_name = liveConnectionTargets)]
    pub fn live_connection_targets(&self) -> Vec<String> {
        let mut targets = self
            .inner
            .with_live(|live| {
                live.connections
                    .borrow()
                    .iter()
                    .filter(|(_, connection)| connection.close_reason().is_none())
                    .map(|(key, _)| key.target.to_string())
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();
        targets.sort();
        targets
    }

    /// Opens one bidirectional Home-tunnel stream over the configured relay,
    /// writes the shared tunnel preamble plus `request`, and returns the bytes
    /// the existing Home acceptor writes back.
    ///
    /// This is a bounded request/response probe: it half-closes the send side
    /// and reads to end under `maxResponseBytes`. It is deliberately NOT the
    /// production boundary. `serverFetch` streaming responses and the
    /// Socket.IO/Engine.IO duplex owner need an incremental read/write surface,
    /// which I11/I12 must add on top of these same connections; nothing here
    /// establishes that contract.
    /// `relayUrls` are that target's own descriptor relays, and they are
    /// required: a relay-only carrier has no other path, and another Home's
    /// relay is not a path to this one. They are validated by the core before
    /// anything else is consulted, added to this one endpoint's relay set (a
    /// union — another Home's relay is never evicted), and used as the dial
    /// hints for this target only.
    #[wasm_bindgen(js_name = openHomeTunnelStream)]
    pub fn open_home_tunnel_stream(
        &self,
        endpoint_id: String,
        request: Vec<u8>,
        max_response_bytes: u32,
        relay_urls: Vec<String>,
    ) -> js_sys::Promise {
        let inner = Rc::clone(&self.inner);
        wasm_bindgen_futures::future_to_promise(async move {
            let response = inner
                .open_home_tunnel_stream(
                    &endpoint_id,
                    &request,
                    max_response_bytes as usize,
                    &relay_urls,
                )
                .await?;
            Ok(js_sys::Uint8Array::from(response.as_slice()).into())
        })
    }

    /// Opens a Home tunnel stream but leaves both directions live behind an
    /// opaque handle. The authenticated remote id stored with the stream is
    /// the id proven by the connection, never a relay/address hint.
    ///
    /// The shared tunnel preamble is written here, because Iroh streams are
    /// lazy until the first write and the Home acceptor reads that byte before
    /// anything else.
    #[wasm_bindgen(js_name = openIncrementalHomeTunnelStream)]
    pub fn open_incremental_home_tunnel_stream(
        &self,
        endpoint_id: String,
        relay_urls: Vec<String>,
    ) -> js_sys::Promise {
        self.open_incremental_stream(BrowserStreamKind::Home, endpoint_id, relay_urls)
    }

    /// Opens one `happier/machine/1` stream to the exact signed machine
    /// EndpointId and leaves both directions live behind an opaque handle.
    ///
    /// This is a separate operation rather than a parameter so no ALPN string
    /// ever crosses this boundary: the protocol is named by the method the
    /// caller invoked, and the ALPN itself comes from the shared core.
    ///
    /// Unlike the Home tunnel, nothing is written here. The canonical machine
    /// admission frame — preamble, handshake length, signed handshake — is one
    /// write owned by the existing machine-carrier seam, which then reads the
    /// single admission decision byte before any payload byte. Writing a bare
    /// preamble here would split that frame across two owners. The caller is
    /// expected to write it immediately: the stream is lazy until the first
    /// write, and the acceptor bounds how long an admitted connection may take
    /// to open its first application stream.
    #[wasm_bindgen(js_name = openIncrementalMachineStream)]
    pub fn open_incremental_machine_stream(
        &self,
        endpoint_id: String,
        relay_urls: Vec<String>,
    ) -> js_sys::Promise {
        self.open_incremental_stream(BrowserStreamKind::Machine, endpoint_id, relay_urls)
    }

    #[wasm_bindgen(js_name = streamRemoteEndpointId)]
    pub fn stream_remote_endpoint_id(&self, stream_handle: u32) -> Result<String, JsValue> {
        Ok(self
            .inner
            .stream(stream_handle)?
            .remote_endpoint_id
            .to_string())
    }

    /// The path this stream's connection actually selected. A relay-only
    /// browser carrier reports `relay` or `unknown`; it never claims `direct`.
    #[wasm_bindgen(js_name = streamObservedPath)]
    pub fn stream_observed_path(&self, stream_handle: u32) -> Result<String, JsValue> {
        Ok(self
            .inner
            .stream(stream_handle)?
            .observed_path
            .as_str()
            .to_string())
    }

    #[wasm_bindgen(js_name = readStream)]
    pub fn read_stream(&self, stream_handle: u32, max_bytes: u32) -> js_sys::Promise {
        let inner = Rc::clone(&self.inner);
        wasm_bindgen_futures::future_to_promise(async move {
            match inner.read_stream(stream_handle, max_bytes as usize).await? {
                Some(bytes) => Ok(js_sys::Uint8Array::from(bytes.as_slice()).into()),
                None => Ok(JsValue::NULL),
            }
        })
    }

    #[wasm_bindgen(js_name = writeStream)]
    pub fn write_stream(&self, stream_handle: u32, bytes: Vec<u8>) -> js_sys::Promise {
        let inner = Rc::clone(&self.inner);
        wasm_bindgen_futures::future_to_promise(async move {
            inner.write_stream(stream_handle, bytes).await?;
            Ok(JsValue::UNDEFINED)
        })
    }

    #[wasm_bindgen(js_name = finishStreamWrite)]
    pub fn finish_stream_write(&self, stream_handle: u32) -> js_sys::Promise {
        let inner = Rc::clone(&self.inner);
        wasm_bindgen_futures::future_to_promise(async move {
            inner.finish_stream_write(stream_handle)?;
            Ok(JsValue::UNDEFINED)
        })
    }

    #[wasm_bindgen(js_name = cancelStream)]
    pub fn cancel_stream(&self, stream_handle: u32) {
        if let Ok(stream) = self.inner.stream(stream_handle) {
            stream.cancel();
        }
    }

    #[wasm_bindgen(js_name = closeStream)]
    pub fn close_stream(&self, stream_handle: u32) -> js_sys::Promise {
        let inner = Rc::clone(&self.inner);
        wasm_bindgen_futures::future_to_promise(async move {
            inner.close_stream(stream_handle);
            Ok(JsValue::UNDEFINED)
        })
    }

    /// Releases one Home-tunnel connection while keeping the browser's single
    /// application endpoint alive for other Homes and later re-dials.
    #[wasm_bindgen(js_name = closeHomeTunnelConnection)]
    pub fn close_home_tunnel_connection(&self, endpoint_id: String) -> Result<(), JsValue> {
        self.inner
            .close_connection(BrowserStreamKind::Home, &endpoint_id)
    }

    /// Releases one Machine connection while keeping the browser's single
    /// application endpoint alive for other Homes and later re-dials.
    #[wasm_bindgen(js_name = closeMachineConnection)]
    pub fn close_machine_connection(&self, endpoint_id: String) -> Result<(), JsValue> {
        self.inner
            .close_connection(BrowserStreamKind::Machine, &endpoint_id)
    }

    /// Cancels every current and pending operation and closes every live
    /// connection, without shutting the endpoint down. A pending dial or a
    /// pending response rejects immediately rather than hanging, and the
    /// endpoint stays reusable for the next request.
    #[wasm_bindgen(js_name = cancel)]
    pub fn cancel(&self) {
        self.inner.cancel_operations(b"cancelled");
    }

    /// Terminal teardown, awaited: the same release the probe performs when it
    /// is dropped, plus waiting for the endpoint shutdown to finish. A closed
    /// probe retains no key material and admits no further operation.
    ///
    /// A later close is a no-op because there is nothing left to take. Two
    /// closes issued concurrently are not coalesced: the second finds the
    /// endpoint already taken and resolves without waiting for the first
    /// shutdown to finish.
    #[wasm_bindgen(js_name = close)]
    pub fn close(&self) -> js_sys::Promise {
        let inner = Rc::clone(&self.inner);
        wasm_bindgen_futures::future_to_promise(async move {
            if let Some(live) = inner.take_for_terminal_release(b"closed") {
                live.endpoint.shutdown().await;
                // Dropping the endpoint releases iroh's own secret key; the
                // seed-bearing plan was already dropped and zeroized by `create`.
                drop(live);
            }
            Ok(JsValue::UNDEFINED)
        })
    }
}

impl HappierBrowserIrohProbe {
    /// The one incremental-open entry point. Both public operations reach the
    /// transport through it, so protocol selection is the only difference
    /// between them and neither can drift into a second open path.
    fn open_incremental_stream(
        &self,
        kind: BrowserStreamKind,
        endpoint_id: String,
        relay_urls: Vec<String>,
    ) -> js_sys::Promise {
        let inner = Rc::clone(&self.inner);
        wasm_bindgen_futures::future_to_promise(async move {
            let handle = inner
                .open_incremental_stream(kind, &endpoint_id, &relay_urls)
                .await?;
            Ok(JsValue::from_f64(f64::from(handle)))
        })
    }
}

impl ProbeInner {
    /// Reads live state under a short borrow. `None` means the probe is closed;
    /// no borrow is ever held across an await point.
    fn with_live<T>(&self, read: impl FnOnce(&LiveEndpoint) -> T) -> Option<T> {
        self.live.borrow().as_ref().map(read)
    }

    /// The one terminal-release step, shared by `close` and by the probe
    /// handle's `Drop` so there is a single owner of what "released" means.
    ///
    /// Everything here is synchronous: in-flight operations are cancelled and
    /// woken, live connections are closed, the inbound owner is stopped, and
    /// the endpoint is taken out of the probe, which is what makes every later
    /// call fail `endpoint_closed`. The returned [`LiveEndpoint`] is the
    /// caller's to shut down; `None` means the probe was already released.
    fn take_for_terminal_release(&self, reason: &'static [u8]) -> Option<LiveEndpoint> {
        self.cancel_operations(reason);
        self.inbound_stop.stop();
        self.live.borrow_mut().take()
    }

    fn cancel_operations(&self, reason: &'static [u8]) {
        self.generation.set(self.generation.get().wrapping_add(1));
        self.changed.notify_waiters();
        if let Some(connections) =
            self.with_live(|live| live.connections.borrow_mut().drain().collect::<Vec<_>>())
        {
            for (_, connection) in connections {
                connection.close(0u32.into(), reason);
            }
        }
        if let Some(streams) = self.with_live(|live| {
            live.streams
                .borrow_mut()
                .drain()
                .map(|(_, stream)| stream)
                .collect::<Vec<_>>()
        }) {
            for stream in streams {
                stream.cancel();
            }
        }
    }

    fn stream(&self, stream_handle: u32) -> Result<Rc<IncrementalStream>, JsValue> {
        self.with_live(|live| live.streams.borrow().get(&stream_handle).cloned())
            .flatten()
            .ok_or_else(|| JsValue::from_str("unknown_stream"))
    }

    fn allocate_stream_handle(&self) -> u32 {
        let handle = self.next_stream_handle.get();
        self.next_stream_handle.set(handle.wrapping_add(1).max(1));
        handle
    }

    async fn open_incremental_stream(
        &self,
        kind: BrowserStreamKind,
        endpoint_id: &str,
        relay_urls: &[String],
    ) -> Result<u32, JsValue> {
        BrowserEndpointPlan::validate_target(endpoint_id).map_err(to_js)?;
        let selection = self.apply_relay_urls(relay_urls).await?;
        let target = iroh::EndpointId::from_str(endpoint_id).map_err(to_js)?;
        let key = ConnectionKey { target, kind };
        let generation = self.generation.get();
        let connection = match self.live_connection(key)? {
            Some(connection) => connection,
            None => self.connect(generation, key, &selection).await?,
        };
        let (mut send, recv) = self
            .until_cancelled(generation, connection.open_bi())
            .await?
            .map_err(to_js)?;
        // Home framing only. The machine seam owns its whole admission frame;
        // see `openIncrementalMachineStream`.
        if matches!(kind, BrowserStreamKind::Home) {
            send.write_all(&[TUNNEL_PREAMBLE]).await.map_err(to_js)?;
        }
        if self.generation.get() != generation {
            let _ = send.reset(0u32.into());
            return Err(cancelled_error());
        }
        let stream_handle = self.allocate_stream_handle();
        let stream = Rc::new(IncrementalStream {
            remote_endpoint_id: connection.remote_id(),
            observed_path: browser_observed_path(observed_path_for_connection(&connection)),
            send: RefCell::new(Some(send)),
            recv: RefCell::new(Some(recv)),
            generation: Cell::new(0),
            changed: tokio::sync::Notify::new(),
            closed: Cell::new(false),
        });
        let inserted = self.with_live(|live| {
            live.streams.borrow_mut().insert(stream_handle, stream);
        });
        if inserted.is_none() {
            return Err(closed_error());
        }
        self.streams_opened.set(self.streams_opened.get() + 1);
        Ok(stream_handle)
    }

    async fn read_stream(
        &self,
        stream_handle: u32,
        max_bytes: usize,
    ) -> Result<Option<Vec<u8>>, JsValue> {
        validate_stream_read_size(max_bytes).map_err(to_js)?;
        let stream = self.stream(stream_handle)?;
        if stream.closed.get() {
            return Err(cancelled_error());
        }
        let generation = stream.generation.get();
        let mut recv = stream
            .recv
            .borrow_mut()
            .take()
            .ok_or_else(|| JsValue::from_str("read_in_progress"))?;
        let mut bytes = vec![0u8; max_bytes];
        let read = tokio::select! {
            biased;
            () = stream.await_cancellation(generation) => Err(cancelled_error()),
            result = recv.read(&mut bytes) => result.map_err(to_js),
        };
        if stream.closed.get() || stream.generation.get() != generation {
            return Err(cancelled_error());
        }
        stream.recv.borrow_mut().replace(recv);
        match read? {
            Some(length) => {
                bytes.truncate(length);
                Ok(Some(bytes))
            }
            None => Ok(None),
        }
    }

    async fn write_stream(&self, stream_handle: u32, bytes: Vec<u8>) -> Result<(), JsValue> {
        validate_stream_write_size(bytes.len()).map_err(to_js)?;
        let stream = self.stream(stream_handle)?;
        if stream.closed.get() {
            return Err(cancelled_error());
        }
        let generation = stream.generation.get();
        let mut send = stream
            .send
            .borrow_mut()
            .take()
            .ok_or_else(|| JsValue::from_str("write_in_progress"))?;
        let written = tokio::select! {
            biased;
            () = stream.await_cancellation(generation) => Err(cancelled_error()),
            result = send.write_all(&bytes) => result.map_err(to_js),
        };
        if stream.closed.get() || stream.generation.get() != generation {
            return Err(cancelled_error());
        }
        stream.send.borrow_mut().replace(send);
        written
    }

    fn finish_stream_write(&self, stream_handle: u32) -> Result<(), JsValue> {
        let stream = self.stream(stream_handle)?;
        if stream.closed.get() {
            return Err(cancelled_error());
        }
        let send = stream.send.borrow_mut().take();
        match send {
            Some(mut send) => send.finish().map_err(to_js),
            None => Ok(()),
        }
    }

    fn close_stream(&self, stream_handle: u32) {
        if let Some(stream) = self
            .with_live(|live| live.streams.borrow_mut().remove(&stream_handle))
            .flatten()
        {
            stream.cancel();
        }
    }

    fn close_connection(&self, kind: BrowserStreamKind, endpoint_id: &str) -> Result<(), JsValue> {
        BrowserEndpointPlan::validate_target(endpoint_id).map_err(to_js)?;
        let target = iroh::EndpointId::from_str(endpoint_id).map_err(to_js)?;
        let key = ConnectionKey { target, kind };
        let removed = self
            .with_live(|live| live.connections.borrow_mut().remove(&key))
            .ok_or_else(closed_error)?;
        if let Some(connection) = removed {
            connection.close(0u32.into(), b"lease_released");
        }
        Ok(())
    }

    /// Validates one relay set and unions it into the live endpoint, returning
    /// the normalized selection. One definition of "apply relay facts", shared
    /// by A7.2 endpoint configuration and the open path's per-target hints.
    async fn apply_relay_urls(&self, relay_urls: &[String]) -> Result<RelaySelection, JsValue> {
        // Validated before any live state is consulted. A malformed or
        // credential-bearing hint set is a bad descriptor whether or not the
        // endpoint already has this relay, so nothing can launder one.
        let selection = BrowserEndpointPlan::resolve_target_relays(relay_urls).map_err(to_js)?;
        let generation = self.generation.get();
        let endpoint = self
            .with_live(|live| Rc::clone(&live.endpoint))
            .ok_or_else(closed_error)?;
        // `ensure_relay_urls` is a union, so joining one Home's relay never
        // evicts another's.
        self.until_cancelled(
            generation,
            endpoint.ensure_relay_urls(selection.relay_urls()),
        )
        .await?
        .map_err(to_js)?;
        Ok(selection)
    }

    async fn open_home_tunnel_stream(
        &self,
        endpoint_id: &str,
        request: &[u8],
        max_response_bytes: usize,
        relay_urls: &[String],
    ) -> Result<Vec<u8>, JsValue> {
        BrowserEndpointPlan::validate_target(endpoint_id).map_err(to_js)?;
        // This target's supplied relay facts are validated and applied to the
        // one endpoint before the connection is used.
        let selection = self.apply_relay_urls(relay_urls).await?;
        let target = iroh::EndpointId::from_str(endpoint_id).map_err(to_js)?;
        let key = ConnectionKey {
            target,
            kind: BrowserStreamKind::Home,
        };
        let generation = self.generation.get();

        // A connection is reusable only for the target it is actually
        // authenticated to, and only for the protocol it negotiated, so a
        // request to another Home — or over another ALPN — never rides this
        // peer's connection and the identity guard is never bypassed.
        let connection = match self.live_connection(key)? {
            Some(connection) => connection,
            None => self.connect(generation, key, &selection).await?,
        };

        let (mut send, mut recv) = self
            .until_cancelled(generation, connection.open_bi())
            .await?
            .map_err(to_js)?;
        self.streams_opened.set(self.streams_opened.get() + 1);
        // Iroh streams are lazy until the first write, so the shared tunnel
        // preamble is written immediately, exactly as the native Home tunnel
        // does.
        send.write_all(&[TUNNEL_PREAMBLE]).await.map_err(to_js)?;
        send.write_all(request).await.map_err(to_js)?;
        send.finish().map_err(to_js)?;
        self.until_cancelled(generation, recv.read_to_end(max_response_bytes))
            .await?
            .map_err(to_js)
    }

    /// Runs one operation until it finishes or this probe is cancelled/closed.
    /// Dropping the operation future aborts the underlying dial or read, so a
    /// pending request releases its transport work instead of running on.
    async fn until_cancelled<T>(
        &self,
        generation: u64,
        operation: impl Future<Output = T>,
    ) -> Result<T, JsValue> {
        if self.generation.get() != generation {
            return Err(cancelled_error());
        }
        tokio::select! {
            biased;
            () = self.await_cancellation(generation) => Err(cancelled_error()),
            result = operation => Ok(result),
        }
    }

    async fn await_cancellation(&self, generation: u64) {
        loop {
            // Registered before the generation is re-read, so a cancellation
            // between the two can never be missed.
            let notified = self.changed.notified();
            if self.generation.get() != generation {
                return;
            }
            notified.await;
        }
    }

    fn live_connection(
        &self,
        key: ConnectionKey,
    ) -> Result<Option<iroh::endpoint::Connection>, JsValue> {
        let borrowed = self.live.borrow();
        let live = borrowed.as_ref().ok_or_else(closed_error)?;
        let mut connections = live.connections.borrow_mut();
        match connections.get(&key) {
            Some(connection) if connection.close_reason().is_none() => Ok(Some(connection.clone())),
            // A dead connection leaves custody instead of being handed out or
            // retained; the next request for this target dials again.
            Some(_) => {
                connections.remove(&key);
                Ok(None)
            }
            None => Ok(None),
        }
    }

    /// Establishes (or joins) the one cold dial for a target under one protocol.
    ///
    /// Concurrent opens for the same key do not each dial: the first becomes
    /// the dial owner and the others wait for it, then take its connection.
    /// Without that, two cold opens would both dial and one would silently
    /// replace the other's connection, orphaning a live transport.
    async fn connect(
        &self,
        generation: u64,
        key: ConnectionKey,
        selection: &RelaySelection,
    ) -> Result<iroh::endpoint::Connection, JsValue> {
        loop {
            if self.generation.get() != generation {
                return Err(cancelled_error());
            }
            if let Some(connection) = self.live_connection(key)? {
                return Ok(connection);
            }
            let owned = self.claim_dial(key)?;
            if owned {
                let _guard = DialGuard { inner: self, key };
                return self.dial_owned(generation, key, selection).await;
            }
            // Another open owns this key's dial. Wait for it to settle, then
            // re-check: normally its connection is now in custody.
            let notified = self.changed.notified();
            if !self.is_dialing(key) || self.generation.get() != generation {
                continue;
            }
            notified.await;
        }
    }

    fn claim_dial(&self, key: ConnectionKey) -> Result<bool, JsValue> {
        self.with_live(|live| live.dialing.borrow_mut().insert(key))
            .ok_or_else(closed_error)
    }

    fn is_dialing(&self, key: ConnectionKey) -> bool {
        self.with_live(|live| live.dialing.borrow().contains(&key))
            .unwrap_or(false)
    }

    async fn dial_owned(
        &self,
        generation: u64,
        key: ConnectionKey,
        selection: &RelaySelection,
    ) -> Result<iroh::endpoint::Connection, JsValue> {
        let endpoint = self
            .with_live(|live| Rc::clone(&live.endpoint))
            .ok_or_else(closed_error)?;
        self.dials_started.set(self.dials_started.get() + 1);
        // A cold dial uses exactly this target's own validated relay set. The
        // endpoint's accumulated union is membership, not reachability: another
        // Home's relay is not a path to this target.
        let connection = self
            .until_cancelled(
                generation,
                dial(endpoint.endpoint(), selection.clone(), key),
            )
            .await??;
        // A dial that completed after a cancellation or a close must not enter
        // custody: it is closed instead of becoming a live connection nobody
        // asked for.
        if self.generation.get() != generation {
            connection.close(0u32.into(), b"cancelled");
            return Err(cancelled_error());
        }
        match self.live.borrow().as_ref() {
            Some(live) => {
                live.connections
                    .borrow_mut()
                    .insert(key, connection.clone());
                Ok(connection)
            }
            None => {
                connection.close(0u32.into(), b"closed");
                Err(closed_error())
            }
        }
    }
}

/// Releases one dial key's ownership when the owning open finishes, fails, or
/// is dropped by a cancellation, and wakes anyone waiting on it. Ownership can
/// never be stranded by a cancelled future.
struct DialGuard<'probe> {
    inner: &'probe ProbeInner,
    key: ConnectionKey,
}

impl Drop for DialGuard<'_> {
    fn drop(&mut self) {
        self.inner.with_live(|live| {
            live.dialing.borrow_mut().remove(&self.key);
        });
        self.inner.changed.notify_waiters();
    }
}

/// Dials one target over the configured relays, for exactly one protocol.
/// Free-standing so no probe borrow is held across the await.
async fn dial(
    endpoint: iroh::Endpoint,
    selection: RelaySelection,
    key: ConnectionKey,
) -> Result<iroh::endpoint::Connection, JsValue> {
    // Dial hints come from the core-validated relay set only. The browser
    // never contributes a direct IP address and never consults ambient
    // infrastructure for one.
    let mut remote = iroh::EndpointAddr::new(key.target);
    for url in selection.relay_urls() {
        remote = remote.with_relay_url(url.clone());
    }
    // The ALPN and the transport caps both come from the requested protocol's
    // core-owned facts; neither is a caller-supplied value.
    let options = iroh::endpoint::ConnectOptions::new()
        .with_transport_config(key.kind.cap_profile().transport_config().map_err(to_js)?);
    let connecting = endpoint
        .connect_with_opts(remote, key.kind.alpn().as_bytes(), options)
        .await
        .map_err(to_js)?;
    let connection = connecting.await.map_err(to_js)?;
    // The authenticated transport identity is checked by the same guard the
    // native tunnels use; a mismatch fails closed before any stream opens.
    verified_remote_endpoint_id(connection.remote_id(), key.target).map_err(to_js)?;
    Ok(connection)
}
