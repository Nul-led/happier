// Composed contract spike: only the external app-server transport is a fixture.
import { clientState, createRuntime, buildConnectedCodexCredential } from './runtime.test-support.js';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { createExecutionRunHostBackendFromSessionRuntime, type AgentExecutionRunEvent } from '../../../../../../plugin-sdk/src/agentRuntime/executionRun.ts';
import { createCodexNativeAppServerSessionRuntime } from './native.js';
import { waitForCodexAppServerRuntimeTurnCompletion } from './runtime.js';
import { createAgentSessionTurnInvariant } from '../../../../../../../apps/cli/src/agent/runtime/session/turn/agentSessionTurnInvariant.ts';

async function waitForRequest(method: string, count: number) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (clientState.requests.filter(request => request.method === method).length >= count) return;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error(`Missing request ${method}`);
}
function terminal(id: string, status: string, error?: Record<string, unknown>) {
  const handler = clientState.handlers.get('turn/completed');
  if (!handler) throw new Error('Missing terminal handler');
  void handler({ threadId: 'thread-1', turn: { id, status, ...(error ? { error } : {}) } });
}
const request = {
  serviceId: 'openai-codex', reason: 'soft_threshold' as const,
  authGeneration: { credential: buildConnectedCodexCredential('backup'), forcedWorkspaceId: 'acct_target',
    selection: { kind: 'profile', serviceId: 'openai-codex', profileId: 'backup' } },
};
describe('owned auth handoff through canonical consumers', () => {
  beforeEach(() => clientState.reset());
  it.each(['success', 'user_abort', 'auth_failure', 'interrupt_failure_late_interrupted'] as const)('settles the canonical execution run only at the logical handoff outcome: %s', async outcome => {
    const codexHome = await mkdtemp(join(tmpdir(), 'happier-codex-auth-run-contract-'));
    await mkdir(codexHome, { recursive: true });
    const appServer = createRuntime({ processEnv: { CODEX_HOME: codexHome, ...(outcome === 'interrupt_failure_late_interrupted' ? { HAPPIER_CODEX_APP_SERVER_RPC_TIMEOUT_MS: '250' } : {}) } });
    const native = createCodexNativeAppServerSessionRuntime(appServer, 'session-1');
    const invariant = createAgentSessionTurnInvariant({ sessionId: 'session-1' });
    const rejected: unknown[] = [];
    const nativeTerminals: string[] = [];
    native.watch(event => {
      if (event.kind === 'turn-complete' || event.kind === 'turn-failed' || event.kind === 'turn-cancelled') nativeTerminals.push(event.kind);
      const result = invariant.observe(event);
      if (result.status === 'rejected') rejected.push(result.diagnostic);
    });
    const execution = await createExecutionRunHostBackendFromSessionRuntime({
      sessionId: 'session-1',
      request: { kind: 'create', runId: 'run-1', cwd: '/repo', profile: { pluginId: 'happier.agent.codex', localId: 'default' }, input: { text: 'owned work' } },
      openSession: async () => native,
    });
    const events: AgentExecutionRunEvent[] = [];
    execution.watch(event => events.push(event));
    const completion = waitForCodexAppServerRuntimeTurnCompletion(appServer);
    void completion.catch(() => undefined);
    if (outcome === 'interrupt_failure_late_interrupted') {
      clientState.rejectNextInterruptWith(new Error('synthetic interrupt failure'));
    } else {
      clientState.deferNextLoginStart();
    }
    const apply = native.runtimeAuth!.apply(request);
    void apply.catch(() => undefined);
    try {
      await waitForRequest('turn/interrupt', 1);
      if (outcome === 'interrupt_failure_late_interrupted') {
        await expect(apply).rejects.toThrow('synthetic interrupt failure');
        terminal('turn-1', 'interrupted');
        await expect(completion).rejects.toThrow('auth handoff failed');
        expect(nativeTerminals).toEqual(['turn-failed']);
        expect(events.filter(event => event.kind === 'run-failed' || event.kind === 'run-cancelled' || event.kind === 'run-complete').map(event => event.kind)).toEqual(['run-failed']);
        expect(rejected).toEqual([]);
        return;
      }
      terminal('turn-1', 'interrupted');
      await new Promise(resolve => setTimeout(resolve, 20));
      expect(events.filter(event => event.kind === 'run-cancelled' || event.kind === 'run-failed' || event.kind === 'run-complete')).toEqual([]);
      await waitForRequest('account/login/start', 1);
      // The actual execution-run admission owner keeps later input outside the held handoff.
      await expect(execution.send({ text: 'later queued work' })).resolves.toMatchObject({ status: 'unavailable' });
      expect(clientState.requests.filter(entry => entry.method === 'turn/start')).toHaveLength(1);
      if (outcome === 'user_abort') {
        await execution.stop();
        await new Promise(resolve => setTimeout(resolve, 10));
        expect(events.filter(event => event.kind === 'run-cancelled')).toHaveLength(1);
        // User cancellation must settle while the unrelated auth reply is still held.
        await completion;
        clientState.resolveDeferredLoginStart();
        await apply;
      } else if (outcome === 'auth_failure') {
        clientState.rejectDeferredLoginStart(new Error('synthetic auth failure'));
        await expect(apply).resolves.toMatchObject({ ok: false });
        await expect(completion).rejects.toThrow('auth handoff failed');
        expect(events.filter(event => event.kind === 'run-failed')).toHaveLength(1);
      } else {
        clientState.resolveDeferredLoginStart();
        await expect(apply).resolves.toMatchObject({ ok: true });
        await waitForRequest('turn/start', 2);
        terminal('turn-2', 'completed');
        await completion;
        expect(events.filter(event => event.kind === 'run-complete')).toHaveLength(1);
      }
      expect(events.filter(event => event.kind === 'run-cancelled' || event.kind === 'run-failed' || event.kind === 'run-complete')).toHaveLength(1);
      expect(rejected).toEqual([]);
    } finally {
      // A terminal consumer may dispose before login is even admitted.
      try { clientState.resolveDeferredLoginStart(); } catch {}
      await execution.dispose();
      await rm(codexHome, { recursive: true, force: true });
    }
  });
  it.each(['natural_complete_auth_failure', 'deferred_terminal_failure', 'continuation_start_failure', 'native_exit'] as const)('finalizes the actual logical owner at the provider boundary: %s', async outcome => {
    const codexHome = await mkdtemp(join(tmpdir(), 'happier-codex-auth-boundary-'));
    const appServer = createRuntime({ processEnv: { CODEX_HOME: codexHome } });
    const native = createCodexNativeAppServerSessionRuntime(appServer, 'session-1');
    const invariant = createAgentSessionTurnInvariant({ sessionId: 'session-1' });
    const rejected: unknown[] = [];
    const events: Array<{ kind: string }> = [];
    native.watch(event => { events.push(event); const result = invariant.observe(event); if (result.status === 'rejected') rejected.push(result.diagnostic); });
    let apply: Promise<unknown> | undefined;
    try {
      await native.send({ inputIds: ['accepted-1'], input: { text: 'owned work' }, delivery: { kind: 'newTurn', turnId: 'host-work' } });
      const completion = waitForCodexAppServerRuntimeTurnCompletion(appServer);
      let completionOutcome = 'pending';
      void completion.then(() => { completionOutcome = 'completed'; }, () => { completionOutcome = 'failed'; });
      clientState.deferNextLoginStart();
      apply = native.runtimeAuth!.apply(request);
      void apply.catch(() => undefined);
      await waitForRequest('turn/interrupt', 1);
      if (outcome === 'deferred_terminal_failure') {
        terminal('turn-1', 'failed', { message: 'Selected model is at capacity. Please try a different model.', codex_error_info: 'other' });
      } else {
        terminal('turn-1', outcome === 'natural_complete_auth_failure' ? 'completed' : 'interrupted');
      }
      await waitForRequest('account/login/start', 1);
      if (outcome === 'natural_complete_auth_failure') {
        await new Promise(resolve => setTimeout(resolve, 30));
        expect(completionOutcome).toBe('completed');
        clientState.rejectDeferredLoginStart(new Error('synthetic auth failure'));
        await expect(apply).resolves.toMatchObject({ ok: false });
        await expect(completion).resolves.toBeUndefined();
        expect(events.filter(event => event.kind === 'turn-complete')).toHaveLength(1);
        expect(events.filter(event => event.kind === 'turn-failed')).toHaveLength(0);
      } else {
        if (outcome === 'native_exit') {
          clientState.emitExit({ exitCode: 1, signal: null, stdout: '', stderr: '' });
        } else if (outcome === 'continuation_start_failure') {
          clientState.rejectNextTurnStart(new Error('synthetic continuation startup failure'));
          clientState.resolveDeferredLoginStart();
          await apply;
          await waitForRequest('turn/start', 2);
        }
        await new Promise(resolve => setTimeout(resolve, 30));
        expect(events.filter(event => event.kind === 'turn-failed')).toHaveLength(1);
        await expect(completion).rejects.toThrow();
        expect(events.filter(event => event.kind === 'turn-start')).toHaveLength(1);
        expect(events.filter(event => event.kind === 'turn-complete' || event.kind === 'turn-cancelled')).toHaveLength(0);
      }
      expect(rejected).toEqual([]);
    } finally {
      try { clientState.resolveDeferredLoginStart(); } catch {}
      await apply?.catch(() => undefined);
      await native.dispose();
      await rm(codexHome, { recursive: true, force: true });
    }
  });
  it.each(['acknowledged_capacity', 'startup_capacity', 'retry_exhausted'] as const)('preserves bounded temporary recovery of the continued native attempt: %s', async outcome => {
    const codexHome = await mkdtemp(join(tmpdir(), 'happier-codex-auth-retry-'));
    const appServer = createRuntime({ processEnv: { CODEX_HOME: codexHome } });
    const native = createCodexNativeAppServerSessionRuntime(appServer, 'session-1');
    const invariant = createAgentSessionTurnInvariant({ sessionId: 'session-1' });
    const rejected: unknown[] = [];
    const events: Array<{ kind: string }> = [];
    native.watch(event => { events.push(event); const result = invariant.observe(event); if (result.status === 'rejected') rejected.push(result.diagnostic); });
    try {
      await native.send({ inputIds: ['accepted-1'], input: { text: 'owned work' }, delivery: { kind: 'newTurn', turnId: 'host-work' } });
      const completion = waitForCodexAppServerRuntimeTurnCompletion(appServer);
      void completion.catch(() => undefined);
      clientState.deferNextLoginStart();
      const apply = native.runtimeAuth!.apply(request);
      await waitForRequest('turn/interrupt', 1);
      terminal('turn-1', 'interrupted');
      await waitForRequest('account/login/start', 1);
      if (outcome === 'startup_capacity') clientState.rejectNextTurnStart(new Error('Selected model is at capacity. Please try a different model.'));
      clientState.resolveDeferredLoginStart();
      await apply;
      await waitForRequest('turn/start', 2);
      if (outcome !== 'startup_capacity') {
        await new Promise(resolve => setTimeout(resolve, 10));
        terminal('turn-2', 'failed', { message: 'Selected model is at capacity. Please try a different model.', codex_error_info: 'other' });
      }
      await waitForRequest('turn/start', 3);
      await new Promise(resolve => setTimeout(resolve, 10));
      const starts = clientState.requests.filter(entry => entry.method === 'turn/start');
      expect(starts[2].params).toMatchObject({ input: starts[1].params.input });
      expect(starts[2].params).not.toHaveProperty('clientUserMessageId');
      expect(events.filter(event => event.kind === 'turn-start')).toHaveLength(1);
      expect(events.filter(event => event.kind === 'turn-failed' || event.kind === 'turn-cancelled' || event.kind === 'turn-complete')).toHaveLength(0);
      // A rejected start never creates a provider ID in the fixture.
      const retriedId = outcome === 'startup_capacity' ? 'turn-2' : 'turn-3';
      terminal(retriedId, outcome === 'retry_exhausted' ? 'failed' : 'completed', outcome === 'retry_exhausted' ? { message: 'Selected model is at capacity. Please try a different model.', codex_error_info: 'other' } : undefined);
      if (outcome === 'retry_exhausted') {
        await expect(completion).rejects.toThrow();
        expect(events.filter(event => event.kind === 'turn-failed')).toHaveLength(1);
      } else {
        await expect(completion).resolves.toBeUndefined();
        expect(events.filter(event => event.kind === 'turn-complete')).toHaveLength(1);
      }
      expect(clientState.requests.filter(entry => entry.method === 'turn/start')).toHaveLength(3);
      expect(rejected).toEqual([]);
    } finally {
      try { clientState.resolveDeferredLoginStart(); } catch {}
      await native.dispose();
      await rm(codexHome, { recursive: true, force: true });
    }
  });
  it('delivers the same owned work continuation through the canonical host invariant', async () => {
    const codexHome = await mkdtemp(join(tmpdir(), 'happier-codex-auth-invariant-contract-'));
    const appServer = createRuntime({ processEnv: { CODEX_HOME: codexHome } });
    const native = createCodexNativeAppServerSessionRuntime(appServer, 'session-1');
    const invariant = createAgentSessionTurnInvariant({ sessionId: 'session-1' });
    const rejected: unknown[] = [];
    native.watch(event => { const result = invariant.observe(event); if (result.status === 'rejected') rejected.push(result.diagnostic); });
    try {
      await native.send({ inputIds: ['accepted-1'], input: { text: 'owned work' }, delivery: { kind: 'newTurn', turnId: 'host-work' } });
      const apply = native.runtimeAuth!.apply(request);
      await waitForRequest('turn/interrupt', 1);
      terminal('turn-1', 'interrupted');
      await apply;
      await waitForRequest('turn/start', 2);
      terminal('turn-2', 'completed');
      await waitForCodexAppServerRuntimeTurnCompletion(appServer);
      expect(rejected).toEqual([]);
    } finally {
      await native.dispose();
      await rm(codexHome, { recursive: true, force: true });
    }
  });
});
