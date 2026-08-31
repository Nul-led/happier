import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));

function readPackageFile(relativePath: string): string {
  return readFileSync(join(packageRoot, relativePath), 'utf8');
}

describe('Iroh mobile release build contract', () => {
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

  it('exposes exact tunnel-handle status on both mobile bindings', () => {
    expect(readPackageFile('ios/HappierIrohNativeModule.swift')).toContain('AsyncFunction("getTunnelStatus")');
    expect(readPackageFile('android/src/main/java/dev/happier/iroh/HappierIrohNativeModule.kt'))
      .toContain('AsyncFunction("getTunnelStatus")');
    expect(readPackageFile('rust/happier-iroh-native/src/lib.rs'))
      .toContain('Java_dev_happier_iroh_HappierIrohNativeRust_getTunnelStatusJson');
  });
});
