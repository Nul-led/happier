import type {
  ExecutionRunResumeHandle,
  WorkflowUsageV1,
} from '@happier-dev/protocol';

import type { ExactTurnUsageAccumulator } from '@/usage/exactTurnUsage';

export type ExecutionRunWorkflowObservation =
  | Readonly<{
      kind: 'provider_resume_identity';
      runId: string;
      localInputId: string;
      providerResumeIdentity: Extract<ExecutionRunResumeHandle, { kind: 'provider_session.v1' }>;
    }>
  | Readonly<{
      kind: 'usage';
      runId: string;
      localInputId: string;
      usage: WorkflowUsageV1;
    }>;

/**
 * Host-private, exact-input projection into the Workflow invocation owner.
 * It is carried only over the direct in-process Action path and is never wire
 * input, public Run state, marker content, or a durable Execution Run store.
 */
export type ExecutionRunWorkflowObservationSink = Readonly<{
  commit(observation: ExecutionRunWorkflowObservation): Promise<void>;
}>;

export type ExecutionRunWorkflowObservationBinding = Readonly<{
  localInputId: string;
  sink: ExecutionRunWorkflowObservationSink;
  usage: ExactTurnUsageAccumulator;
}>;

export function readExecutionRunWorkflowObservationSink(
  value: unknown,
): ExecutionRunWorkflowObservationSink | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return typeof (value as { commit?: unknown }).commit === 'function'
    ? value as ExecutionRunWorkflowObservationSink
    : null;
}
