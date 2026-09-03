import { describe, expect, it, vi } from 'vitest';

import {
  ExecutionRunStartResponseSchema,
  ExecutionRunWaitResultSchema,
} from './index.js';
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
    const delay = vi.fn(async () => undefined);

    await expect(waitForExecutionRunTerminal({
      runId: 'run_1',
      timeoutMs: null,
      pollIntervalMs: 1,
      readRun,
      delay,
    })).resolves.toEqual({
      ok: true,
      status: 'succeeded',
      result: { run: { status: 'succeeded', result: { ok: true } } },
    });

    expect(readRun).toHaveBeenNthCalledWith(1, { runId: 'run_1' });
    expect(readRun).toHaveBeenNthCalledWith(2, { runId: 'run_1' });
    expect(delay).toHaveBeenCalledWith(250, undefined);
  });

  it('requests a delay no longer than the remaining observation deadline', async () => {
    let now = 0;
    const requestedDelays: Array<Readonly<{ atMs: number; ms: number }>> = [];
    const readRun = vi.fn()
      .mockResolvedValueOnce({ ok: true as const, data: { run: { status: 'running' } } })
      .mockResolvedValueOnce({ ok: true as const, data: { run: { status: 'succeeded', result: { ok: true } } } });
    const delay = vi.fn(async (ms: number) => {
      requestedDelays.push({ atMs: now, ms });
      // A real sleep advances the clock by at least the requested delay.
      now += ms;
    });

    await expect(waitForExecutionRunTerminal({
      runId: 'run_1',
      timeoutMs: 1_000,
      pollIntervalMs: 60_000,
      readRun,
      delay,
      now: () => now,
    })).resolves.toEqual({
      ok: true,
      status: 'succeeded',
      result: { run: { status: 'succeeded', result: { ok: true } } },
    });

    expect(readRun).toHaveBeenCalledTimes(2);
    // timeoutMs=1_000 with pollIntervalMs=60_000 must not sleep ~a minute past
    // the deadline: every requested delay is min(pollIntervalMs, remaining).
    expect(requestedDelays).toEqual([{ atMs: 0, ms: 1_000 }]);
    for (const requested of requestedDelays) {
      expect(requested.ms).toBeLessThanOrEqual(1_000 - requested.atMs);
    }
  });

  it('ends only its observation at timeout and preserves typed read failures', async () => {
    let now = 0;
    const runningRead = vi.fn(async () => ({ ok: true as const, data: { run: { status: 'running' } } }));
    const delay = vi.fn(async () => {
      now = 51;
    });

    await expect(waitForExecutionRunTerminal({
      runId: 'run_1',
      timeoutMs: 50,
      pollIntervalMs: 250,
      readRun: runningRead,
      delay,
      now: () => now,
    })).resolves.toEqual({
      ok: true,
      status: 'running',
      disposition: 'observation_timeout',
      runId: 'run_1',
      timeoutMs: 50,
      observedAtMs: 51,
      deadlineAtMs: 50,
    });
    expect(runningRead).toHaveBeenCalledTimes(1);

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
      pollIntervalMs: 250,
      readRun: failedRead,
    })).resolves.toEqual({
      ok: false,
      code: 'execution_run_target_unavailable',
      message: 'machine disconnected',
    });
  });
});
