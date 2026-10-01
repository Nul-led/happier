import { WorkerUpdateV1Schema } from '@happier-dev/protocol';
import type { RetainedExecutionRunWorkerUpdate } from '@/daemon/executionRunRegistry';
import type { ExecutionRunState } from './executionRunTypes';

/** A projection of canonical terminal Run state; no additional result or status owner. */
export function composeExecutionRunWorkerUpdate(run: ExecutionRunState, terminalEventId: string): RetainedExecutionRunWorkerUpdate | null {
  if (!run.sessionId || run.status === 'running' || run.notifyParentOnCompletion !== true) return null;
  const result = typeof run.latestToolResult === 'string' ? run.latestToolResult
    : run.latestToolResult !== undefined ? JSON.stringify(run.latestToolResult) ?? ''
      : run.summary ?? run.error?.message ?? '';
  const update = WorkerUpdateV1Schema.parse({
    v: 1, workerKind: 'execution_run', workerId: run.runId,
    ownerState: run.status, wake: 'finished',
    ...(run.effectiveEngine ? { engine: run.effectiveEngine } : {}),
    headline: `Background run ${run.status}`,
    result: result.slice(0, 8_000),
    ...(result.length > 8_000 ? { truncated: true } : {}),
    transcriptPointer: { kind: 'execution_run', sessionId: run.sessionId, runId: run.runId },
    canInspect: run.retentionPolicy === 'resumable',
  });
  return { sessionId: run.sessionId, localId: `execution-run-worker-update:${terminalEventId}`, update };
}
