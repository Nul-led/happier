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
      runner: { start, poll, respond: vi.fn(), cancel: vi.fn() },
      spec: { protocolVersion: SYSTEM_TASK_PROTOCOL_VERSION, kind: 'test.kind.v1', params: {} },
      onEvent,
      sleep: async () => undefined,
    })).resolves.toBe(result);

    expect(start).toHaveBeenCalledOnce();
    expect(poll).toHaveBeenNthCalledWith(1, { taskId: 'task-1', cursor: 0 });
    expect(poll).toHaveBeenNthCalledWith(2, { taskId: 'task-1', cursor: 1 });
    expect(onEvent).toHaveBeenCalledOnce();
  });

  it('cancels an active task and keeps polling until its terminal cancelled result', async () => {
    const controller = new AbortController();
    const terminal: SystemTaskResult = {
      protocolVersion: SYSTEM_TASK_PROTOCOL_VERSION,
      taskId: 'task-1',
      ok: false,
      error: { code: 'cancelled', message: 'cancelled by task' },
    };
    const poll = vi.fn()
      .mockImplementationOnce(async () => {
        controller.abort();
        return { events: [], nextCursor: 0, result: null, pendingPrompt: null };
      })
      .mockResolvedValueOnce({ events: [], nextCursor: 0, result: terminal, pendingPrompt: null });
    const cancel = vi.fn(async () => undefined);

    await expect(runSystemTaskToCompletion({
      runner: { start: async () => ({ taskId: 'task-1' }), poll, respond: vi.fn(), cancel },
      spec: { protocolVersion: SYSTEM_TASK_PROTOCOL_VERSION, kind: 'test.kind.v1', params: {} },
      signal: controller.signal,
      sleep: async () => undefined,
    })).resolves.toBe(terminal);
    expect(cancel).toHaveBeenCalledOnce();
    expect(cancel).toHaveBeenCalledWith({ taskId: 'task-1' });
    expect(poll).toHaveBeenCalledTimes(2);
  });

  it('keeps polling after an active prompt is aborted so cancellation can release task ownership', async () => {
    const controller = new AbortController();
    const terminal: SystemTaskResult = {
      protocolVersion: SYSTEM_TASK_PROTOCOL_VERSION,
      taskId: 'task-1',
      ok: false,
      error: { code: 'cancelled', message: 'cancelled by task' },
    };
    const prompt = { kind: 'test.confirm.v1', data: {} };
    const poll = vi.fn()
      .mockResolvedValueOnce({ events: [], nextCursor: 0, result: null, pendingPrompt: prompt })
      .mockResolvedValueOnce({ events: [], nextCursor: 0, result: terminal, pendingPrompt: null });
    const cancel = vi.fn(async () => undefined);
    const respond = vi.fn();
    const onPrompt = vi.fn(async () => {
      controller.abort();
      controller.signal.throwIfAborted();
      return { confirmed: true };
    });

    await expect(runSystemTaskToCompletion({
      runner: { start: async () => ({ taskId: 'task-1' }), poll, respond, cancel },
      spec: { protocolVersion: SYSTEM_TASK_PROTOCOL_VERSION, kind: 'test.kind.v1', params: {} },
      signal: controller.signal,
      onPrompt,
      sleep: async () => undefined,
    })).resolves.toBe(terminal);
    expect(cancel).toHaveBeenCalledOnce();
    expect(poll).toHaveBeenCalledTimes(2);
    expect(respond).not.toHaveBeenCalled();
  });

  it('keeps prompt custody after cancellation when the task has crossed its irreversible boundary', async () => {
    const controller = new AbortController();
    const terminal: SystemTaskResult = {
      protocolVersion: SYSTEM_TASK_PROTOCOL_VERSION,
      taskId: 'task-1',
      ok: true,
      data: { status: 'committed' },
    };
    const prompt = { kind: 'personal_home.read_relocation_descriptor.v1', data: {} };
    const poll = vi.fn()
      .mockImplementationOnce(async () => {
        controller.abort();
        return { events: [], nextCursor: 0, result: null, pendingPrompt: null };
      })
      .mockResolvedValueOnce({ events: [], nextCursor: 0, result: null, pendingPrompt: prompt })
      .mockResolvedValueOnce({ events: [], nextCursor: 0, result: terminal, pendingPrompt: null });
    const cancel = vi.fn(async () => undefined);
    const respond = vi.fn(async () => undefined);
    const onPrompt = vi.fn(async () => ({ descriptor: null }));

    await expect(runSystemTaskToCompletion({
      runner: { start: async () => ({ taskId: 'task-1' }), poll, respond, cancel },
      spec: { protocolVersion: SYSTEM_TASK_PROTOCOL_VERSION, kind: 'test.kind.v1', params: {} },
      signal: controller.signal,
      onPrompt,
      sleep: async () => undefined,
    })).resolves.toBe(terminal);
    expect(cancel).toHaveBeenCalledOnce();
    expect(onPrompt).toHaveBeenCalledWith(prompt, '');
    expect(respond).toHaveBeenCalledWith({ taskId: 'task-1', answer: { descriptor: null } });
  });

  it('does not revive a historical prompt after cancellation has produced a terminal result', async () => {
    const terminal: SystemTaskResult = {
      protocolVersion: SYSTEM_TASK_PROTOCOL_VERSION,
      taskId: 'task-1',
      ok: false,
      error: { code: 'cancelled', message: 'cancelled by task' },
    };
    const onPrompt = vi.fn();
    const respond = vi.fn();

    await expect(runSystemTaskToCompletion({
      runner: {
        start: async () => ({ taskId: 'task-1' }),
        poll: async () => ({
          events: [{
            protocolVersion: SYSTEM_TASK_PROTOCOL_VERSION,
            taskId: 'task-1',
            tsMs: 1,
            type: 'prompt',
            stepId: 'confirmation',
            data: { kind: 'test.confirm.v1' },
          }],
          nextCursor: 1,
          result: terminal,
          pendingPrompt: null,
        }),
        respond,
      },
      spec: { protocolVersion: SYSTEM_TASK_PROTOCOL_VERSION, kind: 'test.kind.v1', params: {} },
      onPrompt,
    })).resolves.toBe(terminal);
    expect(onPrompt).not.toHaveBeenCalled();
    expect(respond).not.toHaveBeenCalled();
  });
});
