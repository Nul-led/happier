import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createHomeIrohRealIntegrationPlan,
  runHomeIrohRealIntegration,
} from './run-home-iroh-real-integration.mjs';

test('prepares the current-platform relay fixture and runs the real server integration test', () => {
  const plan = createHomeIrohRealIntegrationPlan({
    platform: 'win32',
    arch: 'x64',
    packageDir: 'C:\\repo\\packages\\iroh-native',
    serverDir: 'C:\\repo\\apps\\server',
  });

  assert.deepEqual(plan.build, {
    args: ['-s', 'build:native:test-relay'],
    cwd: 'C:\\repo\\packages\\iroh-native',
  });
  assert.deepEqual(plan.test.args, [
    '-s',
    'vitest:local',
    'run',
    '--isolate',
    '-c',
    'vitest.integration.config.ts',
    'sources/app/iroh/homeIrohEndpoint.real.integration.test.ts',
  ]);
  assert.equal(plan.test.cwd, 'C:\\repo\\apps\\server');
  assert.equal(plan.test.env.HAPPIER_IROH_REQUIRE_NODE_ADDON, '1');
  assert.equal(
    plan.test.env.HAPPIER_TEST_IROH_NODE_ADDON_PATH,
    'C:\\repo\\packages\\iroh-native\\native\\happier-iroh-native-lifecycle-test.win32-x64.node',
  );
});

test('runs the canonical build before the server test and supplies the selected addon environment', () => {
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

  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0].args, ['-s', 'build:native:test-relay']);
  assert.match(calls[1].args.join(' '), /homeIrohEndpoint\.real\.integration\.test\.ts/u);
  assert.equal(calls[1].options.env.EXISTING_VALUE, 'preserved');
  assert.equal(calls[1].options.env.HAPPIER_IROH_REQUIRE_NODE_ADDON, '1');
  assert.equal(copied.length, 1);
  assert.match(copied[0].source, /native[/\\]happier-iroh-native-lifecycle-test\.[^.]+-[^.]+\.node$/u);
  assert.equal(copied[0].destination, '/tmp/happier-iroh-home-test-stable/addon.node');
  assert.equal(calls[1].options.env.HAPPIER_TEST_IROH_NODE_ADDON_PATH, copied[0].destination);
  assert.deepEqual(removed, ['/tmp/happier-iroh-home-test-stable']);
});
