import {
  EXTERNAL_ACTION_RESPONSE_MAX_SERIALIZED_BYTES,
  WorkflowProgressEnvelopeV1Schema,
  isWorkflowResultDeliveryUnavailableV1,
  WorkflowRunInvocationIndexV1Schema,
  WorkflowRunSummaryV1Schema,
  openWorkflowAcceptedSnapshotStoredEnvelopeV1,
  openWorkflowFinalResultStoredEnvelopeV1,
  openWorkflowProgressStoredEnvelopeV1,
  parseWorkflowStoredContentEnvelopeV1,
  sealWorkflowProgressStoredEnvelopeV1,
  serializeWorkflowStoredContentEnvelopeV1,
  type JsonValue,
  type WorkflowInvocationLifecycleV1,
  type WorkflowProgressEnvelopeV1,
  type WorkflowRunInvocationIndexV1,
  type WorkflowRunSummaryV1,
} from '@happier-dev/protocol';

import { getRandomBytes } from '@/api/encryption';
import {
  isAvailableE2eeAutomationAccountEncryptionV1,
  type AvailableAutomationAccountEncryptionV1,
} from '@/plugins/runtime/automations/automationAccountCurrentness';
import type { WorkflowRunStorageOperation } from './workflowRunStorageClient';

const RECOVERABLE_INVOCATION_LIFECYCLES = [
  'pending',
  'waiting_for_capacity',
  'admitting',
  'running',
  'waiting_for_approval',
  'needs_attention',
  'cancel_requested',
  'outcome_uncertain',
] as const;

const TERMINAL_RUN_STATES = new Set([
  'succeeded', 'failed', 'cancelled', 'expired', 'dispatch_failed', 'skipped',
  'missed', 'outcome_uncertain',
]);

type Storage = Readonly<{
  execute: (operation: WorkflowRunStorageOperation, options?: Readonly<{ signal?: AbortSignal }>) => Promise<unknown>;
}>;

function record(value: unknown): Readonly<Record<string, unknown>> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Readonly<Record<string, unknown>>
    : null;
}

function openMode(encryption: AvailableAutomationAccountEncryptionV1) {
  if (!isAvailableE2eeAutomationAccountEncryptionV1(encryption)) return { mode: 'plain' as const };
  return { mode: 'e2ee' as const, material: encryption.material.material };
}

type RecoveryCandidate = Readonly<{ run: WorkflowRunSummaryV1; parentAttempt: number }>;

export type WorkflowInvocationRecoveryObservation =
  | Readonly<{ kind: 'unresolved'; code?: string }>
  | Readonly<{ kind: 'completed'; result: JsonValue }>
  | Readonly<{ kind: 'failed'; code: string }>
  | Readonly<{ kind: 'cancelled'; code?: string }>
  | Readonly<{ kind: 'outcome_uncertain'; code: string }>;

type ReconciledInvocationTransition = Readonly<{
  id: string;
  expectedLifecycle: WorkflowInvocationLifecycleV1;
  lifecycle: WorkflowInvocationLifecycleV1;
}>;

type ReconciledInvocationCustody = Readonly<{
  invocationTransitions: readonly ReconciledInvocationTransition[];
  cancellationRequested: boolean;
}>;

function parseRunPage(value: unknown): Readonly<{ candidates: readonly RecoveryCandidate[]; nextCursor?: string }> {
  const body = record(value);
  if (!body || !Array.isArray(body.candidates)) throw new Error('workflow_recovery_response_invalid');
  const candidates = body.candidates.map((raw) => {
    const candidate = record(raw);
    if (!candidate || !Number.isSafeInteger(candidate.parentAttempt) || Number(candidate.parentAttempt) < 0) {
      throw new Error('workflow_recovery_response_invalid');
    }
    return { run: WorkflowRunSummaryV1Schema.parse(candidate.run), parentAttempt: Number(candidate.parentAttempt) };
  });
  return { candidates, ...(typeof body.nextCursor === 'string' ? { nextCursor: body.nextCursor } : {}) };
}

async function recoverDirectResultDelivery(params: Readonly<{
  accountId: string;
  run: WorkflowRunSummaryV1;
  parentAttempt: number;
  encryption: AvailableAutomationAccountEncryptionV1;
  storage: Storage;
  deliverResult: (input: Readonly<{ runId: string; sessionId: string; text: string; signal?: AbortSignal }>) => Promise<Readonly<{
    status: 'accepted' | 'unavailable' | 'unresolved';
  }>>;
  signal?: AbortSignal;
}>): Promise<void> {
  if (params.run.workflowResultDeliveryState !== 'pending') return;
  const response = record(await params.storage.execute(
    { operation: 'get', runId: params.run.id },
    params.signal ? { signal: params.signal } : {},
  ));
  const current = response ? WorkflowRunSummaryV1Schema.safeParse(response.run) : null;
  if (!response || !current?.success || current.data.workflowResultDeliveryState !== 'pending') return;

  const acceptedEnvelope = parseWorkflowStoredContentEnvelopeV1(response.acceptedEnvelope);
  const resultEnvelope = parseWorkflowStoredContentEnvelopeV1(response.resultEnvelope);
  const accepted = acceptedEnvelope
    ? openWorkflowAcceptedSnapshotStoredEnvelopeV1({
      ...openMode(params.encryption),
      binding: { v: 1, purpose: 'accepted_snapshot', accountId: params.accountId, runId: params.run.id },
      envelope: acceptedEnvelope,
    })
    : null;
  const result = resultEnvelope
    ? openWorkflowFinalResultStoredEnvelopeV1({
      ...openMode(params.encryption),
      binding: { v: 1, purpose: 'final_result', accountId: params.accountId, runId: params.run.id },
      envelope: resultEnvelope,
    })
    : null;

  // A mode/binding/decryption failure is not proof that delivery is
  // unavailable. Retain custody so a later current-material pass can rejoin.
  if (accepted?.kind !== 'available' || (resultEnvelope && result?.kind !== 'available')) return;

  let settlement: Readonly<{
    state: 'accepted' | 'unavailable';
    reason?: 'workflow_outcome_unresolved';
  }>;
  const resultDelivery = 'resultDelivery' in accepted.content
    ? accepted.content.resultDelivery
    : undefined;
  if (!resultDelivery) {
    settlement = { state: 'unavailable' };
  } else if (!resultEnvelope
    || result?.kind !== 'available'
    || result.content.result.kind !== 'text'
    || typeof result.content.result.value !== 'string') {
    settlement = { state: 'unavailable', reason: 'workflow_outcome_unresolved' };
  } else {
    let delivered: Readonly<{ status: 'accepted' | 'unavailable' | 'unresolved' }>;
    try {
      delivered = await params.deliverResult({
        runId: params.run.id,
        sessionId: resultDelivery.originSessionId,
        text: result.content.result.value,
        ...(params.signal ? { signal: params.signal } : {}),
      });
    } catch {
      // A transport failure may happen after the stable input was accepted.
      // Keep pending custody and rejoin on the next lifecycle trigger.
      return;
    }
    if (delivered.status === 'unresolved') return;
    settlement = { state: delivered.status };
  }
  try {
    await params.storage.execute({
      operation: 'result-delivery.settle',
      runId: params.run.id,
      parentAttempt: params.parentAttempt,
      expectedRevision: current.data.revision,
      ...settlement,
    }, params.signal ? { signal: params.signal } : {});
  } catch {
    // A concurrent pass or a response-loss retry may already have committed
    // this stable delivery. Re-read the exact Run and accept only its durable
    // settled fact; pending custody remains eligible for a later rejoin.
    const rejoinBody = record(await params.storage.execute(
      { operation: 'get', runId: params.run.id },
      params.signal ? { signal: params.signal } : {},
    ));
    const rejoined = rejoinBody ? WorkflowRunSummaryV1Schema.safeParse(rejoinBody.run) : null;
    if (rejoined?.success
      && rejoined.data.workflowCustodyState === 'settled'
      && (rejoined.data.workflowResultDeliveryState === 'accepted'
        || isWorkflowResultDeliveryUnavailableV1(rejoined.data.workflowResultDeliveryState))) return;
  }
}

async function recoverInvocationCustody(params: Readonly<{
  accountId: string;
  run: WorkflowRunSummaryV1;
  trigger: WorkflowRecoveryTrigger;
  encryption: AvailableAutomationAccountEncryptionV1;
  storage: Storage;
  reconcileInvocation: (input: Readonly<{
    run: WorkflowRunSummaryV1;
    index: WorkflowRunInvocationIndexV1;
    progress: WorkflowProgressEnvelopeV1;
    terminalParent: boolean;
    cancellationRequested: boolean;
    parentAttempt: number;
    trigger: WorkflowRecoveryTrigger;
    signal?: AbortSignal;
  }>) => Promise<WorkflowInvocationRecoveryObservation>;
  signal?: AbortSignal;
  parentAttempt: number;
}>): Promise<ReconciledInvocationCustody | null> {
  const reconciled: ReconciledInvocationTransition[] = [];
  let allResolved = true;
  let cancellationRequested = false;
  const commitFact = async (
    index: WorkflowRunInvocationIndexV1,
    lifecycle: WorkflowInvocationLifecycleV1,
    contentEnvelope: string,
    resolution?: 'observed_terminal_execution',
  ): Promise<boolean> => {
    try {
      await params.storage.execute({
        operation: 'invocations.fact',
        runId: params.run.id,
        parentAttempt: params.parentAttempt,
        accountCurrentness: params.encryption.witness,
        invocationId: index.id,
        invocationAttempt: index.attempt,
        expectedLifecycle: index.lifecycle,
        lifecycle,
        contentEnvelope,
        ...(resolution ? { resolution } : {}),
      }, params.signal ? { signal: params.signal } : {});
      return true;
    } catch {
      const rejoinBody = record(await params.storage.execute({
        operation: 'invocations.get', runId: params.run.id, invocationId: index.id,
      }, params.signal ? { signal: params.signal } : {}));
      const rejoinInvocation = record(rejoinBody?.invocation);
      const rejoinIndex = rejoinInvocation
        ? WorkflowRunInvocationIndexV1Schema.safeParse(rejoinInvocation.index)
        : null;
      return rejoinIndex?.success === true
        && rejoinIndex.data.attempt === index.attempt
        && rejoinIndex.data.lifecycle === lifecycle
        && rejoinInvocation?.contentEnvelope === contentEnvelope;
    }
  };
  let cursor: string | undefined;
  do {
    const pageBody = record(await params.storage.execute({
      operation: 'invocations.list', runId: params.run.id,
      lifecycles: [...RECOVERABLE_INVOCATION_LIFECYCLES],
      pageByteLimit: EXTERNAL_ACTION_RESPONSE_MAX_SERIALIZED_BYTES,
      ...(cursor ? { cursor } : {}),
    }, params.signal ? { signal: params.signal } : {}));
    if (!pageBody || !Array.isArray(pageBody.invocations)) throw new Error('workflow_recovery_response_invalid');
    for (const rawIndex of pageBody.invocations) {
      const index = WorkflowRunInvocationIndexV1Schema.parse(rawIndex);
      const detailBody = record(await params.storage.execute({
        operation: 'invocations.get', runId: params.run.id, invocationId: index.id,
      }, params.signal ? { signal: params.signal } : {}));
      const invocation = record(detailBody?.invocation);
      const exactIndex = invocation ? WorkflowRunInvocationIndexV1Schema.safeParse(invocation.index) : null;
      const storedContentEnvelope = typeof invocation?.contentEnvelope === 'string'
        ? invocation.contentEnvelope
        : null;
      const envelope = parseWorkflowStoredContentEnvelopeV1(storedContentEnvelope);
      if (!exactIndex?.success || !envelope || exactIndex.data.lifecycle !== index.lifecycle) {
        allResolved = false;
        continue;
      }
      const opened = openWorkflowProgressStoredEnvelopeV1({
        ...openMode(params.encryption),
        binding: {
          v: 1, purpose: 'invocation_progress', accountId: params.accountId, runId: params.run.id,
          recordId: exactIndex.data.id, sequence: exactIndex.data.sequence,
          parentRecordId: exactIndex.data.parentRecordId, memberOrdinal: exactIndex.data.memberOrdinal,
          attempt: exactIndex.data.attempt,
        },
        envelope,
      });
      if (opened.kind !== 'available') {
        allResolved = false;
        continue;
      }
      const progress = WorkflowProgressEnvelopeV1Schema.parse(opened.content);
      const currentLifecycle = exactIndex.data.lifecycle;
      if (currentLifecycle === 'cancel_requested') cancellationRequested = true;
      if (currentLifecycle === 'pending' || currentLifecycle === 'waiting_for_capacity') {
        if (!TERMINAL_RUN_STATES.has(params.run.state)) {
          allResolved = false;
          continue;
        }
        const lifecycle = params.run.state === 'cancelled' ? 'cancelled' : 'skipped';
        if (!storedContentEnvelope || !await commitFact(exactIndex.data, lifecycle, storedContentEnvelope)) {
          allResolved = false;
          continue;
        }
        reconciled.push({
          id: exactIndex.data.id,
          expectedLifecycle: lifecycle,
          lifecycle,
        });
        continue;
      }
      if (progress.blockKind !== 'step') {
        if (currentLifecycle === 'cancel_requested') {
          if (!storedContentEnvelope || !await commitFact(exactIndex.data, 'cancelled', storedContentEnvelope)) {
            allResolved = false;
            continue;
          }
          reconciled.push({ id: exactIndex.data.id, expectedLifecycle: 'cancelled', lifecycle: 'cancelled' });
          continue;
        }
        if (currentLifecycle === 'outcome_uncertain') {
          if (!storedContentEnvelope
            || !await commitFact(exactIndex.data, currentLifecycle, storedContentEnvelope)) {
            allResolved = false;
            continue;
          }
          reconciled.push({ id: exactIndex.data.id, expectedLifecycle: currentLifecycle, lifecycle: currentLifecycle });
          continue;
        }
        allResolved = false;
        continue;
      }
      const observation = await params.reconcileInvocation({
        run: params.run, index: exactIndex.data,
        progress,
        terminalParent: TERMINAL_RUN_STATES.has(params.run.state),
        cancellationRequested: currentLifecycle === 'cancel_requested',
        parentAttempt: params.parentAttempt, trigger: params.trigger,
        ...(params.signal ? { signal: params.signal } : {}),
      });
      if (observation.kind === 'unresolved') {
        allResolved = false;
        continue;
      }
      if (currentLifecycle === 'outcome_uncertain' && observation.kind === 'outcome_uncertain') {
        allResolved = false;
        continue;
      }
      const resolvingUncertain = currentLifecycle === 'outcome_uncertain';
      const stoppedWithUncertainEffects = resolvingUncertain
        && (observation.kind === 'failed' || observation.kind === 'cancelled');
      const lifecycle: WorkflowInvocationLifecycleV1 = stoppedWithUncertainEffects
        ? 'needs_attention'
        : observation.kind;
      const nextProgress: WorkflowProgressEnvelopeV1 = {
        ...progress,
        ...(progress.result !== undefined || observation.kind !== 'completed'
          ? {}
          : { result: observation.result }),
        ...(progress.reason || observation.kind === 'completed' || !observation.code
          ? {}
          : { reason: { code: observation.code } }),
        ...(stoppedWithUncertainEffects ? { uncertainPriorEffects: { activity: 'stopped' as const } } : {}),
      };
      const binding = {
        v: 1 as const, purpose: 'invocation_progress' as const, accountId: params.accountId, runId: params.run.id,
        recordId: exactIndex.data.id, sequence: exactIndex.data.sequence,
        parentRecordId: exactIndex.data.parentRecordId, memberOrdinal: exactIndex.data.memberOrdinal,
        attempt: exactIndex.data.attempt,
      };
      const sealMode = isAvailableE2eeAutomationAccountEncryptionV1(params.encryption)
        ? { mode: 'e2ee' as const, material: params.encryption.material.material, randomBytes: getRandomBytes }
        : { mode: 'plain' as const };
      const contentEnvelope = serializeWorkflowStoredContentEnvelopeV1(sealWorkflowProgressStoredEnvelopeV1({
        ...sealMode,
        binding,
        progress: nextProgress,
      }));
      if (!await commitFact(
        exactIndex.data,
        lifecycle,
        contentEnvelope,
        resolvingUncertain ? 'observed_terminal_execution' : undefined,
      )) {
        allResolved = false;
        continue;
      }
      reconciled.push({ id: exactIndex.data.id, expectedLifecycle: lifecycle, lifecycle });
    }
    cursor = typeof pageBody.nextCursor === 'string' ? pageBody.nextCursor : undefined;
  } while (cursor && !params.signal?.aborted);
  return allResolved && !params.signal?.aborted
    ? { invocationTransitions: reconciled, cancellationRequested }
    : null;
}

async function settleRecoveredRun(params: Readonly<{
  runId: string;
  parentAttempt: number;
  encryption: AvailableAutomationAccountEncryptionV1;
  storage: Storage;
  invocationTransitions: readonly ReconciledInvocationTransition[];
  cancellationRequested: boolean;
  signal?: AbortSignal;
}>): Promise<void> {
  const body = record(await params.storage.execute(
    { operation: 'get', runId: params.runId },
    params.signal ? { signal: params.signal } : {},
  ));
  const current = body ? WorkflowRunSummaryV1Schema.safeParse(body.run) : null;
  if (!current?.success || current.data.workflowCustodyState === 'settled') return;
  if ((!TERMINAL_RUN_STATES.has(current.data.state) && !params.cancellationRequested)
    || current.data.workflowResultDeliveryState === 'pending'
    || typeof body?.checkpointEnvelope !== 'string'
    || !parseWorkflowStoredContentEnvelopeV1(body.checkpointEnvelope)) return;
  try {
    await params.storage.execute({
      operation: 'transition',
      runId: params.runId,
      parentAttempt: params.parentAttempt,
      accountCurrentness: params.encryption.witness,
      expectedRevision: current.data.revision,
      state: params.cancellationRequested ? 'cancelled' : current.data.state,
      checkpointEnvelope: body.checkpointEnvelope,
      custodyState: 'settled',
      invocationTransitions: params.invocationTransitions,
    }, params.signal ? { signal: params.signal } : {});
  } catch {
    const rejoinBody = record(await params.storage.execute(
      { operation: 'get', runId: params.runId },
      params.signal ? { signal: params.signal } : {},
    ));
    const rejoined = rejoinBody ? WorkflowRunSummaryV1Schema.safeParse(rejoinBody.run) : null;
    if (rejoined?.success && rejoined.data.workflowCustodyState === 'settled') return;
    if (!rejoined?.success
      || rejoined.data.workflowResultDeliveryState === 'pending'
      || typeof rejoinBody?.checkpointEnvelope !== 'string'
      || !parseWorkflowStoredContentEnvelopeV1(rejoinBody.checkpointEnvelope)) return;
    try {
      await params.storage.execute({
        operation: 'transition',
        runId: params.runId,
        parentAttempt: params.parentAttempt,
        accountCurrentness: params.encryption.witness,
        expectedRevision: rejoined.data.revision,
        state: params.cancellationRequested ? 'cancelled' : rejoined.data.state,
        checkpointEnvelope: rejoinBody.checkpointEnvelope,
        custodyState: 'settled',
        invocationTransitions: params.invocationTransitions,
      }, params.signal ? { signal: params.signal } : {});
    } catch {
      // Exact row facts remain durable and server custody remains pending.
    }
  }
}

export type WorkflowRecoveryTrigger = 'startup' | 'resume' | 'reconnect' | 'control';

/**
 * One daemon-lifetime, lifecycle-indexed recovery pass. It never claims,
 * initializes, resumes or coordinates a Workflow Run. Private content is
 * retrieved only for the exact rows returned by the recovery indexes.
 */
export function createWorkflowRunRecoveryReader(params: Readonly<{
  accountId: string;
  machineId: string;
  storage: Storage;
  resolveAccountEncryption: (signal?: AbortSignal) => Promise<AvailableAutomationAccountEncryptionV1>;
  deliverResult: Parameters<typeof recoverDirectResultDelivery>[0]['deliverResult'];
  reconcileInvocation: Parameters<typeof recoverInvocationCustody>[0]['reconcileInvocation'];
}>): (trigger: WorkflowRecoveryTrigger, signal?: AbortSignal) => Promise<void> {
  let inFlight: Promise<void> | null = null;
  return async (trigger, signal) => {
    if (inFlight) return await inFlight;
    const operation = (async () => {
      const encryption = await params.resolveAccountEncryption(signal);
      let cursor: string | undefined;
      do {
        const page = parseRunPage(await params.storage.execute({
          operation: 'recovery.list',
          pageByteLimit: EXTERNAL_ACTION_RESPONSE_MAX_SERIALIZED_BYTES,
          ...(cursor ? { cursor } : {}),
        }, signal ? { signal } : {}));
        for (const candidate of page.candidates) {
          const { run } = candidate;
          if (signal?.aborted) return;
          const reconciledCustody = await recoverInvocationCustody({
            accountId: params.accountId, run, parentAttempt: candidate.parentAttempt, trigger, encryption, storage: params.storage,
            reconcileInvocation: params.reconcileInvocation, ...(signal ? { signal } : {}),
          });
          if (reconciledCustody
            && TERMINAL_RUN_STATES.has(run.state)
            && run.workflowResultDeliveryState === 'pending') {
            await recoverDirectResultDelivery({
              accountId: params.accountId, run, parentAttempt: candidate.parentAttempt,
              encryption, storage: params.storage,
              deliverResult: params.deliverResult, ...(signal ? { signal } : {}),
            });
          }
          if (reconciledCustody
            && (TERMINAL_RUN_STATES.has(run.state) || reconciledCustody.cancellationRequested)) {
            await settleRecoveredRun({
              runId: run.id,
              parentAttempt: candidate.parentAttempt,
              encryption,
              storage: params.storage,
              invocationTransitions: reconciledCustody.invocationTransitions,
              cancellationRequested: reconciledCustody.cancellationRequested,
              ...(signal ? { signal } : {}),
            });
          }
        }
        cursor = page.nextCursor;
      } while (cursor && !signal?.aborted);
    })();
    inFlight = operation;
    try {
      await operation;
    } finally {
      if (inFlight === operation) inFlight = null;
    }
  };
}
