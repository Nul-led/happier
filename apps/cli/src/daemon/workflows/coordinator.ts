import {
  type WorkflowAuthoredInputV1,
  type WorkflowAuthoredProducerRef,
  type WorkflowBlock,
  type WorkflowAcceptedAuthorizationV1,
  type WorkflowCheckpointEnvelopeV1,
  type WorkflowDefinitionV1,
  type WorkflowFinalResultV1,
  type WorkflowInvocationLifecycleV1,
  type WorkflowContainerProgressV1,
  type WorkflowContainerResultSelectorV1,
  type WorkflowInvocationFrameV1,
  type WorkflowLoopSourceSelectionV1,
  type WorkflowRunExecutionTargetV1,
  type WorkflowProgressEnvelopeV1,
  type WorkflowUsageV1,
  type WorkflowStep,
  type WorkflowStepExecutionSelection,
  type WorkflowValueReference,
  type WorkflowWorkspaceDescriptorV1,
  type WorkflowWorkspaceProgressV1,
  type WorkflowWorkspaceResolutionV1,
} from '@happier-dev/protocol';
import { randomUUID } from 'node:crypto';
import {
  decodeExecutionRunProfileResult,
  validateExecutionRunProfileResult,
} from '@/agent/executionRuns/profiles/resultContract';
import { isAuthoritativeAutomationRunCancellation } from '@/daemon/automation/automationRunCancellation';

import {
  evaluateWorkflowCondition,
  materializeWorkflowStepInput,
  resolveWorkflowValueReference,
  isWorkflowJsonObject,
  WorkflowInputResolutionError,
  type MaterializedWorkflowStepInput,
  type WorkflowJsonValue,
  type WorkflowValueResolutionRuntime,
} from './input';
import { findWorkflowStepById } from './workflowDefinitionTraversal';

type WorkflowInvocationPath = WorkflowProgressEnvelopeV1['invocationPath'];
export type WorkflowConversationWorkspace = Pick<WorkflowWorkspaceDescriptorV1, 'machineId' | 'directory'>;

export type WorkflowCoordinatorInvocation = Readonly<{
  key: string;
  /** Opaque persisted row id. It is deliberately distinct from the deterministic invocation key. */
  recordId: string;
  /** Stable logical identity retained across explicit retry attempts. */
  logicalInvocationRecordId?: string;
  runId: string;
  blockId: string;
  /** Internal structural parent key; never projected into authored JSON. */
  parentKey?: string;
  /** Deterministic structural slot under parent, encoded as canonical decimal. */
  memberOrdinal?: string;
  path: WorkflowInvocationPath;
  attempt: number;
  acceptedAtMs: number;
  lifecycle: WorkflowInvocationLifecycleV1;
  result?: WorkflowJsonValue;
  usage?: WorkflowUsageV1;
  reason?: string;
  execution?: WorkflowProgressEnvelopeV1['execution'];
  observationDeadline?: WorkflowProgressEnvelopeV1['observationDeadline'];
  previousAttemptRecordId?: string;
  recovery?: WorkflowProgressEnvelopeV1['recovery'];
  input?: WorkflowAuthoredInputV1;
  workspace?: WorkflowWorkspaceProgressV1;
  frame?: WorkflowInvocationFrameV1;
  container?: WorkflowContainerProgressV1;
  containerResult?: WorkflowContainerResultSelectorV1;
}>;

export type WorkflowCoordinatorStore = Readonly<{
  read: (key: string) => WorkflowCoordinatorInvocation | undefined | Promise<WorkflowCoordinatorInvocation | undefined>;
  readCurrent?: (params: Readonly<{
    runId: string;
    blockId: string;
    scope: WorkflowInvocationPath['scope'];
    parentKey?: string;
    memberOrdinal?: string;
  }>) => WorkflowCoordinatorInvocation | undefined | Promise<WorkflowCoordinatorInvocation | undefined>;
  readByLogicalInvocation: (logicalInvocationRecordId: string) => WorkflowCoordinatorInvocation | undefined | Promise<WorkflowCoordinatorInvocation | undefined>;
  listByLifecycle?: (params: Readonly<{
    runId: string;
    lifecycles: readonly WorkflowInvocationLifecycleV1[];
  }>) => readonly WorkflowCoordinatorInvocation[] | Promise<readonly WorkflowCoordinatorInvocation[]>;
  ensureIntent: (invocation: WorkflowCoordinatorInvocation) => Promise<WorkflowCoordinatorInvocation>;
  commitFact: (params: Readonly<{
    key: string;
    lifecycle: WorkflowInvocationLifecycleV1;
    result?: WorkflowJsonValue;
    usage?: WorkflowUsageV1;
    /** Private invocation-scoped request state; never a selected step result. */
    interaction?: WorkflowJsonValue;
    reason?: string;
    execution?: WorkflowProgressEnvelopeV1['execution'];
    observationDeadline?: WorkflowProgressEnvelopeV1['observationDeadline'];
    input?: WorkflowAuthoredInputV1;
    workspace?: WorkflowWorkspaceProgressV1;
    container?: WorkflowContainerProgressV1;
    containerResult?: WorkflowContainerResultSelectorV1;
  }>) => Promise<WorkflowCoordinatorInvocation>;
  readContainerResult?: (record: WorkflowCoordinatorInvocation) => WorkflowJsonValue | undefined | Promise<WorkflowJsonValue | undefined>;
  rememberContainerResult?: (params: Readonly<{ key: string; result: WorkflowJsonValue }>) => void;
  commitContainerResult?: (params: Readonly<{ key: string; result: WorkflowJsonValue }>) => Promise<WorkflowCoordinatorInvocation>;
  commitSharedConversation?: (params: Readonly<{
    execution: NonNullable<WorkflowProgressEnvelopeV1['execution']>;
    workspace: WorkflowWorkspaceDescriptorV1;
  }>) => Promise<void>;
  commitFrontier?: (params: Readonly<{ nextBlockOrdinal: number }>) => Promise<void>;
  readControl?: (runId: string) => Promise<'running' | 'pause_requested' | 'cancel_requested'>;
}>;

export type WorkflowStepExecutionResult =
  | Readonly<{
      kind: 'completed';
      result?: WorkflowJsonValue;
      usage?: WorkflowUsageV1;
      /** Native Execution Run results are already decoded; Session results remain exact assistant text. */
      resultEncoding?: 'raw_text' | 'typed';
    }>
  | Readonly<{ kind: 'failed'; code: string; usage?: WorkflowUsageV1 }>
  | Readonly<{ kind: 'needs_attention'; code: string; usage?: WorkflowUsageV1 }>
  | Readonly<{ kind: 'cancelled'; code?: string; usage?: WorkflowUsageV1 }>
  | Readonly<{ kind: 'outcome_uncertain'; code: string; usage?: WorkflowUsageV1 }>;

export type WorkflowStepExecutor = (params: Readonly<{
  runId: string;
  step: WorkflowStep;
  invocation: WorkflowProgressEnvelopeV1;
  /** Physical attempt row; exact input identities change across retries. */
  invocationRecordId?: string;
  recoveryPreviousExecution?: WorkflowProgressEnvelopeV1['execution'];
  recoveryPreviousWorkspace?: WorkflowWorkspaceDescriptorV1;
  input: MaterializedWorkflowStepInput;
  execution: WorkflowStepExecutionSelection;
  /** One immutable execution placement frozen at Run admission. */
  executionTarget: WorkflowRunExecutionTargetV1;
  workspace: WorkflowWorkspaceDescriptorV1;
  /** Opaque preparation produced by the target's canonical conversation owner before workspace effects. */
  preparedStep?: unknown;
  /** Immutable authority admitted with the Run; leaf adapters reject broader effective requests. */
  authorization: WorkflowAcceptedAuthorizationV1;
  item?: Readonly<{ value: WorkflowJsonValue; index: number; position: number; count: number }>;
  iteration?: Readonly<{ index: number; position: number; count: number; stopReason: WorkflowJsonValue | null }>;
  onInputAccepted: (execution: NonNullable<WorkflowProgressEnvelopeV1['execution']>) => Promise<void>;
  /** Exact pre-terminal Workflow fact emitted by a detached Execution Run. */
  onExecutionObservation?: (observation: Readonly<{
    execution: Extract<NonNullable<WorkflowProgressEnvelopeV1['execution']>, { kind: 'detached_run' }>;
    usage?: WorkflowUsageV1;
  }>) => Promise<void>;
  signal?: AbortSignal;
}>) => Promise<WorkflowStepExecutionResult>;

export type WorkflowStepPreparer = (params: Readonly<{
  runId: string;
  step: WorkflowStep;
  invocation: WorkflowProgressEnvelopeV1;
  invocationRecordId?: string;
  recoveryPreviousExecution?: WorkflowProgressEnvelopeV1['execution'];
  recoveryPreviousWorkspace?: WorkflowWorkspaceDescriptorV1;
  execution: WorkflowStepExecutionSelection;
  executionTarget: WorkflowRunExecutionTargetV1;
  authorization: WorkflowAcceptedAuthorizationV1;
  item?: Readonly<{ value: WorkflowJsonValue; index: number; position: number; count: number }>;
  iteration?: Readonly<{ index: number; position: number; count: number; stopReason: WorkflowJsonValue | null }>;
  signal?: AbortSignal;
}>) => Promise<Readonly<{
  conversationWorkspace?: WorkflowConversationWorkspace;
  /** Opaque identity of an already-retained conversation whose native input frontier is singular. */
  conversationAdmissionKey?: string;
  preparedStep?: unknown;
  failure?: Readonly<{ kind: 'failed' | 'needs_attention'; code: string }>;
}>>;

export type WorkflowWorkspaceResolver = (params: Readonly<{
  runId: string;
  definition: WorkflowDefinitionV1;
  step: WorkflowStep;
  invocation: WorkflowCoordinatorInvocation;
  scope: WorkflowInvocationPath['scope'];
  conversationWorkspace?: WorkflowConversationWorkspace;
}>) => Promise<WorkflowWorkspaceResolutionV1>;

export type WorkflowAcceptedAuthorizationCurrentness = (params: Readonly<{
  authorization: WorkflowAcceptedAuthorizationV1;
  signal?: AbortSignal;
}>) => boolean | Promise<boolean>;

export type WorkflowCoordinatorResult = Readonly<{
  state: 'succeeded' | 'interrupted' | 'paused' | 'cancelled' | 'outcome_uncertain' | 'failed';
  completedWithFailures?: boolean;
  finalOutput?: WorkflowJsonValue;
  finalResult?: WorkflowFinalResultV1;
  reason?: string;
}>;

type Frame = {
  parent?: Frame;
  results: Map<string, WorkflowJsonValue>;
  resultRecords: Map<string, string>;
  previousIterations: Map<string, Map<string, WorkflowJsonValue>>;
  previousIterationRecords: Map<string, Map<string, string>>;
  collectedFailures: boolean;
  item?: Readonly<{ value: WorkflowJsonValue; index: number; position: number; count: number }>;
  iteration?: Readonly<{ index: number; position: number; count: number; stopReason: WorkflowJsonValue | null }>;
};

export class WorkflowControlBoundary extends Error {
  constructor(readonly state: 'paused' | 'cancelled') {
    super(state);
  }
}

/** Exact abort reason shared with the incumbent claimed-Run heartbeat. */
export const WORKFLOW_AUTHORIZATION_NOT_CURRENT_ABORT_REASON = 'workflow_authorization_not_current';
/** Exact abort reason the incumbent claimed-Run heartbeat uses for a persisted cancel request. */
export const WORKFLOW_CANCEL_REQUESTED_ABORT_REASON = 'workflow_cancel_requested';

class WorkflowLeafFailure extends Error {
  constructor(
    readonly state: 'interrupted' | 'cancelled' | 'outcome_uncertain' | 'failed',
    readonly code: string,
    readonly collectable = false,
  ) {
    super(code);
  }
}

/**
 * This claim attempt lost its currentness (daemon shutdown, lease-heartbeat
 * loss, stale-attempt invalidation) without any cancellation authority. It
 * unwinds exactly like a crash: no leaf, container or parent fact is written
 * and no owned work is stopped, so the incumbent reclaim rejoins the durable
 * correspondence and observes whatever survived.
 */
export class WorkflowRuntimeInterruption extends Error {
  constructor() {
    super('runtime_interrupted');
  }
}

export type WorkflowAbortClassification =
  | 'none'
  | 'cancelled'
  | 'fail_stop'
  | 'authorization_revoked'
  | 'interrupted';

/**
 * The one reading of a claim/coordinator abort. Only an authoritative or
 * persisted cancel request, a fail-stop sibling closure, or authority
 * revocation may stop owned work or close the frontier; every other abort is
 * a runtime interruption of this attempt.
 */
export function classifyWorkflowAbort(signal: AbortSignal | undefined): WorkflowAbortClassification {
  if (!signal?.aborted) return 'none';
  const reason: unknown = signal.reason;
  if (reason === WORKFLOW_AUTHORIZATION_NOT_CURRENT_ABORT_REASON) return 'authorization_revoked';
  if (reason === WORKFLOW_CANCEL_REQUESTED_ABORT_REASON || isAuthoritativeAutomationRunCancellation(signal)) {
    return 'cancelled';
  }
  if (reason instanceof WorkflowLeafFailure || reason instanceof WorkflowInputResolutionError) return 'fail_stop';
  return 'interrupted';
}

export function workflowInvocationKey(params: Readonly<{
  runId: string;
  blockId: string;
  scope: WorkflowInvocationPath['scope'];
  attempt: number;
}>): string {
  const scope = params.scope.map((part) => part.kind === 'branch'
    ? `b:${part.blockId}:${part.branchId}`
    : `i:${part.blockId}:${part.index}`).join('|');
  return `workflow:${params.runId}:${scope}:${params.blockId}:attempt:${params.attempt}`;
}

export type InMemoryWorkflowCoordinatorStore = Omit<
  WorkflowCoordinatorStore,
  'read' | 'readCurrent' | 'readByLogicalInvocation' | 'listByLifecycle'
> & Readonly<{
  records: Map<string, WorkflowCoordinatorInvocation>;
  read: (key: string) => WorkflowCoordinatorInvocation | undefined;
  readCurrent: (params: Readonly<{
    runId: string;
    blockId: string;
    scope: WorkflowInvocationPath['scope'];
    parentKey?: string;
    memberOrdinal?: string;
  }>) => WorkflowCoordinatorInvocation | undefined;
  readByLogicalInvocation: (logicalInvocationRecordId: string) => WorkflowCoordinatorInvocation | undefined;
  listByLifecycle: (params: Readonly<{
    runId: string;
    lifecycles: readonly WorkflowInvocationLifecycleV1[];
  }>) => readonly WorkflowCoordinatorInvocation[];
}>;

export function createInMemoryWorkflowCoordinatorStore(): InMemoryWorkflowCoordinatorStore {
  const records = new Map<string, WorkflowCoordinatorInvocation>();
  const materializedContainers = new Map<string, WorkflowJsonValue>();
  return {
    records,
    read: (key) => records.get(key),
    readCurrent: ({ runId, blockId, scope, parentKey, memberOrdinal }) => [...records.values()]
      .filter((record) => record.runId === runId && record.blockId === blockId
        && JSON.stringify(record.path.scope) === JSON.stringify(scope)
        && (parentKey === undefined || record.parentKey === parentKey)
        && (memberOrdinal === undefined || record.memberOrdinal === memberOrdinal))
      .sort((left, right) => right.attempt - left.attempt)[0],
    readByLogicalInvocation: (id) => [...records.values()].find((record) => record.recordId === id),
    listByLifecycle: ({ runId, lifecycles }) => [...records.values()].filter(
      (record) => record.runId === runId && lifecycles.includes(record.lifecycle),
    ),
    ensureIntent: async (invocation) => {
      const existing = records.get(invocation.key);
      if (existing) return existing;
      records.set(invocation.key, invocation);
      return invocation;
    },
    readContainerResult: (record) => materializedContainers.get(record.key),
    rememberContainerResult: ({ key, result }) => { materializedContainers.set(key, result); },
    commitContainerResult: async ({ key, result }) => {
      const existing = records.get(key);
      if (!existing) throw new Error('workflow_invocation_intent_missing');
      const committed = { ...existing, lifecycle: 'completed' as const,
        containerResult: { kind: 'container' as const, containerRecordId: existing.recordId } };
      materializedContainers.set(key, result);
      records.set(key, committed);
      return committed;
    },
    commitFact: async ({ key, lifecycle, result, usage, reason, execution, observationDeadline, input, workspace, container, containerResult }) => {
      const existing = records.get(key);
      if (!existing) throw new Error('workflow_invocation_intent_missing');
      if (existing.lifecycle === 'completed' || existing.lifecycle === 'failed'
        || existing.lifecycle === 'skipped' || existing.lifecycle === 'cancelled'
        || existing.lifecycle === 'outcome_uncertain') {
        if (existing.lifecycle !== lifecycle
          || !sameOptionalJson(existing.result, result)
          || JSON.stringify(existing.usage) !== JSON.stringify(usage)) {
          throw new Error('workflow_invocation_fact_conflict');
        }
        return existing;
      }
      const committed = { ...existing, lifecycle, ...(result === undefined ? {} : { result }), ...(usage === undefined ? {} : { usage }), ...(reason ? { reason } : {}), ...(execution ? { execution } : {}), ...(observationDeadline ? { observationDeadline } : {}), ...(input ? { input } : {}), ...(workspace ? { workspace: { ...existing.workspace, ...workspace } } : {}), ...(container ? { container } : {}), ...(containerResult ? { containerResult } : {}) };
      records.set(key, committed);
      return committed;
    },
  };
}

function sameOptionalJson(left: WorkflowJsonValue | undefined, right: WorkflowJsonValue | undefined): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function childFrame(parent: Frame, overrides: Partial<Pick<Frame, 'item' | 'iteration'>> = {}): Frame {
  return {
    parent,
    results: new Map(),
    resultRecords: new Map(),
    previousIterations: new Map(),
    previousIterationRecords: new Map(),
    collectedFailures: false,
    ...overrides,
  };
}

function effectiveExecution(definition: WorkflowDefinitionV1, step: WorkflowStep): WorkflowStepExecutionSelection {
  return { ...definition.defaults, ...step.execution };
}

/**
 * Conservatively projects only a directly addressable next top-level Session
 * binding. Structural reachability remains with the coordinator; callers must
 * treat `false` as "not proven equal", never as proof that no later step can
 * use the Session.
 */
export function doesWorkflowImmediateEligibleStepTargetSession(input: Readonly<{
  definition: WorkflowDefinitionV1;
  checkpoint: WorkflowCheckpointEnvelopeV1 | null;
  executionTarget: WorkflowRunExecutionTargetV1;
  sessionId: string;
}>): boolean {
  if (input.executionTarget.kind === 'detached_run' || input.checkpoint?.frontier.paused) return false;
  const block = input.definition.blocks[input.checkpoint?.frontier.nextBlockOrdinal ?? 0];
  if (!block || block.kind !== 'step' || block.onlyWhen) return false;
  const conversation = effectiveExecution(input.definition, block).conversation;
  return conversation?.kind === 'existing_session' && conversation.sessionId === input.sessionId;
}

function createResolutionRuntime(
  inputs: Readonly<Record<string, WorkflowJsonValue>>,
  frame: Frame,
  store: WorkflowCoordinatorStore,
): WorkflowValueResolutionRuntime {
  const resolveProducerRecordId = (producer: WorkflowAuthoredProducerRef): string | undefined => {
    let selectedFrame: Frame | undefined = frame;
    if (producer.scope.kind === 'outer') {
      for (let level = 0; level < producer.scope.levels; level += 1) selectedFrame = selectedFrame?.parent;
    }
    if (producer.scope.kind === 'previous_iteration') {
      while (selectedFrame && !selectedFrame.previousIterationRecords.has(producer.scope.loopBlockId)) {
        selectedFrame = selectedFrame.parent;
      }
      return selectedFrame?.previousIterationRecords
        .get(producer.scope.loopBlockId)?.get(producer.blockId);
    }
    return selectedFrame?.resultRecords.get(producer.blockId);
  };
  return {
    inputs,
    ...(frame.item ? { item: frame.item } : {}),
    ...(frame.iteration ? { iteration: frame.iteration } : {}),
    resolveResult: async (producer) => {
      let selectedFrame: Frame | undefined = frame;
      if (producer.scope.kind === 'outer') {
        for (let level = 0; level < producer.scope.levels; level += 1) selectedFrame = selectedFrame?.parent;
      }
      let value: WorkflowJsonValue | undefined;
      if (producer.scope.kind === 'previous_iteration') {
        while (selectedFrame && !selectedFrame.previousIterations.has(producer.scope.loopBlockId)) {
          selectedFrame = selectedFrame.parent;
        }
        value = selectedFrame?.previousIterations.get(producer.scope.loopBlockId)?.get(producer.blockId);
      } else {
        value = selectedFrame?.results.get(producer.blockId);
      }
      if (value === undefined) throw new WorkflowInputResolutionError('missing_reference');
      return value;
    },
    resolveWorkspace: async (producer) => {
      const recordId = resolveProducerRecordId(producer);
      const record = recordId === undefined
        ? undefined
        : await store.readByLogicalInvocation(recordId);
      const workspace = record?.workspace?.descriptor;
      if (!workspace) throw new WorkflowInputResolutionError('missing_reference');
      return workspace;
    },
  };
}

function resolveLoopSourceSelection(
  reference: WorkflowValueReference,
  frame: Frame,
): WorkflowLoopSourceSelectionV1 {
  if (reference.kind === 'literal' || reference.kind === 'input') {
    return { kind: 'definition', reference };
  }
  if (reference.kind !== 'result') throw new WorkflowInputResolutionError('invalid_reference_scope');
  let selectedFrame: Frame | undefined = frame;
  if (reference.producer.scope.kind === 'outer') {
    for (let level = 0; level < reference.producer.scope.levels; level += 1) selectedFrame = selectedFrame?.parent;
  }
  let recordId: string | undefined;
  if (reference.producer.scope.kind === 'previous_iteration') {
    while (selectedFrame && !selectedFrame.previousIterationRecords.has(reference.producer.scope.loopBlockId)) {
      selectedFrame = selectedFrame.parent;
    }
    recordId = selectedFrame?.previousIterationRecords
      .get(reference.producer.scope.loopBlockId)?.get(reference.producer.blockId);
  } else {
    recordId = selectedFrame?.resultRecords.get(reference.producer.blockId);
  }
  if (!recordId) throw new WorkflowInputResolutionError('missing_reference');
  return { kind: 'result', recordId, path: reference.path };
}

async function resolveSelectedLoopSource(
  selection: WorkflowLoopSourceSelectionV1,
  frame: Frame,
  context: ExecutionContext,
): Promise<WorkflowJsonValue> {
  const runtime = createResolutionRuntime(context.inputs, frame, context.deps.store);
  if (selection.kind === 'definition') {
    return await resolveWorkflowValueReference(selection.reference, runtime);
  }
  const sourceRecord = await context.deps.store.readByLogicalInvocation(selection.recordId);
  if (!sourceRecord || sourceRecord.lifecycle !== 'completed') {
    throw new WorkflowInputResolutionError('missing_reference');
  }
  const sourceResult = sourceRecord.result !== undefined
    ? sourceRecord.result
    : await context.deps.store.readContainerResult?.(sourceRecord);
  if (sourceResult === undefined) throw new WorkflowInputResolutionError('missing_reference');
  return await resolveWorkflowValueReference({
    kind: 'result',
    producer: { blockId: sourceRecord.blockId, scope: { kind: 'current' } },
    path: selection.path,
  }, {
    ...runtime,
    resolveResult: async () => sourceResult,
  });
}

class OptionalSemaphore {
  private active = 0;
  private readonly waiters: Array<() => void> = [];
  constructor(private readonly maximum: number | undefined) {}
  async run<T>(operation: () => Promise<T>, onWaiting?: () => Promise<void>): Promise<T> {
    if (this.maximum !== undefined && this.active >= this.maximum) {
      await onWaiting?.();
      await new Promise<void>((resolve) => this.waiters.push(resolve));
    }
    this.active += 1;
    try {
      return await operation();
    } finally {
      this.active -= 1;
      this.waiters.shift()?.();
    }
  }
}

class KeyedAdmissionGate {
  private readonly tails = new Map<string, Promise<void>>();
  async acquire(key: string): Promise<() => void> {
    const previous = this.tails.get(key) ?? Promise.resolve();
    let releaseCurrent!: () => void;
    const current = new Promise<void>((resolve) => { releaseCurrent = resolve; });
    const tail = previous.then(() => current);
    this.tails.set(key, tail);
    await previous;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      releaseCurrent();
      if (this.tails.get(key) === tail) this.tails.delete(key);
    };
  }
}

function withAbortSignal(context: ExecutionContext, signal: AbortSignal): ExecutionContext {
  if (!context.signal) return { ...context, signal };
  const combined = new AbortController();
  const relay = (source: AbortSignal) => {
    if (!combined.signal.aborted) combined.abort(source.reason);
  };
  if (context.signal.aborted) relay(context.signal);
  else context.signal.addEventListener('abort', () => relay(context.signal!), { once: true });
  if (signal.aborted) relay(signal);
  else signal.addEventListener('abort', () => relay(signal), { once: true });
  return { ...context, signal: combined.signal };
}

function persistedFailure(record: WorkflowCoordinatorInvocation): WorkflowLeafFailure | undefined {
  const code = record.reason ?? record.lifecycle;
  switch (record.lifecycle) {
    case 'cancelled':
      return new WorkflowLeafFailure('cancelled', code);
    case 'cancel_requested':
      return new WorkflowLeafFailure('interrupted', code);
    case 'outcome_uncertain':
      return new WorkflowLeafFailure(record.execution ? 'interrupted' : 'outcome_uncertain', code);
    case 'failed':
      if (code === 'loop_limit_reached' || code === 'invalid_reference_scope' || code === 'missing_reference') {
        return new WorkflowLeafFailure('failed', code);
      }
      // A persisted definitive leaf failure remains collectable after process
      // reconstruction. The authored parent policy decides whether that fact
      // is collected or fail-stops; the leaf row does not encode that policy.
      return new WorkflowLeafFailure('interrupted', code, true);
    default:
      return undefined;
  }
}

function createWorkflowFinalResult(
  step: WorkflowStep | undefined,
  value: WorkflowJsonValue,
  producerInvocationRecordId: string,
): WorkflowFinalResultV1 {
  // Container and branch outputs are structural JSON values. Only a leaf Step
  // carries an authored scalar result contract.
  if (!step) {
    return {
      kind: 'happier.workflow-final-result.v1',
      result: { kind: 'json', value },
      producerInvocation: { recordId: producerInvocationRecordId },
    };
  }
  switch (step.result.kind) {
    case 'text':
    case 'decision':
      if (typeof value !== 'string') throw new WorkflowInputResolutionError('invalid_reference_scope');
      return {
        kind: 'happier.workflow-final-result.v1',
        result: { kind: step.result.kind, value },
        producerInvocation: { recordId: producerInvocationRecordId },
      };
    case 'json':
      return {
        kind: 'happier.workflow-final-result.v1',
        result: { kind: 'json', value },
        producerInvocation: { recordId: producerInvocationRecordId },
      };
  }
}

export function createWorkflowCoordinator(deps: Readonly<{
  store: WorkflowCoordinatorStore;
  executeStep: WorkflowStepExecutor;
  prepareStep?: WorkflowStepPreparer;
  resolveWorkspace: WorkflowWorkspaceResolver;
  /** Revalidates the accepted Account/authority binding before a new leaf effect. */
  isAcceptedAuthorizationCurrent: WorkflowAcceptedAuthorizationCurrentness;
  allocateInvocationRecordId?: () => string;
}>): Readonly<{
  run: (params: Readonly<{
    runId: string;
    definition: WorkflowDefinitionV1;
    inputs: Readonly<Record<string, WorkflowJsonValue>>;
    executionTarget: WorkflowRunExecutionTargetV1;
    authorization: WorkflowAcceptedAuthorizationV1;
    signal?: AbortSignal;
  }>) => Promise<WorkflowCoordinatorResult>;
}> {
  return {
    run: async ({ runId, definition, inputs, executionTarget, authorization, signal }) => {
      const root: Frame = {
        results: new Map(),
        resultRecords: new Map(),
        previousIterations: new Map(),
        previousIterationRecords: new Map(),
        collectedFailures: false,
      };
      try {
        const context: ExecutionContext = {
          runId, definition, inputs, executionTarget, authorization,
          deps: { ...deps, allocateInvocationRecordId: deps.allocateInvocationRecordId ?? randomUUID },
          admissionGate: new KeyedAdmissionGate(), signal,
        };
        for (let index = 0; index < definition.blocks.length; index += 1) {
          await executeBlock(definition.blocks[index]!, [], root, context, undefined, String(index));
          await deps.store.commitFrontier?.({ nextBlockOrdinal: index + 1 });
        }
        const finalOutput = definition.finalOutput
          ? await resolveWorkflowValueReference(definition.finalOutput, createResolutionRuntime(inputs, root, deps.store))
          : undefined;
        const selectedStep = definition.finalOutput
          ? findWorkflowStepById(definition.blocks, definition.finalOutput.producer.blockId)
          : undefined;
        const finalOutputInvocationRecordId = definition.finalOutput
          ? root.resultRecords.get(definition.finalOutput.producer.blockId)
          : undefined;
        const finalResult = finalOutput === undefined || !finalOutputInvocationRecordId
          ? undefined
          : createWorkflowFinalResult(selectedStep, finalOutput, finalOutputInvocationRecordId);
        return {
          state: 'succeeded',
          ...(root.collectedFailures ? { completedWithFailures: true } : {}),
          ...(finalOutput === undefined ? {} : { finalOutput }),
          ...(finalResult ? { finalResult } : {}),
        };
      } catch (error) {
        if (error instanceof WorkflowControlBoundary) return { state: error.state };
        if (error instanceof WorkflowLeafFailure) return { state: error.state, reason: error.code };
        if (error instanceof WorkflowInputResolutionError) return { state: 'failed', reason: error.code };
        throw error;
      }
    },
  };
}

type ExecutionContext = Readonly<{
  runId: string;
  definition: WorkflowDefinitionV1;
  inputs: Readonly<Record<string, WorkflowJsonValue>>;
  authorization: WorkflowAcceptedAuthorizationV1;
  executionTarget: WorkflowRunExecutionTargetV1;
  signal?: AbortSignal;
  admissionGate: KeyedAdmissionGate;
  deps: Readonly<{
    store: WorkflowCoordinatorStore;
    executeStep: WorkflowStepExecutor;
    prepareStep?: WorkflowStepPreparer;
    resolveWorkspace: WorkflowWorkspaceResolver;
    isAcceptedAuthorizationCurrent: WorkflowAcceptedAuthorizationCurrentness;
    allocateInvocationRecordId: () => string;
  }>;
}>;

async function assertAdmissionOpen(context: ExecutionContext): Promise<void> {
  switch (classifyWorkflowAbort(context.signal)) {
    case 'authorization_revoked':
      throw new WorkflowLeafFailure(
        'interrupted',
        WORKFLOW_AUTHORIZATION_NOT_CURRENT_ABORT_REASON,
      );
    case 'interrupted':
      throw new WorkflowRuntimeInterruption();
    case 'cancelled':
    case 'fail_stop':
      throw new WorkflowControlBoundary('cancelled');
    case 'none':
      break;
  }
  const control = await context.deps.store.readControl?.(context.runId) ?? 'running';
  if (control === 'pause_requested') throw new WorkflowControlBoundary('paused');
  if (control === 'cancel_requested') throw new WorkflowControlBoundary('cancelled');
}

const CAPACITY_OCCUPYING_LIFECYCLES = [
  'admitting', 'running', 'waiting_for_approval', 'needs_attention', 'cancel_requested',
] as const satisfies readonly WorkflowInvocationLifecycleV1[];

function scopeStartsWith(
  candidate: WorkflowInvocationPath['scope'],
  prefix: WorkflowInvocationPath['scope'],
): boolean {
  return prefix.every((part, index) => JSON.stringify(candidate[index]) === JSON.stringify(part));
}

async function orderPipelinesForRecovery<T extends Readonly<{ scope: WorkflowInvocationPath['scope'] }>>(
  pipelines: readonly T[],
  context: ExecutionContext,
): Promise<readonly T[]> {
  if (!context.deps.store.listByLifecycle) return pipelines;
  const active = await context.deps.store.listByLifecycle({
    runId: context.runId,
    lifecycles: CAPACITY_OCCUPYING_LIFECYCLES,
  });
  return pipelines
    .map((pipeline, sourceIndex) => ({
      pipeline,
      sourceIndex,
      occupied: active.some((record) => scopeStartsWith(record.path.scope, pipeline.scope)),
    }))
    .sort((left, right) => Number(right.occupied) - Number(left.occupied) || left.sourceIndex - right.sourceIndex)
    .map(({ pipeline }) => pipeline);
}

async function persistWaitingForCapacity(params: Readonly<{
  owner: Extract<WorkflowBlock, { kind: 'parallel' | 'loop' }>;
  source: WorkflowInvocationFrameV1['source'];
  scope: WorkflowInvocationPath['scope'];
  context: ExecutionContext;
  parentKey: string;
  memberOrdinal: string;
}>): Promise<void> {
  const current = await params.context.deps.store.readCurrent?.({
    runId: params.context.runId,
    blockId: params.owner.id,
    scope: params.scope,
    parentKey: params.parentKey,
    memberOrdinal: params.memberOrdinal,
  });
  if (current) return;
  const key = workflowInvocationKey({
    runId: params.context.runId,
    blockId: params.owner.id,
    scope: params.scope,
    attempt: 0,
  });
  await params.context.deps.store.ensureIntent({
    key,
    recordId: params.context.deps.allocateInvocationRecordId(),
    acceptedAtMs: Date.now(),
    runId: params.context.runId,
    blockId: params.owner.id,
    parentKey: params.parentKey,
    memberOrdinal: params.memberOrdinal,
    path: { blockId: params.owner.id, scope: params.scope },
    attempt: 0,
    lifecycle: 'waiting_for_capacity',
    frame: { ownerBlockId: params.owner.id, source: params.source },
    container: { kind: 'body', nextBlockOrdinal: '0' },
  });
}

async function closeWaitingAfterFailStop(params: Readonly<{
  owner: Extract<WorkflowBlock, { kind: 'parallel' | 'loop' }>;
  scope: WorkflowInvocationPath['scope'];
  context: ExecutionContext;
  parentKey: string;
}>): Promise<void> {
  const current = await params.context.deps.store.readCurrent?.({
    runId: params.context.runId,
    blockId: params.owner.id,
    scope: params.scope,
    parentKey: params.parentKey,
  });
  if (current?.lifecycle === 'waiting_for_capacity' || current?.lifecycle === 'pending') {
    await params.context.deps.store.commitFact({
      key: current.key,
      lifecycle: 'cancelled',
      reason: 'container_fail_stop',
    });
  }
}

async function executeBodyFrame(params: Readonly<{
  owner: Extract<WorkflowBlock, { kind: 'parallel' | 'loop' }>;
  source: WorkflowInvocationFrameV1['source'];
  blocks: readonly WorkflowBlock[];
  scope: WorkflowInvocationPath['scope'];
  frame: Frame;
  context: ExecutionContext;
  parentKey: string;
  memberOrdinal: string;
  onFrameStarted?: (frameKey: string) => Promise<void>;
  afterBlocks?: (frameKey: string) => Promise<void>;
}>): Promise<WorkflowJsonValue> {
  const key = workflowInvocationKey({
    runId: params.context.runId,
    blockId: params.owner.id,
    scope: params.scope,
    attempt: 0,
  });
  const existing = await params.context.deps.store.readCurrent?.({
    runId: params.context.runId,
    blockId: params.owner.id,
    scope: params.scope,
    parentKey: params.parentKey,
    memberOrdinal: params.memberOrdinal,
  }) ?? await params.context.deps.store.read(key);
  if (existing) {
    const failure = persistedFailure(existing);
    if (failure) throw failure;
  }
  const reconstructing = existing?.lifecycle === 'completed' && existing.containerResult !== undefined;
  await assertAdmissionOpen(params.context);
  if (!existing) {
    await params.context.deps.store.ensureIntent({
      key,
      recordId: params.context.deps.allocateInvocationRecordId(),
      runId: params.context.runId,
      blockId: params.owner.id,
      parentKey: params.parentKey,
      memberOrdinal: params.memberOrdinal,
      path: { blockId: params.owner.id, scope: params.scope },
      attempt: 0,
      acceptedAtMs: Date.now(),
      lifecycle: 'running',
      frame: { ownerBlockId: params.owner.id, source: params.source },
      container: { kind: 'body', nextBlockOrdinal: '0' },
    });
  } else if (existing.lifecycle === 'pending' || existing.lifecycle === 'waiting_for_capacity') {
    await params.context.deps.store.commitFact({ key, lifecycle: 'running' });
  }
  if (!reconstructing) await params.onFrameStarted?.(key);
  try {
    for (let index = 0; index < params.blocks.length; index += 1) {
      await executeBlock(params.blocks[index]!, params.scope, params.frame, params.context, key, String(index));
      if (!reconstructing) {
        await params.context.deps.store.commitFact({
          key,
          lifecycle: 'running',
          container: { kind: 'body', nextBlockOrdinal: String(index + 1) },
        });
      }
    }
    await params.afterBlocks?.(key);
  } catch (error) {
    if (!reconstructing && error instanceof WorkflowLeafFailure) {
      const lifecycle = error.state === 'cancelled' ? 'cancelled'
        : error.state === 'outcome_uncertain' ? 'outcome_uncertain'
          : error.state === 'interrupted' ? 'needs_attention' : 'failed';
      await params.context.deps.store.commitFact({ key, lifecycle, reason: error.code });
    }
    throw error;
  }
  const result = Object.fromEntries(params.frame.results);
  if (reconstructing) {
    params.context.deps.store.rememberContainerResult?.({ key, result });
  } else if (params.context.deps.store.commitContainerResult) {
    await params.context.deps.store.commitContainerResult({ key, result });
  } else {
    const record = await params.context.deps.store.read(key);
    await params.context.deps.store.commitFact({
      key,
      lifecycle: 'completed',
      containerResult: { kind: 'container', containerRecordId: record?.recordId ?? key },
    });
  }
  return result;
}

async function ensureAndCommitContainer(
  block: WorkflowBlock,
  scope: WorkflowInvocationPath['scope'],
  frame: Frame,
  context: ExecutionContext,
  parentKey: string | undefined,
  memberOrdinal: string,
  body: (reconstructing: boolean) => Promise<WorkflowJsonValue>,
  initialContainer?: WorkflowContainerProgressV1,
): Promise<WorkflowJsonValue> {
  const key = workflowInvocationKey({ runId: context.runId, blockId: block.id, scope, attempt: 0 });
  const existing = await context.deps.store.readCurrent?.({ runId: context.runId, blockId: block.id, scope, memberOrdinal, ...(parentKey ? { parentKey } : {}) })
    ?? await context.deps.store.read(key);
  const reconstructing = existing?.lifecycle === 'completed' && existing.containerResult !== undefined;
  if (existing) {
    const failure = persistedFailure(existing);
    if (failure) throw failure;
    if (existing.lifecycle === 'superseded') {
      throw new WorkflowLeafFailure('interrupted', existing.reason ?? 'retry_not_current');
    }
  }
  await assertAdmissionOpen(context);
  if (!existing) {
    await context.deps.store.ensureIntent({
      key, recordId: context.deps.allocateInvocationRecordId(), acceptedAtMs: Date.now(), runId: context.runId, blockId: block.id, memberOrdinal, ...(parentKey ? { parentKey } : {}),
      path: { blockId: block.id, scope }, attempt: 0, lifecycle: 'running', ...(initialContainer ? { container: initialContainer } : {}),
    });
  } else if (existing.lifecycle === 'waiting_for_capacity' || existing.lifecycle === 'pending') {
    await context.deps.store.commitFact({ key, lifecycle: 'running', ...(initialContainer ? { container: initialContainer } : {}) });
  } else if (!reconstructing && initialContainer && !existing.container) {
    await context.deps.store.commitFact({ key, lifecycle: 'running', container: initialContainer });
  }
  try {
    const result = await body(reconstructing);
    let committedRecord = existing;
    if (reconstructing) {
      context.deps.store.rememberContainerResult?.({ key, result });
    } else if (context.deps.store.commitContainerResult) {
      committedRecord = await context.deps.store.commitContainerResult({ key, result });
    } else {
      committedRecord = await context.deps.store.commitFact({
        key, lifecycle: 'completed',
        containerResult: { kind: 'container', containerRecordId: existing?.recordId
          ?? (await context.deps.store.read(key))?.recordId ?? key },
      });
    }
    frame.results.set(block.id, result);
    const recordId = committedRecord?.recordId ?? (await context.deps.store.read(key))?.recordId;
    if (recordId) frame.resultRecords.set(block.id, recordId);
    return result;
  } catch (error) {
    if (!reconstructing && error instanceof WorkflowLeafFailure) {
      const lifecycle = error.state === 'cancelled'
        ? 'cancelled' as const
        : error.state === 'outcome_uncertain'
          ? 'outcome_uncertain' as const
          : error.state === 'interrupted'
            ? 'needs_attention' as const
            : 'failed' as const;
      await context.deps.store.commitFact({ key, lifecycle, reason: error.code });
    }
    throw error;
  }
}

async function executeBlock(
  block: WorkflowBlock,
  scope: WorkflowInvocationPath['scope'],
  frame: Frame,
  context: ExecutionContext,
  parentKey?: string,
  memberOrdinal = '0',
): Promise<void> {
  const runtime = createResolutionRuntime(context.inputs, frame, context.deps.store);
  if ('onlyWhen' in block && block.onlyWhen && !await evaluateWorkflowCondition(block.onlyWhen, runtime)) {
    const key = workflowInvocationKey({ runId: context.runId, blockId: block.id, scope, attempt: 0 });
    await context.deps.store.ensureIntent({ key, recordId: context.deps.allocateInvocationRecordId(), acceptedAtMs: Date.now(), runId: context.runId, blockId: block.id, memberOrdinal, ...(parentKey ? { parentKey } : {}), path: { blockId: block.id, scope }, attempt: 0, lifecycle: 'pending' });
    await context.deps.store.commitFact({ key, lifecycle: 'skipped', reason: 'condition_false' });
    return;
  }
  if (block.kind === 'step') {
    await executeStepBlock(block, scope, frame, context, parentKey, memberOrdinal);
    return;
  }
  if (block.kind === 'if') {
    const key = workflowInvocationKey({ runId: context.runId, blockId: block.id, scope, attempt: 0 });
    const existing = await context.deps.store.readCurrent?.({
      runId: context.runId, blockId: block.id, scope, memberOrdinal, ...(parentKey ? { parentKey } : {}),
    }) ?? await context.deps.store.read(key);
    const selected = existing?.container?.kind === 'if'
      ? existing.container.selected
      : await evaluateWorkflowCondition(block.when, runtime) ? 'then' : 'otherwise';
    if (selected === 'otherwise' && block.otherwise.length === 0) {
      const key = workflowInvocationKey({ runId: context.runId, blockId: block.id, scope, attempt: 0 });
      await context.deps.store.ensureIntent({
        key, recordId: context.deps.allocateInvocationRecordId(), acceptedAtMs: Date.now(), runId: context.runId, blockId: block.id, memberOrdinal, ...(parentKey ? { parentKey } : {}),
        path: { blockId: block.id, scope }, attempt: 0, lifecycle: 'pending',
      });
      await context.deps.store.commitFact({ key, lifecycle: 'skipped', reason: 'condition_false' });
      return;
    }
    await ensureAndCommitContainer(block, scope, frame, context, parentKey, memberOrdinal, async (reconstructing) => {
      const selectedBlocks = selected === 'then' ? block.then : block.otherwise;
      const branchFrame = childFrame(frame);
      for (let index = 0; index < selectedBlocks.length; index += 1) {
        await executeBlock(selectedBlocks[index]!, scope, branchFrame, context, key, String(index));
        if (!reconstructing) {
          await context.deps.store.commitFact({
            key,
            lifecycle: 'running',
            container: { kind: 'if', selected, nextBlockOrdinal: String(index + 1) },
          });
        }
      }
      return Object.fromEntries(branchFrame.results);
    }, { kind: 'if', selected, nextBlockOrdinal: '0' });
    return;
  }
  if (block.kind === 'parallel') {
    await ensureAndCommitContainer(block, scope, frame, context, parentKey, memberOrdinal, async (reconstructing) => {
      const semaphore = new OptionalSemaphore(block.maxConcurrent);
      const failStop = new AbortController();
      const branchContext = block.failurePolicy === 'fail_stop' ? withAbortSignal(context, failStop.signal) : context;
      const branches = block.branches.map((branch) => {
        return {
          branch,
          scope: [...scope, { kind: 'branch' as const, blockId: block.id, branchId: branch.id }],
        };
      });
      if (!reconstructing) {
        await context.deps.store.commitFact({
          key: workflowInvocationKey({ runId: context.runId, blockId: block.id, scope, attempt: 0 }),
          lifecycle: 'running',
          container: { kind: 'parallel', nextBranchOrdinal: String(branches.length) },
        });
      }
      const scheduledBranches = block.maxConcurrent === undefined
        ? branches
        : await orderPipelinesForRecovery(branches, context);
      const outcomesByBranch = new Map<string, WorkflowJsonValue>();
      const branchSettlements = await Promise.allSettled(scheduledBranches.map(({ branch, scope: branchScope }) => semaphore.run(async () => {
        if (failStop.signal.aborted) {
          await closeWaitingAfterFailStop({ owner: block, scope: branchScope, context,
            parentKey: workflowInvocationKey({ runId: context.runId, blockId: block.id, scope, attempt: 0 }) });
          throw failStop.signal.reason;
        }
        const branchFrame = childFrame(frame);
        try {
          const branchResult = await executeBodyFrame({
            owner: block,
            source: { kind: 'branch', branchId: branch.id },
            blocks: blocksOf(branch),
            scope: branchScope,
            frame: branchFrame,
            context: branchContext,
            parentKey: workflowInvocationKey({ runId: context.runId, blockId: block.id, scope, attempt: 0 }),
            memberOrdinal: String(block.branches.indexOf(branch)),
          });
          const branchRecord = await context.deps.store.readCurrent?.({
            runId: context.runId,
            blockId: block.id,
            scope: branchScope,
            parentKey: workflowInvocationKey({ runId: context.runId, blockId: block.id, scope, attempt: 0 }),
            memberOrdinal: String(block.branches.indexOf(branch)),
          });
          frame.results.set(branch.id, branchResult);
          if (branchRecord) frame.resultRecords.set(branch.id, branchRecord.recordId);
          if (branchFrame.collectedFailures) frame.collectedFailures = true;
          outcomesByBranch.set(branch.id, { branchId: branch.id, status: 'completed', results: Object.fromEntries(branchFrame.results) });
        } catch (error) {
          if (error instanceof WorkflowControlBoundary || error instanceof WorkflowRuntimeInterruption) throw error;
          if (block.failurePolicy === 'fail_stop' || !(error instanceof WorkflowLeafFailure && error.collectable)) {
            failStop.abort(error);
            throw error;
          }
          outcomesByBranch.set(branch.id, { branchId: branch.id, status: 'failed', reason: error instanceof Error ? error.message : 'unknown' });
          frame.collectedFailures = true;
        }
      }, async () => {
        await persistWaitingForCapacity({ owner: block, source: { kind: 'branch', branchId: branch.id }, scope: branchScope, context,
          parentKey: workflowInvocationKey({ runId: context.runId, blockId: block.id, scope, attempt: 0 }), memberOrdinal: String(block.branches.indexOf(branch)) });
      })));
      const rejectedBranch = branchSettlements.find(
        (settlement): settlement is PromiseRejectedResult => settlement.status === 'rejected',
      );
      if (rejectedBranch) throw failStop.signal.reason ?? rejectedBranch.reason;
      return block.branches.map((branch) => outcomesByBranch.get(branch.id) ?? null);
    }, { kind: 'parallel', nextBranchOrdinal: '0' });
    return;
  }
  await executeLoop(block, scope, frame, context, parentKey, memberOrdinal);
}

function blocksOf(branch: { blocks: readonly WorkflowBlock[] }): readonly WorkflowBlock[] {
  return branch.blocks;
}

async function executeStepBlock(
  step: WorkflowStep,
  scope: WorkflowInvocationPath['scope'],
  frame: Frame,
  context: ExecutionContext,
  parentKey?: string,
  memberOrdinal = '0',
  supplementalInputValues: readonly WorkflowJsonValue[] = [],
): Promise<WorkflowJsonValue> {
  const current = await context.deps.store.readCurrent?.({ runId: context.runId, blockId: step.id, scope, memberOrdinal, ...(parentKey ? { parentKey } : {}) });
  const candidateKey = workflowInvocationKey({ runId: context.runId, blockId: step.id, scope, attempt: 0 });
  const existing = current ?? await context.deps.store.read(candidateKey);
  const key = existing?.key ?? candidateKey;
  if (existing?.lifecycle === 'completed') {
    const result = existing.result ?? null;
    frame.results.set(step.id, result);
    frame.resultRecords.set(step.id, existing.recordId);
    return result;
  }
  if (existing) {
    const failure = persistedFailure(existing);
    if (failure) throw failure;
    if (existing.lifecycle === 'superseded') {
      throw new WorkflowLeafFailure('interrupted', existing.reason ?? 'retry_not_current');
    }
  }
  const path = { blockId: step.id, scope };
  const rejoining = existing !== undefined
    && existing.lifecycle !== 'pending'
    && existing.lifecycle !== 'waiting_for_capacity';
  let admitted: WorkflowCoordinatorInvocation;
  if (rejoining) {
    // `admitting` may represent a lost Session-admission response. Re-entering
    // the executor with the same persisted logical invocation is safe because
    // the Session adapter derives the same canonical input identity. Once a
    // row claims a later lifecycle, absence of correspondence cannot prove an
    // effect did not happen and must not dispatch again.
    if (!existing?.execution && existing?.lifecycle !== 'admitting') {
      throw new WorkflowLeafFailure('interrupted', 'continuation_unavailable');
    }
    admitted = existing;
  } else {
    await assertAdmissionOpen(context);
    try {
      admitted = await context.deps.store.ensureIntent({
        key, recordId: context.deps.allocateInvocationRecordId(), acceptedAtMs: Date.now(), runId: context.runId, blockId: step.id, memberOrdinal, ...(parentKey ? { parentKey } : {}),
        path, attempt: 0, lifecycle: 'admitting',
      });
    } catch (error) {
      // A parent CAS can lose to an external pause/cancel after the preceding
      // admission check. Re-read only the canonical control owner; do not
      // retry a new row or reinterpret unrelated storage failures.
      await assertAdmissionOpen(context);
      throw error;
    }
  }
  const observationDeadline = admitted.observationDeadline ?? (step.timeoutMs === undefined
    ? undefined
    : { kind: 'at' as const, expiresAt: new Date(admitted.acceptedAtMs + step.timeoutMs).toISOString() });
  if (!rejoining && observationDeadline) {
    await context.deps.store.commitFact({ key, lifecycle: 'admitting', observationDeadline });
  }
  const invocation: WorkflowProgressEnvelopeV1 = {
    kind: 'happier.workflow-progress.v1',
    invocationPath: path,
    blockKind: 'step',
    attempt: String(admitted.attempt),
    logicalInvocationRecordId: admitted.logicalInvocationRecordId ?? admitted.recordId,
    resultContract: step.result,
    ...(admitted.execution ? { execution: admitted.execution } : {}),
    ...(observationDeadline ? { observationDeadline } : {}),
  };
  const recoveryPrevious = admitted.previousAttemptRecordId
    ? await context.deps.store.readByLogicalInvocation(admitted.previousAttemptRecordId)
    : undefined;
  const recoveryInput = admitted.recovery?.input;
  const effectiveStep = recoveryInput?.kind === 'replacement'
    ? { ...step, document: recoveryInput.value.document }
    : step;
  const persistedInput = admitted.input;
  const input = await materializeWorkflowStepInput({
    document: persistedInput?.document ?? effectiveStep.document,
    references: persistedInput
      ? persistedInput.input.map((value) => ({ kind: 'literal' as const, value }))
      : recoveryInput?.kind === 'replacement'
        ? recoveryInput.value.input.map((value) => ({ kind: 'literal' as const, value }))
        : [
            ...step.input,
            ...supplementalInputValues.map((value) => ({ kind: 'literal' as const, value })),
          ],
    runtime: createResolutionRuntime(context.inputs, frame, context.deps.store),
  });
  const authoredInput: WorkflowAuthoredInputV1 = {
    document: persistedInput?.document ?? effectiveStep.document,
    input: [...input.values],
  };
  if (!admitted.input) {
    admitted = await context.deps.store.commitFact({
      key,
      lifecycle: admitted.lifecycle,
      input: authoredInput,
    });
  }
  const selectedExecution = {
    ...effectiveExecution(context.definition, step),
    ...(admitted.recovery?.conversation === 'fresh_agent'
      ? { conversation: { kind: 'fresh' as const } }
      : {}),
  };
  let preparedStep: Awaited<ReturnType<WorkflowStepPreparer>> | undefined;
  if (!admitted.execution) {
    let isCurrent = false;
    try {
      isCurrent = await context.deps.isAcceptedAuthorizationCurrent({
        authorization: context.authorization,
        ...(context.signal ? { signal: context.signal } : {}),
      });
    } catch {
      isCurrent = false;
    }
    if (!isCurrent) {
      const code = 'workflow_authorization_not_current';
      await context.deps.store.commitFact({ key, lifecycle: 'needs_attention', reason: code });
      throw new WorkflowLeafFailure('interrupted', code);
    }
    preparedStep = await context.deps.prepareStep?.({
      runId: context.runId,
      step: effectiveStep,
      invocation,
      invocationRecordId: admitted.recordId,
      ...(recoveryPrevious?.execution ? { recoveryPreviousExecution: recoveryPrevious.execution } : {}),
      ...(recoveryPrevious?.workspace?.descriptor
        ? { recoveryPreviousWorkspace: recoveryPrevious.workspace.descriptor }
        : {}),
      execution: selectedExecution,
      executionTarget: context.executionTarget,
      authorization: context.authorization,
      ...(frame.item ? { item: frame.item } : {}),
      ...(frame.iteration ? { iteration: frame.iteration } : {}),
      ...(context.signal ? { signal: context.signal } : {}),
    });
    if (preparedStep?.failure) {
      await context.deps.store.commitFact({
        key,
        lifecycle: preparedStep.failure.kind,
        reason: preparedStep.failure.code,
      });
      throw new WorkflowLeafFailure(
        'interrupted',
        preparedStep.failure.code,
        preparedStep.failure.kind === 'failed',
      );
    }
  }
  const workspaceResolution = await context.deps.resolveWorkspace({
    runId: context.runId,
    definition: context.definition,
    step,
    invocation: admitted,
    scope,
    ...(preparedStep?.conversationWorkspace
      ? { conversationWorkspace: preparedStep.conversationWorkspace }
      : {}),
  });
  if (!workspaceResolution.ok) {
    await context.deps.store.commitFact({ key, lifecycle: 'needs_attention', reason: workspaceResolution.code });
    throw new WorkflowLeafFailure('interrupted', workspaceResolution.code);
  }
  const conversationKind = selectedExecution.conversation?.kind ?? 'shared_run';
  const retainedConversationAdmissionKey = preparedStep?.conversationAdmissionKey
    ?? (conversationKind === 'from_step' && admitted.execution?.kind === 'detached_run'
      ? admitted.execution.runId
      : undefined);
  const admissionKey = conversationKind === 'shared_run'
    ? 'shared_run'
    : retainedConversationAdmissionKey === undefined
      ? undefined
      : `retained:${retainedConversationAdmissionKey}`;
  const releaseAdmission = admissionKey !== undefined
    ? await context.admissionGate.acquire(admissionKey)
    : () => undefined;
  let execution: WorkflowStepExecutionResult;
  let durableExecution = admitted.execution;
  try {
    if (!admitted.execution && !rejoining) await assertAdmissionOpen(context);
    execution = await context.deps.executeStep({
      runId: context.runId,
      step: effectiveStep,
      invocation,
      invocationRecordId: admitted.recordId,
      ...(recoveryPrevious?.execution ? { recoveryPreviousExecution: recoveryPrevious.execution } : {}),
      ...(recoveryPrevious?.workspace?.descriptor
        ? { recoveryPreviousWorkspace: recoveryPrevious.workspace.descriptor }
        : {}),
      input,
      execution: selectedExecution,
      executionTarget: context.executionTarget,
      workspace: workspaceResolution.workspace,
      ...(preparedStep?.preparedStep !== undefined
        ? { preparedStep: preparedStep.preparedStep }
        : {}),
      authorization: context.authorization,
      ...(frame.item ? { item: frame.item } : {}),
      ...(frame.iteration ? { iteration: frame.iteration } : {}),
      onInputAccepted: async (correspondence) => {
        const persistedCorrespondence = correspondence.kind === 'detached_run'
          && durableExecution?.kind === 'detached_run'
          && durableExecution.runId === correspondence.runId
          && durableExecution.localInputId === correspondence.localInputId
          && durableExecution.providerResumeIdentity
          ? { ...correspondence, providerResumeIdentity: durableExecution.providerResumeIdentity }
          : correspondence;
        durableExecution = persistedCorrespondence;
        await context.deps.store.commitFact({ key, lifecycle: 'running', execution: persistedCorrespondence });
        if ((selectedExecution.conversation?.kind ?? 'shared_run') === 'shared_run') {
          await context.deps.store.commitSharedConversation?.({
            execution: persistedCorrespondence,
            workspace: workspaceResolution.workspace,
          });
        }
      },
      onExecutionObservation: async (observation) => {
        const currentExecution = durableExecution;
        if (currentExecution && (
          currentExecution.kind !== 'detached_run'
          || currentExecution.runId !== observation.execution.runId
          || currentExecution.localInputId !== observation.execution.localInputId
        )) {
          throw new Error('workflow_invocation_fact_conflict');
        }
        const existingIdentity = currentExecution?.kind === 'detached_run'
          ? currentExecution.providerResumeIdentity
          : undefined;
        const observedIdentity = observation.execution.providerResumeIdentity;
        if (existingIdentity && observedIdentity
          && JSON.stringify(existingIdentity) !== JSON.stringify(observedIdentity)) {
          throw new Error('workflow_invocation_fact_conflict');
        }
        const mergedExecution = {
          ...(currentExecution?.kind === 'detached_run' ? currentExecution : {}),
          ...observation.execution,
          ...(existingIdentity ? { providerResumeIdentity: existingIdentity } : {}),
        } as Extract<NonNullable<WorkflowProgressEnvelopeV1['execution']>, { kind: 'detached_run' }>;
        durableExecution = mergedExecution;
        await context.deps.store.commitFact({
          key,
          lifecycle: 'running',
          execution: mergedExecution,
          ...(observation.usage ? { usage: observation.usage } : {}),
        });
      },
      ...(context.signal ? { signal: context.signal } : {}),
    });
  } catch (error) {
    releaseAdmission();
    throw error;
  }
  try {
    if (execution.kind === 'completed') {
      let result: WorkflowJsonValue;
      try {
        result = validateStepResult(step, execution.result, execution.resultEncoding ?? 'raw_text');
      } catch (error) {
        if (error instanceof WorkflowLeafFailure) {
          await context.deps.store.commitFact({
            key,
            lifecycle: 'failed',
            reason: error.code,
            ...(execution.usage ? { usage: execution.usage } : {}),
          });
        }
        throw error;
      }
      const completed = await context.deps.store.commitFact({
        key,
        lifecycle: 'completed',
        result,
        ...(execution.usage ? { usage: execution.usage } : {}),
      });
      frame.results.set(step.id, result);
      frame.resultRecords.set(step.id, completed.recordId);
      return result;
    }
    const authorizationRevoked = context.signal?.aborted
      && context.signal.reason === WORKFLOW_AUTHORIZATION_NOT_CURRENT_ABORT_REASON;
    const stopStillPending = execution.kind === 'cancelled'
      && execution.code === 'session_input_turn_cancel_requested'
      && !authorizationRevoked;
    const state = execution.kind === 'failed' || execution.kind === 'needs_attention'
      || (execution.kind === 'outcome_uncertain' && durableExecution !== undefined)
      || stopStillPending
      ? 'interrupted'
      : execution.kind;
    const reason = authorizationRevoked && execution.kind === 'cancelled'
      ? WORKFLOW_AUTHORIZATION_NOT_CURRENT_ABORT_REASON
      : execution.code;
    await context.deps.store.commitFact({
      key,
      lifecycle: stopStillPending ? 'cancel_requested' : execution.kind,
      reason,
      ...(execution.usage ? { usage: execution.usage } : {}),
    });
    if (authorizationRevoked && execution.kind === 'cancelled') {
      throw new WorkflowLeafFailure(
        'interrupted',
        WORKFLOW_AUTHORIZATION_NOT_CURRENT_ABORT_REASON,
      );
    }
    if (context.signal?.aborted && context.signal.reason instanceof WorkflowLeafFailure) {
      throw context.signal.reason;
    }
    throw new WorkflowLeafFailure(
      state,
      execution.code ?? execution.kind,
      execution.kind === 'failed',
    );
  } finally {
    // A shared detached conversation has no native prompt queue. Keep its
    // coordinator frontier closed until the exact row-local result or terminal
    // fact is durable, not merely until provider acceptance.
    releaseAdmission();
  }
}

function validateStepResult(
  step: WorkflowStep,
  result: WorkflowJsonValue | undefined,
  encoding: 'raw_text' | 'typed',
): WorkflowJsonValue {
  const value = result ?? null;
  const decoded = encoding === 'typed'
    ? validateExecutionRunProfileResult(value, step.result)
    : typeof value === 'string'
      ? decodeExecutionRunProfileResult(value, step.result)
      : { ok: false as const };
  if (!decoded.ok) {
    throw new WorkflowLeafFailure('interrupted', 'invalid_result_contract', true);
  }
  return decoded.value;
}

async function executeLoop(
  block: Extract<WorkflowBlock, { kind: 'loop' }>,
  scope: WorkflowInvocationPath['scope'],
  frame: Frame,
  context: ExecutionContext,
  parentKey?: string,
  memberOrdinal = '0',
): Promise<void> {
  const repetition = block.repetition;
  const loopKey = workflowInvocationKey({ runId: context.runId, blockId: block.id, scope, attempt: 0 });
  const existingLoop = await context.deps.store.readCurrent?.({
    runId: context.runId,
    blockId: block.id,
    scope,
    memberOrdinal,
    ...(parentKey ? { parentKey } : {}),
  }) ?? await context.deps.store.read(loopKey);
  const persistedLoop = existingLoop?.container?.kind === 'loop'
    ? existingLoop.container
    : undefined;
  const runtime = createResolutionRuntime(context.inputs, frame, context.deps.store);

  let loopProgress: Extract<WorkflowContainerProgressV1, { kind: 'loop' }>;
  let count: number;
  let items: readonly WorkflowJsonValue[] | undefined;
  if (repetition.kind === 'count') {
    if (persistedLoop && persistedLoop.mode !== 'count') {
      throw new WorkflowInputResolutionError('invalid_reference_scope');
    }
    const source = persistedLoop?.mode === 'count'
      ? persistedLoop.source
      : resolveLoopSourceSelection(repetition.count, frame);
    const resolved = persistedLoop?.mode === 'count'
      ? await resolveSelectedLoopSource(source, frame, context)
      : await resolveWorkflowValueReference(repetition.count, runtime);
    if (typeof resolved !== 'number' || !Number.isSafeInteger(resolved) || resolved < 0) {
      throw new WorkflowInputResolutionError('invalid_reference_scope');
    }
    count = resolved;
    if (persistedLoop?.mode === 'count' && Number(persistedLoop.count) !== count) {
      throw new WorkflowInputResolutionError('invalid_reference_scope');
    }
    loopProgress = persistedLoop ?? {
      kind: 'loop', mode: 'count', source, count: String(count),
      nextMemberIndex: '0', nextBodyBlockOrdinal: '0',
    };
  } else if (repetition.kind === 'items') {
    if (persistedLoop && persistedLoop.mode !== 'items') {
      throw new WorkflowInputResolutionError('invalid_reference_scope');
    }
    const source = persistedLoop?.mode === 'items'
      ? persistedLoop.source
      : resolveLoopSourceSelection(repetition.items, frame);
    const resolved = persistedLoop?.mode === 'items'
      ? await resolveSelectedLoopSource(source, frame, context)
      : await resolveWorkflowValueReference(repetition.items, runtime);
    if (!Array.isArray(resolved)) throw new WorkflowInputResolutionError('invalid_reference_scope');
    items = resolved;
    count = items.length;
    if (persistedLoop?.mode === 'items' && Number(persistedLoop.itemCount) !== count) {
      throw new WorkflowInputResolutionError('invalid_reference_scope');
    }
    loopProgress = persistedLoop ?? {
      kind: 'loop', mode: 'items', source, itemCount: String(count),
      nextMemberIndex: '0', nextBodyBlockOrdinal: '0',
    };
  } else {
    if (persistedLoop && persistedLoop.mode !== repetition.kind) {
      throw new WorkflowInputResolutionError('invalid_reference_scope');
    }
    count = repetition.maxIterations;
    loopProgress = persistedLoop ?? {
      kind: 'loop', mode: repetition.kind,
      nextMemberIndex: '0', nextBodyBlockOrdinal: '0',
    };
  }

  const persistedMemberIndex = Number(loopProgress.nextMemberIndex);
  const persistedBodyOrdinal = Number(loopProgress.nextBodyBlockOrdinal);
  const iterationWidth = block.body.length + (repetition.kind === 'evaluate' ? 1 : 0);
  if (!Number.isSafeInteger(persistedMemberIndex) || persistedMemberIndex < 0 || persistedMemberIndex > count
    || !Number.isSafeInteger(persistedBodyOrdinal) || persistedBodyOrdinal < 0
    || persistedBodyOrdinal > iterationWidth) {
    throw new WorkflowInputResolutionError('invalid_reference_scope');
  }

  await ensureAndCommitContainer(block, scope, frame, context, parentKey, memberOrdinal, async (reconstructing) => {
    const commitLoopProgress = async (
      nextMemberIndex: number,
      nextBodyBlockOrdinal: number,
      closingCode?: string,
    ): Promise<void> => {
      loopProgress = {
        ...loopProgress,
        nextMemberIndex: String(nextMemberIndex),
        nextBodyBlockOrdinal: String(nextBodyBlockOrdinal),
        ...(closingCode ? { closing: { code: closingCode } } : {}),
      };
      if (!reconstructing) {
        await context.deps.store.commitFact({ key: loopKey, lifecycle: 'running', container: loopProgress });
      }
    };
    if (repetition.kind === 'items') {
      const selectedItems = items!;
      const failStop = new AbortController();
      const itemContext = repetition.failurePolicy === 'fail_stop'
        ? withAbortSignal(context, failStop.signal)
        : context;
      const parentKey = loopKey;
      const pipelines = selectedItems.map((value, index) => ({
        value,
        index,
        scope: [...scope, { kind: 'iteration' as const, blockId: block.id, index }],
      }));
      const scheduledPipelines = repetition.execution === 'parallel'
        && repetition.maxConcurrent !== undefined
        ? await orderPipelinesForRecovery(pipelines, context)
        : pipelines;
      const outcomesByIndex = new Map<number, WorkflowJsonValue>();
      let frontierTail = Promise.resolve();
      const advanceMemberFrontier = (nextMemberIndex: number): Promise<void> => {
        const advance = frontierTail.then(async () => {
          const currentIndex = Number(loopProgress.nextMemberIndex);
          if (nextMemberIndex > currentIndex) await commitLoopProgress(nextMemberIndex, 0);
        });
        frontierTail = advance.catch(() => undefined);
        return advance;
      };
      const runItem = async ({ value, index, scope: itemScope }: typeof pipelines[number]) => {
        if (failStop.signal.aborted) {
          await closeWaitingAfterFailStop({ owner: block, scope: itemScope, context: itemContext, parentKey });
          throw failStop.signal.reason;
        }
        const item = { value, index, position: index + 1, count: selectedItems.length };
        const itemFrame = childFrame(frame, { item });
        try {
          await executeBodyFrame({
            owner: block,
            source: { kind: 'item', index: String(index) },
            blocks: block.body,
            scope: itemScope,
            frame: itemFrame,
            context: itemContext,
            parentKey: loopKey,
            memberOrdinal: String(index),
            onFrameStarted: async () => await advanceMemberFrontier(index + 1),
          });
          if (itemFrame.collectedFailures) frame.collectedFailures = true;
          outcomesByIndex.set(index, { index, status: 'completed', results: Object.fromEntries(itemFrame.results) });
        } catch (error) {
          if (error instanceof WorkflowControlBoundary || error instanceof WorkflowRuntimeInterruption) throw error;
          if (repetition.failurePolicy === 'fail_stop'
            || !(error instanceof WorkflowLeafFailure && error.collectable)) {
            failStop.abort(error);
            throw error;
          }
          outcomesByIndex.set(index, { index, status: 'failed', reason: error instanceof Error ? error.message : 'unknown' });
          frame.collectedFailures = true;
        }
      };
      if (repetition.execution === 'parallel') {
        const runWorker = async (nextPipeline: () => typeof pipelines[number] | undefined): Promise<void> => {
          for (let pipeline = nextPipeline(); pipeline; pipeline = nextPipeline()) {
            await runItem(pipeline);
          }
        };
        let nextPipelineIndex = 0;
        const nextPipeline = () => scheduledPipelines[nextPipelineIndex++];
        const workerCount = repetition.maxConcurrent === undefined
          ? scheduledPipelines.length
          : Math.min(repetition.maxConcurrent, scheduledPipelines.length);
        const itemSettlements = await Promise.allSettled(
          Array.from({ length: workerCount }, () => runWorker(nextPipeline)),
        );
        const rejectedItem = itemSettlements.find(
          (settlement): settlement is PromiseRejectedResult => settlement.status === 'rejected',
        );
        if (rejectedItem) throw failStop.signal.reason ?? rejectedItem.reason;
      }
      else await sequentialMap(scheduledPipelines, runItem);
      return selectedItems.map((_, index) => outcomesByIndex.get(index) ?? null);
    }
    if (loopProgress.closing && persistedMemberIndex === 0) return [];
    const outcomes: WorkflowJsonValue[] = [];
    let previous = new Map<string, WorkflowJsonValue>();
    let previousRecords = new Map<string, string>();
    const evaluatorOutcomes: WorkflowJsonValue[] = [];

    for (let index = 0; index < count; index += 1) {
      const iteration = { index, position: index + 1, count, stopReason: null };
      const iterationFrame = childFrame(frame, { iteration });
      iterationFrame.previousIterations.set(block.id, previous);
      iterationFrame.previousIterationRecords.set(block.id, previousRecords);
      const iterationScope = [...scope, { kind: 'iteration' as const, blockId: block.id, index }];
      const selectedEvaluatorHistory = repetition.kind !== 'evaluate' || repetition.history === 'none'
        ? []
        : repetition.history === 'latest'
          ? evaluatorOutcomes.slice(-1)
          : [...evaluatorOutcomes];
      const iterationResult = await executeBodyFrame({
        owner: block,
        source: { kind: 'iteration', index: String(index) },
        blocks: block.body,
        scope: iterationScope,
        frame: iterationFrame,
        context,
        parentKey: loopKey,
        memberOrdinal: String(index),
        afterBlocks: repetition.kind === 'evaluate'
          ? async (iterationFrameKey) => {
              await executeStepBlock(
                repetition.evaluator,
                iterationScope,
                iterationFrame,
                context,
                iterationFrameKey,
                String(block.body.length),
                selectedEvaluatorHistory.length === 0
                  ? []
                  : [{ kind: 'evaluation_history', evaluations: selectedEvaluatorHistory }],
              );
            }
          : undefined,
      });
      if (iterationFrame.collectedFailures) frame.collectedFailures = true;
      outcomes.push(iterationResult);
      if (repetition.kind === 'until') {
        const shouldStop = await evaluateWorkflowCondition(
          repetition.stopWhen,
          createResolutionRuntime(context.inputs, iterationFrame, context.deps.store),
        );
        await commitLoopProgress(index + 1, 0, shouldStop ? 'loop_stop_condition' : undefined);
        previous = new Map(iterationFrame.results);
        previousRecords = new Map(iterationFrame.resultRecords);
        frame.previousIterations.set(block.id, previous);
        frame.previousIterationRecords.set(block.id, previousRecords);
        if (shouldStop) break;
        if (index === count - 1) throw new WorkflowLeafFailure('failed', 'loop_limit_reached');
      }
      if (repetition.kind === 'evaluate') {
        const decision = iterationFrame.results.get(repetition.evaluator.id);
        if (decision === undefined) throw new WorkflowLeafFailure('failed', 'invalid_result_contract');
        evaluatorOutcomes.push(decision);
        const normalized = isWorkflowJsonObject(decision)
          ? decision.decision
          : decision;
        if (normalized !== 'stop' && normalized !== 'continue') {
          throw new WorkflowLeafFailure('failed', 'invalid_result_contract');
        }
        await commitLoopProgress(index + 1, 0, normalized === 'stop' ? 'loop_evaluator_stop' : undefined);
        previous = new Map(iterationFrame.results);
        previousRecords = new Map(iterationFrame.resultRecords);
        frame.previousIterations.set(block.id, previous);
        frame.previousIterationRecords.set(block.id, previousRecords);
        if (normalized === 'stop') break;
        if (index === count - 1) throw new WorkflowLeafFailure('failed', 'loop_limit_reached');
      }
      if (repetition.kind === 'count') {
        await commitLoopProgress(index + 1, 0);
        previous = new Map(iterationFrame.results);
        previousRecords = new Map(iterationFrame.resultRecords);
        frame.previousIterations.set(block.id, previous);
        frame.previousIterationRecords.set(block.id, previousRecords);
      }
    }
    return outcomes;
  }, loopProgress);
}

async function sequentialMap<T, R>(values: readonly T[], operation: (value: T, index: number) => Promise<R>): Promise<R[]> {
  const results: R[] = [];
  for (let index = 0; index < values.length; index += 1) results.push(await operation(values[index]!, index));
  return results;
}
