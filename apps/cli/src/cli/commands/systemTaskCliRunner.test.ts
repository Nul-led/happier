import { describe, expect, it, vi } from 'vitest';

import { SYSTEM_TASK_PROTOCOL_VERSION, type SystemTaskResult } from '@happier-dev/protocol';

import { runSystemTaskToCompletion } from './systemTaskCliRunner';

describe('runSystemTaskToCompletion', () => {
  it('starts once and advances the shared event cursor until completion', async () => {
    const result: SystemTaskResult = {
      protocolVersion: SYSTEM_TASK_PROTOCOL_VERSION,
      taskId: 'task-1',
      ok: true,
      data: { complete: true },
    };
    const start = vi.fn(async () => ({ taskId: 'task-1' }));
    const poll = vi.fn()
      .mockResolvedValueOnce({
        events: [{
          protocolVersion: SYSTEM_TASK_PROTOCOL_VERSION,
          taskId: 'task-1',
          tsMs: 1,
          type: 'progress',
          stepId: 'one',
        }],
        nextCursor: 1,
        result: null,
        pendingPrompt: null,
      })
      .mockResolvedValueOnce({ events: [], nextCursor: 1, result, pendingPrompt: null });
    const onEvent = vi.fn();

    await expect(runSystemTaskToCompletion({
      runner: { start, poll, respond: vi.fn() },
      spec: { protocolVersion: SYSTEM_TASK_PROTOCOL_VERSION, kind: 'test.kind.v1', params: {} },
      onEvent,
      sleep: async () => undefined,
    })).resolves.toBe(result);

    expect(start).toHaveBeenCalledOnce();
    expect(poll).toHaveBeenNthCalledWith(1, { taskId: 'task-1', cursor: 0 });
    expect(poll).toHaveBeenNthCalledWith(2, { taskId: 'task-1', cursor: 1 });
    expect(onEvent).toHaveBeenCalledOnce();
  });

  it('stops polling an active task when the caller signal aborts', async () => {
    const controller = new AbortController();
    const poll = vi.fn(async () => {
      controller.abort();
      return { events: [], nextCursor: 0, result: null, pendingPrompt: null };
    });

    await expect(runSystemTaskToCompletion({
      runner: { start: async () => ({ taskId: 'task-1' }), poll, respond: vi.fn() },
      spec: { protocolVersion: SYSTEM_TASK_PROTOCOL_VERSION, kind: 'test.kind.v1', params: {} },
      signal: controller.signal,
      sleep: async () => undefined,
    })).rejects.toMatchObject({ code: 'cancelled' });
    expect(poll).toHaveBeenCalledOnce();
  });
});
