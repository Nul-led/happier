//! Target-independent admission rules for a browser Iroh endpoint.
//!
//! The browser carrier is relay-only in its first supported form (A7): it has
//! no IP transports at all, so a descriptor without an explicitly configured
//! relay cannot carry it. Everything else — relay grammar, bounds, credential
//! and scheme policy, endpoint-id grammar — is delegated to
//! `happier-iroh-core`, so there is exactly one definition of each rule.

use happier_iroh_core::{
    validate_endpoint_id, EndpointConfig, EndpointSeed, IrohAlpn, IrohCapProfile, IrohError,
    IrohObservedPath, RelayPolicy, RelaySelection, Result,
};
use zeroize::Zeroize;

/// Home traffic uses the same interactive profile the native Home tunnel uses.
pub const BROWSER_CAP_PROFILE: IrohCapProfile = IrohCapProfile::HomeInteractive;

/// The closed set of protocols a browser stream may be opened for.
///
/// This exists so no ALPN string ever crosses the JS/WASM boundary: a caller
/// names a kind, and this type is the only thing that maps a kind to the core's
/// ALPN constant and its transport-cap profile. Adding a third protocol is a
/// deliberate change here, never a caller-supplied value.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum BrowserStreamKind {
    Home,
    Machine,
}

impl BrowserStreamKind {
    pub const fn alpn(self) -> IrohAlpn {
        match self {
            Self::Home => IrohAlpn::HomeTunnel,
            Self::Machine => IrohAlpn::Machine,
        }
    }

    /// Home traffic is interactive; machine/1 is bulk, matching the profile the
    /// native machine tunnel requires of itself. Both are owned by the core.
    pub const fn cap_profile(self) -> IrohCapProfile {
        match self {
            Self::Home => BROWSER_CAP_PROFILE,
            Self::Machine => IrohCapProfile::MachineBulk,
        }
    }
}

/// Normalizes the core's observed path for a relay-only carrier.
///
/// A browser endpoint has no IP transports, so it cannot have established a
/// direct path; reporting one would be a claim the carrier cannot support. An
/// observed relay path is reported as such, and everything else — including a
/// value the transport could not decide — stays `unknown`.
pub fn browser_observed_path(observed: IrohObservedPath) -> IrohObservedPath {
    match observed {
        IrohObservedPath::Relay => IrohObservedPath::Relay,
        _ => IrohObservedPath::Unknown,
    }
}

/// Maximum bytes copied by one browser/SharedWorker stream operation. This is
/// deliberately smaller than the HomeInteractive carrier's per-stream receive
/// window, so incremental reads and structured-clone messages cannot become a
/// second unbounded buffering surface.
pub const BROWSER_STREAM_CHUNK_BYTES: usize = 1024 * 1024;

#[cfg(any(target_arch = "wasm32", test))]
pub fn validate_stream_read_size(max_bytes: usize) -> Result<()> {
    if max_bytes == 0 || max_bytes > BROWSER_STREAM_CHUNK_BYTES {
        return Err(IrohError::ResourceLimit);
    }
    Ok(())
}

#[cfg(any(target_arch = "wasm32", test))]
pub fn validate_stream_write_size(bytes: usize) -> Result<()> {
    if bytes > BROWSER_STREAM_CHUNK_BYTES {
        return Err(IrohError::ResourceLimit);
    }
    Ok(())
}

/// A validated browser endpoint plan: the persisted identity seed plus the
/// explicitly configured relay set the endpoint is allowed to use.
///
/// `EndpointSeed`'s own `Debug` is redacted, so this stays safe to log.
#[derive(Debug)]
pub struct BrowserEndpointPlan {
    seed: EndpointSeed,
    relay_urls: Vec<String>,
}

impl BrowserEndpointPlan {
    /// Validates a browser endpoint request.
    ///
    /// * `secret_key` is the 32-byte persisted browser identity. The browser
    ///   never mints one per load, per Home, per tab, or per request. The
    ///   caller owns wiping its own buffer; the intermediate copy taken here is
    ///   zeroized before returning, exactly as the native key store does, so
    ///   the only retained copy is `EndpointSeed`'s zeroize-on-drop one.
    /// * `relay_urls` are the descriptor's explicitly configured relays. An
    ///   empty set fails closed: a relay-only carrier with no relay would
    ///   otherwise be silently unusable, and ambient infrastructure is never
    ///   substituted for it.
    pub fn resolve(secret_key: &[u8], relay_urls: &[String]) -> Result<Self> {
        let mut seed_bytes: [u8; 32] = secret_key
            .try_into()
            .map_err(|_| IrohError::InvalidDescriptor)?;
        let resolved = Self::resolve_with_seed(&seed_bytes, relay_urls);
        seed_bytes.zeroize();
        resolved
    }

    fn resolve_with_seed(seed_bytes: &[u8; 32], relay_urls: &[String]) -> Result<Self> {
        Self::resolve_target_relays(relay_urls)?;
        Ok(Self {
            seed: EndpointSeed::from_bytes(*seed_bytes),
            relay_urls: relay_urls.to_vec(),
        })
    }

    /// Validates one set of explicitly configured relay facts — the endpoint's
    /// own at bind time, or one target's at open time — and returns the
    /// normalized set the transport may dial.
    ///
    /// The browser carrier is relay-only, so an empty set fails closed: there is
    /// no direct path to fall back to, ambient infrastructure is never
    /// substituted, and another Home's relay is not a path to this one. Grammar,
    /// scheme, credential, and bounds policy live in the core; this adds only
    /// the relay-only requirement.
    pub fn resolve_target_relays(relay_urls: &[String]) -> Result<RelaySelection> {
        if relay_urls.is_empty() {
            return Err(IrohError::InvalidDescriptor);
        }
        let selection = RelaySelection::resolve(&RelayPolicy::Automatic, relay_urls)?;
        if selection.relay_urls().is_empty() {
            return Err(IrohError::InvalidDescriptor);
        }
        Ok(selection)
    }

    /// The endpoint identity this plan will bind, available before any network
    /// activity so a caller can report it without a live transport.
    pub fn endpoint_id(&self) -> String {
        self.seed.endpoint_id().to_string()
    }

    /// The core endpoint configuration. `RelayPolicy::Automatic` with an
    /// explicit URL set resolves to a custom relay map in the core; there is no
    /// policy value that selects ambient relays.
    pub fn endpoint_config(&self) -> EndpointConfig {
        EndpointConfig {
            key_seed: Some(self.seed.clone()),
            relay_policy: RelayPolicy::Automatic,
            relay_urls: self.relay_urls.clone(),
            caps: BROWSER_CAP_PROFILE,
            ..EndpointConfig::default()
        }
    }

    /// Validates a dial target's endpoint id with the core grammar before any
    /// connection attempt.
    pub fn validate_target(endpoint_id: &str) -> Result<()> {
        validate_endpoint_id(endpoint_id)
    }

    pub fn relay_urls(&self) -> &[String] {
        &self.relay_urls
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const SEED: [u8; 32] = [9u8; 32];

    #[test]
    fn a_relay_only_browser_endpoint_requires_an_explicitly_configured_relay() {
        // No relay facts at all: the browser has no direct path to fall back
        // to, and ambient relays are never substituted.
        assert_eq!(
            BrowserEndpointPlan::resolve(&SEED, &[]).unwrap_err(),
            IrohError::InvalidDescriptor
        );
    }

    #[test]
    fn an_explicit_relay_is_applied_as_the_endpoint_relay_set() {
        let plan = BrowserEndpointPlan::resolve(&SEED, &["https://relay.happier.test".to_string()])
            .expect("an explicit relay is usable");
        let config = plan.endpoint_config();

        assert_eq!(config.relay_policy, RelayPolicy::Automatic);
        assert_eq!(config.relay_urls, vec!["https://relay.happier.test"]);
        assert_eq!(config.caps, IrohCapProfile::HomeInteractive);

        let selection = RelaySelection::resolve(&config.relay_policy, &config.relay_urls)
            .expect("the core re-resolves the applied set");
        assert_eq!(selection.mode(), "custom");
        assert_eq!(
            selection
                .relay_urls()
                .iter()
                .map(|url| url.to_string())
                .collect::<Vec<_>>(),
            vec!["https://relay.happier.test/"]
        );
    }

    #[test]
    fn a_plain_http_relay_is_usable_so_a_local_browser_fixture_needs_no_public_ca() {
        let plan = BrowserEndpointPlan::resolve(&SEED, &["http://127.0.0.1:3340".to_string()])
            .expect("http relays are valid descriptor relays");
        assert_eq!(plan.relay_urls(), &["http://127.0.0.1:3340".to_string()]);
    }

    #[test]
    fn descriptor_relay_policy_violations_are_rejected_by_the_core() {
        for invalid in [
            "https://user:secret@relay.happier.test",
            "ftp://relay.happier.test",
            "https://relay.happier.test?token=1",
            "not-a-url",
        ] {
            assert_eq!(
                BrowserEndpointPlan::resolve(&SEED, &[invalid.to_string()]).unwrap_err(),
                IrohError::InvalidDescriptor,
                "{invalid} must be rejected"
            );
        }
        let too_many = (0..9)
            .map(|index| format!("https://relay-{index}.happier.test"))
            .collect::<Vec<_>>();
        assert_eq!(
            BrowserEndpointPlan::resolve(&SEED, &too_many).unwrap_err(),
            IrohError::InvalidDescriptor
        );
    }

    #[test]
    fn the_browser_identity_is_the_persisted_seed_not_a_fresh_key() {
        let relays = vec!["https://relay.happier.test".to_string()];
        let first = BrowserEndpointPlan::resolve(&SEED, &relays).expect("plan");
        let second = BrowserEndpointPlan::resolve(&SEED, &relays).expect("plan");
        assert_eq!(first.endpoint_id(), second.endpoint_id());

        let other = BrowserEndpointPlan::resolve(&[3u8; 32], &relays).expect("plan");
        assert_ne!(first.endpoint_id(), other.endpoint_id());

        assert_eq!(
            BrowserEndpointPlan::resolve(&[0u8; 31], &relays).unwrap_err(),
            IrohError::InvalidDescriptor
        );
    }

    #[test]
    fn a_target_open_requires_its_own_exact_relay_set() {
        // A relay-only carrier has no other path, so an open with no relay facts
        // has nothing to dial. It fails closed here rather than silently
        // borrowing whatever relays other Homes have already contributed to the
        // one endpoint.
        assert_eq!(
            BrowserEndpointPlan::resolve_target_relays(&[]).unwrap_err(),
            IrohError::InvalidDescriptor
        );
        for invalid in [
            "https://user:secret@relay.happier.test",
            "https://relay.happier.test?token=1",
            "ftp://relay.happier.test",
            "not-a-url",
        ] {
            assert_eq!(
                BrowserEndpointPlan::resolve_target_relays(&[invalid.to_string()]).unwrap_err(),
                IrohError::InvalidDescriptor,
                "{invalid} must be rejected as a target relay hint"
            );
        }

        // The resolved set is exactly this target's relays in their normalized
        // core form: it is what the cold dial uses, so it must never include
        // another target's relay.
        let selection = BrowserEndpointPlan::resolve_target_relays(&[
            "https://relay-b.happier.test".to_string(),
        ])
        .expect("an explicit target relay resolves");
        assert_eq!(
            selection
                .relay_urls()
                .iter()
                .map(|url| url.to_string())
                .collect::<Vec<_>>(),
            vec!["https://relay-b.happier.test/"]
        );
    }

    #[test]
    fn dial_targets_are_validated_with_the_core_endpoint_id_grammar() {
        let valid = happier_iroh_core::EndpointSeed::from_bytes([4u8; 32])
            .endpoint_id()
            .to_string();
        assert!(BrowserEndpointPlan::validate_target(&valid).is_ok());
        assert!(BrowserEndpointPlan::validate_target("not-an-endpoint-id").is_err());
    }

    #[test]
    fn the_browser_speaks_the_one_home_tunnel_protocol_defined_by_the_core() {
        assert_eq!(
            happier_iroh_core::IrohAlpn::HomeTunnel.as_bytes(),
            happier_iroh_core::HOME_TUNNEL_ALPN
        );
        assert!(happier_iroh_core::validate_preamble(happier_iroh_core::TUNNEL_PREAMBLE).is_ok());
    }

    #[test]
    fn a_machine_stream_is_a_distinct_closed_kind_dialing_the_core_machine_alpn() {
        // The two browser stream kinds are the whole closed set: there is no
        // caller-supplied ALPN, and neither kind can be satisfied by the
        // other's protocol. Both ALPN values come from the core.
        assert_eq!(
            BrowserStreamKind::Home.alpn().as_bytes(),
            happier_iroh_core::HOME_TUNNEL_ALPN
        );
        assert_eq!(
            BrowserStreamKind::Machine.alpn().as_bytes(),
            happier_iroh_core::MACHINE_ALPN
        );
        assert_ne!(
            BrowserStreamKind::Home.alpn().as_bytes(),
            BrowserStreamKind::Machine.alpn().as_bytes()
        );
        assert_ne!(BrowserStreamKind::Home, BrowserStreamKind::Machine);
    }

    #[test]
    fn each_browser_stream_kind_uses_its_own_transport_cap_profile() {
        // A8 leaves exactly two transport-cap profiles. Home traffic keeps the
        // interactive one; a machine/1 stream is bulk, exactly as the native
        // machine tunnel requires of itself.
        assert_eq!(
            BrowserStreamKind::Home.cap_profile(),
            IrohCapProfile::HomeInteractive
        );
        assert_eq!(
            BrowserStreamKind::Machine.cap_profile(),
            IrohCapProfile::MachineBulk
        );
        assert!(BrowserStreamKind::Machine
            .cap_profile()
            .transport_config()
            .is_ok());
    }

    #[test]
    fn a_machine_stream_is_bounded_by_the_same_browser_operation_window() {
        // The machine kind reuses the one browser chunk bound; it is not a
        // second, larger structured-clone surface.
        assert!(validate_stream_read_size(BROWSER_STREAM_CHUNK_BYTES).is_ok());
        assert_eq!(
            validate_stream_write_size(BROWSER_STREAM_CHUNK_BYTES + 1).unwrap_err(),
            IrohError::ResourceLimit
        );
    }

    #[test]
    fn a_browser_never_reports_a_direct_path() {
        // Relay-only carrier: `relay` is the only positive claim it can make,
        // and anything the transport cannot decide stays `unknown`. `direct` is
        // unreachable rather than merely unlikely.
        assert_eq!(
            browser_observed_path(IrohObservedPath::Relay).as_str(),
            "relay"
        );
        assert_eq!(
            browser_observed_path(IrohObservedPath::Unknown).as_str(),
            "unknown"
        );
        assert_eq!(
            browser_observed_path(IrohObservedPath::Direct).as_str(),
            "unknown"
        );
    }

    #[test]
    fn incremental_stream_operations_are_bounded_below_the_carrier_window() {
        assert_eq!(BROWSER_STREAM_CHUNK_BYTES, 1024 * 1024);
        assert!(validate_stream_read_size(1).is_ok());
        assert!(validate_stream_read_size(BROWSER_STREAM_CHUNK_BYTES).is_ok());
        assert_eq!(
            validate_stream_read_size(0).unwrap_err(),
            IrohError::ResourceLimit
        );
        assert_eq!(
            validate_stream_read_size(BROWSER_STREAM_CHUNK_BYTES + 1).unwrap_err(),
            IrohError::ResourceLimit
        );
        assert!(validate_stream_write_size(0).is_ok());
        assert!(validate_stream_write_size(BROWSER_STREAM_CHUNK_BYTES).is_ok());
        assert_eq!(
            validate_stream_write_size(BROWSER_STREAM_CHUNK_BYTES + 1).unwrap_err(),
            IrohError::ResourceLimit
        );
    }
}
