import assert from 'node:assert/strict';
import test from 'node:test';

import {
  resolveTypeScriptCliInvocation,
  shouldRouteTypeScriptCliThroughHstack,
} from './resolveTypeScriptCliInvocation.mjs';

test('routes direct no-emit compilation through hstack but executes an admitted payload directly', () => {
  assert.equal(shouldRouteTypeScriptCliThroughHstack({
    args: ['--noEmit', '-p', 'tsconfig.json'],
    env: {},
  }), true);
  assert.equal(shouldRouteTypeScriptCliThroughHstack({
    args: ['--noEmit'],
    env: { HAPPIER_DEV_TARGET_EXECUTION: '1' },
  }), false);
  assert.equal(shouldRouteTypeScriptCliThroughHstack({
    args: ['--noEmit'],
    env: { HAPPIER_HSTACK_EXECUTION: '1' },
  }), false);
  assert.equal(shouldRouteTypeScriptCliThroughHstack({
    args: ['-p', 'tsconfig.json', '--outDir', 'dist'],
    env: {},
  }), false);
});

test('resolves the native TypeScript CLI from its exported package manifest', () => {
  const resolutions = [];
  const invocation = resolveTypeScriptCliInvocation({
    processExecPath: '/managed/node',
    requireResolve(specifier) {
      resolutions.push(specifier);
      return '/repo/node_modules/@typescript/native/package.json';
    },
    readFileSyncImpl(path, encoding) {
      assert.equal(path, '/repo/node_modules/@typescript/native/package.json');
      assert.equal(encoding, 'utf8');
      return JSON.stringify({ bin: { tsc: './bin/tsc' } });
    },
  });

  assert.deepEqual(resolutions, ['@typescript/native/package.json']);
  assert.deepEqual(invocation, {
    command: '/managed/node',
    argsPrefix: ['/repo/node_modules/@typescript/native/bin/tsc'],
  });
});

test('fails closed when the native package does not declare a tsc entrypoint', () => {
  assert.throws(
    () => resolveTypeScriptCliInvocation({
      requireResolve: () => '/repo/node_modules/@typescript/native/package.json',
      readFileSyncImpl: () => JSON.stringify({ bin: {} }),
    }),
    /does not declare a tsc binary/i,
  );
});
