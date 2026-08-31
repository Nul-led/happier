import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const repoRoot = new URL('../../', import.meta.url);

async function read(relativePath) {
  return readFile(new URL(relativePath, repoRoot), 'utf8');
}

test('CLI native release matrix builds and loads the Iroh addon from the packaged payload', async () => {
  const workflow = await read('.github/workflows/publish-cli-binaries.yml');

  assert.match(workflow, /rustup toolchain install 1\.94\.1 --profile minimal/u);
  assert.match(workflow, /rustup default 1\.94\.1/u);
  assert.match(
    workflow,
    /yarn workspace @happier-dev\/iroh-native build:native[\s\S]*?yarn workspace @happier-dev\/iroh-native verify:native/u,
  );
  assert.match(workflow, /verify:native:bun/u);
  assert.match(workflow, /bun build --compile --target "\$BUN_TARGET"/u);
  assert.match(workflow, /platform_key: windows-x64[\s\S]*?iroh_addon_target: win32-x64/u);
  assert.match(workflow, /happier-iroh-native-lifecycle\.\$\{IROH_ADDON_TARGET\}\.node/u);
  assert.match(workflow, /--package-root "\$PACKAGED_IROH_ROOT"/u);
  assert.match(workflow, /PACKAGED_IROH_SMOKE[\s\S]*?"\$PACKAGED_IROH_SMOKE"/u);
});

test('the addon smoke accepts an explicit package root for packaged hosts', async () => {
  const smoke = await read('packages/iroh-native/scripts/verify-node-addon-load.mjs');
  assert.match(smoke, /--package-root/u);
  assert.match(smoke, /loadIrohNodeNative/u);
});
