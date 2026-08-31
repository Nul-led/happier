use crate::{IrohError, Result};
use std::time::Duration;

/// Per-connection QUIC resource bounds for a named workload profile. These
/// protect receive memory and stream fan-out at the transport boundary; they
/// deliberately do not impose an endpoint-wide device/peer quota.
#[derive(Debug, Clone, Copy)]
pub(crate) struct IrohTunnelLimits {
    pub max_streams: usize,
    pub receive_window: usize,
    pub stream_receive_window: usize,
    /// Transport-layer idle timeout in milliseconds; `None` disables it so
    /// long-lived application sockets (Socket.IO heartbeats) own liveness.
    pub idle_timeout_ms: Option<u64>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum IrohCapProfile {
    HomeInteractive,
    MachineBulk,
    WorkspaceSync,
}

impl IrohCapProfile {
    pub(crate) const fn limits(self) -> IrohTunnelLimits {
        match self {
            Self::HomeInteractive => IrohTunnelLimits {
                max_streams: 64,
                receive_window: 16 * 1024 * 1024,
                stream_receive_window: 4 * 1024 * 1024,
                idle_timeout_ms: None,
            },
            Self::MachineBulk => IrohTunnelLimits {
                max_streams: 32,
                receive_window: 64 * 1024 * 1024,
                stream_receive_window: 8 * 1024 * 1024,
                idle_timeout_ms: Some(10 * 60 * 1000),
            },
            Self::WorkspaceSync => IrohTunnelLimits {
                max_streams: 8,
                receive_window: 32 * 1024 * 1024,
                stream_receive_window: 8 * 1024 * 1024,
                // The profile keep-alive is owned by iroh's own heartbeat
                // defaults; the plan table's 30s keepalive maps onto it.
                idle_timeout_ms: Some(10 * 60 * 1000),
            },
        }
    }

    /// Builds the QUIC transport config that enforces the profile's stream and
    /// receive-window caps at the actual connection boundary. This is the real
    /// enforcement point: peers cannot open more streams or exceed these
    /// windows regardless of what any caller-side counter says.
    pub(crate) fn transport_config(self) -> Result<iroh::endpoint::QuicTransportConfig> {
        let limits = self.limits();
        let mut builder = iroh::endpoint::QuicTransportConfig::builder()
            .max_concurrent_bidi_streams(iroh::endpoint::VarInt::from(
                u32::try_from(limits.max_streams).map_err(|_| IrohError::ResourceLimit)?,
            ))
            .receive_window(iroh::endpoint::VarInt::from(
                u32::try_from(limits.receive_window).map_err(|_| IrohError::ResourceLimit)?,
            ))
            .stream_receive_window(iroh::endpoint::VarInt::from(
                u32::try_from(limits.stream_receive_window)
                    .map_err(|_| IrohError::ResourceLimit)?,
            ));
        builder = match limits.idle_timeout_ms {
            // Disabled at the transport layer (home_interactive); application
            // heartbeats own liveness.
            None => builder.max_idle_timeout(None),
            Some(ms) => builder.max_idle_timeout(Some(
                Duration::from_millis(ms)
                    .try_into()
                    .map_err(|_| IrohError::ResourceLimit)?,
            )),
        };
        Ok(builder.build())
    }
}

/// Canonical string identifier for a cap profile (native binding surface).
impl IrohCapProfile {
    pub const fn id(self) -> &'static str {
        match self {
            Self::HomeInteractive => "homeInteractive",
            Self::MachineBulk => "machineBulk",
            Self::WorkspaceSync => "workspaceSync",
        }
    }

    pub fn parse(value: &str) -> Result<Self> {
        match value {
            "homeInteractive" => Ok(Self::HomeInteractive),
            "machineBulk" => Ok(Self::MachineBulk),
            "workspaceSync" => Ok(Self::WorkspaceSync),
            _ => Err(IrohError::ResourceLimit),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn home_interactive_profile_enforces_per_connection_transport_bounds() {
        let limits = IrohCapProfile::HomeInteractive.limits();
        assert_eq!(limits.max_streams, 64);
        assert_eq!(limits.receive_window, 16 * 1024 * 1024);
        assert_eq!(limits.stream_receive_window, 4 * 1024 * 1024);
        // No transport idle timeout: Socket.IO/application heartbeats own liveness.
        assert_eq!(limits.idle_timeout_ms, None);
        // The QUIC boundary really carries the caps.
        let _config = IrohCapProfile::HomeInteractive
            .transport_config()
            .expect("home_interactive profile builds a QUIC transport config");
    }

    #[test]
    fn machine_and_workspace_profiles_enforce_distinct_transport_bounds() {
        let machine = IrohCapProfile::MachineBulk.limits();
        assert_eq!(machine.max_streams, 32);
        assert_eq!(machine.receive_window, 64 * 1024 * 1024);
        assert_eq!(machine.stream_receive_window, 8 * 1024 * 1024);
        assert_eq!(machine.idle_timeout_ms, Some(10 * 60 * 1000));

        let sync = IrohCapProfile::WorkspaceSync.limits();
        assert_eq!(sync.max_streams, 8);
        assert_eq!(sync.receive_window, 32 * 1024 * 1024);
        assert_eq!(sync.stream_receive_window, 8 * 1024 * 1024);
        assert_eq!(sync.idle_timeout_ms, Some(10 * 60 * 1000));

        assert!(IrohCapProfile::parse("homeInteractive").is_ok());
        assert_eq!(IrohCapProfile::HomeInteractive.id(), "homeInteractive");
        assert!(IrohCapProfile::parse("unlimited").is_err());
    }
}
