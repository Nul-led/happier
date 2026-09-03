import assert from 'node:assert/strict';
import test from 'node:test';

import { createPluginTestkit } from '@happier-dev/plugin-sdk/testing';

test('declares one custom Session Agent with an import-safe runner leaf', async () => {
  const compiledEntry = new URL('../dist/index.js', import.meta.url);
  const module = await import(compiledEntry.href);
  assert.equal(module.manifest.contributes.agents.length, 1);
  const [agent] = module.manifest.contributes.agents;
  assert.equal(agent.runtime.kind, 'custom');
  assert.equal(agent.primary, 'sessions');
  assert.deepEqual(agent.capabilities.sessions.open, ['create', 'resume']);
  // `sessionRunnerFactory` is an activation-time registration fact, not a
  // cold manifest declaration: the cold manifest must not pretend it exists.
  assert.equal(agent.sessionRunnerFactory, undefined);
});

test('registers the Session runner leaf through the activation registration boundary', async () => {
  const compiledEntry = new URL('../dist/index.js', import.meta.url);
  const module = await import(compiledEntry.href);
  const testkit = await createPluginTestkit({ manifest: module.manifest, module });
  try {
    const registration = testkit.registration('agents', 'session-agent');
    assert.equal(typeof registration?.factory, 'function');
    assert.deepEqual(registration.sessionRunnerFactory, {
      module: './agent/deterministicSessionAgent.js',
      export: 'createDeterministicSessionAgentRuntime',
      runtimeApiVersion: 1,
    });
  } finally {
    await testkit.dispose();
  }
});
