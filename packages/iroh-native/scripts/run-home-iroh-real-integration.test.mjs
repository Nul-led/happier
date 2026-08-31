import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createHomeIrohRealIntegrationPlan,
  runHomeIrohRealIntegration,
} from './run-home-iroh-real-integration.mjs';

test('prepares the current-platform relay fixture and both real transport integration tests', () => {
  const plan = createHomeIrohRealIntegrationPlan({
    platform: 'win32',
    arch: 'x64',
    packageDir: 'C:\\repo\\packages\\iroh-native',
    serverDir: 'C:\\repo\\apps\\server',
    cliDir: 'C:\\repo\\apps\\cli',
  });

  assert.deepEqual(plan.build, {
    args: ['-s', 'build:native:test-relay'],
    cwd: 'C:\\repo\\packages\\iroh-native',
  });
  assert.deepEqual(plan.tests.server.args, [
    '-s',
    'vitest:local',
    'run',
    '--isolate',
    '-c',
    'vitest.integration.config.ts',
    'sources/app/iroh/homeIrohEndpoint.real.integration.test.ts',
  ]);
  assert.equal(plan.tests.server.cwd, 'C:\\repo\\apps\\server');
  assert.deepEqual(plan.tests.machine.args, [
    '-s',
    'vitest:local',
    'run',
    '--isolate',
    '-c',
    'vitest.integration.config.ts',
    'src/daemon/peer/iroh/workspaceMachineCarrierLane08.real.integration.test.ts',
  ]);
  assert.equal(plan.tests.machine.cwd, 'C:\\repo\\apps\\cli');
  assert.equal(plan.tests.server.env.HAPPIER_IROH_REQUIRE_NODE_ADDON, '1');
  assert.equal(plan.tests.machine.env.HAPPIER_RUN_HOME_IROH_REAL_INTEGRATION, '1');
  assert.equal(
    plan.tests.machine.env.HAPPIER_TEST_IROH_NODE_ADDON_PATH,
    'C:\\repo\\packages\\iroh-native\\native\\happier-iroh-native-lifecycle-test.win32-x64.node',
  );
});

test('runs the canonical build before both tests and supplies one stable selected addon', () => {
  const calls = [];
  const copied = [];
  const removed = [];
  runHomeIrohRealIntegration({
    env: { EXISTING_VALUE: 'preserved' },
    execYarnImpl: (args, options) => calls.push({ args, options }),
    makeTempDirImpl: () => '/tmp/happier-iroh-home-test-stable',
    copyFileImpl: (source, destination) => copied.push({ source, destination }),
    removeDirImpl: (directory) => removed.push(directory),
  });

  assert.equal(calls.length, 3);
  assert.deepEqual(calls[0].args, ['-s', 'build:native:test-relay']);
  assert.match(calls[1].args.join(' '), /homeIrohEndpoint\.real\.integration\.test\.ts/u);
  assert.match(calls[2].args.join(' '), /workspaceMachineCarrierLane08\.real\.integration\.test\.ts/u);
  assert.equal(calls[1].options.env.EXISTING_VALUE, 'preserved');
  assert.equal(calls[1].options.env.HAPPIER_IROH_REQUIRE_NODE_ADDON, '1');
  assert.equal(calls[2].options.env.HAPPIER_RUN_HOME_IROH_REAL_INTEGRATION, '1');
  assert.equal(copied.length, 1);
  assert.match(copied[0].source, /native[/\\]happier-iroh-native-lifecycle-test\.[^.]+-[^.]+\.node$/u);
  assert.equal(copied[0].destination, '/tmp/happier-iroh-home-test-stable/addon.node');
  assert.equal(calls[1].options.env.HAPPIER_TEST_IROH_NODE_ADDON_PATH, copied[0].destination);
  assert.equal(calls[2].options.env.HAPPIER_TEST_IROH_NODE_ADDON_PATH, copied[0].destination);
  assert.deepEqual(removed, ['/tmp/happier-iroh-home-test-stable']);
});
