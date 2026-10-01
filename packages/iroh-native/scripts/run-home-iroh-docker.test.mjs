import assert from 'node:assert/strict';
import test from 'node:test';

import {
  parsePublishedRelayPort,
  runHomeIrohDockerIntegration,
} from './run-home-iroh-docker.mjs';

test('accepts only one loopback-published stock relay port', () => {
  assert.equal(parsePublishedRelayPort('127.0.0.1:49123\n'), 49123);
  for (const value of ['0.0.0.0:49123', '127.0.0.1:0', '127.0.0.1:65536', '']) {
    assert.throws(() => parsePublishedRelayPort(value), /loopback TCP port/u);
  }
});

test('runs the existing source journey against the Docker relay and cleans only its own resources', async () => {
  const calls = [];
  const integrations = [];
  await runHomeIrohDockerIntegration({
    runId: 'c0ffee00-0000-0000-0000-000000000000',
    env: { EXISTING: 'kept' },
    runDocker: (args) => {
      calls.push(args);
      if (args[0] === 'port') return '127.0.0.1:49123';
      return '';
    },
    awaitRelay: async (port) => assert.equal(port, 49123),
    runIntegration: (input) => integrations.push(input),
  });
  assert.equal(calls[0][0], 'build');
  assert.deepEqual(calls[1].slice(0, 4), ['run', '-d', '--name', 'happier-iroh-relay-e2e-c0ffee00000000000000']);
  assert.deepEqual(calls.at(-2), ['rm', '-f', 'happier-iroh-relay-e2e-c0ffee00000000000000']);
  assert.deepEqual(calls.at(-1), ['image', 'rm', 'happier-iroh-relay-e2e:c0ffee00000000000000']);
  assert.deepEqual(integrations, [{
    dockerOnly: true,
    env: { EXISTING: 'kept', HAPPIER_TEST_IROH_EXTERNAL_RELAY_URL: 'http://127.0.0.1:49123' },
  }]);
});

test('preserves a failed journey and removes its exact container and image', async () => {
  const calls = [];
  await assert.rejects(runHomeIrohDockerIntegration({
    runId: 'deadbeef-0000-0000-0000-000000000000',
    runDocker: (args) => {
      calls.push(args);
      if (args[0] === 'port') return '127.0.0.1:49123';
      return '';
    },
    awaitRelay: async () => {},
    runIntegration: () => { throw new Error('transfer bytes differ'); },
  }), /transfer bytes differ/u);
  assert.deepEqual(calls.at(-2), ['rm', '-f', 'happier-iroh-relay-e2e-deadbeef000000000000']);
  assert.deepEqual(calls.at(-1), ['image', 'rm', 'happier-iroh-relay-e2e:deadbeef000000000000']);
});
