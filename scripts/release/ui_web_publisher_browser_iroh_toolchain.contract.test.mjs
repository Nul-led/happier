import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const repoRoot = new URL('../../', import.meta.url);

async function read(relativePath) {
  return readFile(new URL(relativePath, repoRoot), 'utf8');
}

/**
 * The pins the browser Iroh build actually depends on, read from the files that
 * own them rather than restated here: the repository's Rust channel and the
 * `wasm-bindgen` version the Iroh Cargo lockfile resolves. A `wasm-bindgen` CLI
 * that does not match the linked crate refuses the module outright, so this is
 * the one pair a publisher has to install.
 */
async function readCanonicalPins() {
  const [toolchainFile, lockfile] = await Promise.all([
    read('apps/ui/rust-toolchain.toml'),
    read('packages/iroh-native/rust/Cargo.lock'),
  ]);
  const channel = toolchainFile.match(/^channel = "([^"]+)"$/mu)?.[1];
  const wasmBindgen = lockfile
    .split(/\n\[\[package\]\]\n/u)
    .find((block) => /^name = "wasm-bindgen"$/mu.test(block))
    ?.match(/^version = "([^"]+)"$/mu)?.[1];

  assert.ok(channel, 'apps/ui/rust-toolchain.toml must pin a Rust channel');
  assert.ok(wasmBindgen, 'the Iroh Cargo lockfile must resolve a wasm-bindgen version');
  return { channel, wasmBindgen };
}

test('the web publisher admits the pinned Rust, wasm32 target and wasm-bindgen before it materializes browser Iroh', async () => {
  // Lane 06 A10: `build-ui-web-bundle.mjs` invokes the browser Iroh producer,
  // which compiles `wasm32-unknown-unknown` and runs `wasm-bindgen`. The build
  // image supplies neither, so the release job has to install them, and it has
  // to do so before the bundle build rather than anywhere in the job.
  const { channel, wasmBindgen } = await readCanonicalPins();
  const workflow = await read('.github/workflows/publish-ui-web.yml');

  const buildJob = workflow.slice(workflow.indexOf('\n  build_candidate:'), workflow.indexOf('\n  publish:'));
  assert.ok(buildJob.length > 0, 'expected the unsigned UI-web candidate build job');

  const toolchainStep = buildJob.search(
    new RegExp(`toolchain:\\s*${channel.replace(/\./gu, '\\.')}[\\s\\S]*?targets:\\s*wasm32-unknown-unknown`, 'u'),
  );
  assert.notEqual(toolchainStep, -1, 'the build job must install the pinned Rust toolchain and the wasm32 target');

  const bindgenStep = buildJob.search(
    new RegExp(`cargo install wasm-bindgen-cli --version ${wasmBindgen.replace(/\./gu, '\\.')} --locked`, 'u'),
  );
  assert.notEqual(bindgenStep, -1, 'the build job must install the wasm-bindgen CLI matching the locked crate');

  const bundleBuild = buildJob.indexOf('build-ui-web-bundle.mjs');
  assert.notEqual(bundleBuild, -1, 'the build job must build the UI-web bundle');
  assert.ok(toolchainStep < bundleBuild, 'the Rust toolchain must be installed before the bundle build runs');
  assert.ok(bindgenStep < bundleBuild, 'wasm-bindgen must be installed before the bundle build runs');
});

test('release admission reuses the proven real-Iroh toolchain pins instead of drifting from them', async () => {
  // The same two pins gate the Chromium real-transport lane that proves the
  // browser carrier works. A release that installed a different pair would
  // publish a boundary nothing had exercised.
  const { channel, wasmBindgen } = await readCanonicalPins();
  const tests = await read('.github/workflows/tests.yml');
  const realIrohLane = tests.slice(tests.indexOf('\n  home-iroh-real:'), tests.indexOf('\n  server-db-contract:'));

  assert.match(realIrohLane, new RegExp(`toolchain:\\s*${channel.replace(/\./gu, '\\.')}`, 'u'));
  assert.match(realIrohLane, /targets:\s*wasm32-unknown-unknown/u);
  assert.match(
    realIrohLane,
    new RegExp(`cargo install wasm-bindgen-cli --version ${wasmBindgen.replace(/\./gu, '\\.')} --locked`, 'u'),
  );
});
