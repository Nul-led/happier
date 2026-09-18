import { z } from 'zod';

import { ExecutionRunStatusSchema } from './listRequest.js';

/**
 * The statuses an execution run can END on, derived from the canonical enum in
 * `listRequest.ts` instead of restating the literals: the wait/start-and-wait
 * wire shapes and `isExecutionRunTerminalStatus` previously inlined this
 * vocabulary five times, and the presentation adapter is typed against the
 * canonical enum. Deriving keeps the wire members and their order byte-identical.
 */
export const ExecutionRunTerminalStatusSchema = ExecutionRunStatusSchema.exclude(['running']);
export type ExecutionRunTerminalStatus = z.infer<typeof ExecutionRunTerminalStatusSchema>;

export type ExecutionRunWaitFailure = Readonly<{
  ok: false;
  code: string;
  message?: string;
  details?: unknown;
}>;

export type ExecutionRunWaitReadResult<TData, TFailure extends ExecutionRunWaitFailure = ExecutionRunWaitFailure> =
  | Readonly<{ ok: true; data: TData }>
  | TFailure;

export type ExecutionRunWaitLoopResult<TData, TFailure extends ExecutionRunWaitFailure = ExecutionRunWaitFailure> =
  | Readonly<{
      ok: true;
      status: ExecutionRunTerminalStatus;
      result: TData;
    }>
  | Readonly<{
      ok: true;
      status: 'running';
      disposition: 'observation_timeout';
      runId: string;
      timeoutMs: number;
      observedAtMs: number;
      deadlineAtMs: number;
    }>
  | TFailure;

export function normalizeExecutionRunWaitTimeoutMs(timeoutSeconds: unknown): number | null {
  if (typeof timeoutSeconds !== 'number' || !Number.isFinite(timeoutSeconds) || timeoutSeconds <= 0) {
    return null;
  }
  return Math.max(1, Math.floor(timeoutSeconds * 1_000));
}

export function isExecutionRunTerminalStatus(status: unknown): status is ExecutionRunTerminalStatus {
  return ExecutionRunTerminalStatusSchema.safeParse(status).success;
}

function readExecutionRunStatus(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const run = (value as Readonly<Record<string, unknown>>).run;
  if (!run || typeof run !== 'object' || Array.isArray(run)) return undefined;
  return (run as Readonly<Record<string, unknown>>).status;
}

function createAbortError(): Error {
  const error = new Error('Execution-run wait was aborted');
  error.name = 'AbortError';
  return error;
}

/**
 * The shared event-driven observer for an already admitted execution run.
 * It never starts, stops, retries, or retargets a run; a timeout only ends this
 * caller's observation. The host supplies its canonical terminal promise and
 * exact snapshot read, so callers do not create polling sockets or duplicate
 * run-lifecycle state.
 */
export async function waitForExecutionRunTerminal<TData, TFailure extends ExecutionRunWaitFailure>(args: Readonly<{
  runId: string;
  timeoutMs: number | null;
  signal?: AbortSignal;
  readRun: (request: Readonly<{ runId: string }>) => Promise<ExecutionRunWaitReadResult<TData, TFailure>>;
  waitForTerminal: (runId: string, signal?: AbortSignal) => Promise<void>;
  now?: () => number;
}>): Promise<ExecutionRunWaitLoopResult<TData, TFailure>> {
  const timeoutMs =
    typeof args.timeoutMs === 'number' && Number.isFinite(args.timeoutMs) && args.timeoutMs > 0
      ? args.timeoutMs
      : null;
  const now = args.now ?? Date.now;
  const deadlineMs = timeoutMs === null ? null : now() + timeoutMs;

  args.signal?.throwIfAborted();
  const initial = await args.readRun({ runId: args.runId });
  if (!initial.ok) return initial;
  const initialStatus = readExecutionRunStatus(initial.data);
  if (isExecutionRunTerminalStatus(initialStatus)) {
    return { ok: true, status: initialStatus, result: initial.data };
  }
  // The initial snapshot is asynchronous. Re-check before creating the terminal
  // observation so an abort delivered during that read cannot be lost before
  // the listener below is attached.
  args.signal?.throwIfAborted();

  const terminalObserverAbort = new AbortController();
  let timer: ReturnType<typeof setTimeout> | null = null;
  let onAbort: (() => void) | null = null;
  const terminal = args.waitForTerminal(args.runId, terminalObserverAbort.signal).then(() => 'terminal' as const);
  const observationEnd = new Promise<'timeout'>((resolve, reject) => {
    if (timeoutMs !== null) {
      timer = setTimeout(() => resolve('timeout'), Math.max(0, deadlineMs! - now()));
    }
    if (args.signal) {
      onAbort = () => reject(createAbortError());
      args.signal.addEventListener('abort', onAbort, { once: true });
      if (args.signal.aborted) onAbort();
    }
  });

  let disposition: 'terminal' | 'timeout';
  try {
    disposition = timeoutMs === null && !args.signal
      ? await terminal
      : await Promise.race([terminal, observationEnd]);
  } finally {
    terminalObserverAbort.abort(createAbortError());
    if (timer !== null) clearTimeout(timer);
    if (onAbort && args.signal) args.signal.removeEventListener('abort', onAbort);
  }

  args.signal?.throwIfAborted();
  const final = await args.readRun({ runId: args.runId });
  if (!final.ok) return final;
  const finalStatus = readExecutionRunStatus(final.data);
  if (isExecutionRunTerminalStatus(finalStatus)) {
    return { ok: true, status: finalStatus, result: final.data };
  }

  if (disposition === 'terminal') {
    throw new Error('Execution-run terminal signal resolved before its canonical state became terminal');
  }
  if (deadlineMs === null || timeoutMs === null) {
    throw new Error('Execution-run wait timed out without an observation deadline');
  }

  const observedAtMs = now();
  return {
    ok: true,
    status: 'running',
    disposition: 'observation_timeout',
    runId: args.runId,
    timeoutMs,
    observedAtMs,
    deadlineAtMs: deadlineMs,
  };
}
