//! Transport primitives shared by native Iroh bindings: the Iroh endpoint
//! boundary (explicit relay ownership, cap profiles, one shared process
//! endpoint per identity, and the endpoint's single incoming accept/ALPN
//! dispatcher with one exclusive consumer slot per known ALPN), the Home
//! tunnel acceptor/dialer over the `happier/home-tunnel/1` ALPN, endpoint key
//! storage, path telemetry, and the native byte pump used by Home and machine
//! tunnels.

mod endpoint;
mod errors;
mod home_tunnel;
mod limits;
mod machine;
mod path;
mod preamble;
mod stream;

#[cfg(test)]
mod home_tunnel_tests;
#[cfg(test)]
mod machine_tests;
#[cfg(test)]
mod preamble_tests;

pub use endpoint::{
    validate_endpoint_id, validate_loopback_bind_addr, validate_loopback_target,
    AcceptedIrohConnection, ConsumerRegistration, EndpointConfig, EndpointIdentity,
    EndpointKeyStore, EndpointManager, EndpointSeed, IrohConsumerSender, IrohEndpoint, RelayPolicy,
    RelaySelection, ResolvedEndpointConfig, MAX_RELAY_URLS, MAX_RELAY_URL_UTF8_BYTES,
};
pub use errors::{IrohError, IrohFailureReason, Result};
pub use home_tunnel::{
    HomeAcceptor, HomeAcceptorConfig, HomeAcceptorStatus, HomeTunnel, HomeTunnelConfig,
    HomeTunnelStatus, PREAMBLE_READ_TIMEOUT,
};
pub use limits::IrohCapProfile;
pub use machine::{
    MachineAcceptor, MachineAcceptorConfig, MachineAcceptorStatus, MachineFailureCode,
    MachineHttpTunnel, MachineTunnel, MachineTunnelConfig, MachineTunnelStatus,
    IROH_MACHINE_APPLICATION_CAPABILITY_HEADER, IROH_MACHINE_APPLICATION_PORT_HEADER,
    IROH_MACHINE_HTTP_LOCAL_CAPABILITY_HEADER,
    MACHINE_ADMISSION_PATH, MACHINE_CONTROL_TIMEOUT, MACHINE_REMOTE_ENDPOINT_HEADER,
    MACHINE_STREAM_ACCEPT_BYTE, MACHINE_STREAM_REJECT_BYTE, MAX_MACHINE_HANDSHAKE_BYTES,
};
pub use path::{
    from_incoming_addr, normalize_path, snapshot_for_connection, snapshot_for_incoming_addr,
    IrohObservedPath, IrohPathSnapshot,
};
pub use preamble::{read_preamble, write_preamble};

pub const HOME_TUNNEL_ALPN: &[u8] = b"happier/home-tunnel/1";
pub const MACHINE_ALPN: &[u8] = b"happier/machine/1";
pub const TUNNEL_PREAMBLE: u8 = 0x01;

/// The only ALPNs understood by this release. Unknown values are never silently
/// treated as a compatible protocol.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum IrohAlpn {
    HomeTunnel,
    Machine,
}

impl IrohAlpn {
    pub const fn as_bytes(self) -> &'static [u8] {
        match self {
            Self::HomeTunnel => HOME_TUNNEL_ALPN,
            Self::Machine => MACHINE_ALPN,
        }
    }

    pub fn parse(alpn: &[u8]) -> Result<Self> {
        match alpn {
            HOME_TUNNEL_ALPN => Ok(Self::HomeTunnel),
            MACHINE_ALPN => Ok(Self::Machine),
            _ => Err(IrohError::UnsupportedAlpn),
        }
    }
}

pub fn validate_preamble(byte: u8) -> Result<()> {
    (byte == TUNNEL_PREAMBLE)
        .then_some(())
        .ok_or(IrohError::InvalidPreamble)
}

/// Monotonic-wall-clock milliseconds for status/telemetry timestamps only.
pub fn unix_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|value| value.as_millis() as u64)
        .unwrap_or(0)
}

pub fn validate_alpn(alpn: &[u8]) -> Result<()> {
    IrohAlpn::parse(alpn).map(|_| ())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_only_locked_protocols_and_preamble() {
        assert!(validate_preamble(0x01).is_ok());
        assert_eq!(IrohAlpn::parse(HOME_TUNNEL_ALPN), Ok(IrohAlpn::HomeTunnel));
        assert_eq!(IrohAlpn::parse(MACHINE_ALPN), Ok(IrohAlpn::Machine));
        assert!(validate_alpn(HOME_TUNNEL_ALPN).is_ok());
        assert!(validate_alpn(MACHINE_ALPN).is_ok());
    }

    #[test]
    fn rejects_unknown_protocols_and_preamble() {
        assert_eq!(validate_preamble(0x00), Err(IrohError::InvalidPreamble));
        assert_eq!(
            validate_alpn(b"happier/peer-duplex/1"),
            Err(IrohError::UnsupportedAlpn)
        );
        assert_eq!(
            IrohAlpn::parse(b"happier/home-tunnel/2"),
            Err(IrohError::UnsupportedAlpn)
        );
        assert_eq!(
            IrohAlpn::parse(b"happier/home-tunnel/0"),
            Err(IrohError::UnsupportedAlpn)
        );
    }
}
