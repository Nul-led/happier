#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum IrohObservedPath {
    Direct,
    Relay,
    Unknown,
}
impl IrohObservedPath {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Direct => "direct",
            Self::Relay => "relay",
            Self::Unknown => "unknown",
        }
    }
}
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct IrohPathSnapshot {
    pub observed_path: IrohObservedPath,
    pub is_relay: bool,
    pub remote_endpoint_id: String,
    pub at_ms: u64,
}
impl IrohPathSnapshot {
    pub fn new(
        observed_path: IrohObservedPath,
        remote_endpoint_id: impl Into<String>,
        at_ms: u64,
    ) -> Self {
        Self {
            is_relay: matches!(observed_path, IrohObservedPath::Relay),
            observed_path,
            remote_endpoint_id: remote_endpoint_id.into(),
            at_ms,
        }
    }
}

/// Normalizes an actually observed Iroh incoming address into honest path
/// telemetry. `direct` is only reported for an observed IP path, `relay` only
/// for an observed relay path, and `unknown` only where the Iroh API genuinely
/// cannot decide (custom transport). `IncomingAddr` is `#[non_exhaustive]`, so
/// unknown variants map safely to `unknown`; forced-direct/forced-relay states
/// are never manufactured here.
pub fn from_incoming_addr(addr: &iroh::endpoint::IncomingAddr) -> IrohObservedPath {
    match addr {
        iroh::endpoint::IncomingAddr::Ip(_) => IrohObservedPath::Direct,
        iroh::endpoint::IncomingAddr::Relay { .. } => IrohObservedPath::Relay,
        iroh::endpoint::IncomingAddr::Custom(_) => IrohObservedPath::Unknown,
        _ => IrohObservedPath::Unknown,
    }
}

/// Builds a path snapshot from the address observed on an incoming connection
/// (`Incoming::remote_addr`/`Accepting::remote_addr`, available before the
/// handshake completes). Acceptors record this at admission so telemetry never
/// depends on post-handshake path-watcher timing.
pub fn snapshot_for_incoming_addr(
    addr: &iroh::endpoint::IncomingAddr,
    remote_endpoint_id: impl Into<String>,
) -> IrohPathSnapshot {
    IrohPathSnapshot::new(
        from_incoming_addr(addr),
        remote_endpoint_id,
        crate::unix_ms(),
    )
}

/// Observes a live Iroh connection's currently selected network path. A
/// post-handshake `Connection` has no pre-handshake address accessor;
/// `Connection::paths()` is the genuine observation: the selected open path is
/// `direct` for an IP path and `relay` for a relay path. With no visible
/// selected path (including custom transports) the honest value is `unknown` —
/// never a manufactured direct/relay claim.
///
/// Separate from [`snapshot_for_connection`] because a caller that only reports
/// the path (the browser binding, which has no wall clock) must not have to
/// stamp a timestamp to obtain it. The observation rule itself has one owner.
pub fn observed_path_for_connection(connection: &iroh::endpoint::Connection) -> IrohObservedPath {
    connection
        .paths()
        .iter()
        .find(|path| path.is_selected())
        .map_or(IrohObservedPath::Unknown, |path| {
            if path.is_ip() {
                IrohObservedPath::Direct
            } else if path.is_relay() {
                IrohObservedPath::Relay
            } else {
                IrohObservedPath::Unknown
            }
        })
}

/// Builds a path snapshot from a live Iroh connection's observed path.
pub fn snapshot_for_connection(connection: &iroh::endpoint::Connection) -> IrohPathSnapshot {
    IrohPathSnapshot::new(
        observed_path_for_connection(connection),
        connection.remote_id().to_string(),
        crate::unix_ms(),
    )
}

pub fn normalize_path(value: &str) -> IrohObservedPath {
    match value {
        "direct" => IrohObservedPath::Direct,
        "relay" => IrohObservedPath::Relay,
        _ => IrohObservedPath::Unknown,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn incoming_addr_maps_to_honest_observed_paths() {
        let ip: std::net::SocketAddr = "203.0.113.7:443".parse().unwrap();
        let relay_url: iroh::RelayUrl = "https://relay.example.test".parse().unwrap();
        assert_eq!(
            from_incoming_addr(&iroh::endpoint::IncomingAddr::Ip(ip)),
            IrohObservedPath::Direct
        );
        assert_eq!(
            from_incoming_addr(&iroh::endpoint::IncomingAddr::Relay {
                url: relay_url,
                endpoint_id: iroh::SecretKey::from_bytes(&[7u8; 32]).public(),
            }),
            IrohObservedPath::Relay
        );
        assert_eq!(IrohObservedPath::Relay.as_str(), "relay");
        assert_eq!(IrohObservedPath::Unknown.as_str(), "unknown");
        assert_eq!(normalize_path("direct"), IrohObservedPath::Direct);
    }
}
