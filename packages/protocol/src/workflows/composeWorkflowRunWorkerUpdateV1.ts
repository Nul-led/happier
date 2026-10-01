import { WorkerUpdateV1Schema, type WorkerUpdateV1 } from '../sessions/relations/workerUpdateV1.js';
import type { WorkflowFinalResultV1, WorkflowReviewV1, WorkflowRunSummaryV1 } from './workflowProgressV1.js';
import { EXECUTION_RUN_COMPLETION_SUMMARY_MAX_LENGTH } from '../execution/runs/completionInputV1.js';

/** One current-state projection; delivery transports never reconstruct a history of holds. */
export function composeWorkflowRunWorkerUpdateV1(input: Readonly<{
  run: Pick<WorkflowRunSummaryV1, 'id' | 'state' | 'attentionRequired'>;
  finalResult?: WorkflowFinalResultV1;
  finalProducerReview?: WorkflowReviewV1;
}>): WorkerUpdateV1 | null {
  const terminal = ['succeeded', 'failed', 'cancelled', 'expired', 'dispatch_failed', 'skipped', 'missed', 'outcome_uncertain'].includes(input.run.state);
  if (!terminal && input.run.attentionRequired !== true) return null;
  const selected = input.finalResult?.result;
  const text = selected?.kind === 'json' ? JSON.stringify(selected.value) : selected?.value;
  const decision = input.finalProducerReview?.decision;
  const followUp = decision?.kind === 'use_result' ? decision.followUp : undefined;
  const followUpText = followUp?.kind === 'run_started'
    ? `Follow-up already started: ${followUp.runId}. Do not start it again.`
    : followUp?.kind === 'editing' ? 'Follow-up: editing. No follow-up Run has been started.' : '';
  const suffix = followUpText ? `\n\n${followUpText}` : '';
  const result = text === undefined && !suffix ? undefined : `${text ?? ''}${suffix}`;
  const maxResultLength = EXECUTION_RUN_COMPLETION_SUMMARY_MAX_LENGTH;
  const truncated = result !== undefined && result.length > maxResultLength;
  return WorkerUpdateV1Schema.parse({
    v: 1, workerKind: 'workflow_run', workerId: input.run.id, ownerState: input.run.state,
    wake: terminal ? 'finished' : 'needs_you',
    // The optional allowance truncates result text, never this exact follow-up fact.
    headline: `${terminal ? `Workflow ${input.run.state}` : 'Workflow needs your attention'}${followUpText ? ` · ${followUpText}` : ''}`,
    ...(result === undefined ? {} : { result: truncated
      ? `${(text ?? '').slice(0, maxResultLength - suffix.length)}${suffix}` : result }),
    ...(truncated ? { truncated: true } : {}),
    transcriptPointer: { kind: 'workflow_run', runId: input.run.id,
      ...(input.finalResult ? { invocationRecordId: input.finalResult.producerInvocation.recordId } : {}) },
    canInspect: true,
  });
}
