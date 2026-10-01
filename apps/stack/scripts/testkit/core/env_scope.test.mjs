import test from 'node:test';
import assert from 'node:assert/strict';

import { buildStackFixtureEnv, withPatchedProcessEnv } from './env_scope.mjs';

test('buildStackFixtureEnv preserves the runner-owned canonical home while stripping live Stack scope', () => {
  const env = buildStackFixtureEnv({
    baseEnv: {
      HOME: '/Users/example',
      HAPPIER_STACK_TEST_ISOLATED_ROOT: '/tmp/happier-stack-unit-abc',
      HAPPIER_STACK_CANONICAL_HOME_DIR: '/live/canonical-home',
      HAPPIER_STACK_STORAGE_DIR: '/live/stacks',
      HAPPIER_STACK_STACK: 'live',
    },
    storageDir: '/tmp/fixture/stacks',
    stackName: 'fixture',
    stripStackEnv: true,
  });

  assert.equal(env.HAPPIER_STACK_TEST_ISOLATED_ROOT, undefined);
  assert.equal(env.HAPPIER_STACK_CANONICAL_HOME_DIR, '/tmp/happier-stack-unit-abc/canonical-home');
  assert.equal(env.HAPPIER_STACK_STORAGE_DIR, '/tmp/fixture/stacks');
  assert.equal(env.HAPPIER_STACK_STACK, 'fixture');
});

test('withPatchedProcessEnv maps PATH overrides to Path on Windows', (t) => {
  const descriptor = Object.getOwnPropertyDescriptor(process, 'platform');
  assert.ok(descriptor);
  Object.defineProperty(process, 'platform', { ...descriptor, value: 'win32' });
  t.after(() => {
    Object.defineProperty(process, 'platform', descriptor);
  });

  const previousPath = process.env.Path;
  const restore = withPatchedProcessEnv(null, { PATH: 'C:\\Tools\\bin' });
  t.after(restore);

  assert.equal(process.env.Path, 'C:\\Tools\\bin');

  restore();
  assert.equal(process.env.Path, previousPath);
});
