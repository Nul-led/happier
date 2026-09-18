/// The Runner shell reuses the canonical Happier icon set rather than carrying a
/// second copy of the brand assets. Icons are generated into an ignored folder so
/// only the desktop package owner in `apps/ui/src-tauri/icons` stays authoritative.
const CANONICAL_ICONS: &[&str] = &[
    "32x32.png",
    "128x128.png",
    "128x128@2x.png",
    "icon.png",
    "icon.icns",
];

fn main() {
    let source = std::path::Path::new("../../ui/src-tauri/icons");
    std::fs::create_dir_all("icons").expect("create generated icon directory");
    for name in CANONICAL_ICONS {
        let target = std::path::Path::new("icons").join(name);
        let origin = source.join(name);
        println!("cargo:rerun-if-changed={}", origin.display());
        if !target.exists() {
            std::fs::copy(&origin, &target)
                .unwrap_or_else(|error| panic!("copy canonical Happier icon {name}: {error}"));
        }
    }

    let target = std::env::var("TARGET").expect("Cargo TARGET is required");
    let sidecar = std::path::Path::new("binaries").join(format!("happier-runner-core-{target}"));
    println!("cargo:rerun-if-changed={}", sidecar.display());
    if !sidecar.exists() {
        if std::env::var("PROFILE").as_deref() == Ok("release") {
            panic!("release build requires the target-matched Bun Runner core sidecar");
        }
        std::fs::create_dir_all("binaries").expect("create debug sidecar directory");
        std::fs::write(&sidecar, b"debug-only Runner core placeholder\n")
            .expect("write debug sidecar placeholder");
    }
    tauri_build::build()
}
