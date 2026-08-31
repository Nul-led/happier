import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createWorkspaceSyncRealIntegrationPlan,
  runWorkspaceSyncRealIntegration,
} from './runWorkspaceSyncRealIntegration.mjs';

const binaries = Object.freeze({
  HAPPIER_MUTAGEN_LIVE_MANAGER_BIN: '/artifacts/happier-mutagen',
  HAPPIER_MUTAGEN_LIVE_AGENT_BIN: '/artifacts/happier-mutagen-agent',
  HAPPIER_PROCESS_CUSTODY_LIVE_BIN: '/artifacts/happier-process-custody',
});

test('requires every source-built workspace-sync binary before constructing the lane', () => {
  assert.throws(
    () => createWorkspaceSyncRealIntegrationPlan({ env: {} }),
    /HAPPIER_MUTAGEN_LIVE_MANAGER_BIN.*HAPPIER_MUTAGEN_LIVE_AGENT_BIN.*HAPPIER_PROCESS_CUSTODY_LIVE_BIN/u,
  );
});

test('runs only the real workspace-sync spec with explicit source-built lane admission', () => {
  const calls = [];
  runWorkspaceSyncRealIntegration({
    env: { ...binaries, EXISTING_VALUE: 'preserved' },
    accessSyncImpl: () => undefined,
    execYarnImpl: (args, options) => calls.push({ args, options }),
  });

  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].args, [
    '-s',
    'vitest:local',
    'run',
    '--isolate',
    '-c',
    'vitest.integration.config.ts',
    'src/daemon/startup/createDaemonWorkspaceSyncRuntime.real.integration.test.ts',
  ]);
  assert.equal(calls[0].options.env.EXISTING_VALUE, 'preserved');
  assert.equal(calls[0].options.env.HAPPIER_RUN_MUTAGEN_REAL_INTEGRATION, '1');
});
