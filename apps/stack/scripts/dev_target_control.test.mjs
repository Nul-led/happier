import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const testDir = dirname(fileURLToPath(import.meta.url));
const controlExecutable = resolve(testDir, '..', 'bin', 'hstack-dev-target-control');

async function executable(path, contents) {
  await writeFile(path, contents);
  await chmod(path, 0o755);
}

async function waitForFile(path) {
  for (let attempt = 0; attempt < 250; attempt += 1) {
    try {
      await readFile(path);
      return;
    } catch {
      await new Promise((resolveWait) => setTimeout(resolveWait, 20));
    }
  }
  throw new Error(`timed out waiting for ${path}`);
}

async function waitForExit(child) {
  return await new Promise((resolveExit, rejectExit) => {
    child.once('error', rejectExit);
    child.once('exit', (code, signal) => resolveExit({ code, signal }));
  });
}

test('coalesces concurrent fresh-sync barriers and runs only the leader in the critical slice', {
  skip: process.platform !== 'linux' || !process.env.DBUS_SESSION_BUS_ADDRESS,
}, async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'happier-dev-target-control-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const binDir = join(root, 'bin');
  const dataDir = join(root, 'mutagen', 'data');
  const stateDir = join(root, 'command-state', 'sync-control');
  const invocationLog = join(root, 'mutagen-invocations');
  const scopeLog = join(root, 'systemd-scopes');
  const started = join(root, 'flush-started');
  const release = join(root, 'flush-release');
  await mkdir(binDir, { recursive: true });
  await mkdir(dataDir, { recursive: true });
  await chmod(dataDir, 0o500);

  await executable(join(binDir, 'systemctl'), [
    '#!/bin/sh',
    "printf '%s\\n' 'LoadState=loaded' 'MemoryLow=4294967296'",
    '',
  ].join('\n'));
  await executable(join(binDir, 'systemd-run'), [
    '#!/bin/sh',
    `printf '%s\\n' "$*" >> ${JSON.stringify(scopeLog)}`,
    'while [ "$#" -gt 0 ] && [ "$1" != "--" ]; do shift; done',
    '[ "$1" != "--" ] || shift',
    'exec "$@"',
    '',
  ].join('\n'));
  await executable(join(binDir, 'mutagen'), [
    '#!/bin/sh',
    `printf '%s\\n' "$*" >> ${JSON.stringify(invocationLog)}`,
    `: > ${JSON.stringify(started)}`,
    `while [ ! -e ${JSON.stringify(release)} ]; do sleep 0.02; done`,
    '',
  ].join('\n'));

  const env = {
    ...process.env,
    PATH: `${binDir}:${process.env.PATH ?? ''}`,
    MUTAGEN_DATA_DIRECTORY: dataDir,
    HAPPIER_DEV_TARGET_CONTROL_STATE_DIR: stateDir,
  };
  const args = ['--sync-flush', 'happier-linux', '--', 'mutagen', 'sync', 'flush', 'happier-linux'];
  const first = spawn(controlExecutable, args, { env, stdio: 'ignore' });
  await waitForFile(started);
  const second = spawn(controlExecutable, args, { env, stdio: 'ignore' });
  await new Promise((resolveWait) => setTimeout(resolveWait, 150));

  assert.equal((await readFile(invocationLog, 'utf8')).trim().split('\n').length, 1);
  await writeFile(release, '');
  assert.deepEqual(await Promise.all([waitForExit(first), waitForExit(second)]), [
    { code: 0, signal: null },
    { code: 0, signal: null },
  ]);
  assert.equal((await readFile(invocationLog, 'utf8')).trim().split('\n').length, 1);
  assert.match(
    await readFile(scopeLog, 'utf8'),
    /(?:--nice=0 )?--slice=happier-critical\.slice .*-- mutagen sync flush happier-linux/,
  );
});

test('falls back to direct execution when the inherited user bus is unavailable', {
  skip: process.platform !== 'linux',
}, async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'happier-dev-target-control-stale-bus-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const binDir = join(root, 'bin');
  const scopeLog = join(root, 'systemd-scopes');
  const commandLog = join(root, 'command-ran');
  await mkdir(binDir, { recursive: true });

  await executable(join(binDir, 'cat'), [
    '#!/bin/sh',
    "case \"$1\" in */happier-critical.slice/memory.low) printf '%s\\n' 4294967296 ;; *) exec /bin/cat \"$@\" ;; esac",
    '',
  ].join('\n'));
  await executable(join(binDir, 'systemctl'), [
    '#!/bin/sh',
    'exit 1',
    '',
  ].join('\n'));
  await executable(join(binDir, 'systemd-run'), [
    '#!/bin/sh',
    `printf '%s\\n' "$*" >> ${JSON.stringify(scopeLog)}`,
    'exit 91',
    '',
  ].join('\n'));
  await executable(join(binDir, 'work'), [
    '#!/bin/sh',
    `: > ${JSON.stringify(commandLog)}`,
    '',
  ].join('\n'));

  const result = await waitForExit(spawn(controlExecutable, ['--', 'work'], {
    env: {
      ...process.env,
      PATH: `${binDir}:${process.env.PATH ?? ''}`,
      DBUS_SESSION_BUS_ADDRESS: 'unix:path=/run/user/does-not-exist/bus',
    },
    stdio: 'ignore',
  }));

  assert.deepEqual(result, { code: 0, signal: null });
  assert.equal(await readFile(commandLog, 'utf8'), '');
  await assert.rejects(readFile(scopeLog, 'utf8'), { code: 'ENOENT' });
});
