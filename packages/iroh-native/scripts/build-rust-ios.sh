#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CRATE_DIR="${ROOT_DIR}/rust/happier-iroh-native"
CARGO_TARGET_DIR="${ROOT_DIR}/rust/target"
OUT_DIR="${ROOT_DIR}/ios/vendor/happier-iroh-native"
XCFRAMEWORK="${OUT_DIR}/HappierIrohNativeRust.xcframework"
HEADERS_DIR="${OUT_DIR}/include"
mkdir -p "${HEADERS_DIR}"
cat > "${HEADERS_DIR}/happier_iroh_native.h" <<'HEADER'
#pragma once
char *happier_iroh_native_create_endpoint_json(const char *request_json);
char *happier_iroh_native_start_home_acceptor_json(const char *request_json);
char *happier_iroh_native_stop_home_acceptor_json(const char *request_json);
char *happier_iroh_native_ensure_home_tunnel_json(const char *request_json);
char *happier_iroh_native_release_home_tunnel_json(const char *request_json);
char *happier_iroh_native_shutdown_endpoint_json(const char *request_json);
char *happier_iroh_native_get_endpoint_status_json(const char *request_json);
char *happier_iroh_native_get_tunnel_status_json(const char *request_json);
char *happier_iroh_native_start_machine_acceptor_json(const char *request_json);
char *happier_iroh_native_stop_machine_acceptor_json(const char *request_json);
char *happier_iroh_native_get_machine_acceptor_status_json(const char *request_json);
char *happier_iroh_native_start_machine_tunnel_json(const char *request_json);
char *happier_iroh_native_stop_machine_tunnel_json(const char *request_json);
char *happier_iroh_native_get_machine_tunnel_status_json(const char *request_json);
void happier_iroh_native_free_string(char *value);
HEADER
CARGO_TARGET_DIR="${CARGO_TARGET_DIR}" cargo build --locked --manifest-path "${CRATE_DIR}/Cargo.toml" --release --target aarch64-apple-ios
CARGO_TARGET_DIR="${CARGO_TARGET_DIR}" cargo build --locked --manifest-path "${CRATE_DIR}/Cargo.toml" --release --target aarch64-apple-ios-sim
CARGO_TARGET_DIR="${CARGO_TARGET_DIR}" cargo build --locked --manifest-path "${CRATE_DIR}/Cargo.toml" --release --target x86_64-apple-ios
SIM_DIR="${OUT_DIR}/sim-universal"
SIM_UNIVERSAL="${SIM_DIR}/libhappier_iroh_native.a"
mkdir -p "${SIM_DIR}"
lipo -create "${CARGO_TARGET_DIR}/aarch64-apple-ios-sim/release/libhappier_iroh_native.a" "${CARGO_TARGET_DIR}/x86_64-apple-ios/release/libhappier_iroh_native.a" -output "${SIM_UNIVERSAL}"
rm -rf "${XCFRAMEWORK}"
xcodebuild -create-xcframework \
  -library "${CARGO_TARGET_DIR}/aarch64-apple-ios/release/libhappier_iroh_native.a" -headers "${HEADERS_DIR}" \
  -library "${SIM_UNIVERSAL}" -headers "${HEADERS_DIR}" -output "${XCFRAMEWORK}"
