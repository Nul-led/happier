use std::fs;
use std::io;
use std::path::Path;

use serde_json::{Map, Value};

#[cfg(unix)]
use std::os::unix::fs::PermissionsExt;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SidecarSnapshot {
    pub bytes: Vec<u8>,
    pub unix_mode: Option<u32>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SidecarUpdateAction {
    Noop,
    Copy,
    PermissionsOnly,
    CopyAndPermissions,
}

const IROH_RELEASE_EVIDENCE_RESOURCES: &[&str] = &[
    "../../../packages/iroh-native/release-evidence/THIRD-PARTY-NOTICES.txt",
    "../../../packages/iroh-native/release-evidence/sbom.cdx.json",
];

/// Builds the inline Tauri config used by source-only Cargo tests.
///
/// Tauri validates every configured bundle resource while compiling its build
/// script, even though `cargo test` never creates a bundle. The Iroh notice and
/// SBOM are deliberately produced by the release/native carrier build, so a
/// source test must remove those two entries instead of fabricating release
/// evidence. JSON `null` values are merge-patch deletions in `TAURI_CONFIG`.
/// Any unrelated caller-provided inline configuration is preserved.
pub fn tauri_config_without_iroh_release_evidence(
    existing: Option<&str>,
) -> Result<String, String> {
    let mut config = match existing.map(str::trim).filter(|value| !value.is_empty()) {
        Some(value) => serde_json::from_str::<Value>(value)
            .map_err(|error| format!("invalid TAURI_CONFIG: {error}"))?,
        None => Value::Object(Map::new()),
    };

    let Some(root) = config.as_object_mut() else {
        return Err("TAURI_CONFIG must be a JSON object".to_owned());
    };
    let bundle = root
        .entry("bundle")
        .or_insert_with(|| Value::Object(Map::new()));

    // A null bundle already removes the whole base bundle config. A non-object
    // value is invalid and should remain for Tauri to diagnose rather than
    // being silently rewritten here.
    let Some(bundle) = bundle.as_object_mut() else {
        return serde_json::to_string(&config).map_err(|error| error.to_string());
    };
    let resources = bundle
        .entry("resources")
        .or_insert_with(|| Value::Object(Map::new()));

    // Arrays replace the base resource map wholesale, and null removes it, so
    // both already exclude the base evidence entries. Only map patches need
    // explicit per-entry deletions.
    if let Some(resources) = resources.as_object_mut() {
        for path in IROH_RELEASE_EVIDENCE_RESOURCES {
            resources.insert((*path).to_owned(), Value::Null);
        }
    }

    serde_json::to_string(&config).map_err(|error| error.to_string())
}

impl SidecarSnapshot {
    #[allow(dead_code)]
    pub fn from_path(path: &Path) -> io::Result<Self> {
        let bytes = fs::read(path)?;
        Ok(Self {
            unix_mode: read_unix_mode(&fs::metadata(path)?),
            bytes,
        })
    }
}

pub fn resolve_sidecar_update_action(
    source: &SidecarSnapshot,
    destination: Option<&SidecarSnapshot>,
) -> SidecarUpdateAction {
    let Some(destination) = destination else {
        return if source.unix_mode.is_some() {
            SidecarUpdateAction::CopyAndPermissions
        } else {
            SidecarUpdateAction::Copy
        };
    };

    let content_differs = source.bytes != destination.bytes;
    let permissions_differs = source.unix_mode != destination.unix_mode;

    match (content_differs, permissions_differs) {
        (false, false) => SidecarUpdateAction::Noop,
        (true, false) => SidecarUpdateAction::Copy,
        (false, true) => SidecarUpdateAction::PermissionsOnly,
        (true, true) => SidecarUpdateAction::CopyAndPermissions,
    }
}

#[cfg(unix)]
#[allow(dead_code)]
fn read_unix_mode(metadata: &fs::Metadata) -> Option<u32> {
    Some(metadata.permissions().mode())
}

#[cfg(not(unix))]
#[allow(dead_code)]
fn read_unix_mode(_metadata: &fs::Metadata) -> Option<u32> {
    None
}
