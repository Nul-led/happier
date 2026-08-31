//! Node/Bun lifecycle-only NAPI binding over the existing
//! `happier-iroh-native` public JSON C ABI.
//!
//! This crate owns no Iroh state and no lifecycle logic. Every operation
//! forwards one C string to the exact `happier_iroh_native_*_json` export and
//! frees the returned string with the existing `happier_iroh_native_free_string`.
//! The `happier-iroh-native` rlib is linked into this cdylib, so its exported
//! symbols — and the one `OnceLock` tokio runtime, `NativeRuntime`,
//! `EndpointManager`, acceptor set, and tunnel-lease map behind them — remain
//! the single process owner this binding shares with every other host surface.
//!
//! Status/metadata only: requests and responses are JSON strings; no tunnel
//! payload bytes cross this boundary, and there is no generic dispatch (one
//! typed export per C ABI operation). Request/response JSON validation and
//! typing live in the TypeScript module (`src/nodeNative.ts`).
//!
//! Operations run on the libuv worker pool via `napi::Task` because the C ABI
//! is synchronous by contract (it enters the shared tokio runtime
//! internally); the JS thread is never blocked, and the addon adds no second
//! runtime.

use std::ffi::{CStr, CString};
use std::os::raw::c_char;

use happier_iroh_native::{
    happier_iroh_native_create_endpoint_json, happier_iroh_native_ensure_home_tunnel_json,
    happier_iroh_native_free_string, happier_iroh_native_get_endpoint_status_json,
    happier_iroh_native_get_home_tunnel_status_json,
    happier_iroh_native_get_machine_acceptor_status_json,
    happier_iroh_native_get_machine_tunnel_status_json, happier_iroh_native_get_tunnel_status_json,
    happier_iroh_native_release_home_tunnel_json, happier_iroh_native_shutdown_endpoint_json,
    happier_iroh_native_start_home_acceptor_json, happier_iroh_native_start_home_tunnel_json,
    happier_iroh_native_start_machine_acceptor_json, happier_iroh_native_start_machine_tunnel_json,
    happier_iroh_native_stop_home_acceptor_json, happier_iroh_native_stop_home_tunnel_json,
    happier_iroh_native_stop_machine_acceptor_json, happier_iroh_native_stop_machine_tunnel_json,
};
#[cfg(feature = "test-relay-fixture")]
use happier_iroh_native::{
    happier_iroh_native_test_force_direct_only_json,
    happier_iroh_native_test_force_relay_only_json, happier_iroh_native_test_observed_path,
    happier_iroh_native_test_relay_url, happier_iroh_native_test_restore_automatic_json,
};
use napi::bindgen_prelude::AsyncTask;
use napi::{Env, Error, Result, Task};
use napi_derive::napi;

/// One synchronous C ABI call executed on the libuv worker pool. The C ABI
/// owns the process tokio runtime internally; this task adds none.
#[doc(hidden)]
pub struct JsonOpTask {
    operation: extern "C" fn(*const c_char) -> *mut c_char,
    request: CString,
}

impl Task for JsonOpTask {
    type Output = String;
    type JsValue = String;

    fn compute(&mut self) -> Result<Self::Output> {
        let response = (self.operation)(self.request.as_ptr());
        if response.is_null() {
            return Err(Error::from_reason(
                "happier-iroh-native returned no response for a lifecycle operation",
            ));
        }
        // SAFETY: the C ABI contract returns a NUL-terminated UTF-8 JSON
        // string owned by the caller until `happier_iroh_native_free_string`.
        let raw = unsafe { CStr::from_ptr(response) }
            .to_string_lossy()
            .into_owned();
        happier_iroh_native_free_string(response);
        Ok(raw)
    }

    fn resolve(&mut self, _env: Env, output: Self::Output) -> Result<Self::JsValue> {
        Ok(output)
    }
}

fn json_op(
    operation: extern "C" fn(*const c_char) -> *mut c_char,
    request: String,
) -> Result<AsyncTask<JsonOpTask>> {
    let request = CString::new(request)
        .map_err(|_| Error::from_reason("Iroh lifecycle request must not contain NUL bytes"))?;
    Ok(AsyncTask::new(JsonOpTask { operation, request }))
}

/// Availability/status metadata for the loaded addon. Synchronous by contract
/// (`NativeIrohModule.getAvailability`); performs no Iroh work.
#[napi(object)]
pub struct IrohNodeAvailability {
    /// Always `true`: the addon only exists when it loaded successfully.
    pub available: bool,
    /// Compile-time target OS of this artifact (for example `macos`).
    pub os: String,
    /// Compile-time target architecture of this artifact.
    pub arch: String,
    /// Engine crate that owns the Iroh runtime behind this binding.
    pub engine: String,
    /// Exact exported lifecycle operation names (the no-payload surface).
    pub surface: Vec<String>,
}

#[napi]
pub fn get_availability() -> IrohNodeAvailability {
    IrohNodeAvailability {
        available: true,
        os: std::env::consts::OS.to_owned(),
        arch: std::env::consts::ARCH.to_owned(),
        engine: "happier-iroh-native".to_owned(),
        surface: [
            "getAvailability",
            "startHomeTunnel",
            "stopHomeTunnel",
            "getHomeTunnelStatus",
            "createEndpoint",
            "startHomeAcceptor",
            "stopHomeAcceptor",
            "ensureHomeTunnel",
            "releaseHomeTunnel",
            "shutdownEndpoint",
            "getEndpointStatus",
            "getTunnelStatus",
            "startMachineAcceptor",
            "stopMachineAcceptor",
            "getMachineAcceptorStatus",
            "startMachineTunnel",
            "stopMachineTunnel",
            "getMachineTunnelStatus",
        ]
        .iter()
        .map(|name| (*name).to_owned())
        .collect(),
    }
}

// These exports exist only in a deliberately feature-built test addon. The
// ordinary/release crate graph cannot name them, so product runtime config
// cannot reach the topology override or its insecure local-relay TLS trust.
#[cfg(feature = "test-relay-fixture")]
#[napi]
pub fn force_direct_only() -> Result<AsyncTask<JsonOpTask>> {
    json_op(
        happier_iroh_native_test_force_direct_only_json,
        "{}".to_owned(),
    )
}

#[cfg(feature = "test-relay-fixture")]
#[napi]
pub fn force_relay_only() -> Result<AsyncTask<JsonOpTask>> {
    json_op(
        happier_iroh_native_test_force_relay_only_json,
        "{}".to_owned(),
    )
}

#[cfg(feature = "test-relay-fixture")]
#[napi]
pub fn restore_automatic() -> Result<AsyncTask<JsonOpTask>> {
    json_op(
        happier_iroh_native_test_restore_automatic_json,
        "{}".to_owned(),
    )
}

#[cfg(feature = "test-relay-fixture")]
#[napi]
pub fn get_observed_path() -> String {
    happier_iroh_native_test_observed_path().to_owned()
}

#[cfg(feature = "test-relay-fixture")]
#[napi]
pub fn get_test_relay_url() -> Option<String> {
    happier_iroh_native_test_relay_url()
}

// Handle-based lifecycle ops (Lane 06 plan §7.4): one export per C ABI
// operation, JSON request string in, JSON envelope string out. TypeScript
// owns envelope validation and the typed results.

/// Create or reuse the shared process endpoint. Wraps
/// `happier_iroh_native_create_endpoint_json`.
#[napi]
pub fn create_endpoint(request: String) -> Result<AsyncTask<JsonOpTask>> {
    json_op(happier_iroh_native_create_endpoint_json, request)
}

/// Start (or reuse) the fixed-loopback Home acceptor on an endpoint. Wraps
/// `happier_iroh_native_start_home_acceptor_json`.
#[napi]
pub fn start_home_acceptor(request: String) -> Result<AsyncTask<JsonOpTask>> {
    json_op(happier_iroh_native_start_home_acceptor_json, request)
}

/// Stop the endpoint's Home acceptor. Wraps
/// `happier_iroh_native_stop_home_acceptor_json`.
#[napi]
pub fn stop_home_acceptor(request: String) -> Result<AsyncTask<JsonOpTask>> {
    json_op(happier_iroh_native_stop_home_acceptor_json, request)
}

/// Ensure one Home tunnel lease on an endpoint. Wraps
/// `happier_iroh_native_ensure_home_tunnel_json`.
#[napi]
pub fn ensure_home_tunnel(request: String) -> Result<AsyncTask<JsonOpTask>> {
    json_op(happier_iroh_native_ensure_home_tunnel_json, request)
}

/// Release one tunnel lease; sibling leases and the shared endpoint stay up.
/// Wraps `happier_iroh_native_release_home_tunnel_json`.
#[napi]
pub fn release_home_tunnel(request: String) -> Result<AsyncTask<JsonOpTask>> {
    json_op(happier_iroh_native_release_home_tunnel_json, request)
}

/// Shut down an endpoint together with its acceptor and bound leases. Wraps
/// `happier_iroh_native_shutdown_endpoint_json`.
#[napi]
pub fn shutdown_endpoint(request: String) -> Result<AsyncTask<JsonOpTask>> {
    json_op(happier_iroh_native_shutdown_endpoint_json, request)
}

/// Endpoint status/metadata. Wraps
/// `happier_iroh_native_get_endpoint_status_json`.
#[napi]
pub fn get_endpoint_status(request: String) -> Result<AsyncTask<JsonOpTask>> {
    json_op(happier_iroh_native_get_endpoint_status_json, request)
}

/// Tunnel lease status/metadata. Wraps
/// `happier_iroh_native_get_tunnel_status_json`.
#[napi]
pub fn get_tunnel_status(request: String) -> Result<AsyncTask<JsonOpTask>> {
    json_op(happier_iroh_native_get_tunnel_status_json, request)
}

#[napi]
pub fn start_machine_acceptor(request: String) -> Result<AsyncTask<JsonOpTask>> {
    json_op(happier_iroh_native_start_machine_acceptor_json, request)
}
#[napi]
pub fn stop_machine_acceptor(request: String) -> Result<AsyncTask<JsonOpTask>> {
    json_op(happier_iroh_native_stop_machine_acceptor_json, request)
}
#[napi]
pub fn get_machine_acceptor_status(request: String) -> Result<AsyncTask<JsonOpTask>> {
    json_op(
        happier_iroh_native_get_machine_acceptor_status_json,
        request,
    )
}
#[napi]
pub fn start_machine_tunnel(request: String) -> Result<AsyncTask<JsonOpTask>> {
    json_op(happier_iroh_native_start_machine_tunnel_json, request)
}
#[napi]
pub fn stop_machine_tunnel(request: String) -> Result<AsyncTask<JsonOpTask>> {
    json_op(happier_iroh_native_stop_machine_tunnel_json, request)
}
#[napi]
pub fn get_machine_tunnel_status(request: String) -> Result<AsyncTask<JsonOpTask>> {
    json_op(happier_iroh_native_get_machine_tunnel_status_json, request)
}

// Legacy mobile trio: thin exact wrappers over the same C ABI owner, exposed
// so the Node module satisfies the shared `NativeIrohModule` surface. No
// competing owner: start/stop/status run the identical C ABI operations.

/// Wraps `happier_iroh_native_start_home_tunnel_json`.
#[napi]
pub fn start_home_tunnel(request: String) -> Result<AsyncTask<JsonOpTask>> {
    json_op(happier_iroh_native_start_home_tunnel_json, request)
}

/// Wraps `happier_iroh_native_stop_home_tunnel_json` (takes the raw lease id).
#[napi]
pub fn stop_home_tunnel(lease_id: String) -> Result<AsyncTask<JsonOpTask>> {
    json_op(happier_iroh_native_stop_home_tunnel_json, lease_id)
}

/// Wraps `happier_iroh_native_get_home_tunnel_status_json` (takes the raw
/// Home server identity).
#[napi]
pub fn get_home_tunnel_status(home_server_identity_id: String) -> Result<AsyncTask<JsonOpTask>> {
    json_op(
        happier_iroh_native_get_home_tunnel_status_json,
        home_server_identity_id,
    )
}
