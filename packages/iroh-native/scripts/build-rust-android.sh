#!/usr/bin/env bash
set -euo pipefail
RUST_ENV="${CARGO_HOME:-${HOME}/.cargo}/env"
if ! command -v cargo >/dev/null 2>&1 && [[ -f "${RUST_ENV}" ]]; then
  # `eas-build-pre-install` runs in an earlier shell; consume the environment
  # persisted by rustup rather than assuming that shell's PATH survived.
  source "${RUST_ENV}"
fi
command -v cargo >/dev/null 2>&1 || { echo "Rust/Cargo is required to build the Iroh Android carrier" >&2; exit 1; }
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CRATE_DIR="${ROOT_DIR}/rust/happier-iroh-native"
CARGO_TARGET_DIR="${ROOT_DIR}/rust/target"
OUT_DIR="${ROOT_DIR}/android/build/generated/rustJniLibs"
NDK_HOME="${ANDROID_NDK_HOME:-${ANDROID_NDK_ROOT:-${ANDROID_HOME:-${ANDROID_SDK_ROOT:-}}/ndk/27.1.12297006}}"
case "$(uname -s)" in Darwin) HOST_TAG="darwin-x86_64" ;; Linux) HOST_TAG="linux-x86_64" ;; *) echo "Unsupported Android NDK build host: $(uname -s)" >&2; exit 1 ;; esac
TOOLCHAIN="${NDK_HOME}/toolchains/llvm/prebuilt/${HOST_TAG}/bin"
API_LEVEL="${HAPPIER_ANDROID_NATIVE_API_LEVEL:-24}"
build_target() {
  local target="$1" abi="$2" clang_prefix="$3" cargo_target
  cargo_target="$(printf '%s' "${target}" | tr '[:lower:]-' '[:upper:]_')"
  export "CC_${target//-/_}=${TOOLCHAIN}/${clang_prefix}${API_LEVEL}-clang"
  export "AR_${target//-/_}=${TOOLCHAIN}/llvm-ar"
  export "CARGO_TARGET_${cargo_target}_LINKER=${TOOLCHAIN}/${clang_prefix}${API_LEVEL}-clang"
  CARGO_TARGET_DIR="${CARGO_TARGET_DIR}" cargo build --locked --manifest-path "${CRATE_DIR}/Cargo.toml" --release --target "${target}"
  mkdir -p "${OUT_DIR}/${abi}"
  cp "${CARGO_TARGET_DIR}/${target}/release/libhappier_iroh_native.so" "${OUT_DIR}/${abi}/libhappier_iroh_native.so"
}
build_target "aarch64-linux-android" "arm64-v8a" "aarch64-linux-android"
build_target "x86_64-linux-android" "x86_64" "x86_64-linux-android"
node "${ROOT_DIR}/scripts/generate-native-release-evidence.mjs" \
  --package-root "${ROOT_DIR}" \
  --output-dir "${ROOT_DIR}/release-evidence"
