import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));

function readPackageFile(relativePath: string): string {
  return readFileSync(join(packageRoot, relativePath), 'utf8');
}

describe('Iroh mobile release build contract', () => {
  it('uses the checked-in lockfile for Node, iOS, and Android Cargo builds', () => {
    expect(readPackageFile('scripts/build-node-addon.mjs')).toMatch(
      /const cargoArgs = \["build", "--locked",/u,
    );
    for (const script of ['scripts/build-rust-ios.sh', 'scripts/build-rust-android.sh']) {
      expect(readPackageFile(script)).toMatch(/cargo build --locked /u);
    }
  });

  it('proves the canonical Iroh version, source, and checksum across application lockfiles', () => {
    const source = readPackageFile('scripts/verify-iroh-lock-parity.mjs');
    expect(source).toContain("'rust/Cargo.lock'");
    expect(source).toContain("'../../apps/ui/src-tauri/Cargo.lock'");
    expect(source).toMatch(/version.*source.*checksum/su);
    expect(JSON.parse(readPackageFile('package.json')).scripts['verify:iroh-lock-parity'])
      .toBe('node scripts/verify-iroh-lock-parity.mjs');
  });

  it('reads Cargo artifacts from the package Rust workspace target directory', () => {
    for (const script of ['scripts/build-rust-ios.sh', 'scripts/build-rust-android.sh']) {
      const source = readPackageFile(script);
      expect(source).toContain('CARGO_TARGET_DIR="${ROOT_DIR}/rust/target"');
      expect(source).not.toContain('${CRATE_DIR}/target/');
    }
  });

  it('uses abort-on-panic for release native libraries', () => {
    const workspaceManifest = readPackageFile('rust/Cargo.toml');
    expect(workspaceManifest).toMatch(/\[profile\.release\][\s\S]*?panic\s*=\s*"abort"/u);
  });

  it('keeps Android ABI and API declarations aligned with the Rust artifacts', () => {
    const gradle = readPackageFile('android/build.gradle');
    const script = readPackageFile('scripts/build-rust-android.sh');
    const outputAbis = [...script.matchAll(/^build_target\s+"[^"]+"\s+"([^"]+)"/gmu)]
      .map((match) => match[1]);
    const abiFilters = gradle.match(/abiFilters\s+((?:'[^']+'(?:,\s*)?)+)/u);
    const gradleApiLevel = gradle.match(/def happierIrohNativeAndroidApiLevel\s*=\s*(\d+)/u);
    const scriptApiLevel = script.match(/API_LEVEL="\$\{HAPPIER_ANDROID_NATIVE_API_LEVEL:-(\d+)\}"/u);

    expect(outputAbis).toEqual(['arm64-v8a', 'x86_64']);
    expect(abiFilters).not.toBeNull();
    expect(gradleApiLevel).not.toBeNull();
    expect(scriptApiLevel).not.toBeNull();
    if (abiFilters === null || gradleApiLevel === null || scriptApiLevel === null) return;

    const declaredAbis = [...abiFilters[1].matchAll(/'([^']+)'/gu)].map((match) => match[1]);
    expect(declaredAbis).toEqual(outputAbis);
    expect(gradleApiLevel[1]).toBe('24');
    expect(scriptApiLevel[1]).toBe(gradleApiLevel[1]);
    expect(gradle).toContain('minSdk happierIrohNativeAndroidApiLevel');
    expect(gradle).toContain(
      'environment "HAPPIER_ANDROID_NATIVE_API_LEVEL", '
        + '(System.getenv("HAPPIER_ANDROID_NATIVE_API_LEVEL") '
        + '?: happierIrohNativeAndroidApiLevel.toString())',
    );
  });

  it('installs the Android application JNI context exactly once before endpoint construction', () => {
    const kotlin = readPackageFile(
      'android/src/main/java/dev/happier/iroh/HappierIrohNativeModule.kt',
    );
    const createEndpoint = kotlin.slice(
      kotlin.indexOf('fun createEndpoint(request:'),
      kotlin.indexOf('fun startMachineHttpTunnel('),
    );

    expect(createEndpoint.indexOf('IrohAndroidContext.install(context)')).toBeGreaterThan(-1);
    expect(createEndpoint.indexOf('IrohAndroidContext.install(context)')).toBeLessThan(
      createEndpoint.indexOf('HappierIrohNativeRust.createEndpointJson('),
    );
    expect(kotlin).toMatch(
      /private object IrohAndroidContext[\s\S]*?installed[\s\S]*?@Synchronized[\s\S]*?if \(installed\) return[\s\S]*?installAndroidContext\(context\.applicationContext\)[\s\S]*?installed = true/u,
    );
    expect(kotlin).toContain('external fun installAndroidContext(context: Context)');

    const rust = readPackageFile('rust/happier-iroh-native/src/lib.rs');
    expect(rust).toContain('iroh::dns::install_android_jni_context(');
    expect(rust).toContain('static ANDROID_APPLICATION_CONTEXT: Mutex<Option<GlobalRef>>');
    expect(rust).toContain('env.new_global_ref(application_context)');
  });

  it('does not publish the Cargo target directory with the package sources', () => {
    const manifest = JSON.parse(readPackageFile('package.json')) as { files?: string[] };
    expect(manifest.files).not.toContain('rust');
    expect(manifest.files).toEqual(expect.arrayContaining([
      'rust/Cargo.toml',
      'rust/Cargo.lock',
      'rust/happier-iroh-core',
      'rust/happier-iroh-native',
      'rust/happier-iroh-node',
    ]));
    expect(readPackageFile('.npmignore')).toMatch(/^rust\/target\/$/mu);
  });

  it('exposes only the canonical endpoint-and-tunnel handle lifecycle on mobile bindings', () => {
    for (const source of [
      readPackageFile('ios/HappierIrohNativeModule.swift'),
      readPackageFile('android/src/main/java/dev/happier/iroh/HappierIrohNativeModule.kt'),
    ]) {
      for (const operation of ['createEndpoint', 'ensureHomeTunnel', 'releaseHomeTunnel', 'getTunnelStatus', 'shutdownEndpoint']) {
        expect(source).toContain(`AsyncFunction("${operation}")`);
      }
      for (const removed of ['startHomeTunnel', 'stopHomeTunnel', 'getHomeTunnelStatus']) {
        expect(source).not.toContain(removed);
      }
    }
    const rustProduction = readPackageFile('rust/happier-iroh-native/src/lib.rs').split('#[cfg(test)]')[0];
    for (const removed of ['start_home_tunnel_json', 'stop_home_tunnel_json', 'get_home_tunnel_status_json']) {
      expect(rustProduction).not.toContain(removed);
    }
  });
});
