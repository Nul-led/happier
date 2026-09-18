import { describe, expect, it, vi } from 'vitest';

import { createActionOperationRunner } from './actionOperationRunner';
import { createActionOperationStore } from './actionOperationStore';

const scope = { accountId: 'account-1', machineId: 'machine-1' } as const;

describe('action operation canonical execution observer', () => {
  it('publishes every revision while returning the canonical result unchanged exactly once', async () => {
    const published: unknown[] = [];
    const store = createActionOperationStore({ onSnapshot: (snapshot) => published.push(snapshot) });
    const execute = vi.fn(async ({ updateProgress }: { updateProgress: (value: { phase: string; label: string }) => void }) => {
      updateProgress({ phase: 'working', label: 'Working' });
      return { ok: true as const, result: { childSessionId: 'child-1' } };
    });
    const runner = createActionOperationRunner({
      store,
      resolveAction: (actionId) => ({
        actionId,
        title: 'Fork session',
        operation: {
          version: 1,
          visibility: 'activity',
          progress: 'reported',
          presentation: { onStart: 'current' },
        },
      }),
      generateOperationId: () => 'operation-1',
    });

    const result = await runner.observe({
      actionId: 'session.fork',
      requestId: 'request-1',
      scope,
      execute,
    });

    expect(result).toEqual({ ok: true, result: { childSessionId: 'child-1' } });
    expect(execute).toHaveBeenCalledTimes(1);
    expect(published).toMatchObject([
      { revision: 1, state: 'accepted', requestId: 'request-1' },
      { revision: 2, state: 'running' },
      { revision: 3, state: 'running', progress: { kind: 'phase', phase: 'working' } },
      { revision: 4, state: 'succeeded' },
    ]);
  });

  it('does not observe an Action without a tracked declaration', async () => {
    const store = createActionOperationStore();
    const runner = createActionOperationRunner({
      store,
      resolveAction: (actionId) => ({ actionId, title: actionId }),
    });
    const execute = vi.fn(async () => ({ ok: true as const, result: 'historical' }));
    await expect(runner.observe({ actionId: 'memory.search', scope, execute }))
      .resolves.toEqual({ ok: true, result: 'historical' });
    expect(store.list(scope).items).toEqual([]);
  });

  it('returns the terminal result for an exact replay without invoking the Action again', async () => {
    const published: Array<{ operationId: string }> = [];
    const store = createActionOperationStore({ onSnapshot: (snapshot) => published.push(snapshot) });
    const runner = createActionOperationRunner({
      store,
      resolveAction: (actionId) => ({
        actionId, title: 'Spawn',
        operation: {
          version: 1, visibility: 'activity', progress: 'indeterminate',
          presentation: { onStart: 'current' },
        },
      }),
      generateOperationId: vi.fn(() => 'operation-1'),
    });
    const execute = vi.fn(async () => ({ ok: true as const, result: { type: 'success' } }));

    await runner.observe({ actionId: 'session.spawn_new', requestId: 'creation-1', input: { target: 'machine-1' }, scope, execute });
    await expect(runner.observe({
      actionId: 'session.spawn_new', requestId: 'creation-1', input: { target: 'machine-1' }, scope, execute,
    })).resolves.toEqual({ ok: true, result: { type: 'success' } });

    expect(execute).toHaveBeenCalledTimes(1);
    expect(store.list(scope).items).toHaveLength(1);
    expect(new Set(published.map((snapshot) => snapshot.operationId))).toEqual(new Set(['operation-1']));
  });

  it('joins an in-flight exact replay and rejects the same request identity with different input', async () => {
    const store = createActionOperationStore();
    const runner = createActionOperationRunner({
      store,
      resolveAction: (actionId) => ({
        actionId, title: 'Handoff',
        operation: {
          version: 1, visibility: 'activity', progress: 'reported',
          presentation: { onStart: 'current' },
        },
      }),
      generateOperationId: () => 'operation-1',
    });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const execute = vi.fn(async () => {
      await gate;
      return { ok: true as const, result: { workspace: { kind: 'none' } } };
    });

    const first = runner.observe({
      actionId: 'session.handoff', requestId: 'request-1', input: { targetMachineId: 'machine-2' }, scope, execute,
    });
    const joined = runner.observe({
      actionId: 'session.handoff', requestId: 'request-1', input: { targetMachineId: 'machine-2' }, scope, execute,
    });
    await expect(runner.observe({
      actionId: 'session.handoff', requestId: 'request-1', input: { targetMachineId: 'machine-3' }, scope, execute,
    })).resolves.toEqual({
      ok: false,
      errorCode: 'action_request_input_conflict',
      error: 'action_request_input_conflict',
    });

    expect(execute).toHaveBeenCalledTimes(1);
    release();
    await expect(Promise.all([first, joined])).resolves.toEqual([
      { ok: true, result: { workspace: { kind: 'none' } } },
      { ok: true, result: { workspace: { kind: 'none' } } },
    ]);
  });

  it('keeps an indeterminate handoff recoverable and re-enters the same operation identity', async () => {
    const store = createActionOperationStore();
    const generateOperationId = vi.fn(() => 'operation-1');
    const runner = createActionOperationRunner({
      store,
      resolveAction: (actionId) => ({
        actionId, title: 'Handoff',
        operation: {
          version: 1, visibility: 'activity', progress: 'reported',
          presentation: { onStart: 'current' },
        },
      }),
      generateOperationId,
    });
    let retainedPublicationRequestId: string | null = null;
    let publicationEffectCount = 0;
    const execute = vi.fn(async (context: { actionRequestId?: string }) => {
      const actionRequestId = context.actionRequestId;
      if (!actionRequestId) throw new Error('missing canonical Action request identity');
      if (retainedPublicationRequestId === null) {
        retainedPublicationRequestId = actionRequestId;
        publicationEffectCount += 1;
        return { ok: false as const, errorCode: 'indeterminate', error: 'publication outcome unknown' };
      }
      expect(actionRequestId).toBe(retainedPublicationRequestId);
      return { ok: true as const, result: { workspace: { kind: 'copied', operationId: actionRequestId } } };
    });
    const request = {
      actionId: 'session.handoff',
      requestId: 'request-1',
      input: { targetMachineId: 'machine-2', workspaceAction: { kind: 'copy_once' } },
      scope,
      execute,
    } as const;

    await expect(runner.observe(request)).resolves.toMatchObject({ ok: false, errorCode: 'indeterminate' });
    expect(store.get(scope, 'operation-1')).toMatchObject({
      operationId: 'operation-1', requestId: 'request-1', state: 'running',
    });

    await expect(runner.observe(request)).resolves.toMatchObject({ ok: true });
    expect(generateOperationId).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledTimes(2);
    expect(publicationEffectCount).toBe(1);
    expect(execute.mock.calls.map(([context]) => context.actionRequestId)).toEqual(['request-1', 'request-1']);
    expect(store.get(scope, 'operation-1')).toMatchObject({ state: 'succeeded' });
  });

  it('does not fail canonical execution when snapshot publication throws', async () => {
    const store = createActionOperationStore({ onSnapshot: () => { throw new Error('socket unavailable'); } });
    const runner = createActionOperationRunner({
      store,
      resolveAction: (actionId) => ({
        actionId, title: 'Fork',
        operation: {
          version: 1, visibility: 'activity', progress: 'indeterminate',
          presentation: { onStart: 'current' },
        },
      }),
    });
    await expect(runner.observe({
      actionId: 'session.fork', scope,
      execute: async () => ({ ok: true, result: 'historical' }),
    })).resolves.toEqual({ ok: true, result: 'historical' });
  });

  it('preserves the strict handoff terminal result and keeps a later handoff failure visible', async () => {
    const store = createActionOperationStore();
    let operation = 0;
    const runner = createActionOperationRunner({
      store,
      resolveAction: (actionId) => ({
        actionId,
        title: 'Handoff session',
        operation: {
          version: 1,
          visibility: 'activity',
          progress: 'reported',
          presentation: { onStart: 'current' },
        },
      }),
      generateOperationId: () => `operation-${++operation}`,
    });
    const terminal = {
      ok: true as const,
      result: {
        handoffId: 'handoff-1',
        status: { handoffId: 'handoff-1', status: 'completed' as const, phase: 'finalizing' as const, recoveryActions: [] },
        workspace: { kind: 'relationship' as const, relationshipId: 'relationship-1', created: true },
        warning: { code: 'source_cleanup_failed', message: 'Source cleanup is still pending.' },
      },
    };

    await expect(runner.observe({
      actionId: 'session.handoff', requestId: 'handoff-request-1', scope,
      execute: async () => terminal,
    })).resolves.toEqual(terminal);
    await expect(runner.observe({
      actionId: 'session.handoff', requestId: 'handoff-request-2', scope,
      execute: async () => ({ ok: false, errorCode: 'target_unavailable', error: 'target_unavailable' }),
    })).resolves.toEqual({ ok: false, errorCode: 'target_unavailable', error: 'target_unavailable' });

    expect(store.get(scope, 'operation-1')).toMatchObject({
      requestId: 'handoff-request-1', state: 'succeeded', result: terminal.result,
    });
    expect(store.get(scope, 'operation-2')).toMatchObject({
      requestId: 'handoff-request-2', state: 'failed',
      error: { errorCode: 'target_unavailable', error: 'target_unavailable' },
    });
  });
});
