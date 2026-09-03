import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createWorkspaceSyncRealIntegrationPlan,
  runWorkspaceSyncRealIntegration,
} from './runWorkspaceSyncRealIntegration.mjs';

const binaries = Object.freeze({
  HAPPIER_MUTAGEN_LIVE_MANAGER_BIN: '/artifacts/happier-mutagen',
  HAPPIER_MUTAGEN_LIVE_AGENT_BIN: '/artifacts/happier-mutagen-agent',
  HAPPIER_MUTAGEN_BROKER_CLIENT_TEST_BIN: '/artifacts/happier-mutagen-broker-client-test',
  HAPPIER_PROCESS_CUSTODY_LIVE_BIN: '/artifacts/happier-process-custody',
});

test('requires every source-built workspace-sync binary before constructing the lane', () => {
  assert.throws(
    () => createWorkspaceSyncRealIntegrationPlan({ env: {} }),
    /workspace-sync real-lane blocked preflight: required HAPPIER_MUTAGEN_LIVE_MANAGER_BIN.*HAPPIER_MUTAGEN_LIVE_AGENT_BIN.*HAPPIER_MUTAGEN_BROKER_CLIENT_TEST_BIN.*HAPPIER_PROCESS_CUSTODY_LIVE_BIN/u,
  );
});

test('fails preflight with the owning environment name when a configured binary is unavailable', () => {
  assert.throws(
    () => runWorkspaceSyncRealIntegration({
      env: binaries,
      accessSyncImpl: (path) => {
        if (path === binaries.HAPPIER_MUTAGEN_LIVE_AGENT_BIN) {
          const error = new Error('ENOENT');
          error.code = 'ENOENT';
          throw error;
        }
      },
    }),
    /workspace-sync real-lane blocked preflight: HAPPIER_MUTAGEN_LIVE_AGENT_BIN points to an unavailable binary at \/artifacts\/happier-mutagen-agent/u,
  );
});

test('plans the relay-fixture build plus local and remote source-built workspace-sync specs', () => {
  const plan = createWorkspaceSyncRealIntegrationPlan({
    env: binaries,
    platform: 'win32',
    arch: 'x64',
    cwd: 'C:\\repo\\apps\\cli',
    irohNativeDirectory: 'C:\\repo\\packages\\iroh-native',
  });

  assert.deepEqual(plan.build, {
    args: ['-s', 'build:native:test-relay'],
    cwd: 'C:\\repo\\packages\\iroh-native',
  });
  assert.equal(
    plan.addonPath,
    'C:\\repo\\packages\\iroh-native\\native\\happier-iroh-native-lifecycle-test.win32-x64.node',
  );
  assert.deepEqual(
    plan.tests.map((testPlan) => testPlan.args.at(-1)),
    [
      'src/workspaces/sync/transport/workspaceSyncBroker.go.real.integration.test.ts',
      'src/daemon/startup/createDaemonWorkspaceSyncRuntime.real.integration.test.ts',
      'src/daemon/peer/iroh/workspaceMachineCarrierMutagen.real.integration.test.ts',
    ],
  );
  assert.equal(plan.tests[0].env.HAPPIER_RUN_MUTAGEN_REAL_INTEGRATION, '1');
  assert.equal(plan.tests[0].env.HAPPIER_RUN_HOME_IROH_REAL_INTEGRATION, undefined);
  assert.equal(plan.tests[2].env.HAPPIER_RUN_HOME_IROH_REAL_INTEGRATION, '1');
});

test('builds once and runs all real specs with source binaries and one stable relay addon', () => {
  const calls = [];
  const accessed = [];
  const copied = [];
  const removed = [];
  runWorkspaceSyncRealIntegration({
    env: { ...binaries, EXISTING_VALUE: 'preserved' },
    accessSyncImpl: (path) => accessed.push(path),
    execYarnImpl: (args, options) => calls.push({ args, options }),
    makeTempDirImpl: () => '/tmp/happier-workspace-sync-real-stable',
    copyFileImpl: (source, destination) => copied.push({ source, destination }),
    removeDirImpl: (directory) => removed.push(directory),
  });

  assert.equal(calls.length, 4);
  assert.deepEqual(calls[0].args, ['-s', 'build:native:test-relay']);
  assert.deepEqual(calls[1].args, [
    '-s',
    'vitest:local',
    'run',
    '--isolate',
    '-c',
    'vitest.integration.config.ts',
    'src/workspaces/sync/transport/workspaceSyncBroker.go.real.integration.test.ts',
  ]);
  assert.match(calls[2].args.at(-1), /createDaemonWorkspaceSyncRuntime\.real\.integration\.test\.ts/u);
  assert.match(calls[3].args.at(-1), /workspaceMachineCarrierMutagen\.real\.integration\.test\.ts/u);
  assert.equal(calls[1].options.env.EXISTING_VALUE, 'preserved');
  assert.equal(calls[1].options.env.HAPPIER_RUN_MUTAGEN_REAL_INTEGRATION, '1');
  assert.equal(calls[3].options.env.HAPPIER_RUN_HOME_IROH_REAL_INTEGRATION, '1');
  assert.equal(
    calls[1].options.env.HAPPIER_TEST_IROH_NODE_ADDON_PATH,
    '/tmp/happier-workspace-sync-real-stable/addon.node',
  );
  assert.equal(
    calls[2].options.env.HAPPIER_TEST_IROH_NODE_ADDON_PATH,
    '/tmp/happier-workspace-sync-real-stable/addon.node',
  );
  assert.equal(calls[1].options.env.TMPDIR, '/tmp');
  assert.equal(calls[1].options.env.TMP, '/tmp');
  assert.equal(calls[1].options.env.TEMP, '/tmp');
  assert.deepEqual(accessed.slice(0, 4), Object.values(binaries));
  assert.equal(accessed.length, 5);
  assert.equal(copied.length, 1);
  assert.match(copied[0].source, /native[/\\]happier-iroh-native-lifecycle-test\.[^.]+-[^.]+\.node$/u);
  assert.equal(copied[0].destination, '/tmp/happier-workspace-sync-real-stable/addon.node');
  assert.deepEqual(removed, ['/tmp/happier-workspace-sync-real-stable']);
});
