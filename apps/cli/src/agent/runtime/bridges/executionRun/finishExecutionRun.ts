import { randomUUID } from 'node:crypto';
import { Buffer } from 'node:buffer';

import type { ACPMessageData, ACPProvider } from '@/api/session/sessionMessageTypes';
import type { ExecutionRunStructuredMeta } from '@/agent/executionRuns/profiles/ExecutionRunIntentProfile';
import {
  resolveExecutionRunIntentProfile,
  resolveExecutionRunIntentProfileFromCatalog,
  type ExecutionRunProfileContributionCatalog,
} from '@/agent/executionRuns/profiles/intentRegistry';
import type { ExecutionRunController } from '@/agent/executionRuns/controllers/types';
import { readBackendResumableRuntimeId } from '@/agent/executionRuns/controllers/types';
import type { ExecutionRunState } from './executionRunTypes';
import type { ExecutionBudgetRegistry } from '@/daemon/executionBudget/ExecutionBudgetRegistry';
import {
  retainExecutionRunWorkerUpdate,
  writeExecutionRunMarker,
  type RetainedExecutionRunWorkerUpdate,
} from '@/daemon/executionRunRegistry';
import { composeExecutionRunWorkerUpdate } from './executionRunWorkerUpdate';
import {
  AGENT_SESSION_RUNTIME_LIMITS_CANDIDATE_V1,
  projectExecutionRunRequestedConfiguration,
  readBackendTargetRefV2,
  ReviewFindingsV1Schema,
  ReviewFindingsV2Schema,
  type ExecutionRunResumeHandle,
} from '@happier-dev/protocol';
import type { ExecutionRunTranscriptPublisher } from './executionRunTranscriptPublisher';
import {
  createExecutionRunTranscriptCustodyError,
  isExecutionRunTranscriptCustodyError,
} from './executionRunTranscriptPublisher';
import { buildExecutionRunConnectedServicesCleanupReceipt } from './connectedServicesCleanupReceipt';
import type { ReviewRunCommentService, ReviewRunMaterialization } from '@/agent/executionRuns/profiles/review/reviewComments';
import { buildReviewFindingsV2Payload } from '@/agent/reviews/normalize/buildReviewFindingsV2Payload';

// The same running state claims terminalization without exposing a terminal fact
// before its required ReviewComment writes. This replaces the old early status claim.
const terminalTransitionsInFlight = new WeakMap<Map<string, ExecutionRunState>, Set<string>>();

type EnqueueMarkerWrite = (runId: string, write: () => Promise<void>) => Promise<void>;

function readExecutionRunMarkerResultSizeBytes(value: unknown): number | undefined {
  let serialized: string | undefined;
  if (typeof value === 'string') {
    serialized = value;
  } else {
    try {
      serialized = JSON.stringify(value);
    } catch {
      return undefined;
    }
  }
  if (serialized === undefined) return undefined;

  const sizeBytes = Buffer.byteLength(serialized, 'utf8');
  return sizeBytes <= AGENT_SESSION_RUNTIME_LIMITS_CANDIDATE_V1.p0MeasuredCandidates.sendRequestMaxJsonBytes
    ? sizeBytes
    : undefined;
}

type FinishRunNext = Omit<
  ExecutionRunState,
  | 'runId'
  | 'callId'
  | 'sidechainId'
    | 'sessionId'
    | 'depth'
    | 'intent'
    | 'profileId'
    | 'profileSourceCustody'
    | 'backendTarget'
  | 'backendId'
  | 'instructions'
  | 'permissionMode'
  | 'retentionPolicy'
  | 'runClass'
  | 'ioMode'
  | 'startedAtMs'
  | 'resumeHandle'
> & {
  status: ExecutionRunState['status'];
  finishedAtMs: number;
};

export async function finishExecutionRun(args: Readonly<{
  runId: string;
  next: FinishRunNext;
  toolResult: { output: any; isError?: boolean; meta?: Record<string, unknown> };
  structuredMeta?: ExecutionRunStructuredMeta;
  runs: Map<string, ExecutionRunState>;
  controllers: Map<string, ExecutionRunController>;
  budgetRegistry: ExecutionBudgetRegistry | null;
  parentProvider: ACPProvider;
  sendAcp: ExecutionRunTranscriptPublisher;
  enqueueMarkerWrite: EnqueueMarkerWrite;
  terminalMarkerWritePromises: Map<string, Promise<void>>;
  onWorkerUpdateRetained?: (input: RetainedExecutionRunWorkerUpdate) => void;
  profileCatalog?: ExecutionRunProfileContributionCatalog;
  reviewComments?: ReviewRunCommentService;
}>): Promise<boolean> {
  const existing = args.runs.get(args.runId);
  if (!existing) return false;
  if (existing.status !== 'running') return false;
  const claimed = terminalTransitionsInFlight.get(args.runs) ?? new Set<string>();
  if (claimed.has(args.runId)) return false;
  terminalTransitionsInFlight.set(args.runs, claimed);
  claimed.add(args.runId);
  try {
  const terminalEventId = randomUUID();

  let toolResult = args.toolResult;
  let structuredMeta = args.structuredMeta;
  let materialization: ReviewRunMaterialization | undefined;
  const intentInput = existing.intentInput && typeof existing.intentInput === 'object' && !Array.isArray(existing.intentInput)
    ? existing.intentInput as Readonly<Record<string, unknown>> : {};
  const reviewedFingerprint = typeof intentInput.reviewedFingerprint === 'string' ? intentInput.reviewedFingerprint : null;
  if (existing.intent === 'review') {
    const output = toolResult.output && typeof toolResult.output === 'object' && !Array.isArray(toolResult.output)
      ? toolResult.output as Record<string, unknown> : { result: toolResult.output };
    // Failure, cancellation and malformed output still describe this launch's
    // worktree; never replace its captured fingerprint with a later SCM read.
    toolResult = { ...toolResult, output: { ...output, reviewedFingerprint } };
  }
  if (existing.intent === 'review' && args.next.status === 'succeeded') {
    const parsed = structuredMeta?.kind === 'review_findings.v2'
      ? ReviewFindingsV2Schema.safeParse(structuredMeta.payload)
      : ReviewFindingsV1Schema.safeParse(structuredMeta?.payload);
    if (parsed.success) {
      const controller = args.controllers.get(args.runId);
      const workflowRunId = controller?.kind === 'backend' ? controller.workflowRunId ?? controller.workflowObservation?.workflowRunId : undefined;
      materialization = args.reviewComments
        ? await args.reviewComments.materialize({ run: existing, findings: parsed.data.findings, reviewedFingerprint, ...(workflowRunId ? { workflowRunId } : {}) })
        : {
            engineId: existing.backendId, status: parsed.data.findings.length ? 'failed' : 'materialized',
            commentIds: [], comments: [], failures: parsed.data.findings.map((finding) => ({ findingId: finding.id, errorCode: 'review_comment_materialization_unavailable' })),
          };
      const projection = {
        engineId: existing.backendId,
        reviewedFingerprint,
        commentIds: materialization.commentIds,
        materialization: materialization.status === 'materialized' ? { kind: 'complete' as const }
          : { kind: materialization.status, errorCode: 'review_comment_materialization_failed' },
        ...(materialization.failures.length ? { materializationFailures: materialization.failures } : {}),
        perEngineOutcome: [{ key: existing.backendId, runId: existing.runId, outcome: materialization.status === 'materialized' ? 'completed' : 'failed' }],
      };
      const projectedFindings = parsed.data.findings.map((finding) => {
        const materialized = materialization!.comments.find((entry) => entry.findingId === finding.id);
        return materialized ? { ...finding, comment: materialized.comment } : finding;
      });
      const payload = structuredMeta?.kind === 'review_findings.v2' ? parsed.data
        : buildReviewFindingsV2Payload({
            runId: parsed.data.runRef.runId, callId: parsed.data.runRef.callId, backendId: parsed.data.runRef.backendId,
            backendTarget: parsed.data.runRef.backendTarget, summary: parsed.data.summary, findings: projectedFindings,
            triage: parsed.data.triage, limits: parsed.data.limits, generatedAtMs: parsed.data.generatedAtMs,
          });
      structuredMeta = { kind: 'review_findings.v2', payload: { ...payload, ...projection, findings: projectedFindings } };
      const output = toolResult.output && typeof toolResult.output === 'object' && !Array.isArray(toolResult.output)
        ? toolResult.output as Record<string, unknown> : { result: toolResult.output };
      toolResult = { ...toolResult, output: { ...output, ...projection, findings: projectedFindings }, meta: { ...toolResult.meta, happier: structuredMeta } };
    } else {
      materialization = {
        engineId: existing.backendId, status: 'failed', commentIds: [], comments: [],
        failures: [{ findingId: existing.runId, errorCode: 'review_findings_invalid' }],
      };
      toolResult = {
        ...toolResult, isError: true,
        output: { result: args.toolResult.output, engineId: existing.backendId, reviewedFingerprint, commentIds: [], materialization: { kind: 'failed', errorCode: 'review_findings_invalid' }, perEngineOutcome: [{ key: existing.backendId, runId: existing.runId, outcome: 'failed' }] },
      };
    }
  }

  const resumeHandle: ExecutionRunResumeHandle | null = (() => {
    if (existing.retentionPolicy !== 'resumable') return null;
    const providerSessionId = readBackendResumableRuntimeId(args.controllers.get(args.runId) ?? null);
    if (typeof providerSessionId === 'string' && providerSessionId.trim().length > 0) {
      return { kind: 'provider_session.v1', backendTarget: readBackendTargetRefV2(existing.backendTarget), providerSessionId };
    }
    return existing.resumeHandle ?? null;
  })();

  let updated: ExecutionRunState = {
    ...existing,
    status: materialization && materialization.status !== 'materialized' ? 'failed' : args.next.status,
    summary: args.next.summary ?? existing.summary,
    finishedAtMs: args.next.finishedAtMs,
    ...(args.next.error ? { error: args.next.error } : {}),
    ...(materialization && materialization.status !== 'materialized'
      ? { error: { code: 'review_comment_materialization_failed', message: 'Review findings could not all be persisted' } }
      : {}),
    ...(structuredMeta ? { structuredMeta } : {}),
    latestToolResult: toolResult.output,
    ...(existing.retentionPolicy === 'resumable' ? { resumeHandle } : {}),
  };

  // Required comment materialization has completed before any terminal observation.
  args.runs.set(args.runId, updated);
  args.budgetRegistry?.releaseExecutionRun(args.runId);

  const mergedMeta = (() => {
    const base = toolResult.meta ? { ...toolResult.meta } : {};
    if (resumeHandle) {
      (base as any).happierExecutionRun = {
        resumeHandle,
      };
    }
    return base;
  })();
  let terminalizationError: unknown = null;
  let shouldMaterializeInTranscript = false;
  try {
    const profile = args.profileCatalog
      ? resolveExecutionRunIntentProfileFromCatalog(
          args.profileCatalog,
          existing.intent,
          existing.profileId,
          existing.profileSourceCustody,
        )
      : resolveExecutionRunIntentProfile(existing.intent);
    shouldMaterializeInTranscript = existing.sessionId !== null
      && profile.transcriptMaterialization !== 'none';
  } catch (error) {
    terminalizationError = error;
  }
  if (!terminalizationError && shouldMaterializeInTranscript) {
    try {
      await args.sendAcp(
        args.parentProvider,
        {
          type: 'tool-result',
          callId: existing.callId,
          output: toolResult.output,
          id: terminalEventId,
          ...(toolResult.isError || updated.status === 'failed' ? { isError: true } : {}),
        },
        Object.keys(mergedMeta).length > 0 ? { meta: mergedMeta } : undefined,
      );
    } catch {
      terminalizationError = createExecutionRunTranscriptCustodyError();
    }
  }
  if (terminalizationError) {
    if (isExecutionRunTranscriptCustodyError(terminalizationError)) {
      const publicationError = terminalizationError as ReturnType<typeof createExecutionRunTranscriptCustodyError>;
      updated = {
        ...updated,
        status: 'failed',
        summary: publicationError.message,
        error: { code: publicationError.code, message: publicationError.message },
      };
    } else {
      const message = terminalizationError instanceof Error ? terminalizationError.message : 'Execution failed';
      updated = {
        ...updated,
        status: 'failed',
        summary: args.next.status === 'failed' ? updated.summary : message,
        error: args.next.status === 'failed' && updated.error
          ? updated.error
          : { code: 'execution_run_failed', message },
      };
    }
  }
  args.runs.set(args.runId, updated);

  const resultSizeBytes = readExecutionRunMarkerResultSizeBytes(toolResult.output);

  // Best-effort: update daemon-visible marker for machine-wide run visibility.
  const cleanupReceipt = buildExecutionRunConnectedServicesCleanupReceipt(
    updated.launch?.connectedServicesRegistration,
  );
  const requestedConfiguration = projectExecutionRunRequestedConfiguration({
    modelId: updated.launch?.modelSelection?.modelId ?? updated.launch?.modelId,
    sessionConfigOptionOverrides: updated.launch?.sessionConfigOptionOverrides,
  });
  const parentWorkerUpdate = composeExecutionRunWorkerUpdate(updated, terminalEventId);
  const markerPayload = {
    pid: process.pid,
    happySessionId: existing.sessionId,
    runId: updated.runId,
    callId: updated.callId,
    sidechainId: updated.sidechainId,
    intent: updated.intent,
    backendTarget: readBackendTargetRefV2(updated.backendTarget),
    ...(updated.launch?.launchOrigin ? { launchOrigin: updated.launch.launchOrigin } : {}),
    ...(requestedConfiguration ? { requestedConfiguration } : {}),
    permissionMode: updated.permissionMode,
    retentionPolicy: updated.retentionPolicy,
    runClass: updated.runClass,
    ioMode: updated.ioMode,
    status: updated.status,
    ...(updated.notifyParentOnCompletion === true ? { notifyParentOnCompletion: true } : {}),
    startedAtMs: updated.startedAtMs,
    updatedAtMs: args.next.finishedAtMs,
    finishedAtMs: args.next.finishedAtMs,
    ...(updated.error?.code ? { errorCode: updated.error.code } : {}),
    ...(resultSizeBytes === undefined ? {} : { resultSizeBytes }),
    ...(cleanupReceipt
      ? { executionRunConnectedServicesCleanupReceiptV1: cleanupReceipt }
      : {}),
  } as const;

  const markerWritePromise = args.enqueueMarkerWrite(args.runId, async (): Promise<void> => {
    if (parentWorkerUpdate) {
      await retainExecutionRunWorkerUpdate(parentWorkerUpdate);
      args.onWorkerUpdateRetained?.(parentWorkerUpdate);
    }
    // Disk writes can fail transiently (e.g. rename contention on some platforms). Retry once.
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        await writeExecutionRunMarker(markerPayload);
        return;
      } catch (error) {
        if (attempt === 0) {
          await new Promise<void>((resolve) => setTimeout(resolve, 25));
          continue;
        }
        if (parentWorkerUpdate) throw error;
        return;
      }
    }
  });

  const trackedMarkerWritePromise = markerWritePromise.finally(() => {
    args.terminalMarkerWritePromises.delete(args.runId);
  });
  args.terminalMarkerWritePromises.set(args.runId, trackedMarkerWritePromise);
  const ctrl = args.controllers.get(args.runId) ?? null;
  if (ctrl) {
    ctrl.terminalMarkerWritePromise = trackedMarkerWritePromise;
  }

  // A parent completion is durable input, not merely daemon visibility.
  if (parentWorkerUpdate) await trackedMarkerWritePromise;

  if (terminalizationError) throw terminalizationError;
  return true;
  } finally {
    claimed.delete(args.runId);
  }
}
