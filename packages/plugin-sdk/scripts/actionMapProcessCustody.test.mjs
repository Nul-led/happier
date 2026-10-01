import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import test from 'node:test';

import { isPidAlive } from '../../../apps/stack/scripts/utils/proc/pids.mjs';

// Substitute only the compiler/package-manager process boundary. The real
// producer, prepared-script dispatcher and foreground custody remain active.
async function fixture(t, kind, behavior) {
  const root = await mkdtemp(resolve(tmpdir(), 'happier-action-process-'));
  const pidFile = resolve(root, 'child.pid');
  let childPid;
  let wrapper;
  t.after(async () => {
    if (childPid) { try { process.kill(childPid, 'SIGKILL'); } catch {} }
    if (wrapper?.exitCode == null && wrapper?.signalCode == null) wrapper?.kill('SIGKILL');
    await rm(root, { recursive: true, force: true });
  });
  const actions = resolve(root, 'packages/protocol/src/actions');
  await mkdir(actions, { recursive: true });
  await writeFile(resolve(actions, 'actionIds.ts'), "export const ACTION_ID_FAMILIES_V1 = { inventory: ['inventory.list'] } as const;");
  await writeFile(resolve(actions, 'pluginActionSurface.ts'), 'export const PLUGIN_SURFACE_EXCLUSION_REASONS = {} as const;');
  const fakeYarn = resolve(root, 'yarn.mjs');
  await writeFile(fakeYarn, behavior);
  const preload = resolve(root, 'compiler-boundary.mjs');
  await writeFile(preload, `
    if (process.argv[1]?.endsWith('/deriveActionDtos.mjs')) {
      ${behavior}
      await new Promise(() => {});
    }
  `);
  const entry = kind === 'family'
    ? `import { deriveActionDtoSchemas } from ${JSON.stringify(new URL('./deriveActionDtos.mjs', import.meta.url).href)};
       await deriveActionDtoSchemas({ repoRoot: ${JSON.stringify(root)}, onlyFamilies: ['inventory'] });`
    : `import { runPluginSdkPreparedScript } from ${JSON.stringify(new URL('./bundleWorkspaceDeps.mjs', import.meta.url).href)};
       await runPluginSdkPreparedScript('fixture', { pluginSdkDir: ${JSON.stringify(root)} });`;
  wrapper = spawn(process.execPath, ['--input-type=module', '-e', entry], {
    stdio: ['ignore', 'ignore', 'pipe'],
    env: { ...process.env, npm_execpath: fakeYarn, NODE_OPTIONS: `--import=${preload}` },
  });
  let stderr = '';
  wrapper.stderr.on('data', chunk => { stderr += chunk; });
  return { wrapper, pidFile, stderr: () => stderr, setChildPid: pid => { childPid = pid; } };
}

async function waitFor(predicate, message) {
  // Reuse the process-owner fixture's bounded observation window, not a
  // production cancellation deadline.
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (await predicate()) return;
    await new Promise(resolveWait => setTimeout(resolveWait, 25));
  }
  assert.fail(message());
}

for (const kind of ['family', 'prepared']) {
  test(`${kind} Action child stops after parent-only loss`, { skip: process.platform === 'win32' }, async t => {
    // Write the marker from the substituted OS child, as proc.test.mjs does.
    const run = await fixture(t, kind, `
      const { writeFileSync } = await import('node:fs');
      writeFileSync(new URL('./child.pid', import.meta.url), String(process.pid));
      setInterval(() => {}, 1000);
    `);
    let pid;
    await waitFor(async () => {
      pid = Number(await readFile(run.pidFile, 'utf8').catch(() => '0'));
      return pid > 0;
    }, () => `child did not start: ${run.stderr()}`);
    run.setChildPid(pid);
    const exited = once(run.wrapper, 'exit');
    run.wrapper.kill('SIGKILL');
    assert.deepEqual(await exited, [null, 'SIGKILL']);
    await waitFor(() => {
      if (!isPidAlive(pid)) return true;
      const state = spawnSync('ps', ['-o', 'stat=', '-p', String(pid)], { encoding: 'utf8' });
      assert.equal(state.error, undefined);
      return !isPidAlive(pid) || (state.status === 0 && state.stdout.trim().startsWith('Z'));
    }, () => `${kind} child survived parent loss: ${run.stderr()}`);
  });

  test(`${kind} Action child failure propagates to its awaiting caller`, async t => {
    const run = await fixture(t, kind, 'process.exit(7);');
    const [code] = await once(run.wrapper, 'exit');
    assert.notEqual(code, 0);
    assert.match(run.stderr(), kind === 'family' ? /Action schema family failed \(7\)/u : /fixture failed with exit code 7/u);
  });
}
