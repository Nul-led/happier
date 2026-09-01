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

test('server release builds and loads one native Iroh leaf on each supported target', async () => {
  const workflow = await read('.github/workflows/publish-server-runtime.yml');

  for (const [platformKey, runner, serverTarget, bunTarget, addonTarget] of [
    ['linux-x64', 'ubuntu-24.04', 'linux-x64', 'bun-linux-x64-baseline', 'linux-x64'],
    ['linux-arm64', 'ubuntu-24.04-arm', 'linux-arm64', 'bun-linux-arm64', 'linux-arm64'],
    ['darwin-x64', 'macos-15-intel', 'darwin-x64', 'bun-darwin-x64', 'darwin-x64'],
    ['darwin-arm64', 'macos-15', 'darwin-arm64', 'bun-darwin-arm64', 'darwin-arm64'],
    ['windows-x64', 'windows-2025', 'windows-x64', 'bun-windows-x64', 'win32-x64'],
  ]) {
    assert.match(
      workflow,
      new RegExp(
        `platform_key: ${platformKey}[\\s\\S]*?runner: ${runner}[\\s\\S]*?server_target: ${serverTarget}`
        + `[\\s\\S]*?bun_target: ${bunTarget}[\\s\\S]*?iroh_addon_target: ${addonTarget}`,
        'u',
      ),
    );
  }
  assert.match(workflow, /rustup toolchain install 1\.94\.1 --profile minimal/u);
  assert.match(workflow, /rustup default 1\.94\.1/u);
  assert.match(
    workflow,
    /yarn workspace @happier-dev\/iroh-native build[\s\S]*?yarn workspace @happier-dev\/iroh-native build:native[\s\S]*?yarn workspace @happier-dev\/iroh-native verify:native/u,
  );
  assert.match(workflow, /--targets "\$SERVER_TARGET"/u);
  assert.match(workflow, /PACKAGED_IROH_ROOT="\$\{PACKAGED_PAYLOAD_PATH\}\/node_modules\/@happier-dev\/iroh-native"/u);
  assert.match(workflow, /happier-iroh-native-lifecycle\.\$\{IROH_ADDON_TARGET\}\.node/u);
  assert.match(workflow, /bun "\$\{PACKAGED_IROH_ROOT\}\/scripts\/verify-node-addon-load\.mjs" --package-root "\$PACKAGED_IROH_ROOT"/u);
  assert.match(workflow, /bun build --compile --target "\$BUN_TARGET"/u);
  assert.match(workflow, /"\$PACKAGED_IROH_SMOKE"/u);
  assert.doesNotMatch(workflow, /--targets[^\n]*musl/u);
});
