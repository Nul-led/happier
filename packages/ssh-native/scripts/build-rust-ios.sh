#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CRATE_DIR="${ROOT_DIR}/rust/happier-ssh-native"
OUT_DIR="${ROOT_DIR}/ios/vendor/happier-ssh-native"
XCFRAMEWORK="${OUT_DIR}/HappierSshNativeRust.xcframework"
HEADERS_DIR="${OUT_DIR}/include"

cargo build --manifest-path "${CRATE_DIR}/Cargo.toml" --release --target aarch64-apple-ios
cargo build --manifest-path "${CRATE_DIR}/Cargo.toml" --release --target aarch64-apple-ios-sim
cargo build --manifest-path "${CRATE_DIR}/Cargo.toml" --release --target x86_64-apple-ios

mkdir -p "${HEADERS_DIR}"
cat > "${HEADERS_DIR}/happier_ssh_native.h" <<'HEADER'
#pragma once
typedef void (*happier_ssh_native_stdout_callback)(const char *event_json, void *context);
char *happier_ssh_native_exec_json(const char *request_json);
char *happier_ssh_native_exec_json_streaming(
  const char *request_json,
  happier_ssh_native_stdout_callback callback,
  void *context
);
char *happier_ssh_native_start_loopback_tunnel_json(const char *request_json);
char *happier_ssh_native_stop_loopback_tunnel_json(const char *tunnel_id);
char *happier_ssh_native_cancel_request_json(const char *request_id);
void happier_ssh_native_free_string(char *value);
HEADER

SIM_DIR="${OUT_DIR}/sim-universal"
SIM_UNIVERSAL="${SIM_DIR}/libhappier_ssh_native.a"
mkdir -p "${SIM_DIR}"
lipo -create \
  "${CRATE_DIR}/target/aarch64-apple-ios-sim/release/libhappier_ssh_native.a" \
  "${CRATE_DIR}/target/x86_64-apple-ios/release/libhappier_ssh_native.a" \
  -output "${SIM_UNIVERSAL}"

rm -rf "${XCFRAMEWORK}"
xcodebuild -create-xcframework \
  -library "${CRATE_DIR}/target/aarch64-apple-ios/release/libhappier_ssh_native.a" -headers "${HEADERS_DIR}" \
  -library "${SIM_UNIVERSAL}" -headers "${HEADERS_DIR}" \
  -output "${XCFRAMEWORK}"
