import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { classifyChangedPaths } from '../pipeline/release/component-registry.mjs';

const repoRoot = new URL('../../', import.meta.url);

async function read(relativePath) {
  return readFile(new URL(relativePath, repoRoot), 'utf8');
}

test('an Iroh transport edit is planned as a transport change, not a relay deployment change', () => {
  const classified = classifyChangedPaths([
    'packages/iroh-native/rust/Cargo.lock',
    'packages/peer-transport/src/index.ts',
  ]);

  assert.equal(classified.iroh_transport, true);
  assert.notEqual(classified.iroh_relay, true);
});

test('the release plan publishes the Iroh transport decision the parity gate consumes', async () => {
  const planner = await read('scripts/pipeline/release/compute-changed-components.mjs');
  const workflow = await read('.github/workflows/release-channel.yml');

  assert.match(planner, /changed_iroh_transport:\s*String\(Boolean\(classified\.iroh_transport\)\)/u);
  assert.match(workflow, /changed_iroh_transport:\s*\$\{\{\s*steps\.plan\.outputs\.changed_iroh_transport\s*\}\}/u);
});

test('version parity runs whenever the Iroh transport component changes', async () => {
  // Lane 06 A10: the pinned Iroh version, source and checksum must agree across
  // the native lockfile, the Tauri lockfile and the stock relay image. That is a
  // property of the source being released, so the release plan — which is the
  // job that already resolves the changed components against the authorized
  // source — proves it.
  const workflow = await read('.github/workflows/release-channel.yml');
  const plan = workflow.slice(workflow.indexOf('\n  plan:'), workflow.indexOf('\n  mysql_db_contract:'));
  assert.ok(plan.length > 0, 'expected the release plan job');

  const gate = plan.slice(plan.indexOf('verify-iroh-lock-parity.mjs'));
  assert.notEqual(gate, '', 'the release plan must run the existing Iroh version-parity validation');

  const condition = plan.slice(0, plan.indexOf('verify-iroh-lock-parity.mjs'));
  const guard = condition.slice(condition.lastIndexOf('if:'));
  assert.match(guard, /steps\.plan\.outputs\.changed_iroh_transport == 'true'/u);
  assert.match(guard, /steps\.plan\.outputs\.changed_iroh_relay == 'true'/u);
});

test('the parity gate never turns an Iroh transport change into a relay publication', async () => {
  // A relay rebuild is a separate, digest-published deployment decision. Proving
  // the versions agree must not become a reason to republish the relay image.
  const workflow = await read('.github/workflows/release-channel.yml');

  assert.match(
    workflow,
    /build_iroh_relay:\s*\$\{\{\s*inputs\.force_deploy == true \|\| needs\.plan\.outputs\.changed_iroh_relay == 'true'\s*\}\}/u,
  );
  assert.doesNotMatch(workflow, /build_iroh_relay:[^\n]*changed_iroh_transport/u);
});

test('the parity verifier checks the stock relay crate identity, not only its version', async () => {
  const verifier = await read('packages/iroh-native/scripts/verify-iroh-lock-parity.mjs');
  assert.match(verifier, /verifyPackageParity\('iroh-relay'\)/u);
  assert.match(verifier, /relay[^\n]*source/u);
  assert.match(verifier, /relay[^\n]*checksum/u);
  assert.match(verifier, /IROH_RELAY_VERSION/u);
});

test('the parity verifier rejects a relay release that drifts from the core release', async () => {
  const verifier = await read('packages/iroh-native/scripts/verify-iroh-lock-parity.mjs');
  const directory = mkdtempSync(join(tmpdir(), 'happier-iroh-parity-'));
  const packageRoot = join(directory, 'packages/iroh-native');
  const source = 'registry+https://github.com/rust-lang/crates.io-index';
  const lockfile = (coreVersion, relayVersion) => `
[[package]]
name = "iroh"
version = "${coreVersion}"
source = "${source}"
checksum = "${'a'.repeat(64)}"

[[package]]
name = "iroh-relay"
version = "${relayVersion}"
source = "${source}"
checksum = "${'b'.repeat(64)}"
`;

  try {
    mkdirSync(join(packageRoot, 'scripts'), { recursive: true });
    mkdirSync(join(packageRoot, 'rust'), { recursive: true });
    mkdirSync(join(directory, 'apps/ui/src-tauri'), { recursive: true });
    mkdirSync(join(directory, 'deploy/iroh-relay'), { recursive: true });
    writeFileSync(join(packageRoot, 'scripts/verify-iroh-lock-parity.mjs'), verifier);
    writeFileSync(join(packageRoot, 'rust/Cargo.lock'), lockfile('1.1.0', '1.2.0'));
    writeFileSync(join(directory, 'apps/ui/src-tauri/Cargo.lock'), lockfile('1.1.0', '1.2.0'));
    writeFileSync(join(directory, 'deploy/iroh-relay/Dockerfile'), 'ARG IROH_RELAY_VERSION=1.2.0\n');

    const result = spawnSync(process.execPath, [join(packageRoot, 'scripts/verify-iroh-lock-parity.mjs')], {
      encoding: 'utf8',
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /relay version 1\.2\.0 does not match core version 1\.1\.0/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
