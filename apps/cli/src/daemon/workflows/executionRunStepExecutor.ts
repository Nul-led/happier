import {
  areWorkflowRetainedRuntimeSelectionsEqualV1,
  assertNonEscalatingPermissionMode,
  deriveWorkflowSessionInputLocalIdV2,
  ExecutionRunStartResponseSchema,
  HappierStructuredInputV1Schema,
  projectWorkflowRetainedRuntimeSelectionV1,
  readExecutionRunStartRunCreation,
  type ExecutionRunResultContractV1,
  type ExecutionRunResumeHandle,
  type WorkflowAuthoredProducerRef,
  type WorkflowProgressEnvelopeV1,
  type WorkflowRetainedRuntimeSelectionV1,
} from '@happier-dev/protocol';

type ExecutionRunResumeHandleProviderSessionV1 = Extract<
  ExecutionRunResumeHandle,
  Readonly<{ kind: 'provider_session.v1' }>
>;
import { areExecutionRunBackendTargetsEqual } from '@/agent/runtime/bridges/executionRun/backendTargets';
import type { ExecutionRunWorkflowObservation } from '@/agent/runtime/bridges/executionRun/executionRunWorkflowObservation';

import type {
  RpcActionExecutor,
  RpcActionExecutorContext,
} from '@/rpc/handlers/_actionDispatchAdapter';
import { canonicalAbsolutePathsEqual } from '@/utils/path/expandHomeDirPath';
import {
  classifyWorkflowAbort,
  WorkflowRuntimeInterruption,
  type WorkflowStepExecutor,
  type WorkflowStepExecutionResult,
  type WorkflowStepPreparer,
} from './coordinator';
import {
  observeWorkflowDetachedExecutionRunInput,
  stopWorkflowPendingExecutionRunInput,
  type WorkflowDetachedExecutionRunObservation,
} from './stepExecution';

type WorkflowExecutionRunConversation = Readonly<{
  runId: string;
  machineId: string;
  directory?: string;
  /** Exact effective selection admitted when this detached Run was created. */
  runtimeSelection?: WorkflowRetainedRuntimeSelectionV1;
  /** Attached Runs additionally require their owning Session route. */
  sessionId?: string;
  /** Private Workflow progress identity; public Run projections are not restart authority. */
  providerResumeIdentity?: Extract<ExecutionRunResumeHandle, { kind: 'provider_session.v1' }>;
}>;

type DetachedExecutionRunActionExecutor = Pick<RpcActionExecutor, 'execute'>;
type ExecutionRunObservationDeps = Readonly<{
  actionExecutor: DetachedExecutionRunActionExecutor;
}>;

export type WorkflowDetachedExecutionRunStepExecutorDeps = Readonly<{
  actionExecutor: DetachedExecutionRunActionExecutor;
  resolveSharedRunConversation: (params: Readonly<{
    runId: string;
    invocation: WorkflowProgressEnvelopeV1;
  }>) => Promise<WorkflowExecutionRunConversation | null>;
  resolveProducerConversation: (params: Readonly<{
    runId: string;
    producer: WorkflowAuthoredProducerRef;
    invocation: WorkflowProgressEnvelopeV1;
  }>) => Promise<WorkflowExecutionRunConversation | null>;
  /** Supplies immutable accepted-run authority without letting this leaf invent it. */
  buildActionContext: (
    params: Parameters<WorkflowStepExecutor>[0],
  ) => RpcActionExecutorContext;
  /** Profile generations are runtime-catalog facts, not portable workflow content. */
  resolveProfileGenerationId?: (profileId: string) => string | null | Promise<string | null>;
}>;

export type WorkflowAttachedExecutionRunConversation = Readonly<{
  sessionId: string;
  machineId: string;
  directory?: string;
  runId?: string;
}>;

export type WorkflowAttachedExecutionRunInputOutcome =
  | Readonly<{ kind: 'accepted' }>
  | Readonly<{ kind: 'rejected'; code: string }>
  | Readonly<{ kind: 'outcome_uncertain'; code: string }>;

export type WorkflowAttachedExecutionRunStepExecutorDeps = Readonly<{
  actionExecutor: DetachedExecutionRunActionExecutor;
  /** Canonical Session/conversation owner; this leaf neither creates nor indexes Sessions. */
  materializeConversation: (
    params: Parameters<WorkflowStepExecutor>[0],
  ) => Promise<WorkflowAttachedExecutionRunConversation>;
  /** Re-resolve the owning Session for durable correspondence after restart. */
  resolveRunSession: (params: Readonly<{
    runId: string;
    invocation: WorkflowProgressEnvelopeV1;
  }>) => Promise<WorkflowAttachedExecutionRunConversation | null>;
  /** Canonical Session Pending admission with recipient `{kind:'execution_run',runId}`. */
  sendInput: (params: Readonly<{
    sessionId: string;
    runId: string;
    workflowRunId: string;
    invocationRecordId: string;
    text: string;
    references: Parameters<WorkflowStepExecutor>[0]['input']['references'];
    attachments: Parameters<WorkflowStepExecutor>[0]['input']['attachments'];
    localInputId: string;
    resultContract: ExecutionRunResultContractV1;
    permissionMode: string;
    sourceAuthority?: NonNullable<Parameters<WorkflowStepExecutor>[0]['authorization']['sourceAuthority']>;
    modelSelectionInput?: Parameters<WorkflowStepExecutor>[0]['execution']['modelSelection'];
    signal?: AbortSignal;
  }>) => Promise<WorkflowAttachedExecutionRunInputOutcome>;
  buildActionContext: (
    params: Parameters<WorkflowStepExecutor>[0],
  ) => RpcActionExecutorContext;
  resolveProfileGenerationId?: (profileId: string) => string | null | Promise<string | null>;
}>;

export class WorkflowExecutionRunCompositionError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

export type PreparedWorkflowDetachedExecutionRun = Readonly<{
  kind: 'workflow_detached_execution_run';
  retainedConversation: WorkflowExecutionRunConversation | null;
  runtimeSelection: WorkflowRetainedRuntimeSelectionV1;
}>;

function isPreparedWorkflowDetachedExecutionRun(
  value: unknown,
): value is PreparedWorkflowDetachedExecutionRun {
  return typeof value === 'object' && value !== null
    && 'kind' in value && value.kind === 'workflow_detached_execution_run'
    && 'runtimeSelection' in value;
}

function actionContextFor(
  deps: WorkflowDetachedExecutionRunStepExecutorDeps,
  params: Parameters<WorkflowStepExecutor>[0],
  observation?: Readonly<{
    localInputId: string;
    runtimeSelection: WorkflowRetainedRuntimeSelectionV1;
  }>,
): RpcActionExecutorContext {
  const ownerContext = deps.buildActionContext(params);
  return {
    ...ownerContext,
    actionCaller: {
      kind: 'workflowRun',
      runId: params.runId,
      authorization: params.authorization,
    },
    executionRunTargetMachineId: params.workspace.machineId,
    ...(observation && params.onExecutionObservation
      ? {
          executionRunWorkflowObservationSink: {
            commit: async (value: ExecutionRunWorkflowObservation) => {
              if (value.localInputId !== observation.localInputId) {
                throw new Error('workflow_invocation_fact_conflict');
              }
              await params.onExecutionObservation!({
                execution: {
                  kind: 'detached_run',
                  runId: value.runId,
                  localInputId: observation.localInputId,
                  runtimeSelection: observation.runtimeSelection,
                  ...(value.kind === 'provider_resume_identity'
                    ? { providerResumeIdentity: value.providerResumeIdentity }
                    : {}),
                },
                ...(value.kind === 'usage' ? { usage: value.usage } : {}),
              });
            },
          },
        }
      : {}),
    ...(params.signal ? { signal: params.signal } : {}),
  };
}

function classifyActionFailure(
  result: Extract<Awaited<ReturnType<RpcActionExecutor['execute']>>, { ok: false }>,
  start: boolean,
  signal?: AbortSignal,
): WorkflowStepExecutionResult {
  if (start && readExecutionRunStartRunCreation(result.details) !== 'noRunCreated') {
    return { kind: 'outcome_uncertain', code: result.errorCode };
  }
  if (result.errorCode === 'cancelled') {
    if (classifyWorkflowAbort(signal) === 'interrupted') {
      // An owner-proven `noRunCreated` start left nothing behind: the row
      // stays re-enterable for the reclaim. A retained-conversation send
      // cannot prove whether its prompt was emitted, so it waits for an
      // explicit recovery choice instead of being resubmitted or relabeled
      // as user cancellation.
      if (start) throw new WorkflowRuntimeInterruption();
      return { kind: 'needs_attention', code: 'execution_run_input_admission_interrupted' };
    }
    return { kind: 'cancelled', code: result.errorCode };
  }
  if (
    result.errorCode === 'execution_run_not_found'
    || result.errorCode === 'execution_run_target_unavailable'
    || result.errorCode === 'execution_run_protocol_unsupported'
  ) {
    return { kind: 'needs_attention', code: 'continuation_unavailable' };
  }
  return { kind: 'failed', code: result.errorCode };
}

function projectObservation(
  observation: Exclude<WorkflowDetachedExecutionRunObservation, { kind: 'pending' }>,
): WorkflowStepExecutionResult {
  switch (observation.kind) {
    case 'completed': return { kind: 'completed', result: observation.result, resultEncoding: 'typed' };
    case 'failed': return { kind: 'failed', code: observation.code };
    case 'cancelled': return { kind: 'cancelled', ...(observation.code ? { code: observation.code } : {}) };
    case 'outcome_uncertain': return { kind: 'outcome_uncertain', code: observation.code };
  }
}

const MAX_SCHEDULABLE_OBSERVATION_DELAY_MS = 2_147_483_647;

function createWorkflowObservationDeadline(expiresAt: number): Readonly<{
  signal: AbortSignal;
  expired: () => boolean;
  dispose: () => void;
}> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let expired = false;
  const schedule = () => {
    const remainingMs = expiresAt - Date.now();
    if (remainingMs <= 0) {
      expired = true;
      controller.abort(new Error('Workflow observation deadline reached'));
      return;
    }
    // Host timers cannot represent longer waits. Re-arm against the same
    // persisted absolute deadline instead of narrowing the authored timeout.
    timer = setTimeout(schedule, Math.min(remainingMs, MAX_SCHEDULABLE_OBSERVATION_DELAY_MS));
  };
  schedule();
  return {
    signal: controller.signal,
    expired: () => expired,
    dispose: () => {
      if (timer !== undefined) clearTimeout(timer);
    },
  };
}

async function observeExactRunInput(params: Readonly<{
  deps: ExecutionRunObservationDeps;
  executionParams: Parameters<WorkflowStepExecutor>[0];
  runId: string;
  localInputId: string;
  sessionId: string | null;
  context: RpcActionExecutorContext;
}>): Promise<WorkflowStepExecutionResult> {
  const expiresAt = params.executionParams.invocation.observationDeadline?.kind === 'at'
    ? Date.parse(params.executionParams.invocation.observationDeadline.expiresAt)
    : null;
  if (params.executionParams.signal?.aborted) {
    return await settleOwnedRunInputAfterAbort(params);
  }
  if (expiresAt !== null && Date.now() >= expiresAt) {
    return { kind: 'needs_attention', code: 'workflow_step_timeout' };
  }
  const deadline = expiresAt === null ? null : createWorkflowObservationDeadline(expiresAt);
  const observationContext = deadline === null
    ? params.context
    : {
        ...params.context,
        signal: params.context.signal
          ? AbortSignal.any([params.context.signal, deadline.signal])
          : deadline.signal,
      };
  const actionFailure: { current: WorkflowStepExecutionResult | null } = { current: null };
  const observation = await observeWorkflowDetachedExecutionRunInput({
      runId: params.runId,
      localInputId: params.localInputId,
      get: async (request) => {
        const result = await params.deps.actionExecutor.execute(
          'execution.run.get',
          { sessionId: params.sessionId, ...request, waitForInputId: params.localInputId },
          observationContext,
        );
        if (!result.ok) {
          actionFailure.current = classifyActionFailure(result, false);
          return null;
        }
        return result.result;
      },
  }).catch((error: unknown) => {
      if (actionFailure.current) return null;
      if (deadline?.expired()) {
        actionFailure.current = { kind: 'needs_attention', code: 'workflow_step_timeout' };
        return null;
      }
      throw error;
  }).finally(() => {
      deadline?.dispose();
  });
  if (actionFailure.current) {
    if (params.executionParams.signal?.aborted) return await settleOwnedRunInputAfterAbort(params);
    if (deadline?.expired()) return { kind: 'needs_attention', code: 'workflow_step_timeout' };
    return actionFailure.current.kind === 'cancelled'
      ? await settleOwnedRunInputAfterAbort(params)
      : actionFailure.current;
  }
  if (observation && observation.kind !== 'pending') return projectObservation(observation);
  if (params.executionParams.signal?.aborted) return await settleOwnedRunInputAfterAbort(params);
  return { kind: 'outcome_uncertain', code: 'execution_run_input_result_unavailable' };
}

/**
 * The observation ended because this attempt was aborted. Only an abort that
 * carries stop authority (cancel request, fail-stop closure, revoked
 * authority) stops the owned input; a bare claim interruption leaves the
 * surviving Run untouched for reclaim/reattach and unwinds without a fact.
 */
async function settleOwnedRunInputAfterAbort(params: Readonly<{
  deps: ExecutionRunObservationDeps;
  executionParams: Parameters<WorkflowStepExecutor>[0];
  runId: string;
  localInputId: string;
  sessionId: string | null;
  context: RpcActionExecutorContext;
}>): Promise<WorkflowStepExecutionResult> {
  if (classifyWorkflowAbort(params.executionParams.signal) === 'interrupted') {
    throw new WorkflowRuntimeInterruption();
  }
  const { signal: _abortedSignal, ...settlementContext } = params.context;
  const settled = await stopWorkflowPendingExecutionRunInput({
    runId: params.runId,
    localInputId: params.localInputId,
    stop: async () => await params.deps.actionExecutor.execute(
      'execution.run.stop',
      { sessionId: params.sessionId, runId: params.runId },
      settlementContext,
    ),
    get: async (request) => {
      const result = await params.deps.actionExecutor.execute(
        'execution.run.get',
        { sessionId: params.sessionId, ...request },
        settlementContext,
      );
      return result.ok ? result.result : null;
    },
  });
  return settled.kind === 'unresolved'
    ? { kind: 'outcome_uncertain', code: settled.code }
    : projectObservation(settled);
}

function validateConversation(
  conversation: Pick<WorkflowExecutionRunConversation, 'machineId' | 'directory'>,
  params: Parameters<WorkflowStepExecutor>[0],
): void {
  if (
    conversation.machineId !== params.workspace.machineId
    || (conversation.directory !== undefined
      && !canonicalAbsolutePathsEqual(conversation.directory, params.workspace.directory))
  ) {
    throw new WorkflowExecutionRunCompositionError('workflow_conversation_unavailable');
  }
}

function buildNativeAgentRunStartInput(params: Readonly<{
  executionParams: Parameters<WorkflowStepExecutor>[0];
  sessionId: string | null;
  localInputId: string;
  profileGenerationId: string | null;
  permissionMode: string;
  includeInitialInput?: boolean;
}>): Record<string, unknown> {
  const { executionParams, sessionId, localInputId, profileGenerationId } = params;
  const selection = executionParams.execution;
  const modelSelection = selection.modelSelection?.ref;
  return {
    sessionId,
    intent: 'agent',
    backendTarget: selection.agentTarget,
    ...(params.includeInitialInput === false ? {
      initialInput: { kind: 'deferred_session_pending' },
    } : {
      instructions: executionParams.input.text,
      localInputId,
      resultContract: executionParams.step.result,
    }),
    permissionMode: params.permissionMode,
    retentionPolicy: 'resumable',
    runClass: 'long_lived',
    ioMode: 'request_response',
    cwd: executionParams.workspace.directory,
    ...(modelSelection ? { modelId: modelSelection.modelId, modelSelection } : {}),
    ...(selection.profileId && profileGenerationId
      ? { profileId: selection.profileId, profileGenerationId }
      : {}),
    ...(selection.sessionConfigOptionOverrides
      ? { sessionConfigOptionOverrides: selection.sessionConfigOptionOverrides }
      : {}),
    ...(selection.mcpSelection !== undefined ? { mcpSelection: selection.mcpSelection } : {}),
    ...(selection.connectedServices !== undefined
      ? { connectedServices: selection.connectedServices }
      : {}),
    ...(selection.acpSessionModeId !== undefined
      ? { acpSessionModeId: selection.acpSessionModeId }
      : {}),
    ...(selection.runtimeDescriptorV1 !== undefined
      ? { runtimeDescriptorV1: selection.runtimeDescriptorV1 }
      : {}),
  };
}

function workflowExecutionRunStartContext(
  context: RpcActionExecutorContext,
  localInputId: string,
): RpcActionExecutorContext {
  return {
    ...context,
    actionRequestId: `${localInputId}:execution-run-start`,
  };
}

function resolveWorkflowExecutionPermissionMode(
  params: Pick<Parameters<WorkflowStepExecutor>[0], 'execution' | 'authorization'>,
): string | null {
  const decision = assertNonEscalatingPermissionMode({
    requestedMode: params.execution.permissionMode ?? 'default',
    callerMode: params.authorization.admittedPermissionCeiling,
  });
  return decision.ok ? decision.normalizedMode : null;
}

async function resolveRetainedConversation(
  deps: WorkflowDetachedExecutionRunStepExecutorDeps,
  params: Parameters<WorkflowStepPreparer>[0],
  requestedRuntimeSelection: WorkflowRetainedRuntimeSelectionV1,
): Promise<WorkflowExecutionRunConversation | null> {
  const selection = params.execution.conversation ?? { kind: 'shared_run' as const };
  if (selection.kind === 'fresh') return null;
  if (selection.kind === 'existing_session') {
    throw new WorkflowExecutionRunCompositionError('workflow_conversation_unavailable');
  }
  const conversation = selection.kind === 'shared_run'
    ? await deps.resolveSharedRunConversation({ runId: params.runId, invocation: params.invocation })
    : await deps.resolveProducerConversation({
        runId: params.runId,
        producer: selection.producer,
        invocation: params.invocation,
      });
  if (!conversation && selection.kind === 'from_step') {
    throw new WorkflowExecutionRunCompositionError('workflow_conversation_unavailable');
  }
  if (conversation) {
    if (!areWorkflowRetainedRuntimeSelectionsEqualV1(
      conversation.runtimeSelection,
      requestedRuntimeSelection,
    )) {
      throw new WorkflowExecutionRunCompositionError('workflow_conversation_unavailable');
    }
  }
  return conversation;
}

const DETACHED_RUN_INAPPLICABLE_SELECTION_FIELDS = [
  'transcriptStorage',
  'terminal',
  'windowsRemoteSessionLaunchMode',
  'windowsRemoteSessionConsole',
  'windowsTerminalWindowName',
] as const;

function assertDetachedRunAuthoringSupported(
  params: Parameters<WorkflowStepPreparer>[0],
): void {
  if (DETACHED_RUN_INAPPLICABLE_SELECTION_FIELDS.some((field) => Object.hasOwn(params.execution, field))) {
    throw new WorkflowExecutionRunCompositionError('target_unavailable');
  }
}

function buildWorkflowStructuredInput(
  input: Parameters<WorkflowStepExecutor>[0]['input'],
) {
  if (input.references.length === 0 && input.attachments.length === 0) return undefined;
  return HappierStructuredInputV1Schema.parse({
    v: 1,
    ...(input.references.length > 0 ? { mentions: input.references } : {}),
    ...(input.attachments.length > 0 ? { composerAttachments: input.attachments } : {}),
  });
}

export async function prepareWorkflowDetachedExecutionRunStep(
  deps: WorkflowDetachedExecutionRunStepExecutorDeps,
  params: Parameters<WorkflowStepPreparer>[0],
): Promise<PreparedWorkflowDetachedExecutionRun> {
  assertDetachedRunAuthoringSupported(params);
  const permissionMode = resolveWorkflowExecutionPermissionMode(params);
  if (permissionMode === null) {
    throw new WorkflowExecutionRunCompositionError('workflow_permission_escalation_denied');
  }
  const runtimeSelection = projectWorkflowRetainedRuntimeSelectionV1({
    ...params.execution,
    permissionMode,
  });
  return {
    kind: 'workflow_detached_execution_run',
    retainedConversation: await resolveRetainedConversation(
      deps,
      params,
      runtimeSelection,
    ),
    runtimeSelection,
  };
}

/**
 * Native detached-Run workflow leaf. The Action/RPC/bridge owner retains all
 * Agent lifecycle, prompt admission, permission, result and resume semantics;
 * this adapter only binds workflow correspondence and caller-owned durability.
 */
export function createWorkflowDetachedExecutionRunStepExecutor(
  deps: WorkflowDetachedExecutionRunStepExecutorDeps,
): WorkflowStepExecutor {
  return async (params) => {
    const permissionMode = resolveWorkflowExecutionPermissionMode(params);
    if (permissionMode === null) {
      return { kind: 'failed', code: 'workflow_permission_escalation_denied' };
    }
    let prepared: PreparedWorkflowDetachedExecutionRun;
    try {
      prepared = isPreparedWorkflowDetachedExecutionRun(params.preparedStep)
        ? params.preparedStep
        : await prepareWorkflowDetachedExecutionRunStep(deps, params);
    } catch (error) {
      if (error instanceof WorkflowExecutionRunCompositionError) {
        return {
          kind: error.code === 'workflow_permission_escalation_denied' ? 'failed' : 'needs_attention',
          code: error.code,
        };
      }
      throw error;
    }
    const runtimeSelection = prepared.runtimeSelection;
    const existing = params.invocation.execution;
    if (existing) {
      if (existing.kind !== 'detached_run') {
        return { kind: 'needs_attention', code: 'continuation_unavailable' };
      }
      return await observeExactRunInput({
        deps,
        executionParams: params,
        runId: existing.runId,
        localInputId: existing.localInputId,
        sessionId: null,
        context: actionContextFor(deps, params),
      });
    }

    let retainedConversation: WorkflowExecutionRunConversation | null;
    try {
      retainedConversation = prepared.retainedConversation;
      if (retainedConversation) validateConversation(retainedConversation, params);
    } catch (error) {
      if (error instanceof WorkflowExecutionRunCompositionError) {
        return { kind: 'needs_attention', code: error.code };
      }
      throw error;
    }
    const localInputId = deriveWorkflowSessionInputLocalIdV2({
      purpose: 'invocation',
      runId: params.runId,
      invocationRecordId: params.invocationRecordId ?? params.invocation.logicalInvocationRecordId,
    });
    const resultContract: ExecutionRunResultContractV1 = params.step.result;
    const structuredInput = buildWorkflowStructuredInput(params.input);
    const context = actionContextFor(deps, params, { localInputId, runtimeSelection });
    let runId: string;
    let acceptedProviderResumeIdentity: ExecutionRunResumeHandleProviderSessionV1 | undefined;

    if (retainedConversation) {
      const sent = await deps.actionExecutor.execute(
        'execution.run.send',
        {
          sessionId: null,
          runId: retainedConversation.runId,
          message: params.input.text,
          delivery: 'prompt',
          resume: true,
          localInputId,
          resultContract,
          ...(structuredInput ? { structuredInput } : {}),
        },
        context,
      );
      if (sent.ok) {
        runId = retainedConversation.runId;
        acceptedProviderResumeIdentity = retainedConversation.providerResumeIdentity;
      } else {
        if (sent.errorCode !== 'execution_run_not_found') {
          return classifyActionFailure(sent, false, params.signal);
        }
        const selection = params.execution;
        const providerResumeIdentity = retainedConversation.providerResumeIdentity;
        if (!selection.agentTarget || !providerResumeIdentity
          || !areExecutionRunBackendTargetsEqual(
            providerResumeIdentity.backendTarget,
            selection.agentTarget,
          )) {
          return { kind: 'needs_attention', code: 'continuation_unavailable' };
        }
        const profileGenerationId = selection.profileId
          ? await deps.resolveProfileGenerationId?.(selection.profileId) ?? null
          : null;
        if (selection.profileId && !profileGenerationId) {
          return { kind: 'failed', code: 'target_unavailable' };
        }
        const started = await deps.actionExecutor.execute(
          'execution.run.start',
          {
            ...buildNativeAgentRunStartInput({
              executionParams: params,
              sessionId: null,
              localInputId,
              profileGenerationId,
              permissionMode,
            }),
            resumeHandle: providerResumeIdentity,
            ...(structuredInput ? { structuredInput } : {}),
          },
          workflowExecutionRunStartContext(context, localInputId),
        );
        if (!started.ok) return classifyActionFailure(started, true, params.signal);
        const payload = ExecutionRunStartResponseSchema.safeParse(started.result);
        if (!payload.success) {
          return { kind: 'outcome_uncertain', code: 'execution_run_start_ambiguous' };
        }
        runId = payload.data.runId;
        acceptedProviderResumeIdentity = providerResumeIdentity;
      }
    } else {
      const selection = params.execution;
      if (!selection.agentTarget) return { kind: 'failed', code: 'target_unavailable' };
      const fresh = selection.conversation?.kind === 'fresh';
      const profileGenerationId = selection.profileId
        ? await deps.resolveProfileGenerationId?.(selection.profileId) ?? null
        : null;
      if (selection.profileId && !profileGenerationId) {
        return { kind: 'failed', code: 'target_unavailable' };
      }
      const started = await deps.actionExecutor.execute(
        'execution.run.start',
        {
          ...buildNativeAgentRunStartInput({
            executionParams: params,
            sessionId: null,
            localInputId,
            profileGenerationId,
            permissionMode,
          }),
          ...(structuredInput ? { structuredInput } : {}),
          ...(fresh ? { retentionPolicy: 'ephemeral', runClass: 'bounded' } : {}),
        },
        workflowExecutionRunStartContext(context, localInputId),
      );
      if (!started.ok) return classifyActionFailure(started, true, params.signal);
      const payload = ExecutionRunStartResponseSchema.safeParse(started.result);
      if (!payload.success) {
        return { kind: 'outcome_uncertain', code: 'execution_run_start_ambiguous' };
      }
      runId = payload.data.runId;
    }

    await params.onInputAccepted({
      kind: 'detached_run', runId, localInputId, runtimeSelection,
      ...(acceptedProviderResumeIdentity
        ? { providerResumeIdentity: acceptedProviderResumeIdentity }
        : {}),
    });
    return await observeExactRunInput({
      deps,
      executionParams: params,
      runId,
      localInputId,
      sessionId: null,
      context,
    });
  };
}

/**
 * Session-attached native Run leaf. New/continued input still enters the
 * incumbent Session Pending owner; only Run lifecycle/observation uses the
 * shared execution.run Action family.
 */
export function createWorkflowAttachedExecutionRunStepExecutor(
  deps: WorkflowAttachedExecutionRunStepExecutorDeps,
): WorkflowStepExecutor {
  const contextFor = (params: Parameters<WorkflowStepExecutor>[0]): RpcActionExecutorContext => ({
    ...deps.buildActionContext(params),
    actionCaller: {
      kind: 'workflowRun',
      runId: params.runId,
      authorization: params.authorization,
    },
    executionRunTargetMachineId: params.workspace.machineId,
    ...(params.signal ? { signal: params.signal } : {}),
  });
  return async (params) => {
    const permissionMode = resolveWorkflowExecutionPermissionMode(params);
    if (permissionMode === null) {
      return { kind: 'failed', code: 'workflow_permission_escalation_denied' };
    }
    if (params.invocation.execution) {
      if (params.invocation.execution.kind !== 'attached_run') {
        return { kind: 'needs_attention', code: 'continuation_unavailable' };
      }
      const conversation = await deps.resolveRunSession({
        runId: params.invocation.execution.runId,
        invocation: params.invocation,
      });
      if (!conversation) return { kind: 'needs_attention', code: 'continuation_unavailable' };
      validateConversation(conversation, params);
      return await observeExactRunInput({
        deps,
        executionParams: params,
        sessionId: conversation.sessionId,
        runId: params.invocation.execution.runId,
        localInputId: params.invocation.execution.localInputId,
        context: contextFor(params),
      });
    }

    const conversation = await deps.materializeConversation(params);
    validateConversation(conversation, params);
    const localInputId = deriveWorkflowSessionInputLocalIdV2({
      purpose: 'invocation',
      runId: params.runId,
      invocationRecordId: params.invocationRecordId ?? params.invocation.logicalInvocationRecordId,
    });
    let executionRunId = conversation.runId;
    let correspondencePersisted = false;
    let inputAdmissionUncertainCode: string | null = null;
    const context = contextFor(params);
    if (executionRunId) {
      const admitted = await deps.sendInput({
        sessionId: conversation.sessionId,
        runId: executionRunId,
        workflowRunId: params.runId,
        invocationRecordId: params.invocationRecordId ?? params.invocation.logicalInvocationRecordId,
        text: params.input.text,
        references: params.input.references,
        attachments: params.input.attachments,
        localInputId,
        resultContract: params.step.result,
        permissionMode,
        ...(params.authorization.sourceAuthority
          ? { sourceAuthority: params.authorization.sourceAuthority }
          : {}),
        ...(params.execution.modelSelection === undefined ? {} : { modelSelectionInput: params.execution.modelSelection }),
        ...(params.signal ? { signal: params.signal } : {}),
      });
      if (admitted.kind === 'rejected') return { kind: 'failed', code: admitted.code };
      if (admitted.kind === 'outcome_uncertain') {
        inputAdmissionUncertainCode = admitted.code;
      }
    } else {
      if (!params.execution.agentTarget) return { kind: 'failed', code: 'target_unavailable' };
      const profileGenerationId = params.execution.profileId
        ? await deps.resolveProfileGenerationId?.(params.execution.profileId) ?? null
        : null;
      if (params.execution.profileId && !profileGenerationId) {
        return { kind: 'failed', code: 'target_unavailable' };
      }
      const started = await deps.actionExecutor.execute(
        'execution.run.start',
        buildNativeAgentRunStartInput({
          executionParams: params,
          sessionId: conversation.sessionId,
          localInputId,
          profileGenerationId,
          permissionMode,
          // The exact workflow turn enters canonical Session V2 Pending once
          // the attached Run target exists. An embedded start prompt would
          // bypass workflow provenance and conflate Run creation with input
          // admission.
          includeInitialInput: false,
        }),
        workflowExecutionRunStartContext(context, localInputId),
      );
      if (!started.ok) return classifyActionFailure(started, true, params.signal);
      const payload = ExecutionRunStartResponseSchema.safeParse(started.result);
      if (!payload.success) {
        return { kind: 'outcome_uncertain', code: 'execution_run_start_ambiguous' };
      }
      executionRunId = payload.data.runId;
      await params.onInputAccepted({
        kind: 'attached_run', sessionId: conversation.sessionId, runId: executionRunId, localInputId,
      });
      correspondencePersisted = true;
      const admitted = await deps.sendInput({
        sessionId: conversation.sessionId,
        runId: executionRunId,
        workflowRunId: params.runId,
        invocationRecordId: params.invocationRecordId ?? params.invocation.logicalInvocationRecordId,
        text: params.input.text,
        references: params.input.references,
        attachments: params.input.attachments,
        localInputId,
        resultContract: params.step.result,
        permissionMode,
        ...(params.authorization.sourceAuthority
          ? { sourceAuthority: params.authorization.sourceAuthority }
          : {}),
        ...(params.execution.modelSelection === undefined ? {} : { modelSelectionInput: params.execution.modelSelection }),
        ...(params.signal ? { signal: params.signal } : {}),
      });
      if (admitted.kind === 'rejected') return { kind: 'failed', code: admitted.code };
      if (admitted.kind === 'outcome_uncertain') {
        inputAdmissionUncertainCode = admitted.code;
      }
    }
    if (inputAdmissionUncertainCode && classifyWorkflowAbort(params.signal) === 'interrupted') {
      throw new WorkflowRuntimeInterruption();
    }
    if (!correspondencePersisted) {
      await params.onInputAccepted({
        kind: 'attached_run', sessionId: conversation.sessionId, runId: executionRunId, localInputId,
      });
    }
    if (inputAdmissionUncertainCode) {
      return { kind: 'outcome_uncertain', code: inputAdmissionUncertainCode };
    }
    return await observeExactRunInput({
      deps,
      executionParams: params,
      sessionId: conversation.sessionId,
      runId: executionRunId,
      localInputId,
      context,
    });
  };
}

/** One origin-neutral selector. Agent identity never decides execution placement. */
export function createWorkflowStepExecutorDispatcher(executors: Readonly<{
  session: WorkflowStepExecutor;
  attachedRun: WorkflowStepExecutor;
  detachedRun: WorkflowStepExecutor;
}>): WorkflowStepExecutor {
  return async (params) => {
    switch (params.executionTarget.kind) {
      case 'session': return await executors.session(params);
      case 'attached_run': return await executors.attachedRun(params);
      case 'detached_run': return await executors.detachedRun(params);
    }
  };
}
