import { describe, expect, it, vi } from 'vitest';

import {
  ExecutionRunStartResponseSchema,
  ExecutionRunWaitResultSchema,
} from './responseSchemas.js';
import { waitForExecutionRunTerminal } from './waitForTerminal.js';

describe('waitForExecutionRunTerminal', () => {
  it('keeps public wait dispositions strict when composed into a start response', () => {
    expect(ExecutionRunStartResponseSchema.safeParse({
      runId: 'run_1',
      callId: 'call_1',
      sidechainId: 'call_1',
      wait: {
        ok: true,
        status: 'succeeded',
        result: { notTheCanonicalWaitResult: true },
      },
    }).success).toBe(false);
    expect(ExecutionRunWaitResultSchema.safeParse({
      ok: true,
      status: 'succeeded',
      result: { run: { runId: 'run_1', status: 'running' } },
    }).success).toBe(false);
  });

  it('observes the same run until its terminal result without controlling it', async () => {
    const readRun = vi.fn()
      .mockResolvedValueOnce({ ok: true as const, data: { run: { status: 'running' } } })
      .mockResolvedValueOnce({ ok: true as const, data: { run: { status: 'succeeded', result: { ok: true } } } });
    const waitForTerminal = vi.fn(async () => undefined);

    await expect(waitForExecutionRunTerminal({
      runId: 'run_1',
      timeoutMs: null,
      readRun,
      waitForTerminal,
    })).resolves.toEqual({
      ok: true,
      status: 'succeeded',
      result: { run: { status: 'succeeded', result: { ok: true } } },
    });

    expect(readRun).toHaveBeenNthCalledWith(1, { runId: 'run_1' });
    expect(readRun).toHaveBeenNthCalledWith(2, { runId: 'run_1' });
    expect(waitForTerminal).toHaveBeenCalledOnce();
    expect(waitForTerminal).toHaveBeenCalledWith('run_1', expect.any(AbortSignal));
  });

  it('uses an observation timer without polling while the terminal event is pending', async () => {
    vi.useFakeTimers();
    let now = 0;
    const readRun = vi.fn(async () => ({ ok: true as const, data: { run: { status: 'running' } } }));
    const waitForTerminal = vi.fn(async (_runId: string, _signal?: AbortSignal) => await new Promise<void>(() => {}));

    const wait = waitForExecutionRunTerminal({
      runId: 'run_1',
      timeoutMs: 1_000,
      readRun,
      waitForTerminal,
      now: () => now,
    });
    now = 1_000;
    await vi.advanceTimersByTimeAsync(1_000);
    await expect(wait).resolves.toMatchObject({ status: 'running', disposition: 'observation_timeout' });
    expect(readRun).toHaveBeenCalledTimes(2);
    expect(waitForTerminal).toHaveBeenCalledOnce();
    expect(waitForTerminal.mock.calls[0]?.[1].aborted).toBe(true);
    vi.useRealTimers();
  });

  it('ends only its observation at timeout and preserves typed read failures', async () => {
    let now = 0;
    const runningRead = vi.fn(async () => ({ ok: true as const, data: { run: { status: 'running' } } }));
    const waitForTerminal = vi.fn(async () => await new Promise<void>(() => {}));

    vi.useFakeTimers();
    const wait = waitForExecutionRunTerminal({
      runId: 'run_1',
      timeoutMs: 50,
      readRun: runningRead,
      waitForTerminal,
      now: () => now,
    });
    now = 51;
    await vi.advanceTimersByTimeAsync(50);
    await expect(wait).resolves.toEqual({
      ok: true,
      status: 'running',
      disposition: 'observation_timeout',
      runId: 'run_1',
      timeoutMs: 50,
      observedAtMs: 51,
      deadlineAtMs: 50,
    });
    expect(runningRead).toHaveBeenCalledTimes(2);
    vi.useRealTimers();

    expect(ExecutionRunWaitResultSchema.safeParse({
      ok: true,
      status: 'running',
      disposition: 'observation_timeout',
      runId: 'run_1',
      timeoutMs: 50,
      observedAtMs: 51,
      deadlineAtMs: 50,
    }).success).toBe(true);

    const failedRead = vi.fn(async () => ({
      ok: false as const,
      code: 'execution_run_target_unavailable',
      message: 'machine disconnected',
    }));
    await expect(waitForExecutionRunTerminal({
      runId: 'run_1',
      timeoutMs: null,
      readRun: failedRead,
      waitForTerminal,
    })).resolves.toEqual({
      ok: false,
      code: 'execution_run_target_unavailable',
      message: 'machine disconnected',
    });
  });

  it('does not miss cancellation that happens while reading the initial snapshot', async () => {
    const controller = new AbortController();
    const readRun = vi.fn(async () => {
      controller.abort();
      return { ok: true as const, data: { run: { status: 'running' } } };
    });
    const waitForTerminal = vi.fn(async () => await new Promise<void>(() => {}));

    await expect(waitForExecutionRunTerminal({
      runId: 'run_1',
      timeoutMs: null,
      signal: controller.signal,
      readRun,
      waitForTerminal,
    })).rejects.toMatchObject({ name: 'AbortError' });

    expect(readRun).toHaveBeenCalledOnce();
    expect(waitForTerminal).not.toHaveBeenCalled();
  });
});
