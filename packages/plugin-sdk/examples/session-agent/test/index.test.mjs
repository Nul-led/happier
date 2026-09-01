import assert from 'node:assert/strict';
import test from 'node:test';

test('declares one custom Session Agent with its import-safe runner leaf', async () => {
  const compiledEntry = new URL('../dist/index.js', import.meta.url);
  const module = await import(compiledEntry.href);
  assert.equal(module.manifest.contributes.agents.length, 1);
  const [agent] = module.manifest.contributes.agents;
  assert.equal(agent.runtime.kind, 'custom');
  assert.equal(agent.primary, 'sessions');
  assert.deepEqual(agent.capabilities.sessions.open, ['create', 'resume']);
  assert.equal(agent.sessionRunnerFactory.export, 'createDeterministicSessionAgentRuntime');
  assert.equal(agent.sessionRunnerFactory.runtimeApiVersion, 1);
});
