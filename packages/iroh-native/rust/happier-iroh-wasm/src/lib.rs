//! Browser binding for the shared Happier Iroh core (Lane 06 amendment A7,
//! including the production A7.3 incremental stream boundary).
//!
//! A browser cannot bind a local TCP listener or accept an Iroh connection, so
//! this crate exposes a dialer-only `wasm-bindgen` endpoint and incremental
//! stream boundary. Every transport rule
//! it needs — endpoint identity, explicit relay selection and validation, cap
//! profiles, the `happier/home-tunnel/1` ALPN, the tunnel preamble, and the
//! outgoing endpoint-identity guard — is owned by `happier-iroh-core` and
//! consumed here. This crate deliberately contains no relay grammar, no ALPN
//! literal, no endpoint builder, and no ambient Number-0 discovery.

mod config;

pub use config::{
    browser_observed_path, BrowserEndpointPlan, BrowserStreamKind, BROWSER_CAP_PROFILE,
    BROWSER_STREAM_CHUNK_BYTES,
};

#[cfg(target_arch = "wasm32")]
mod browser;
