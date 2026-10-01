import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
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

test('each queued sync flush executes its own Mutagen flush in causal order', {
  skip: process.platform !== 'linux',
}, async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'happier-dev-target-control-causal-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const binDir = join(root, 'bin');
  const dataDir = join(root, 'mutagen', 'data');
  const stateDir = join(root, 'command-state', 'sync-control');
  const invocationLog = join(root, 'mutagen-invocations');
  const sourceFile = join(root, 'source.txt');
  const started = join(root, 'flush-started');
  const release = join(root, 'flush-release');
  await mkdir(binDir, { recursive: true });
  await mkdir(dataDir, { recursive: true });
  await writeFile(sourceFile, 'X\n');

  await executable(join(binDir, 'mutagen'), [
    '#!/bin/sh',
    'if [ "$2" = "list" ]; then',
    '  printf "%s|Watching|false|true|1|0/0|0/0|true|1|0/0|0/0|active|2|ok|0|0\\n" "$3"',
    '  exit 0',
    'fi',
    `cat -- ${JSON.stringify(sourceFile)} >> ${JSON.stringify(invocationLog)}`,
    `: > ${JSON.stringify(started)}`,
    `while [ ! -e ${JSON.stringify(release)} ]; do sleep 0.02; done`,
    '',
  ].join('\n'));

  const env = {
    ...process.env,
    PATH: `${binDir}:${process.env.PATH ?? ''}`,
    MUTAGEN_DATA_DIRECTORY: dataDir,
    HAPPIER_DEV_TARGET_CONTROL_STATE_DIR: stateDir,
    DBUS_SESSION_BUS_ADDRESS: '',
  };
  const args = ['--sync-flush', 'happier-linux', '--', 'mutagen', 'sync', 'flush', 'happier-linux'];
  const first = spawn(controlExecutable, args, { env, stdio: 'ignore' });
  await waitForFile(started);
  await writeFile(sourceFile, 'Y\n');
  const second = spawn(controlExecutable, args, { env, stdio: 'ignore' });
  await new Promise((resolveWait) => setTimeout(resolveWait, 150));
  await writeFile(release, '');
  assert.deepEqual(await Promise.all([waitForExit(first), waitForExit(second)]), [
    { code: 0, signal: null },
    { code: 0, signal: null },
  ]);
  const invocations = (await readFile(invocationLog, 'utf8')).trim().split('\n');
  assert.equal(invocations.length, 2, 'each queued request must run its own flush after lock admission');
  assert.equal(invocations[0].trim(), 'X');
  assert.equal(invocations[1].trim(), 'Y', 'second flush must observe bytes written while it waited');
});

test('sync inspection does not reinterpret partial template output as session health', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'happier-dev-target-control-template-failure-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const binDir = join(root, 'bin');
  const dataDir = join(root, 'mutagen', 'data');
  await mkdir(binDir, { recursive: true });
  await mkdir(dataDir, { recursive: true });
  await executable(join(binDir, 'mutagen'), [
    '#!/bin/sh',
    "printf '%s' 'happier-linux|Watching|false'",
    "printf '%s\n' 'template evaluation failed' >&2",
    'exit 1',
    '',
  ].join('\n'));

  const result = spawnSync(controlExecutable, ['--sync-check', 'happier-linux'], {
    env: {
      ...process.env,
      PATH: `${binDir}:${process.env.PATH ?? ''}`,
      MUTAGEN_DATA_DIRECTORY: dataDir,
    },
    encoding: 'utf8',
  });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /status inspection failed/i);
  assert.doesNotMatch(result.stderr, /missing.*session/i);
});

test('native sync admission rejects every problem-bearing public-model fact and permits clean post-cycle movement', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'happier-dev-target-control-admission-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const binDir = join(root, 'bin');
  const dataDir = join(root, 'mutagen', 'data');
  await mkdir(binDir, { recursive: true });
  await mkdir(dataDir, { recursive: true });
  await executable(join(binDir, 'mutagen'), '#!/bin/sh\nprintf "%s\\n" "$FAKE_MUTAGEN_STATUS"\n');

  const check = (statusLine) => spawnSync(controlExecutable, ['--sync-check', 'happier-linux'], {
    env: {
      ...process.env,
      PATH: `${binDir}:${process.env.PATH ?? ''}`,
      MUTAGEN_DATA_DIRECTORY: dataDir,
      FAKE_MUTAGEN_STATUS: statusLine,
    },
    encoding: 'utf8',
  });

  const rejected = [
    ['happier-linux|Disconnected|true|false|X|X|X|false|X|X|X|paused|0|ok|0|0', /paused/u],
    ['happier-linux|Disconnected|false|false|X|X|X|false|X|X|X|active|2|ok|0|0', /status is not clean/u],
    ['happier-linux|Watching|false|true|0|0\/0|0\/0|true|1|0\/0|0\/0|active|2|ok|0|0', /not scanned/u],
    ['happier-linux|Watching|false|true|1|1\/0|0\/0|true|1|0\/0|0\/0|active|2|ok|0|0', /alpha scan problems/u],
    ['happier-linux|Watching|false|true|1|0\/2|0\/0|true|1|0\/0|0\/0|active|2|ok|0|0', /alpha scan problems/u],
    ['happier-linux|Watching|false|true|1|0\/0|1\/0|true|1|0\/0|0\/0|active|2|ok|0|0', /alpha transition problems/u],
    ['happier-linux|Watching|false|true|1|0\/0|0\/3|true|1|0\/0|0\/0|active|2|ok|0|0', /alpha transition problems/u],
    ['happier-linux|Watching|false|true|1|0\/0|0\/0|true|1|1\/0|0\/0|active|2|ok|0|0', /beta scan problems/u],
    ['happier-linux|Watching|false|true|1|0\/0|0\/0|true|1|0\/0|0\/4|active|2|ok|0|0', /beta transition problems/u],
    ['happier-linux|Watching|false|true|1|0\/0|0\/0|true|1|0\/0|0\/0|active|2|error|0|0', /recorded error/u],
    ['happier-linux|Watching|false|true|1|0\/0|0\/0|true|1|0\/0|0\/0|active|2|ok|1|0', /unresolved conflicts/u],
    ['happier-linux|Watching|false|true|1|0\/0|0\/0|true|1|0\/0|0\/0|active|2|ok|0|2', /unresolved conflicts/u],
  ];
  for (const [statusLine, expectedError] of rejected) {
    const result = check(statusLine);
    assert.equal(result.status, 1, statusLine);
    assert.match(result.stderr, expectedError);
  }

  const moving = check('happier-linux|Scanning|false|true|1|0/0|0/0|true|1|0/0|0/0|active|2|ok|0|0');
  assert.equal(moving.status, 0, moving.stderr);
});

test('the no-flock platform path still performs a fresh post-flush health check', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'happier-dev-target-control-no-flock-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const binDir = join(root, 'bin');
  const dataDir = join(root, 'mutagen', 'data');
  const stateDir = join(root, 'command-state', 'sync-control');
  const flushMarker = join(root, 'flush-ran');
  await mkdir(binDir, { recursive: true });
  await mkdir(dataDir, { recursive: true });
  for (const command of ['mkdir', 'sed']) {
    await executable(join(binDir, command), `#!/bin/sh\nexec /usr/bin/${command} "$@"\n`);
  }
  await executable(join(binDir, 'mutagen'), [
    '#!/bin/sh',
    'if [ "$2" = flush ]; then',
    `  : > ${JSON.stringify(flushMarker)}`,
    '  exit 0',
    'fi',
    'printf "%s|Watching|false|true|1|0/0|1/0|true|1|0/0|0/0|active|2|ok|0|0\\n" "$3"',
    '',
  ].join('\n'));

  const result = spawnSync(
    controlExecutable,
    ['--sync-flush', 'happier-linux', '--', 'mutagen', 'sync', 'flush', 'happier-linux'],
    {
      env: {
        PATH: binDir,
        MUTAGEN_DATA_DIRECTORY: dataDir,
        HAPPIER_DEV_TARGET_CONTROL_STATE_DIR: stateDir,
        DBUS_SESSION_BUS_ADDRESS: '',
      },
      encoding: 'utf8',
    },
  );

  assert.equal(result.status, 1);
  assert.equal(await readFile(flushMarker, 'utf8'), '');
  assert.match(result.stderr, /alpha transition problems/i);
});

test('critical-slice placement runs the requested flush in the protected slice', {
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
    'if [ "$2" = "list" ]; then',
    '  printf "%s|Watching|false|true|1|0/0|0/0|true|1|0/0|0/0|active|2|ok|0|0\\n" "$3"',
    '  exit 0',
    'fi',
    `printf '%s\\n' "$*" >> ${JSON.stringify(invocationLog)}`,
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
  assert.deepEqual(await waitForExit(first), { code: 0, signal: null });
  assert.match(
    await readFile(invocationLog, 'utf8'),
    /sync flush happier-linux/,
  );
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
