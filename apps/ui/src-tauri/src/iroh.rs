//! Desktop Home-transport lifecycle bridge for the Tauri host.
//!
//! Three invoke commands (`iroh_start_home_tunnel`, `iroh_stop_home_tunnel`,
//! `iroh_get_home_tunnel_status`)
//! compose the renderer's desktop lifecycle module onto the shared
//! `happier-iroh-native` JSON lifecycle (one process endpoint per persistent
//! identity, legacy start/stop lease API). Lifecycle/status only: no tunnel
//! payload byte ever crosses the invoke boundary. The endpoint identity is
//! host-owned — the key path is canonical beneath the Tauri app-data
//! directory and is never accepted from the renderer — and the process
//! endpoint is shut down best-effort on app exit while the persistent key
//! file is retained.

use serde::Deserialize;
use serde_json::{json, Value};
use tauri::{AppHandle, Manager};

/// Canonical persistent endpoint identity location beneath the app-data dir.
const ENDPOINT_KEY_DIRECTORY: &str = "iroh";
const ENDPOINT_KEY_FILE_NAME: &str = "endpoint.key";

/// Renderer-visible rejections carry the exact native error code so the shared
/// fallback classifier keeps owning fail-open versus fail-closed decisions.
const NATIVE_ERROR_PREFIX: &str = "iroh_native_error:";

fn native_error(code: &str, message: impl std::fmt::Display) -> String {
    format!("{NATIVE_ERROR_PREFIX}{code}:{message}")
}

fn default_relay_policy() -> String {
    "automatic".to_owned()
}

/// Descriptor-derived lease facts sent by the renderer. There is deliberately
/// no key-path/seed field: unknown renderer fields are ignored and this host
/// injects its canonical endpoint identity itself.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartHomeTunnelRequest {
    home_server_identity_id: String,
    endpoint_id: String,
    #[serde(default = "default_relay_policy")]
    policy: String,
    #[serde(default)]
    direct_addresses: Vec<String>,
    #[serde(default)]
    relay_urls: Vec<String>,
    #[serde(default)]
    descriptor_revision: Option<u64>,
}

/// Canonical persistent endpoint key path for this installation.
pub fn endpoint_key_path(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("desktop app data directory is unavailable: {error}"))?;
    Ok(app_data_dir
        .join(ENDPOINT_KEY_DIRECTORY)
        .join(ENDPOINT_KEY_FILE_NAME))
}

/// Serializes the native start request: descriptor-derived facts verbatim plus
/// the host-owned key path. The renderer cannot supply identity material.
fn serialized_start_request(request: &StartHomeTunnelRequest, endpoint_key_path: &str) -> String {
    json!({
        "homeServerIdentityId": request.home_server_identity_id,
        "endpointId": request.endpoint_id,
        "relayPolicy": request.policy,
        "directAddresses": request.direct_addresses,
        "relayUrls": request.relay_urls,
        "descriptorRevision": request.descriptor_revision,
        "endpointKeyPath": endpoint_key_path,
    })
    .to_string()
}

/// Unwraps the strict `{ok,result}|{ok,error}` native envelope, preserving the
/// exact native error code in the rejection.
fn envelope_result(envelope: &Value) -> Result<Value, String> {
    if envelope.get("ok") == Some(&Value::Bool(true)) {
        return Ok(envelope.get("result").cloned().unwrap_or(Value::Null));
    }
    let code = envelope
        .pointer("/error/code")
        .and_then(Value::as_str)
        .unwrap_or("transport-unavailable");
    let message = envelope
        .pointer("/error/message")
        .and_then(Value::as_str)
        .unwrap_or("Iroh native lifecycle call failed");
    Err(native_error(code, message))
}

fn response_string(value: &Value, field: &str) -> Result<String, String> {
    value
        .get(field)
        .and_then(Value::as_str)
        .filter(|field_value| !field_value.trim().is_empty())
        .map(str::to_owned)
        .ok_or_else(|| {
            native_error(
                "transport-unavailable",
                format!("malformed native lease field {field}"),
            )
        })
}

/// Projects the native start result onto the exact renderer lease facts.
/// Host-owned facts (the endpoint handle, which for a keyed endpoint is the
/// canonical key path) never cross the bridge.
fn renderer_lease(started: Value) -> Result<Value, String> {
    if response_string(&started, "carrier")?.as_str() != "iroh" {
        return Err(native_error(
            "transport-unavailable",
            "malformed native lease field carrier",
        ));
    }
    let observed_path = response_string(&started, "observedPath")?;
    if !matches!(observed_path.as_str(), "direct" | "relay" | "unknown") {
        return Err(native_error(
            "transport-unavailable",
            "malformed native lease field observedPath",
        ));
    }
    let started_at_ms = started
        .get("startedAtMs")
        .and_then(Value::as_u64)
        .ok_or_else(|| {
            native_error(
                "transport-unavailable",
                "malformed native lease field startedAtMs",
            )
        })?;
    let lease_id = response_string(&started, "leaseId")?;
    let home_server_identity_id = response_string(&started, "homeServerIdentityId")?;
    let home_endpoint_id = response_string(&started, "homeEndpointId")?;
    let runtime_origin = response_string(&started, "runtimeOrigin")?;
    let parsed_runtime_origin = url::Url::parse(&runtime_origin).map_err(|_| {
        native_error(
            "transport-unavailable",
            "malformed native lease field runtimeOrigin",
        )
    })?;
    let is_loopback = matches!(
        parsed_runtime_origin.host_str(),
        Some("127.0.0.1") | Some("::1")
    );
    if parsed_runtime_origin.scheme() != "http"
        || !is_loopback
        || parsed_runtime_origin.port().is_none()
        || !parsed_runtime_origin.username().is_empty()
        || parsed_runtime_origin.password().is_some()
        || parsed_runtime_origin.path() != "/"
        || parsed_runtime_origin.query().is_some()
        || parsed_runtime_origin.fragment().is_some()
    {
        return Err(native_error(
            "transport-unavailable",
            "malformed native lease field runtimeOrigin",
        ));
    }
    let runtime_origin = parsed_runtime_origin.origin().ascii_serialization();
    Ok(json!({
        "leaseId": lease_id,
        "homeServerIdentityId": home_server_identity_id,
        "homeEndpointId": home_endpoint_id,
        "runtimeOrigin": runtime_origin,
        "carrier": "iroh",
        "observedPath": observed_path,
        "startedAtMs": started_at_ms,
    }))
}

fn renderer_status(status: Value) -> Result<Value, String> {
    if status.is_null() {
        return Ok(Value::Null);
    }
    let connection_active = status
        .get("connectionActive")
        .and_then(Value::as_bool)
        .ok_or_else(|| native_error("transport-unavailable", "malformed native tunnel status"))?;
    let observed_path = response_string(&status, "observedPath")?;
    if !matches!(observed_path.as_str(), "direct" | "relay" | "unknown") {
        return Err(native_error(
            "transport-unavailable",
            "malformed native tunnel status",
        ));
    }
    Ok(json!({
        "active": connection_active,
        "connectionActive": connection_active,
        "observedPath": observed_path,
    }))
}

/// Starts (or retains) the Home tunnel lease for the descriptor-derived facts.
/// The one process endpoint is created/reused by the native lifecycle from the
/// host-owned persistent key path, so endpoint identity survives lease
/// acquire/release cycles and app restarts.
#[tauri::command]
pub async fn iroh_start_home_tunnel(
    app: AppHandle,
    request: StartHomeTunnelRequest,
) -> Result<Value, String> {
    let key_path = endpoint_key_path(&app)?;
    let payload = serialized_start_request(&request, &key_path.to_string_lossy());
    // The native lifecycle block_on's its own process runtime; keep that off
    // the async-runtime workers like every other blocking host seam.
    let envelope = tauri::async_runtime::spawn_blocking(move || {
        happier_iroh_native::start_home_tunnel_json(&payload)
    })
    .await
    .map_err(|error| {
        native_error(
            "transport-unavailable",
            format!("iroh native lifecycle call failed: {error}"),
        )
    })?;
    renderer_lease(envelope_result(&envelope)?)
}

/// Releases one Home tunnel lease by id. Lease-scoped and idempotent: the
/// process endpoint and its persistent identity stay.
#[tauri::command]
pub async fn iroh_stop_home_tunnel(lease_id: String) -> Result<Value, String> {
    let envelope = tauri::async_runtime::spawn_blocking(move || {
        happier_iroh_native::stop_home_tunnel_json(&lease_id)
    })
    .await
    .map_err(|error| {
        native_error(
            "transport-unavailable",
            format!("iroh native lifecycle call failed: {error}"),
        )
    })?;
    envelope_result(&envelope)?;
    Ok(Value::Null)
}

/// Polls the native transport owner for one Home tunnel. The renderer receives
/// only active/path facts; endpoint handles, key paths, Home auth, and payloads
/// never cross this bridge.
#[tauri::command]
pub async fn iroh_get_home_tunnel_status(
    lease_id: String,
) -> Result<Value, String> {
    let envelope = tauri::async_runtime::spawn_blocking(move || {
        happier_iroh_native::get_tunnel_status_json(
            &json!({ "tunnelId": lease_id }).to_string(),
        )
    })
    .await
    .map_err(|error| {
        native_error(
            "transport-unavailable",
            format!("iroh native lifecycle call failed: {error}"),
        )
    })?;
    renderer_status(envelope_result(&envelope)?)
}

/// Best-effort process-exit teardown: stops the shared endpoint (with its
/// acceptors and leases) while the persistent key file is retained. Identity
/// is never rotated or deleted.
pub fn shutdown_process_endpoint(app: &AppHandle) {
    let Ok(key_path) = endpoint_key_path(app) else {
        return;
    };
    // The keyed endpoint handle is its canonical key path; a failed or late
    // teardown is ignored at process exit and the OS reclaims the sockets.
    let _ = happier_iroh_native::shutdown_endpoint_json(
        &json!({ "endpointHandle": key_path.to_string_lossy() }).to_string(),
    );
}

#[cfg(test)]
mod tests {
    use super::*;

    const ENDPOINT_ID: &str = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

    #[test]
    fn status_projection_exposes_transport_facts_only() {
        assert_eq!(
            renderer_status(json!({
                "connectionActive": false,
                "observedPath": "relay",
                "endpointHandle": "/private/iroh/endpoint.key",
                "homeServerIdentityId": "srv_home_a",
            }))
            .unwrap(),
            json!({"active": false, "connectionActive": false, "observedPath": "relay"})
        );
    }

    #[test]
    fn start_request_injects_the_host_owned_key_path_and_ignores_renderer_identity_fields() {
        // A renderer that ignores the contract and sends key/seed material
        // cannot have it forwarded: the typed request struct has no such
        // fields, and the host path is always the injected one.
        let request: StartHomeTunnelRequest = serde_json::from_str(
            r#"{"homeServerIdentityId":"srv_home_a","endpointId":"0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef","policy":"disabled","endpointKeyPath":"/tmp/renderer.key","endpointSeedBase64":"AAAA"}"#,
        )
        .expect("renderer request parses with host-identity fields ignored");
        let payload: Value = serde_json::from_str(&serialized_start_request(
            &request,
            "/app-data/iroh/endpoint.key",
        ))
        .expect("payload is valid JSON");
        assert_eq!(payload["endpointKeyPath"], "/app-data/iroh/endpoint.key");
        assert!(payload.get("endpointSeedBase64").is_none());
        assert_eq!(payload["homeServerIdentityId"], "srv_home_a");
        assert_eq!(payload["endpointId"], ENDPOINT_ID);
        assert_eq!(payload["relayPolicy"], "disabled");
    }

    #[test]
    fn native_start_envelope_maps_to_the_exact_renderer_lease_without_host_owned_facts() {
        let started = json!({
            "ok": true,
            "result": {
                "leaseId": "iroh-7",
                "homeServerIdentityId": "srv_home_a",
                "homeEndpointId": ENDPOINT_ID,
                "runtimeOrigin": "http://127.0.0.1:46001",
                "carrier": "iroh",
                "observedPath": "direct",
                "startedAtMs": 42u64,
                "descriptorRevision": 4u64,
                "endpointHandle": "/app-data/iroh/endpoint.key",
            }
        });
        let lease = renderer_lease(envelope_result(&started).expect("ok envelope")).expect("lease");
        assert_eq!(lease["leaseId"], "iroh-7");
        assert_eq!(lease["homeServerIdentityId"], "srv_home_a");
        assert_eq!(lease["homeEndpointId"], ENDPOINT_ID);
        assert_eq!(lease["runtimeOrigin"], "http://127.0.0.1:46001");
        assert_eq!(lease["carrier"], "iroh");
        assert_eq!(lease["observedPath"], "direct");
        assert_eq!(lease["startedAtMs"], 42);
        // Host-owned identity facts never cross the bridge.
        assert!(lease.get("endpointHandle").is_none());
        assert!(lease.get("endpointKeyPath").is_none());
        assert!(lease.get("descriptorRevision").is_none());
    }

    #[test]
    fn malformed_native_start_envelopes_fail_closed_without_a_lease() {
        let missing_fields = json!({ "ok": true, "result": { "leaseId": "iroh-7" } });
        assert!(renderer_lease(missing_fields).is_err());

        let wrong_carrier = json!({
            "ok": true,
            "result": {
                "leaseId": "l", "homeServerIdentityId": "h", "homeEndpointId": "e",
                "runtimeOrigin": "http://127.0.0.1:1", "carrier": "https",
                "observedPath": "direct", "startedAtMs": 1u64,
            }
        });
        assert!(renderer_lease(wrong_carrier).is_err());

        let no_result = json!({ "ok": true });
        assert!(renderer_lease(no_result).is_err());

        let external_origin = json!({
            "leaseId": "l", "homeServerIdentityId": "h", "homeEndpointId": "e",
            "runtimeOrigin": "https://attacker.example.test", "carrier": "iroh",
            "observedPath": "direct", "startedAtMs": 1u64,
        });
        assert!(renderer_lease(external_origin).is_err());
    }

    #[test]
    fn native_failure_envelopes_reject_with_the_exact_code_preserved() {
        let failed = json!({
            "ok": false,
            "error": { "code": "endpoint_key_unavailable", "message": "explicit re-pair is required" }
        });
        assert_eq!(
            envelope_result(&failed).unwrap_err(),
            "iroh_native_error:endpoint_key_unavailable:explicit re-pair is required"
        );
        let malformed = json!({ "ok": false });
        assert_eq!(
            envelope_result(&malformed).unwrap_err(),
            "iroh_native_error:transport-unavailable:Iroh native lifecycle call failed"
        );
    }

    #[test]
    fn stop_envelope_resolves_null_and_stays_idempotent() {
        let ok = json!({ "ok": true, "result": null });
        assert_eq!(envelope_result(&ok).expect("ok stop"), Value::Null);
    }
}
