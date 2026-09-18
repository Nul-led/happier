import { randomUUID } from 'node:crypto';

import {
  EXTERNAL_ACTION_RESPONSE_MAX_SERIALIZED_BYTES,
  MAX_AUTOMATION_STORED_ENVELOPE_UTF8_BYTES,
  StrictJsonValueSchema,
  AutomationStoredContentEnvelopeV1Schema,
  AutomationStoredWorkflowDefinitionV2Schema,
  WorkflowAcceptedSnapshotV1Schema,
  WorkflowAuthoredInputV1Schema,
  WorkflowCheckpointEnvelopeV1Schema,
  WorkflowProgressEnvelopeV1Schema,
  WorkflowRunInvocationIndexV1Schema,
  WorkflowRunSummaryV1Schema,
  WorkflowResolvedInputsV1Schema,
  createAutomationWorkflowAcceptedSnapshotV1,
  openAccountScopedBlobCiphertext,
  openWorkflowAcceptedSnapshotStoredEnvelopeV1,
  openWorkflowCheckpointStoredEnvelopeV1,
  openWorkflowProgressStoredEnvelopeV1,
  parseWorkflowStoredContentEnvelopeV1,
  sealWorkflowCheckpointStoredEnvelopeV1,
  sealWorkflowAcceptedSnapshotStoredEnvelopeV1,
  sealWorkflowFinalResultStoredEnvelopeV1,
  sealWorkflowProgressStoredEnvelopeV1,
  serializeWorkflowStoredContentEnvelopeV1,
  sameAutomationAccountCurrentnessWitnessV1,
  type WorkflowBlock,
  type WorkflowCheckpointEnvelopeV1,
  type WorkflowProgressEnvelopeV1,
  type WorkflowRunInvocationIndexV1,
  type WorkflowRunSummaryV1,
  type AccountScopedCryptoMaterial,
} from '@happier-dev/protocol';
import { createWorkflowInteractionCapacityError } from '@/agent/permissions/interactionPersistenceError';

import { getRandomBytes } from '@/api/encryption';
import { PushNotificationClient } from '@/api/pushNotifications';
import { resolveWorkspaceRefById } from '@/settings/accountSettings/workspaceRefsV1';
import { createWorkflowRunCommittedNotificationHandler } from '@/notifications/activity/dispatchWorkflowRunUpdateNotification';
import {
  isAvailableE2eeAutomationAccountEncryptionV1,
  type AvailableAutomationAccountEncryptionV1,
} from '@/plugins/runtime/automations/automationAccountCurrentness';
import {
  createWorkflowCoordinator,
  WorkflowControlBoundary,
  workflowInvocationKey,
  type WorkflowCoordinatorInvocation,
  type WorkflowCoordinatorResult,
  type WorkflowCoordinatorStore,
  type WorkflowAcceptedAuthorizationCurrentness,
  type WorkflowStepExecutor,
} from './coordinator';
import { createWorkflowRunStorageClient } from './workflowRunStorageClient';
import { createCoordinatorWorkspaceResolver } from './resolveWorkflowWorkspace';
import { prepareWorkflowAcceptedWorkspaceTarget } from './resolveWorkflowWorkspace';
import { bindAutomationWorkflowInputs, resolveAutomationWorkflowOccurrenceSeed } from './input';
import type { WorkflowClaimForCoordination } from './worker';
import { deliverWorkflowResultToOriginatingSession } from './stepExecution';
import type { StoredCredentials } from '@/persistence';
import type { AgentState } from '@/api/types';
import {
  AgentStateRequestStore,
  type AgentStateRequestPersistenceTarget,
} from '@/agent/permissions/agentStateRequestStore';
import {
  createProductionWorkflowConversationOwner,
  createProductionFreshWorkflowSessionConversation,
  createProductionWorkflowSessionStepExecutor,
  createWorkflowSessionStepExecutor,
  isPreparedWorkflowSessionConversation,
  WorkflowSessionCompositionError,
} from './sessionStepExecutor';
import {
  createWorkflowAttachedExecutionRunStepExecutor,
  createWorkflowDetachedExecutionRunStepExecutor,
  createWorkflowStepExecutorDispatcher,
  prepareWorkflowDetachedExecutionRunStep,
  WorkflowExecutionRunCompositionError,
  type WorkflowAttachedExecutionRunStepExecutorDeps,
  type WorkflowDetachedExecutionRunStepExecutorDeps,
} from './executionRunStepExecutor';

type StorageClient = ReturnType<typeof createWorkflowRunStorageClient>;
type SealMode =
  | Readonly<{ mode: 'plain' }>
  | Readonly<{ mode: 'e2ee'; material: AccountScopedCryptoMaterial; randomBytes: typeof getRandomBytes }>;

type RunStorageSnapshot = Readonly<{
  run: WorkflowRunSummaryV1;
  acceptedEnvelope: string;
  checkpointEnvelope: string | null;
  resultEnvelope: string | null;
}>;

export function projectWorkflowRootSettlementLifecycle(
  resultState: WorkflowCoordinatorResult['state'],
  currentLifecycle: WorkflowRunInvocationIndexV1['lifecycle'],
): WorkflowRunInvocationIndexV1['lifecycle'] {
  if (resultState === 'succeeded') return 'completed';
  if (resultState === 'cancelled') return 'cancelled';
  if (resultState === 'outcome_uncertain') return 'outcome_uncertain';
  if (resultState === 'failed') return 'failed';
  return currentLifecycle;
}

export function projectWorkflowResultDeliverySettlement(
  status: 'accepted' | 'alreadyAccepted' | 'rejected' | 'update_required' | 'outcomeUnknown',
): 'accepted' | 'unavailable' | null {
  if (status === 'accepted' || status === 'alreadyAccepted') return 'accepted';
  if (status === 'outcomeUnknown') return null;
  return 'unavailable';
}

export function projectWorkflowTerminalCustodySettlement(
  resultState: WorkflowCoordinatorResult['state'],
  pendingResultDelivery: boolean,
): 'settled' | undefined {
  if (pendingResultDelivery || resultState === 'paused' || resultState === 'interrupted') return undefined;
  return 'settled';
}

function parseAutomationStoredEnvelope(serialized: string) {
  let value: unknown;
  try {
    value = JSON.parse(serialized);
  } catch {
    return null;
  }
  const parsed = AutomationStoredContentEnvelopeV1Schema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

function openAutomationStoredContent(params: Readonly<{
  serialized: string;
  kind: 'automation_template_payload' | 'automation_trigger_evidence';
  encryption: AvailableAutomationAccountEncryptionV1;
}>): unknown | null {
  const envelope = parseAutomationStoredEnvelope(params.serialized);
  if (!envelope) return null;
  if (params.encryption.witness.mode === 'plain') return envelope.t === 'plain' ? envelope.v : null;
  if (envelope.t !== 'encrypted' || !isAvailableE2eeAutomationAccountEncryptionV1(params.encryption)) return null;
  try {
    return openAccountScopedBlobCiphertext({
      kind: params.kind,
      material: params.encryption.material.material,
      ciphertext: envelope.c,
    })?.value ?? null;
  } catch {
    return null;
  }
}

function asRecord(value: unknown): Readonly<Record<string, unknown>> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('workflow_storage_response_invalid');
  return value as Readonly<Record<string, unknown>>;
}

function sameStoredValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function parseRunSnapshot(value: unknown): RunStorageSnapshot {
  const record = asRecord(value);
  const run = WorkflowRunSummaryV1Schema.parse(record.run);
  if (typeof record.acceptedEnvelope !== 'string'
    || (record.checkpointEnvelope !== null && typeof record.checkpointEnvelope !== 'string')
    || (record.resultEnvelope !== null && typeof record.resultEnvelope !== 'string')) {
    throw new Error('workflow_storage_response_invalid');
  }
  return {
    run,
    acceptedEnvelope: record.acceptedEnvelope,
    checkpointEnvelope: record.checkpointEnvelope,
    resultEnvelope: record.resultEnvelope,
  };
}

function sealMode(encryption: AvailableAutomationAccountEncryptionV1): SealMode {
  if (!isAvailableE2eeAutomationAccountEncryptionV1(encryption)) return { mode: 'plain' };
  return { mode: 'e2ee', material: encryption.material.material, randomBytes: getRandomBytes };
}

function openMode(encryption: AvailableAutomationAccountEncryptionV1) {
  if (!isAvailableE2eeAutomationAccountEncryptionV1(encryption)) return { mode: 'plain' as const };
  return { mode: 'e2ee' as const, material: encryption.material.material };
}

function blockKinds(blocks: readonly WorkflowBlock[], target = new Map<string, WorkflowBlock['kind']>()): ReadonlyMap<string, WorkflowBlock['kind']> {
  for (const block of blocks) {
    target.set(block.id, block.kind);
    if (block.kind === 'parallel') for (const branch of block.branches) blockKinds(branch.blocks, target);
    if (block.kind === 'if') {
      blockKinds(block.then, target);
      blockKinds(block.otherwise, target);
    }
    if (block.kind === 'loop') {
      blockKinds(block.body, target);
      if (block.repetition.kind === 'evaluate') target.set(block.repetition.evaluator.id, 'step');
    }
  }
  return target;
}

type PersistedInvocation = Readonly<{
  index: WorkflowRunInvocationIndexV1;
  progress: WorkflowProgressEnvelopeV1;
}>;

/** Internal durable row owner, exported only so its persistence concurrency contract can be tested at the real boundary. */
export class DurableWorkflowCoordinatorStore implements WorkflowCoordinatorStore {
  private readonly records = new Map<string, WorkflowCoordinatorInvocation>();
  private readonly persisted = new Map<string, PersistedInvocation>();
  private readonly materializedContainers = new Map<string, import('./input').WorkflowJsonValue>();
  private mutationTail: Promise<void> = Promise.resolve();
  private readonly invocationMutationTails = new Map<string, Promise<void>>();

  constructor(
    private readonly params: {
      accountId: string;
      runId: string;
      parentAttempt: number;
      storage: StorageClient;
      encryption: AvailableAutomationAccountEncryptionV1;
      rootRecordId: string;
      checkpoint: WorkflowCheckpointEnvelopeV1;
      revision: number;
      kinds: ReadonlyMap<string, WorkflowBlock['kind']>;
    },
  ) {}

  static async load(params: ConstructorParameters<typeof DurableWorkflowCoordinatorStore>[0]): Promise<DurableWorkflowCoordinatorStore> {
    const store = new DurableWorkflowCoordinatorStore(params);
    await store.loadInvocation(params.rootRecordId);
    return store;
  }

  private async loadInvocation(invocationId: string): Promise<void> {
    const detailResponse = asRecord(await this.params.storage.execute({ operation: 'invocations.get', runId: this.params.runId, invocationId }));
    const invocation = asRecord(detailResponse.invocation);
    const detailIndex = asRecord(invocation.index);
    const index = WorkflowRunInvocationIndexV1Schema.parse(detailIndex);
    const contentEnvelope = invocation.contentEnvelope;
    if (typeof contentEnvelope !== 'string') throw new Error('workflow_storage_response_invalid');
    const opened = openWorkflowProgressStoredEnvelopeV1({
      ...openMode(this.params.encryption),
      binding: {
        v: 1, purpose: 'invocation_progress', accountId: this.params.accountId, runId: this.params.runId,
        recordId: index.id, sequence: index.sequence, parentRecordId: index.parentRecordId,
        memberOrdinal: index.memberOrdinal, attempt: index.attempt,
      },
      envelope: parseWorkflowStoredContentEnvelopeV1(contentEnvelope),
    });
    if (opened.kind !== 'available') throw new Error('workflow_invocation_content_unavailable');
    this.remember(index, WorkflowProgressEnvelopeV1Schema.parse(opened.content));
  }

  private async loadParentSlot(parentRecordId: string, memberOrdinal: string): Promise<void> {
    let cursor: string | undefined;
    do {
      const page = asRecord(await this.params.storage.execute({
        operation: 'invocations.list', runId: this.params.runId, parentRecordId,
        ...(cursor ? { cursor } : {}), pageByteLimit: EXTERNAL_ACTION_RESPONSE_MAX_SERIALIZED_BYTES,
      }));
      const indices = Array.isArray(page.invocations)
        ? page.invocations.map((value) => WorkflowRunInvocationIndexV1Schema.parse(value)) : [];
      const selected = indices.find((index) => index.memberOrdinal === memberOrdinal);
      if (selected) {
        await this.loadInvocation(selected.id);
        return;
      }
      if (indices.some((index) => BigInt(index.memberOrdinal) > BigInt(memberOrdinal))) return;
      cursor = typeof page.nextCursor === 'string' ? page.nextCursor : undefined;
    } while (cursor);
  }

  private remember(index: WorkflowRunInvocationIndexV1, progress: WorkflowProgressEnvelopeV1): WorkflowCoordinatorInvocation {
    const attempt = Number(index.attempt);
    const key = workflowInvocationKey({ runId: this.params.runId, blockId: progress.invocationPath.blockId, scope: progress.invocationPath.scope, attempt });
    const record: WorkflowCoordinatorInvocation = {
      key, recordId: index.id, logicalInvocationRecordId: progress.logicalInvocationRecordId,
      runId: index.runId, blockId: progress.invocationPath.blockId,
      path: progress.invocationPath, attempt, acceptedAtMs: Date.parse(index.createdAt), lifecycle: index.lifecycle,
      ...(progress.result === undefined ? {} : { result: progress.result }),
      ...(progress.usage === undefined ? {} : { usage: progress.usage }),
      ...(progress.reason ? { reason: progress.reason.code } : {}),
      ...(progress.execution ? { execution: progress.execution } : {}),
      ...(progress.observationDeadline ? { observationDeadline: progress.observationDeadline } : {}),
      ...(progress.input === undefined ? {} : { input: WorkflowAuthoredInputV1Schema.parse(progress.input) }),
      ...(progress.previousAttemptRecordId ? { previousAttemptRecordId: progress.previousAttemptRecordId } : {}),
      ...(progress.recovery ? { recovery: progress.recovery } : {}),
      ...(progress.workspace ? { workspace: progress.workspace } : {}),
      ...(progress.frame ? { frame: progress.frame } : {}),
      ...(progress.container ? { container: progress.container } : {}),
      ...(progress.containerResult ? { containerResult: progress.containerResult } : {}),
    };
    this.records.set(key, record);
    this.persisted.set(key, { index, progress });
    return record;
  }

  read = (key: string) => this.records.get(key);
  readByLogicalInvocation = async (id: string) => {
    const cached = [...this.records.values()].find((record) => record.recordId === id);
    if (cached) return cached;
    await this.loadInvocation(id);
    return [...this.records.values()].find((record) => record.recordId === id);
  };
  readCurrent = async ({ runId, blockId, scope, parentKey, memberOrdinal }: Readonly<{ runId: string; blockId: string; scope: WorkflowProgressEnvelopeV1['invocationPath']['scope']; parentKey?: string; memberOrdinal?: string }>) => {
    const parentRecordId = parentKey ? this.records.get(parentKey)?.recordId : this.params.rootRecordId;
    if (parentRecordId && memberOrdinal !== undefined) await this.loadParentSlot(parentRecordId, memberOrdinal);
    return [...this.records.values()].filter((record) => record.runId === runId && record.blockId === blockId
      && JSON.stringify(record.path.scope) === JSON.stringify(scope)).sort((left, right) => right.attempt - left.attempt)[0];
  };

  private serializeProgress(binding: Parameters<typeof sealWorkflowProgressStoredEnvelopeV1>[0]['binding'], progress: WorkflowProgressEnvelopeV1): string {
    return serializeWorkflowStoredContentEnvelopeV1(sealWorkflowProgressStoredEnvelopeV1({
      ...sealMode(this.params.encryption), binding, progress,
    }));
  }

  private serializeCheckpoint(checkpoint: WorkflowCheckpointEnvelopeV1): string {
    return serializeWorkflowStoredContentEnvelopeV1(sealWorkflowCheckpointStoredEnvelopeV1({
      ...sealMode(this.params.encryption),
      binding: { v: 1, purpose: 'checkpoint', accountId: this.params.accountId, runId: this.params.runId },
      checkpoint,
    }));
  }

  private serialized<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.mutationTail.then(operation, operation);
    this.mutationTail = result.then(() => undefined, () => undefined);
    return result;
  }

  private serializedInvocation<T>(key: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.invocationMutationTails.get(key) ?? Promise.resolve();
    const result = previous.then(operation, operation);
    const tail = result.then(() => undefined, () => undefined);
    this.invocationMutationTails.set(key, tail);
    void tail.finally(() => {
      if (this.invocationMutationTails.get(key) === tail) this.invocationMutationTails.delete(key);
    });
    return result;
  }

  ensureIntent = async (invocation: WorkflowCoordinatorInvocation): Promise<WorkflowCoordinatorInvocation> => await this.serialized(async () => {
    const parentRecordId = invocation.parentKey
      ? this.records.get(invocation.parentKey)?.recordId
      : this.params.rootRecordId;
    if (!parentRecordId) throw new Error('workflow_parent_invocation_missing');
    await this.loadParentSlot(parentRecordId, invocation.memberOrdinal ?? '0');
    const existing = this.records.get(invocation.key);
    if (existing) return existing;
    const sequence = this.params.checkpoint.nextSequence;
    if (invocation.memberOrdinal === undefined) throw new Error('workflow_member_ordinal_missing');
    const memberOrdinal = invocation.memberOrdinal;
    const progress: WorkflowProgressEnvelopeV1 = {
      kind: 'happier.workflow-progress.v1', invocationPath: invocation.path,
      blockKind: this.params.kinds.get(invocation.blockId) ?? 'step', attempt: '0',
      logicalInvocationRecordId: invocation.logicalInvocationRecordId ?? invocation.recordId,
      ...(invocation.execution ? { execution: invocation.execution } : {}),
      ...(invocation.observationDeadline ? { observationDeadline: invocation.observationDeadline } : {}),
      ...(invocation.input ? { input: StrictJsonValueSchema.parse(invocation.input) } : {}),
      ...(invocation.workspace ? { workspace: invocation.workspace } : {}),
      ...(invocation.frame ? { frame: invocation.frame } : {}),
      ...(invocation.container ? { container: invocation.container } : {}),
      ...(invocation.containerResult ? { containerResult: invocation.containerResult } : {}),
    };
    const binding = {
      v: 1 as const, purpose: 'invocation_progress' as const, accountId: this.params.accountId, runId: this.params.runId,
      recordId: invocation.recordId, sequence, parentRecordId, memberOrdinal, attempt: '0',
    };
    const checkpoint = WorkflowCheckpointEnvelopeV1Schema.parse({
      ...this.params.checkpoint,
      nextSequence: (BigInt(sequence) + 1n).toString(),
    });
    const response = asRecord(await this.params.storage.execute({
      operation: 'invocations.admit', runId: this.params.runId, parentAttempt: this.params.parentAttempt,
      accountCurrentness: this.params.encryption.witness,
      expectedRevision: this.params.revision,
      checkpointEnvelope: this.serializeCheckpoint(checkpoint),
      invocations: [{ id: invocation.recordId, sequence, parentRecordId, memberOrdinal, contentEnvelope: this.serializeProgress(binding, progress) }],
    }));
    const admitted = Array.isArray(response.invocations) ? WorkflowRunInvocationIndexV1Schema.parse(response.invocations[0]) : null;
    if (!admitted || typeof response.parentRevision !== 'number') throw new Error('workflow_storage_response_invalid');
    this.params.revision = response.parentRevision;
    this.params.checkpoint = checkpoint;
    const pending = this.remember(admitted, progress);
    if (invocation.lifecycle === 'pending') return pending;
    return await this.commitFact({ key: pending.key, lifecycle: invocation.lifecycle });
  });

  private async commitFactNow(
    fact: Parameters<WorkflowCoordinatorStore['commitFact']>[0],
  ): Promise<WorkflowCoordinatorInvocation> {
    const current = this.records.get(fact.key);
    const persisted = this.persisted.get(fact.key);
    if (!current || !persisted) throw new Error('workflow_invocation_intent_missing');
    const progress = WorkflowProgressEnvelopeV1Schema.parse({
      ...persisted.progress,
      ...(fact.result === undefined ? {} : { result: fact.result }),
      ...(fact.usage === undefined ? {} : { usage: fact.usage }),
      ...(fact.interaction === undefined ? {} : { interaction: fact.interaction }),
      ...(fact.reason ? { reason: { code: fact.reason } } : {}),
      ...(fact.execution ? { execution: fact.execution } : {}),
      ...(fact.observationDeadline ? { observationDeadline: fact.observationDeadline } : {}),
      ...(fact.input ? { input: fact.input } : {}),
      ...(fact.workspace ? { workspace: { ...persisted.progress.workspace, ...fact.workspace } } : {}),
      ...(fact.container ? { container: fact.container } : {}),
      ...(fact.containerResult ? { containerResult: fact.containerResult } : {}),
    });
    const index = persisted.index;
    const binding = {
      v: 1 as const, purpose: 'invocation_progress' as const, accountId: this.params.accountId, runId: this.params.runId,
      recordId: index.id, sequence: index.sequence, parentRecordId: index.parentRecordId,
      memberOrdinal: index.memberOrdinal, attempt: index.attempt,
    };
    let updatedIndex: WorkflowRunInvocationIndexV1;
    try {
      updatedIndex = WorkflowRunInvocationIndexV1Schema.parse(await this.params.storage.execute({
        operation: 'invocations.fact', runId: this.params.runId, parentAttempt: this.params.parentAttempt,
        accountCurrentness: this.params.encryption.witness,
        invocationId: index.id, invocationAttempt: index.attempt, expectedLifecycle: index.lifecycle,
        lifecycle: fact.lifecycle, contentEnvelope: this.serializeProgress(binding, progress),
      }));
    } catch (error) {
      // Cancellation changes the exact row lifecycle at the server. Reload the
      // row once so that this CAS loser cannot overwrite or hide that control.
      await this.loadInvocation(index.id);
      const refreshed = this.records.get(fact.key);
      const workspaceMatches = fact.workspace === undefined
        || ((fact.workspace.creationIntent === undefined
          || sameStoredValue(refreshed?.workspace?.creationIntent, fact.workspace.creationIntent))
          && (fact.workspace.descriptor === undefined
            || sameStoredValue(refreshed?.workspace?.descriptor, fact.workspace.descriptor)));
      if (refreshed?.lifecycle === fact.lifecycle
        && (fact.result === undefined || sameStoredValue(refreshed.result, fact.result))
        && (fact.usage === undefined || sameStoredValue(refreshed.usage, fact.usage))
        && (fact.reason === undefined || refreshed.reason === fact.reason)
        && (fact.execution === undefined || sameStoredValue(refreshed.execution, fact.execution))
        && (fact.observationDeadline === undefined || sameStoredValue(refreshed.observationDeadline, fact.observationDeadline))
        && (fact.input === undefined || sameStoredValue(refreshed.input, fact.input))
        && (fact.container === undefined || sameStoredValue(refreshed.container, fact.container))
        && (fact.containerResult === undefined || sameStoredValue(refreshed.containerResult, fact.containerResult))
        && workspaceMatches) {
        return refreshed;
      }
      if (refreshed?.lifecycle === 'cancel_requested' || refreshed?.lifecycle === 'cancelled') {
        throw new WorkflowControlBoundary('cancelled');
      }
      throw error;
    }
    return this.remember(updatedIndex, progress);
  }

  commitFact = async (
    fact: Parameters<WorkflowCoordinatorStore['commitFact']>[0],
  ): Promise<WorkflowCoordinatorInvocation> => await this.serializedInvocation(
    fact.key,
    async () => await this.commitFactNow(fact),
  );

  createInteractionPersistenceTarget(key: string): AgentStateRequestPersistenceTarget {
    const persisted = this.persisted.get(key);
    if (!persisted) throw new Error('workflow_invocation_intent_missing');
    return Object.freeze({
      scopeId: `${this.params.runId}:${persisted.index.id}`,
      readState: () => {
        const interaction = this.persisted.get(key)?.progress.interaction;
        return interaction && typeof interaction === 'object' && !Array.isArray(interaction)
          ? interaction as AgentState
          : null;
      },
      updateState: async (updater: (state: AgentState) => AgentState) => {
        await this.serializedInvocation(key, async () => {
          const current = this.persisted.get(key);
          if (!current) throw new Error('workflow_invocation_intent_missing');
          const interaction = current.progress.interaction;
          const currentState = interaction && typeof interaction === 'object' && !Array.isArray(interaction)
            ? interaction as AgentState
            : {};
          const updated = updater(currentState);
          const nextInteraction = StrictJsonValueSchema.parse(updated);
          const requests = updated.requests;
          const hasOutstandingRequests = requests !== null
            && typeof requests === 'object'
            && !Array.isArray(requests)
            && Object.keys(requests).length > 0;
          const canEnterWaitingForApproval = current.index.lifecycle === 'admitting'
            || current.index.lifecycle === 'running'
            || current.index.lifecycle === 'waiting_for_approval';
          const nextLifecycle = hasOutstandingRequests && canEnterWaitingForApproval
            ? 'waiting_for_approval' as const
            : current.index.lifecycle === 'waiting_for_approval'
              ? 'running' as const
              : current.index.lifecycle;
          const binding = {
            v: 1 as const,
            purpose: 'invocation_progress' as const,
            accountId: this.params.accountId,
            runId: this.params.runId,
            recordId: current.index.id,
            sequence: current.index.sequence,
            parentRecordId: current.index.parentRecordId,
            memberOrdinal: current.index.memberOrdinal,
            attempt: current.index.attempt,
          };
          const candidate = WorkflowProgressEnvelopeV1Schema.parse({
            ...current.progress,
            interaction: nextInteraction,
          });
          let serializedCandidate: string;
          try {
            serializedCandidate = this.serializeProgress(binding, candidate);
          } catch (error) {
            const issues = error && typeof error === 'object' && Array.isArray((error as { issues?: unknown }).issues)
              ? (error as { issues: Array<{ message?: unknown }> }).issues
              : [];
            if (!issues.some((issue) => issue.message === 'Stored Automation envelope exceeds its UTF-8 byte limit')) {
              throw error;
            }
            throw createWorkflowInteractionCapacityError();
          }
          if (new TextEncoder().encode(serializedCandidate).byteLength > MAX_AUTOMATION_STORED_ENVELOPE_UTF8_BYTES) {
            throw createWorkflowInteractionCapacityError();
          }
          await this.commitFactNow({
            key,
            lifecycle: nextLifecycle,
            interaction: nextInteraction,
          });
        });
      },
    });
  }

  readContainerResult = (record: WorkflowCoordinatorInvocation) => this.materializedContainers.get(record.key);
  rememberContainerResult = ({ key, result }: Readonly<{ key: string; result: import('./input').WorkflowJsonValue }>) => {
    this.materializedContainers.set(key, result);
  };

  commitContainerResult = async ({ key, result }: Readonly<{ key: string; result: import('./input').WorkflowJsonValue }>) => {
    const current = this.records.get(key);
    if (!current) throw new Error('workflow_invocation_intent_missing');
    this.materializedContainers.set(key, result);
    return await this.commitFact({
      key,
      lifecycle: 'completed',
      containerResult: { kind: 'container', containerRecordId: current.recordId },
    });
  };

  commitSharedConversation = async ({ execution, workspace }: Readonly<{
    execution: NonNullable<WorkflowProgressEnvelopeV1['execution']>;
    workspace: import('@happier-dev/protocol').WorkflowWorkspaceDescriptorV1;
  }>): Promise<void> => {
    const root = [...this.records.values()].find((record) => record.recordId === this.params.rootRecordId);
    if (!root) throw new Error('workflow_root_invocation_missing');
    if (root.execution) return;
    await this.commitFact({
      key: root.key,
      lifecycle: root.lifecycle,
      execution,
      workspace: { descriptor: workspace },
    });
  };

  listByLifecycle = async ({ lifecycles }: Readonly<{
    runId: string;
    lifecycles: readonly WorkflowRunInvocationIndexV1['lifecycle'][];
  }>) => {
    const selected: WorkflowCoordinatorInvocation[] = [];
    let cursor: string | undefined;
    do {
      const page = asRecord(await this.params.storage.execute({
        operation: 'invocations.list', runId: this.params.runId, lifecycles,
        ...(cursor ? { cursor } : {}),
        pageByteLimit: EXTERNAL_ACTION_RESPONSE_MAX_SERIALIZED_BYTES,
      }));
      const indices = Array.isArray(page.invocations)
        ? page.invocations.map((value) => WorkflowRunInvocationIndexV1Schema.parse(value)) : [];
      for (const index of indices) {
        await this.loadInvocation(index.id);
        const record = [...this.records.values()].find((candidate) => candidate.recordId === index.id);
        if (record) selected.push(record);
      }
      cursor = typeof page.nextCursor === 'string' ? page.nextCursor : undefined;
    } while (cursor);
    return selected;
  };

  commitFrontier = async ({ nextBlockOrdinal }: Readonly<{ nextBlockOrdinal: number }>): Promise<void> => {
    if (this.params.checkpoint.frontier.nextBlockOrdinal >= nextBlockOrdinal) return;
    await this.serialized(async () => {
      if (this.params.checkpoint.frontier.nextBlockOrdinal >= nextBlockOrdinal) return;
      const checkpoint = WorkflowCheckpointEnvelopeV1Schema.parse({
        ...this.params.checkpoint,
        frontier: { ...this.params.checkpoint.frontier, nextBlockOrdinal },
      });
      const checkpointEnvelope = this.serializeCheckpoint(checkpoint);
      try {
        const run = WorkflowRunSummaryV1Schema.parse(await this.params.storage.execute({
          operation: 'transition', runId: this.params.runId, parentAttempt: this.params.parentAttempt,
          accountCurrentness: this.params.encryption.witness,
          expectedRevision: this.params.revision,
          state: 'running', checkpointEnvelope,
        }));
        this.params.revision = run.revision;
        this.params.checkpoint = checkpoint;
      } catch (error) {
        const snapshot = parseRunSnapshot(await this.params.storage.execute({ operation: 'get', runId: this.params.runId }));
        const envelope = snapshot.checkpointEnvelope && parseWorkflowStoredContentEnvelopeV1(snapshot.checkpointEnvelope);
        if (!envelope) throw error;
        const opened = openWorkflowCheckpointStoredEnvelopeV1({
          ...openMode(this.params.encryption),
          binding: { v: 1, purpose: 'checkpoint', accountId: this.params.accountId, runId: this.params.runId },
          envelope,
        });
        if (opened.kind !== 'available') throw error;
        const current = WorkflowCheckpointEnvelopeV1Schema.parse(opened.content);
        this.params.revision = snapshot.run.revision;
        this.params.checkpoint = current;
        if (current.frontier.nextBlockOrdinal >= nextBlockOrdinal) return;
        if (snapshot.run.state === 'cancelled') throw new WorkflowControlBoundary('cancelled');
        if (snapshot.run.state !== 'pause_requested') throw error;
        const pausedCheckpoint = WorkflowCheckpointEnvelopeV1Schema.parse({
          ...current,
          frontier: { ...current.frontier, nextBlockOrdinal, paused: true },
        });
        const run = WorkflowRunSummaryV1Schema.parse(await this.params.storage.execute({
          operation: 'transition', runId: this.params.runId, parentAttempt: this.params.parentAttempt,
          accountCurrentness: this.params.encryption.witness,
          expectedRevision: snapshot.run.revision,
          state: 'pause_requested', checkpointEnvelope: this.serializeCheckpoint(pausedCheckpoint),
        }));
        this.params.revision = run.revision;
        this.params.checkpoint = pausedCheckpoint;
      }
    });
  };

  readControl = async () => {
    const snapshot = parseRunSnapshot(await this.params.storage.execute({ operation: 'get', runId: this.params.runId }));
    this.params.revision = snapshot.run.revision;
    if (snapshot.run.state === 'pause_requested') return 'pause_requested' as const;
    const cancelled = asRecord(await this.params.storage.execute({
      operation: 'invocations.list', runId: this.params.runId,
      lifecycles: ['cancel_requested'], limit: 1,
      pageByteLimit: EXTERNAL_ACTION_RESPONSE_MAX_SERIALIZED_BYTES,
    }));
    if (Array.isArray(cancelled.invocations) && cancelled.invocations.length > 0) {
      for (const value of cancelled.invocations) {
        const index = WorkflowRunInvocationIndexV1Schema.parse(value);
        const persisted = [...this.persisted.entries()].find(([, item]) => item.index.id === index.id);
        if (persisted) {
          const [key, item] = persisted;
          this.persisted.set(key, { ...item, index });
          const record = this.records.get(key);
          if (record) this.records.set(key, { ...record, lifecycle: index.lifecycle });
        }
      }
      return 'cancel_requested' as const;
    }
    if (snapshot.run.state === 'cancelled') return 'cancel_requested' as const;
    return 'running' as const;
  };

  get checkpoint() { return this.params.checkpoint; }
  get revision() { return this.params.revision; }
  get rootIndex() {
    return [...this.persisted.values()].find((item) => item.index.id === this.params.rootRecordId)?.index;
  }
  refreshRootIndex = async (): Promise<WorkflowRunInvocationIndexV1 | undefined> => {
    await this.loadInvocation(this.params.rootRecordId);
    return this.rootIndex;
  };
  applyParentTransition(run: WorkflowRunSummaryV1, rootLifecycle: WorkflowRunInvocationIndexV1['lifecycle']): void {
    this.params.revision = run.revision;
    const root = [...this.persisted.entries()].find(([, item]) => item.index.id === this.params.rootRecordId);
    if (!root) throw new Error('workflow_root_invocation_missing');
    const [key, item] = root;
    const index = { ...item.index, lifecycle: rootLifecycle };
    this.persisted.set(key, { ...item, index });
    const current = this.records.get(key);
    if (current) this.records.set(key, { ...current, lifecycle: rootLifecycle });
  }

  resolveSharedInvocation(): WorkflowCoordinatorInvocation | null {
    return [...this.records.values()].find((record) => record.recordId === this.params.rootRecordId) ?? null;
  }

  resolveProducerInvocation(
    producer: import('@happier-dev/protocol').WorkflowAuthoredProducerRef,
    consumer: WorkflowProgressEnvelopeV1,
  ): WorkflowCoordinatorInvocation | null {
    let scope = consumer.invocationPath.scope;
    if (producer.scope.kind === 'outer') scope = scope.slice(0, Math.max(0, scope.length - producer.scope.levels));
    if (producer.scope.kind === 'previous_iteration') {
      const loopBlockId = producer.scope.loopBlockId;
      const owner = [...scope].map((part, index) => ({ part, index })).reverse().find(
        ({ part }) => part.kind === 'iteration' && part.blockId === loopBlockId,
      );
      if (!owner || owner.part.kind !== 'iteration' || owner.part.index === 0) return null;
      const ownerPart = owner.part;
      scope = scope.map((part, index) => index === owner.index
        ? { ...ownerPart, index: ownerPart.index - 1 }
        : part);
    }
    return [...this.records.values()]
      .filter((record) => record.blockId === producer.blockId
        && JSON.stringify(record.path.scope) === JSON.stringify(scope))
      .sort((left, right) => right.attempt - left.attempt)[0] ?? null;
  }
}

export type WorkflowProductionExecutionDeps = Readonly<{
  credentials: StoredCredentials;
  serverId: string;
  resolveMachineOperationProtocolCapabilities: (signal?: AbortSignal) => Promise<unknown>;
  machineAdmissionTransport: NonNullable<Parameters<typeof deliverWorkflowResultToOriginatingSession>[0]['machineAdmissionTransport']>;
  resolveTeamCredentialResourceCatalog?: Parameters<typeof createProductionFreshWorkflowSessionConversation>[0]['resolveTeamCredentialResourceCatalog'];
  resolveExistingSessionConversation: Parameters<typeof createProductionWorkflowSessionStepExecutor>[0]['resolveExistingSessionConversation'];
  /** Canonical Session I/O boundary adapter; production uses the incumbent default owner. */
  sessionInput?: Parameters<typeof createProductionWorkflowSessionStepExecutor>[0]['sessionInput'];
  detachedRun: Omit<WorkflowDetachedExecutionRunStepExecutorDeps, 'resolveSharedRunConversation' | 'resolveProducerConversation'>;
  attachedRun: Omit<WorkflowAttachedExecutionRunStepExecutorDeps, 'materializeConversation' | 'resolveRunSession'>;
}>;

/**
 * Production Automation-claim composition. The server remains ciphertext-blind;
 * this daemon opens the admitted snapshot/evidence, owns root/checkpoint and
 * row sealing, and delegates every leaf effect to the Session executor.
 */
export function createProductionWorkflowRunCoordinator(params: Readonly<{
  token: string;
  accountId: string;
  machineId: string;
  resolveAccountEncryption: (signal?: AbortSignal) => Promise<AvailableAutomationAccountEncryptionV1>;
  isAcceptedAuthorizationCurrent: WorkflowAcceptedAuthorizationCurrentness;
  execution: WorkflowProductionExecutionDeps;
  prepareAcceptedWorkspaceTarget?: typeof prepareWorkflowAcceptedWorkspaceTarget;
  /**
   * The SCM/worktree boundary reached through the daemon-applied plugin
   * runtime. Production omits it and uses the canonical owners; composed tests
   * that run outside a loaded daemon supply it, exactly as
   * `prepareAcceptedWorkspaceTarget` already allows for accepted targets.
   */
  workspaceScm?: Parameters<typeof createCoordinatorWorkspaceResolver>[0]['scm'];
  resolveCurrentWorkspaceRefs?: (signal?: AbortSignal) => Promise<readonly import('@happier-dev/protocol').WorkspaceRefV1[]>;
  onCommittedTransition?: (transition: Readonly<{ run: WorkflowRunSummaryV1; result: WorkflowCoordinatorResult }>) => Promise<void> | void;
  resultDelivery?: Readonly<{
    credentials: StoredCredentials;
    resolveMachineOperationProtocolCapabilities: (signal?: AbortSignal) => Promise<unknown>;
    machineAdmissionTransport: NonNullable<Parameters<typeof deliverWorkflowResultToOriginatingSession>[0]['machineAdmissionTransport']>;
  }>;
  storage?: StorageClient;
}>): (claim: WorkflowClaimForCoordination) => Promise<WorkflowCoordinatorResult> {
  const storage = params.storage ?? createWorkflowRunStorageClient({ token: params.token, machineId: params.machineId });
  const onCommittedTransition = params.onCommittedTransition
    ?? createWorkflowRunCommittedNotificationHandler({
      expoPushSender: new PushNotificationClient(params.token),
    });
  return async (claim) => {
    const encryption = await params.resolveAccountEncryption(claim.signal);
    if (!sameAutomationAccountCurrentnessWitnessV1(encryption.witness, claim.accountCurrentness)) {
      return { state: 'failed', reason: 'content_unavailable' };
    }
    let resolvedAcceptedEnvelope = claim.acceptedEnvelope;
    if (claim.definitionEnvelope !== undefined) {
      if (!claim.automationId || !claim.automationCause) return { state: 'failed', reason: 'content_unavailable' };
      const definitionContent = openAutomationStoredContent({
        serialized: claim.definitionEnvelope,
        kind: 'automation_template_payload',
        encryption,
      });
      const storedDefinition = AutomationStoredWorkflowDefinitionV2Schema.safeParse(definitionContent);
      if (!storedDefinition.success || storedDefinition.data.project.machineId !== params.machineId) {
        return { state: 'failed', reason: 'workspace_conflict' };
      }
      const evidenceContent = claim.automationEvidenceEnvelope === null
        ? null
        : claim.automationEvidenceEnvelope === undefined
          ? null
          : openAutomationStoredContent({
            serialized: claim.automationEvidenceEnvelope,
            kind: 'automation_trigger_evidence',
            encryption,
          });
      let inputs: ReturnType<typeof bindAutomationWorkflowInputs>;
      try {
        const occurrenceSeed = WorkflowResolvedInputsV1Schema.parse(resolveAutomationWorkflowOccurrenceSeed({
          cause: claim.automationCause,
          openedEvidence: evidenceContent,
        }));
        inputs = bindAutomationWorkflowInputs({
          definition: storedDefinition.data.definition,
          evidence: occurrenceSeed,
        });
      } catch {
        return { state: 'failed', reason: 'content_unavailable' };
      }
      let workspaceRefs: readonly import('@happier-dev/protocol').WorkspaceRefV1[] = [];
      if (storedDefinition.data.project.workspaceRefId) {
        try {
          workspaceRefs = await params.resolveCurrentWorkspaceRefs?.(claim.signal) ?? [];
        } catch {
          return { state: 'failed', reason: 'workspace_unavailable' };
        }
      }
      const workspace = await (params.prepareAcceptedWorkspaceTarget ?? prepareWorkflowAcceptedWorkspaceTarget)({
        projectTarget: storedDefinition.data.project,
        definition: storedDefinition.data.definition,
        currentServerId: params.execution.serverId,
        resolveWorkspaceRef: (workspaceRefId) => resolveWorkspaceRefById(workspaceRefs, workspaceRefId),
      });
      if (!workspace.ok) return { state: 'failed', reason: workspace.code };
      const created = createAutomationWorkflowAcceptedSnapshotV1({
        automationId: claim.automationId,
        definition: storedDefinition.data.definition,
        ...(storedDefinition.data.metadata ? { metadata: storedDefinition.data.metadata } : {}),
        inputs,
        machineId: params.machineId,
        workspaceTarget: workspace.workspaceTarget,
        ...(storedDefinition.data.source ? { source: storedDefinition.data.source } : {}),
      });
      if (created.kind !== 'available') return { state: 'failed', reason: 'content_unavailable' };
      const candidate = serializeWorkflowStoredContentEnvelopeV1(sealWorkflowAcceptedSnapshotStoredEnvelopeV1({
        ...sealMode(encryption),
        binding: { v: 1, purpose: 'accepted_snapshot', accountId: params.accountId, runId: claim.runId },
        acceptedSnapshot: created.snapshot,
      }));
      const resolution = asRecord(await storage.execute({
        operation: 'accepted-snapshot.resolve',
        accountCurrentness: encryption.witness,
        runId: claim.runId,
        automationId: claim.automationId,
        expectedAttempt: claim.attempt,
        expectedRevision: claim.expectedRevision,
        definitionEnvelope: claim.definitionEnvelope,
        acceptedEnvelope: candidate,
      }, { ...(claim.signal ? { signal: claim.signal } : {}) }));
      if (typeof resolution.acceptedEnvelope !== 'string') throw new Error('workflow_storage_response_invalid');
      resolvedAcceptedEnvelope = resolution.acceptedEnvelope;
    }
    const initial = parseRunSnapshot(await storage.execute({ operation: 'get', runId: claim.runId }, { ...(claim.signal ? { signal: claim.signal } : {}) }));
    if (resolvedAcceptedEnvelope !== undefined && initial.acceptedEnvelope !== resolvedAcceptedEnvelope) {
      return { state: 'failed', reason: 'content_unavailable' };
    }
    const acceptedEnvelope = parseWorkflowStoredContentEnvelopeV1(resolvedAcceptedEnvelope ?? initial.acceptedEnvelope);
    if (!acceptedEnvelope) return { state: 'failed', reason: 'content_unavailable' };
    const openedAccepted = openWorkflowAcceptedSnapshotStoredEnvelopeV1({
      ...openMode(encryption),
      binding: { v: 1, purpose: 'accepted_snapshot', accountId: params.accountId, runId: claim.runId },
      envelope: acceptedEnvelope,
    });
    if (openedAccepted.kind !== 'available') return { state: 'failed', reason: 'content_unavailable' };
    const accepted = WorkflowAcceptedSnapshotV1Schema.parse(openedAccepted.content);
    const inputs = accepted.inputs;
    if (initial.run.machineId !== params.machineId
      || accepted.machineId !== params.machineId
      || accepted.workspaceTarget.project.machineId !== params.machineId) {
      return { state: 'failed', reason: 'workspace_conflict' };
    }
    const isOpenedAuthorizationCurrent = async (signal?: AbortSignal): Promise<boolean> => {
      try {
        const current = await params.resolveAccountEncryption(signal);
        return sameAutomationAccountCurrentnessWitnessV1(current.witness, claim.accountCurrentness)
          && await params.isAcceptedAuthorizationCurrent({
            authorization: accepted.authorization,
            ...(signal ? { signal } : {}),
          });
      } catch {
        return false;
      }
    };
    claim.registerAuthorizationCurrentnessCheck?.(isOpenedAuthorizationCurrent);

    let checkpoint: WorkflowCheckpointEnvelopeV1;
    let rootRecordId: string;
    let revision = initial.run.revision;
    if (initial.checkpointEnvelope === null) {
      rootRecordId = randomUUID();
      checkpoint = WorkflowCheckpointEnvelopeV1Schema.parse({
        kind: 'happier.workflow-checkpoint.v1', rootRecordId, nextSequence: '1',
        frontier: { nextBlockOrdinal: 0, paused: false },
      });
      const rootProgress = WorkflowProgressEnvelopeV1Schema.parse({
        kind: 'happier.workflow-progress.v1', invocationPath: { blockId: '$root', scope: [] },
        blockKind: 'root', attempt: '0', logicalInvocationRecordId: rootRecordId,
      });
      const checkpointEnvelope = serializeWorkflowStoredContentEnvelopeV1(sealWorkflowCheckpointStoredEnvelopeV1({
        ...sealMode(encryption), binding: { v: 1, purpose: 'checkpoint', accountId: params.accountId, runId: claim.runId }, checkpoint,
      }));
      const rootEnvelope = serializeWorkflowStoredContentEnvelopeV1(sealWorkflowProgressStoredEnvelopeV1({
        ...sealMode(encryption),
        binding: { v: 1, purpose: 'invocation_progress', accountId: params.accountId, runId: claim.runId,
          recordId: rootRecordId, sequence: '0', parentRecordId: null, memberOrdinal: '0', attempt: '0' },
        progress: rootProgress,
      }));
      const initialized = asRecord(await storage.execute({ operation: 'initialize', runId: claim.runId,
        parentAttempt: claim.attempt, accountCurrentness: encryption.witness,
        expectedRevision: revision, checkpointEnvelope,
        rootInvocation: { id: rootRecordId, contentEnvelope: rootEnvelope } }));
      const run = WorkflowRunSummaryV1Schema.parse(initialized.run);
      revision = run.revision;
    } else {
      const envelope = parseWorkflowStoredContentEnvelopeV1(initial.checkpointEnvelope);
      const opened = openWorkflowCheckpointStoredEnvelopeV1({
        ...openMode(encryption), binding: { v: 1, purpose: 'checkpoint', accountId: params.accountId, runId: claim.runId }, envelope,
      });
      if (opened.kind !== 'available') return { state: 'failed', reason: 'content_unavailable' };
      checkpoint = WorkflowCheckpointEnvelopeV1Schema.parse(opened.content);
      rootRecordId = checkpoint.rootRecordId;
    }

    const durableStore = await DurableWorkflowCoordinatorStore.load({
      accountId: params.accountId, runId: claim.runId, parentAttempt: claim.attempt,
      storage, encryption, rootRecordId, checkpoint, revision, kinds: blockKinds(accepted.definition.blocks),
    });
    claim.registerControlCheck?.(async () => await durableStore.readControl());
    const rootAtStart = durableStore.rootIndex;
    if (!rootAtStart) throw new Error('workflow_root_invocation_missing');
    if (rootAtStart.lifecycle === 'pending') {
      const checkpointEnvelope = serializeWorkflowStoredContentEnvelopeV1(sealWorkflowCheckpointStoredEnvelopeV1({
        ...sealMode(encryption), binding: { v: 1, purpose: 'checkpoint', accountId: params.accountId, runId: claim.runId },
        checkpoint: durableStore.checkpoint,
      }));
      const started = WorkflowRunSummaryV1Schema.parse(await storage.execute({
        operation: 'transition', runId: claim.runId, parentAttempt: claim.attempt,
        accountCurrentness: encryption.witness,
        expectedRevision: durableStore.revision,
        state: 'running', checkpointEnvelope,
        invocationTransitions: [{ id: rootAtStart.id, expectedLifecycle: 'pending', lifecycle: 'running' }],
      }));
      durableStore.applyParentTransition(started, 'running');
    }
    const resolveSharedSessionConversation = async () => {
      const record = durableStore.resolveSharedInvocation();
      return record?.execution?.kind === 'session' && record.workspace?.descriptor
        ? { sessionId: record.execution.sessionId, machineId: record.workspace.descriptor.machineId,
            directory: record.workspace.descriptor.directory }
        : record?.execution?.kind === 'attached_run' && record.workspace?.descriptor
          ? { sessionId: record.execution.sessionId, machineId: record.workspace.descriptor.machineId,
              directory: record.workspace.descriptor.directory }
          : null;
    };
    const resolveProducerSessionConversation = async ({ producer, invocation }: Readonly<{
      producer: import('@happier-dev/protocol').WorkflowAuthoredProducerRef;
      invocation: WorkflowProgressEnvelopeV1;
    }>) => {
      const record = durableStore.resolveProducerInvocation(producer, invocation);
      return record?.execution?.kind === 'session' && record.workspace?.descriptor
        ? { sessionId: record.execution.sessionId, machineId: record.workspace.descriptor.machineId,
            directory: record.workspace.descriptor.directory }
        : record?.execution?.kind === 'attached_run' && record.workspace?.descriptor
          ? { sessionId: record.execution.sessionId, machineId: record.workspace.descriptor.machineId,
              directory: record.workspace.descriptor.directory }
          : null;
    };
    const freshConversation = createProductionFreshWorkflowSessionConversation({
      credentials: params.execution.credentials,
      serverId: params.execution.serverId,
      machineId: params.machineId,
      machineAdmissionTransport: params.execution.machineAdmissionTransport,
      ...(params.execution.resolveTeamCredentialResourceCatalog
        ? { resolveTeamCredentialResourceCatalog: params.execution.resolveTeamCredentialResourceCatalog }
        : {}),
    });
    const conversations = createProductionWorkflowConversationOwner({
      machineId: params.machineId,
      createFreshConversation: freshConversation,
      resolveSharedRunConversation: resolveSharedSessionConversation,
      resolveProducerConversation: async ({ producer, invocation }) =>
        await resolveProducerSessionConversation({ producer, invocation }),
      resolveExistingSessionConversation: params.execution.resolveExistingSessionConversation,
    });
    const detachedRunDeps: WorkflowDetachedExecutionRunStepExecutorDeps = {
      ...params.execution.detachedRun,
      buildActionContext: (executionParams) => ({
        ...params.execution.detachedRun.buildActionContext(executionParams),
        executionRunPermissionRequestStore: new AgentStateRequestStore({
          target: durableStore.createInteractionPersistenceTarget(workflowInvocationKey({
            runId: executionParams.runId,
            blockId: executionParams.invocation.invocationPath.blockId,
            scope: executionParams.invocation.invocationPath.scope,
            attempt: Number(executionParams.invocation.attempt),
          })),
          logPrefix: `[WORKFLOW ${executionParams.runId}]`,
        }),
      }),
      resolveSharedRunConversation: async () => {
        const record = durableStore.resolveSharedInvocation();
        return record?.execution?.kind === 'detached_run' && record.workspace?.descriptor
          ? {
              runId: record.execution.runId,
              machineId: record.workspace.descriptor.machineId,
              directory: record.workspace.descriptor.directory,
              ...(record.execution.runtimeSelection
                ? { runtimeSelection: record.execution.runtimeSelection }
                : {}),
              ...(record.execution.providerResumeIdentity
                ? { providerResumeIdentity: record.execution.providerResumeIdentity }
                : {}),
            }
          : null;
      },
      resolveProducerConversation: async ({ producer, invocation }) => {
        const record = durableStore.resolveProducerInvocation(producer, invocation);
        return record?.execution?.kind === 'detached_run' && record.workspace?.descriptor
          ? {
              runId: record.execution.runId,
              machineId: record.workspace.descriptor.machineId,
              directory: record.workspace.descriptor.directory,
              ...(record.execution.runtimeSelection
                ? { runtimeSelection: record.execution.runtimeSelection }
                : {}),
              ...(record.execution.providerResumeIdentity
                ? { providerResumeIdentity: record.execution.providerResumeIdentity }
                : {}),
            }
          : null;
      },
    };
    const attachedRunDeps: WorkflowAttachedExecutionRunStepExecutorDeps = {
      ...params.execution.attachedRun,
      materializeConversation: async (executionParams) => {
        const prepared = executionParams.preparedStep;
        const sessionPreparation = isPreparedWorkflowSessionConversation(prepared)
          ? prepared
          : await conversations.prepare(executionParams);
        const conversation = await conversations.materialize(sessionPreparation, executionParams);
        return { ...conversation };
      },
      resolveRunSession: async ({ invocation }) => {
        const execution = invocation.execution;
        if (execution?.kind !== 'attached_run' || !invocation.workspace?.descriptor) return null;
        return {
          sessionId: execution.sessionId,
          runId: execution.runId,
          machineId: invocation.workspace.descriptor.machineId,
          directory: invocation.workspace.descriptor.directory,
        };
      },
    };
    const coordinator = createWorkflowCoordinator({
      store: durableStore,
      isAcceptedAuthorizationCurrent: async (currentness) =>
        await isOpenedAuthorizationCurrent(currentness.signal),
      prepareStep: async (executionParams) => {
        try {
          if (executionParams.executionTarget.kind === 'detached_run') {
            const preparedStep = await prepareWorkflowDetachedExecutionRunStep(
              detachedRunDeps,
              executionParams,
            );
            const retainedConversation = preparedStep.retainedConversation;
            const directory = retainedConversation?.directory;
            return {
              preparedStep,
              ...(retainedConversation
                ? { conversationAdmissionKey: retainedConversation.runId }
                : {}),
              ...(directory
                ? {
                    conversationWorkspace: {
                      machineId: retainedConversation.machineId,
                      directory,
                    },
                  }
                : {}),
            };
          }
          const preparedStep = await conversations.prepare(executionParams);
          return {
            preparedStep,
            ...(preparedStep.existing
              ? {
                  conversationWorkspace: {
                    machineId: preparedStep.existing.machineId,
                    directory: preparedStep.existing.directory,
                  },
                }
              : {}),
          };
        } catch (error) {
          if (error instanceof WorkflowSessionCompositionError) {
            return { failure: { kind: 'failed', code: error.code } };
          }
          if (error instanceof WorkflowExecutionRunCompositionError) {
            return {
              failure: {
                kind: error.code === 'workflow_permission_escalation_denied' ? 'failed' : 'needs_attention',
                code: error.code,
              },
            };
          }
          throw error;
        }
      },
      executeStep: createWorkflowStepExecutorDispatcher({
        session: createWorkflowSessionStepExecutor({
          credentials: params.execution.credentials,
          resolveMachineOperationProtocolCapabilities:
            params.execution.resolveMachineOperationProtocolCapabilities,
          ...(params.execution.sessionInput ? { sessionInput: params.execution.sessionInput } : {}),
          prepareConversation: async (executionParams) => await conversations.prepare(executionParams),
          materializeConversation: async (prepared, executionParams) => {
            const conversation = await conversations.materialize(prepared, executionParams);
            return {
              sessionId: conversation.sessionId,
              machineAdmissionTransport: params.execution.machineAdmissionTransport,
            };
          },
        }),
        detachedRun: createWorkflowDetachedExecutionRunStepExecutor(detachedRunDeps),
        attachedRun: createWorkflowAttachedExecutionRunStepExecutor(attachedRunDeps),
      }),
      resolveWorkspace: createCoordinatorWorkspaceResolver({
        store: durableStore,
        projectWorkspace: accepted.workspaceTarget.project,
        ...(accepted.workspaceTarget.originalCommittedRevision
          ? { originalCommittedRevision: accepted.workspaceTarget.originalCommittedRevision }
          : {}),
        ...(params.workspaceScm ? { scm: params.workspaceScm } : {}),
      }),
    });
    let result = await coordinator.run({ runId: claim.runId, definition: accepted.definition, inputs,
      executionTarget: accepted.executionTarget,
      authorization: accepted.authorization,
      ...(claim.signal ? { signal: claim.signal } : {}) });
    // Cancellation is the terminal authority even when it races the last
    // admitted leaf. A pause that arrives after all authored work completed is
    // intentionally allowed to settle that completed work normally.
    const control = await durableStore.readControl();
    if (control === 'cancel_requested') {
      const pendingStops = await durableStore.listByLifecycle({
        runId: claim.runId,
        lifecycles: ['cancel_requested'],
      });
      const hasPendingChildStop = pendingStops.some(
        (record) => record.recordId !== durableStore.rootIndex?.id,
      );
      // A native stop acknowledgement is not terminal evidence. The exact
      // child remains `cancel_requested`, so retain the already-running parent
      // and pending custody for observation/recovery to close.
      if (result.state === 'interrupted' || hasPendingChildStop) {
        return result.state === 'interrupted'
          ? result
          : { state: 'interrupted', ...(result.reason ? { reason: result.reason } : {}) };
      }
      result = { state: 'cancelled' };
    }
    let terminalState = result.state === 'succeeded' ? 'succeeded' : result.state;
    const rootBeforeSettlement = durableStore.rootIndex;
    if (!rootBeforeSettlement) throw new Error('workflow_root_invocation_missing');
    let rootTerminal = projectWorkflowRootSettlementLifecycle(result.state, rootBeforeSettlement.lifecycle);
    const checkpointEnvelope = serializeWorkflowStoredContentEnvelopeV1(sealWorkflowCheckpointStoredEnvelopeV1({
      ...sealMode(encryption), binding: { v: 1, purpose: 'checkpoint', accountId: params.accountId, runId: claim.runId },
      checkpoint: durableStore.checkpoint,
    }));
    const resultEnvelope = result.finalResult
      ? serializeWorkflowStoredContentEnvelopeV1(sealWorkflowFinalResultStoredEnvelopeV1({
        ...sealMode(encryption),
        binding: { v: 1, purpose: 'final_result', accountId: params.accountId, runId: claim.runId },
        finalResult: result.finalResult,
      }))
      : undefined;
    const resultDelivery = 'resultDelivery' in accepted ? accepted.resultDelivery : undefined;
    const pendingResultDelivery = resultDelivery !== undefined;
    const custodyState = projectWorkflowTerminalCustodySettlement(result.state, pendingResultDelivery);
    const transition = {
      operation: 'transition', runId: claim.runId, parentAttempt: claim.attempt,
      accountCurrentness: encryption.witness,
      expectedRevision: durableStore.revision,
      state: terminalState, checkpointEnvelope,
      ...(resultEnvelope ? { resultEnvelope } : {}),
      ...(custodyState ? { custodyState } : {}),
      ...(rootTerminal === rootBeforeSettlement.lifecycle ? {} : {
        invocationTransitions: [{ id: rootBeforeSettlement.id, expectedLifecycle: rootBeforeSettlement.lifecycle, lifecycle: rootTerminal }],
      }),
    } as const;
    let committed: WorkflowRunSummaryV1;
    try {
      committed = WorkflowRunSummaryV1Schema.parse(await storage.execute(transition));
    } catch (error) {
      const snapshot = parseRunSnapshot(await storage.execute({ operation: 'get', runId: claim.runId }));
      if (snapshot.run.state === 'cancelled') {
        result = { state: 'cancelled' };
        terminalState = 'cancelled';
        rootTerminal = 'cancelled';
        committed = snapshot.run;
      } else {
        const persistedRoot = await durableStore.refreshRootIndex();
        const custodyMatches = snapshot.run.workflowCustodyState === (custodyState ?? 'pending')
          && snapshot.run.workflowResultDeliveryState === (pendingResultDelivery ? 'pending' : null);
        const exactCommittedSettlement = snapshot.run.state === terminalState
          && snapshot.checkpointEnvelope === checkpointEnvelope
          && snapshot.resultEnvelope === (resultEnvelope ?? null)
          && custodyMatches
          && persistedRoot?.lifecycle === rootTerminal;
        if (exactCommittedSettlement) {
          // The transition committed and only its response was lost. Rejoin
          // the exact durable bytes; never replay the mutation.
          committed = snapshot.run;
        } else if (snapshot.run.state === 'pause_requested') {
          // One control-aware CAS reconciliation is sufficient: either all
          // authored work completed and succeeds, or the paused boundary is
          // durably settled. A second conflict remains visible to recovery.
          committed = WorkflowRunSummaryV1Schema.parse(await storage.execute({
            ...transition,
            expectedRevision: snapshot.run.revision,
          }));
        } else {
          throw error;
        }
      }
    }
    durableStore.applyParentTransition(committed, rootTerminal);
    await onCommittedTransition({ run: committed, result });
    const committedParentIsTerminal = committed.state === 'succeeded'
      || committed.state === 'failed'
      || committed.state === 'cancelled'
      || committed.state === 'expired'
      || committed.state === 'dispatch_failed'
      || committed.state === 'skipped'
      || committed.state === 'missed'
      || committed.state === 'outcome_uncertain';
    if (resultDelivery && committedParentIsTerminal) {
      let deliveryState: 'accepted' | 'unavailable' | null = 'unavailable';
      let deliveryReason: 'workflow_outcome_unresolved' | undefined = typeof result.finalOutput === 'string'
        ? undefined
        : 'workflow_outcome_unresolved';
      if (params.resultDelivery && typeof result.finalOutput === 'string') {
        const machineOperationProtocolCapabilities =
          await params.resultDelivery.resolveMachineOperationProtocolCapabilities(claim.signal);
        const delivered = await deliverWorkflowResultToOriginatingSession({
          credentials: params.resultDelivery.credentials,
          sessionId: resultDelivery.originSessionId,
          machineOperationProtocolCapabilities,
          runId: claim.runId,
          text: result.finalOutput,
          machineAdmissionTransport: params.resultDelivery.machineAdmissionTransport,
          ...(claim.signal ? { signal: claim.signal } : {}),
        });
        deliveryState = projectWorkflowResultDeliverySettlement(delivered.status);
      }
      if (deliveryState !== null) {
        await storage.execute({ operation: 'result-delivery.settle', runId: claim.runId,
          parentAttempt: claim.attempt, expectedRevision: committed.revision, state: deliveryState,
          ...(deliveryReason ? { reason: deliveryReason } : {}) });
      }
    }
    return result;
  };
}
