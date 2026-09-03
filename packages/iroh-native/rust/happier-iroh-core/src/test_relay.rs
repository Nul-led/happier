//! The single local test-relay owner, compiled only under the test-only
//! `test-relay-fixture` cargo feature.
//!
//! It runs the pinned stock `iroh-relay` server with TLS disabled, so the relay
//! is reachable at a plain `http://` URL. That matters for two reasons:
//!
//! * ordinary endpoints trust it with normal CA verification — no fixture-only
//!   TLS bypass exists anywhere in the tree; and
//! * a browser can consume it, because iroh's browser relay client maps an
//!   `http` relay scheme onto `ws://`. A self-signed HTTPS relay cannot be
//!   consumed by Chromium at all.
//!
//! Every forced-relay fixture — the Rust tunnel tests and the native
//! test-controller SPI — uses this one owner. There is no second relay fixture.

use crate::{IrohError, Result};
use std::net::Ipv4Addr;
use std::str::FromStr;

/// A running loopback relay. The relay stops when this value is dropped, so the
/// owner must keep it alive for the fixture's lifetime.
pub struct LocalTestRelay {
    url: iroh::RelayUrl,
    _server: iroh_relay::server::Server,
}

impl LocalTestRelay {
    /// Spawns the relay on an ephemeral loopback port with TLS disabled and
    /// the stock `AllowAll` access control (`RelayConfig::new` defaults).
    pub async fn spawn() -> Result<Self> {
        let relay = iroh_relay::server::RelayConfig::new((Ipv4Addr::LOCALHOST, 0));
        debug_assert!(
            relay.tls.is_none(),
            "the fixture relay must serve plain HTTP"
        );
        let mut config = iroh_relay::server::ServerConfig::default();
        config.relay = Some(relay);
        config.quic = None;
        let server = iroh_relay::server::Server::spawn(config)
            .await
            .map_err(|_| IrohError::TransportClosed)?;
        let addr = server.http_addr().ok_or(IrohError::TransportClosed)?;
        let url = iroh::RelayUrl::from_str(&format!("http://{addr}"))
            .map_err(|_| IrohError::InvalidDescriptor)?;
        Ok(Self {
            url,
            _server: server,
        })
    }

    pub fn url(&self) -> &iroh::RelayUrl {
        &self.url
    }

    pub fn url_string(&self) -> String {
        self.url.to_string()
    }
}
