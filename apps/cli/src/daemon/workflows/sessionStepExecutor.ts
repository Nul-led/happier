import type { StoredCredentials } from '@/persistence';
import { parsePermissionIntentAlias } from '@happier-dev/agents';
import { buildExecutionRunResultContractPrompt } from '@/agent/executionRuns/profiles/resultContract';
import { cancelSessionInput } from '@/session/services/cancelSessionInput';
import { resolveSessionCreationAgentTarget } from '@/session/creation/resolveSessionCreationAgentTarget';
import { prepareSessionCreationTarget } from '@/session/creation/prepareSessionCreationTarget';
import { createSpawnedSession } from '@/session/services/createSpawnedSession';
import {
  resolveSessionSpawnConnectedServicesDefaultsPayload,
  type ResolveSpawnConnectedServicesTeamResourceCatalog,
} from '@/session/services/spawnConnectedServicesDefaults';
import { canonicalAbsolutePathsEqual } from '@/utils/path/expandHomeDirPath';
import type {
  WorkflowAuthoredProducerRef,
  WorkflowProgressEnvelopeV1,
  WorkflowSessionAuthoringSelection,
  WorkflowWorkspaceDescriptorV1,
} from '@happier-dev/protocol/workflows';
import { assertNonEscalatingPermissionMode } from '@happier-dev/protocol';
import {
  classifyWorkflowAbort,
  WorkflowRuntimeInterruption,
  type WorkflowStepExecutionResult,
  type WorkflowStepExecutor,
  type WorkflowStepPreparer,
} from './coordinator';
import {
  enqueueWorkflowSessionInput,
  observeWorkflowSessionInputResult,
  preflightWorkflowSessionInputAdmissionV2,
} from './stepExecution';

export type PreparedWorkflowSessionConversation = Readonly<{
  kind: 'workflow_session_conversation';
  existing: WorkflowSessionConversation | null;
}>;

type WorkflowSessionConversation = Readonly<{
  sessionId: string;
  machineId: string;
  directory: string;
}>;

export type CreateFreshWorkflowSessionConversation = (params: Readonly<{
  selection: WorkflowSessionAuthoringSelection;
  workspace: WorkflowWorkspaceDescriptorV1;
  creationKey: string;
  signal?: AbortSignal;
}>) => Promise<WorkflowSessionConversation>;

/**
 * Binds workflow fresh-conversation creation to the same target preparation,
 * Agent catalog, Connected Service defaulting, credential/currentness and
 * create-or-rejoin owners as ordinary authored Sessions.
 */
export function createProductionFreshWorkflowSessionConversation(deps: Readonly<{
  credentials: StoredCredentials;
  serverId: string;
  machineId: string;
  machineAdmissionTransport: NonNullable<Parameters<typeof enqueueWorkflowSessionInput>[0]['machineAdmissionTransport']>;
  resolveTeamCredentialResourceCatalog?: ResolveSpawnConnectedServicesTeamResourceCatalog;
}>): CreateFreshWorkflowSessionConversation {
  return async ({ selection, workspace, creationKey, signal }) => {
    signal?.throwIfAborted();
    if (workspace.machineId !== deps.machineId) {
      throw new WorkflowSessionCompositionError('target_unavailable');
    }
    const resolvedAgent = selection.agentTarget
      ? resolveSessionCreationAgentTarget(selection.agentTarget)
      : null;
    if (!resolvedAgent) throw new WorkflowSessionCompositionError('target_unavailable');

    const target = await prepareSessionCreationTarget({
      request: {
        directory: workspace.directory,
      },
      ...(signal ? { signal } : {}),
    });
    signal?.throwIfAborted();
    if (!target.ok
      || target.directoryCreationRequired
      || !canonicalAbsolutePathsEqual(target.directory, workspace.directory)) {
      throw new WorkflowSessionCompositionError(
        target.ok ? 'conversation_workspace_mismatch' : target.code,
      );
    }

    const connectedServicesDefault = selection.connectedServices === undefined
      ? await resolveSessionSpawnConnectedServicesDefaultsPayload({
          agentId: resolvedAgent.agentId,
          credentials: deps.credentials,
          ...(deps.resolveTeamCredentialResourceCatalog
            ? { resolveTeamCredentialResourceCatalog: deps.resolveTeamCredentialResourceCatalog }
            : {}),
        })
      : null;
    signal?.throwIfAborted();
    const terminal = selection.terminal
      ? {
          ...(selection.terminal.mode && selection.terminal.mode !== 'integrated'
            ? { mode: selection.terminal.mode }
            : {}),
          ...(selection.terminal.tmux ? { tmux: selection.terminal.tmux } : {}),
        }
      : undefined;
    const permissionMode = selection.permissionMode
      ? parsePermissionIntentAlias(selection.permissionMode)
      : null;
    if (selection.permissionMode && !permissionMode) {
      throw new WorkflowSessionCompositionError('target_unavailable');
    }
    const created = await createSpawnedSession({
      credentials: deps.credentials,
      machineId: deps.machineId,
      directory: target.directory,
      approvedNewDirectoryCreation: false,
      spawnNonce: creationKey,
      backendTarget: resolvedAgent.backendTarget,
      agentTarget: selection.agentTarget ?? undefined,
      ...(selection.modelSelection ? { modelSelection: selection.modelSelection } : {}),
      ...(selection.profileId ? { profileId: selection.profileId } : {}),
      ...(permissionMode ? { permissionMode } : {}),
      ...(selection.acpSessionModeId ? { agentModeId: selection.acpSessionModeId } : {}),
      ...(selection.sessionConfigOptionOverrides
        ? { sessionConfigOptionOverrides: selection.sessionConfigOptionOverrides }
        : {}),
      ...(selection.connectedServices
        ? { connectedServices: selection.connectedServices }
        : connectedServicesDefault
          ? {
              connectedServices: connectedServicesDefault.connectedServices,
              connectedServicesUpdatedAt: connectedServicesDefault.connectedServicesUpdatedAt,
              // Defaulted Team targets are admitted only through the Session's
              // own Team slot bindings, created with it.
              ...(connectedServicesDefault.teamCredentialBindings
                ? { teamCredentialBindings: connectedServicesDefault.teamCredentialBindings }
                : {}),
            }
          : {}),
      ...(selection.mcpSelection ? { mcpSelection: selection.mcpSelection } : {}),
      ...(selection.transcriptStorage ? { transcriptStorage: selection.transcriptStorage } : {}),
      ...(terminal && Object.keys(terminal).length > 0 ? { terminal } : {}),
      ...(selection.windowsRemoteSessionLaunchMode
        ? { windowsRemoteSessionLaunchMode: selection.windowsRemoteSessionLaunchMode }
        : selection.terminal?.windows?.launchMode
          ? { windowsRemoteSessionLaunchMode: selection.terminal.windows.launchMode }
          : {}),
      ...(selection.windowsRemoteSessionConsole
        ? { windowsRemoteSessionConsole: selection.windowsRemoteSessionConsole }
        : selection.terminal?.windows?.console
          ? { windowsRemoteSessionConsole: selection.terminal.windows.console }
          : {}),
      ...(selection.windowsTerminalWindowName
        ? { windowsTerminalWindowName: selection.windowsTerminalWindowName }
        : selection.terminal?.windows?.windowName
          ? { windowsTerminalWindowName: selection.terminal.windows.windowName }
          : {}),
      ...(selection.runtimeDescriptorV1 ? { runtimeDescriptorV1: selection.runtimeDescriptorV1 } : {}),
      machineAdmissionTransport: deps.machineAdmissionTransport,
      ...(signal ? { signal } : {}),
    });
    signal?.throwIfAborted();
    return { sessionId: created.sessionId, machineId: deps.machineId, directory: target.directory };
  };
}

export class WorkflowSessionCompositionError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

/** Session-first leaf adapter. Conversation selection/creation stays in its injected Session owner. */
export function createWorkflowSessionStepExecutor(deps: Readonly<{
  credentials: StoredCredentials;
  prepareConversation: (params: Parameters<WorkflowStepExecutor>[0]) => Promise<PreparedWorkflowSessionConversation>;
  resolveMachineOperationProtocolCapabilities: (signal?: AbortSignal) => Promise<unknown>;
  materializeConversation: (
    prepared: PreparedWorkflowSessionConversation,
    params: Parameters<WorkflowStepExecutor>[0],
  ) => Promise<Readonly<{
    sessionId: string;
    machineAdmissionTransport: NonNullable<Parameters<typeof enqueueWorkflowSessionInput>[0]['machineAdmissionTransport']>;
  }>>;
  sessionInput?: Readonly<{
    preflight: typeof preflightWorkflowSessionInputAdmissionV2;
    enqueue: typeof enqueueWorkflowSessionInput;
    observe: typeof observeWorkflowSessionInputResult;
    cancel?: typeof cancelSessionInput;
  }>;
}>): WorkflowStepExecutor {
  const sessionInput = {
    preflight: preflightWorkflowSessionInputAdmissionV2,
    enqueue: enqueueWorkflowSessionInput,
    observe: observeWorkflowSessionInputResult,
    cancel: cancelSessionInput,
    ...deps.sessionInput,
  };
  return async (params) => {
    const requestedPermissionCeiling = params.execution.permissionMode ?? 'default';
    if (!assertNonEscalatingPermissionMode({
      requestedMode: requestedPermissionCeiling,
      callerMode: params.authorization.admittedPermissionCeiling,
    }).ok) {
      return { kind: 'failed', code: 'workflow_permission_escalation_denied' };
    }
    const cancelAcceptedInput = async (sessionId: string, localId: string) => {
      const cancelled = await sessionInput.cancel({ credentials: deps.credentials, sessionId, localId });
      switch (cancelled.kind) {
        case 'pending_retired': return { kind: 'cancelled' as const, code: 'session_input_pending_retired' };
        case 'turn_cancel_requested': return { kind: 'cancelled' as const, code: 'session_input_turn_cancel_requested' };
        case 'session_absent': return { kind: 'cancelled' as const, code: 'session_input_session_absent' };
        case 'turn_cancel_unavailable': return { kind: 'needs_attention' as const, code: cancelled.code };
      }
    };
    // Observation ended because this attempt was aborted. Only an abort with
    // stop authority retires/cancels the exact accepted input; a bare claim
    // interruption leaves the Session turn running for reclaim/reattach.
    const settleAcceptedInputAfterAbort = async (sessionId: string, localId: string) => {
      if (classifyWorkflowAbort(params.signal) === 'interrupted') throw new WorkflowRuntimeInterruption();
      return await cancelAcceptedInput(sessionId, localId);
    };
    const settleBeforeAdmissionAfterAbort = (): WorkflowStepExecutionResult => {
      if (classifyWorkflowAbort(params.signal) === 'interrupted') throw new WorkflowRuntimeInterruption();
      return { kind: 'cancelled', code: 'session_input_cancelled' };
    };
    if (params.invocation.execution) {
      if (params.invocation.execution.kind !== 'session') {
        return { kind: 'failed', code: 'workflow_execution_target_mismatch' };
      }
      const observed = await sessionInput.observe({
        credentials: deps.credentials,
        sessionId: params.invocation.execution.sessionId,
        localId: params.invocation.execution.localInputId,
        ...(params.invocation.observationDeadline?.kind === 'at'
          ? { deadlineMs: Date.parse(params.invocation.observationDeadline.expiresAt) }
          : {}),
        ...(params.signal ? { signal: params.signal } : {}),
      });
      if (!observed.ok) return observed.code === 'cancelled'
        ? await settleAcceptedInputAfterAbort(params.invocation.execution.sessionId, params.invocation.execution.localInputId)
        : { kind: 'needs_attention', code: observed.code };
      switch (observed.result.kind) {
        case 'pending': return { kind: 'needs_attention', code: 'workflow_step_timeout' };
        case 'final_text': return {
          kind: 'completed',
          result: observed.result.text,
          ...(observed.result.usage ? { usage: observed.result.usage } : {}),
        };
        case 'terminal_no_result': return {
          kind: 'failed', code: observed.result.reason,
          ...(observed.result.usage ? { usage: observed.result.usage } : {}),
        };
        case 'failed': return {
          kind: 'failed', code: 'session_input_failed',
          ...(observed.result.usage ? { usage: observed.result.usage } : {}),
        };
        case 'cancelled': return {
          ...await cancelAcceptedInput(
            params.invocation.execution.sessionId,
            params.invocation.execution.localInputId,
          ),
          ...(observed.result.usage ? { usage: observed.result.usage } : {}),
        };
      }
    }
    let prepared: PreparedWorkflowSessionConversation;
    try {
      prepared = isPreparedWorkflowSessionConversation(params.preparedStep)
        ? params.preparedStep
        : await deps.prepareConversation(params);
    } catch (error) {
      if (params.signal?.aborted) return settleBeforeAdmissionAfterAbort();
      if (error instanceof WorkflowSessionCompositionError) return { kind: 'failed', code: error.code };
      throw error;
    }
    const machineOperationProtocolCapabilities = await deps.resolveMachineOperationProtocolCapabilities(
      params.signal,
    );
    const preflight = sessionInput.preflight(machineOperationProtocolCapabilities);
    if (!preflight.ok) return { kind: 'failed', code: preflight.code };
    let conversation: Awaited<ReturnType<typeof deps.materializeConversation>>;
    try {
      conversation = await deps.materializeConversation(prepared, params);
    } catch (error) {
      if (params.signal?.aborted) return settleBeforeAdmissionAfterAbort();
      if (error instanceof WorkflowSessionCompositionError) return { kind: 'failed', code: error.code };
      throw error;
    }
    const resultInstruction = buildExecutionRunResultContractPrompt(params.step.result);
    const text = resultInstruction ? `${params.input.text}\n\n${resultInstruction}` : params.input.text;
    const admission = await sessionInput.enqueue({
      credentials: deps.credentials,
      sessionId: conversation.sessionId,
      machineOperationProtocolCapabilities,
      workflow: { purpose: 'invocation', runId: params.runId, invocationRecordId: params.invocationRecordId ?? params.invocation.logicalInvocationRecordId },
      text,
      mentions: params.input.references,
      attachments: params.input.attachments,
      machineAdmissionTransport: conversation.machineAdmissionTransport,
      permissionMode: requestedPermissionCeiling,
      ...(params.authorization.sourceAuthority
        ? { sourceAuthority: params.authorization.sourceAuthority }
        : {}),
      ...(params.execution.modelSelection?.ref === undefined
        ? {}
        : { modelSelectionInput: params.execution.modelSelection.ref }),
      ...(params.signal ? { signal: params.signal } : {}),
    });
    if (admission.status === 'update_required') return { kind: 'failed', code: admission.code };
    if (admission.status === 'rejected') return { kind: 'failed', code: admission.code };
    if (admission.status === 'outcomeUnknown') return { kind: 'outcome_uncertain', code: admission.code };
    await params.onInputAccepted({
      kind: 'session',
      sessionId: conversation.sessionId,
      localInputId: admission.localId,
    });
    const deadlineMs = params.invocation.observationDeadline?.kind === 'at'
      ? Date.parse(params.invocation.observationDeadline.expiresAt)
      : undefined;
    const observed = await sessionInput.observe({
      credentials: deps.credentials,
      sessionId: conversation.sessionId,
      localId: admission.localId,
      ...(deadlineMs === undefined ? {} : { deadlineMs }),
      ...(params.signal ? { signal: params.signal } : {}),
    });
    if (!observed.ok) return observed.code === 'cancelled'
      ? await settleAcceptedInputAfterAbort(conversation.sessionId, admission.localId)
      : { kind: 'needs_attention', code: observed.code };
    switch (observed.result.kind) {
      case 'pending': return { kind: 'needs_attention', code: 'workflow_step_timeout' };
      case 'final_text': return {
        kind: 'completed',
        result: observed.result.text,
        ...(observed.result.usage ? { usage: observed.result.usage } : {}),
      };
      case 'terminal_no_result': return {
        kind: 'failed', code: observed.result.reason,
        ...(observed.result.usage ? { usage: observed.result.usage } : {}),
      };
      case 'failed': return {
        kind: 'failed', code: 'session_input_failed',
        ...(observed.result.usage ? { usage: observed.result.usage } : {}),
      };
      case 'cancelled': return {
        ...await cancelAcceptedInput(conversation.sessionId, admission.localId),
        ...(observed.result.usage ? { usage: observed.result.usage } : {}),
      };
    }
  };
}

export type ProductionWorkflowConversationOwner = Readonly<{
  prepare: (params: Parameters<WorkflowStepPreparer>[0]) => Promise<PreparedWorkflowSessionConversation>;
  materialize: (
    prepared: PreparedWorkflowSessionConversation,
    params: Parameters<WorkflowStepExecutor>[0],
  ) => Promise<WorkflowSessionConversation>;
}>;

export function isPreparedWorkflowSessionConversation(
  value: unknown,
): value is PreparedWorkflowSessionConversation {
  return typeof value === 'object' && value !== null
    && 'kind' in value && value.kind === 'workflow_session_conversation'
    && 'existing' in value;
}

/** One conversation-selection owner shared by Session and attached-Run leaves. */
export function createProductionWorkflowConversationOwner(deps: Readonly<{
  machineId: string;
  createFreshConversation: CreateFreshWorkflowSessionConversation;
  resolveSharedRunConversation: (params: Readonly<{
    runId: string;
    invocation: WorkflowProgressEnvelopeV1;
  }>) => Promise<WorkflowSessionConversation | null>;
  resolveProducerConversation: (params: Readonly<{
    runId: string;
    producer: WorkflowAuthoredProducerRef;
    invocation: WorkflowProgressEnvelopeV1;
  }>) => Promise<WorkflowSessionConversation | null>;
  resolveExistingSessionConversation: (params: Readonly<{
    sessionId: string;
    machineId: string;
    signal?: AbortSignal;
  }>) => Promise<WorkflowSessionConversation | null>;
}>): ProductionWorkflowConversationOwner {
  return {
    prepare: async (params): Promise<PreparedWorkflowSessionConversation> => {
      params.signal?.throwIfAborted();
      const selection = params.execution.conversation ?? { kind: 'shared_run' as const };
      if (selection.kind === 'existing_session' && params.execution.workspace?.kind === 'new_worktree') {
        throw new WorkflowSessionCompositionError('conversation_workspace_mismatch');
      }
      let existing: WorkflowSessionConversation | null = null;
      if (params.recoveryPreviousExecution?.kind === 'session') {
        if (!params.recoveryPreviousWorkspace) {
          throw new WorkflowSessionCompositionError('workflow_conversation_unavailable');
        }
        existing = {
          sessionId: params.recoveryPreviousExecution.sessionId,
          machineId: params.recoveryPreviousWorkspace.machineId,
          directory: params.recoveryPreviousWorkspace.directory,
        };
      } else if (selection.kind === 'shared_run') {
        existing = await deps.resolveSharedRunConversation({ runId: params.runId, invocation: params.invocation });
      } else if (selection.kind === 'from_step') {
        existing = await deps.resolveProducerConversation({
          runId: params.runId,
          producer: selection.producer,
          invocation: params.invocation,
        });
        if (!existing) throw new WorkflowSessionCompositionError('workflow_conversation_unavailable');
      } else if (selection.kind === 'existing_session') {
        existing = await deps.resolveExistingSessionConversation({
          sessionId: selection.sessionId,
          machineId: selection.machineId,
          ...(params.signal ? { signal: params.signal } : {}),
        });
        if (!existing) throw new WorkflowSessionCompositionError('workflow_conversation_unavailable');
      }
      if (existing && existing.machineId !== deps.machineId) {
        throw new WorkflowSessionCompositionError('workflow_conversation_unavailable');
      }
      params.signal?.throwIfAborted();
      return {
        kind: 'workflow_session_conversation',
        existing,
      };
    },
    materialize: async (prepared, params) => {
      if (prepared.existing) {
        if (!canonicalAbsolutePathsEqual(prepared.existing.directory, params.workspace.directory)) {
          throw new WorkflowSessionCompositionError('conversation_workspace_mismatch');
        }
        return prepared.existing;
      }
      params.signal?.throwIfAborted();
      if (!params.execution.agentTarget) throw new WorkflowSessionCompositionError('target_unavailable');
      const { conversation: _conversation, workspace: _workspace, ...selection } = params.execution;
      const conversation = await deps.createFreshConversation({
        selection,
        workspace: params.workspace,
        creationKey: `workflow:${params.runId}:${params.invocationRecordId ?? params.invocation.logicalInvocationRecordId}`,
        ...(params.signal ? { signal: params.signal } : {}),
      });
      params.signal?.throwIfAborted();
      if (conversation.machineId !== deps.machineId
        || !canonicalAbsolutePathsEqual(conversation.directory, params.workspace.directory)) {
        throw new WorkflowSessionCompositionError('workflow_conversation_unavailable');
      }
      return conversation;
    },
  };
}

/**
 * Concrete daemon Session composition. Durable invocation rows remain the
 * only conversation correspondence store: these read callbacks project prior
 * exact Session ids and this adapter creates only genuinely fresh Sessions.
 */
export function createProductionWorkflowSessionStepExecutor(deps: Readonly<{
  credentials: StoredCredentials;
  machineId: string;
  resolveMachineOperationProtocolCapabilities: (signal?: AbortSignal) => Promise<unknown>;
  machineAdmissionTransport: NonNullable<Parameters<typeof enqueueWorkflowSessionInput>[0]['machineAdmissionTransport']>;
  /** Canonical prepared Session-creation owner; this adapter never authors raw spawn options. */
  createFreshConversation: CreateFreshWorkflowSessionConversation;
  resolveSharedRunConversation: (params: Readonly<{
    runId: string;
    invocation: WorkflowProgressEnvelopeV1;
  }>) => Promise<WorkflowSessionConversation | null>;
  resolveProducerConversation: (params: Readonly<{
    runId: string;
    producer: WorkflowAuthoredProducerRef;
    invocation: WorkflowProgressEnvelopeV1;
  }>) => Promise<WorkflowSessionConversation | null>;
  resolveExistingSessionConversation: (params: Readonly<{
    sessionId: string;
    machineId: string;
    signal?: AbortSignal;
  }>) => Promise<WorkflowSessionConversation | null>;
  sessionInput?: Parameters<typeof createWorkflowSessionStepExecutor>[0]['sessionInput'];
}>): WorkflowStepExecutor {
  const conversations = createProductionWorkflowConversationOwner(deps);
  return createWorkflowSessionStepExecutor({
    credentials: deps.credentials,
    resolveMachineOperationProtocolCapabilities: deps.resolveMachineOperationProtocolCapabilities,
    ...(deps.sessionInput ? { sessionInput: deps.sessionInput } : {}),
    prepareConversation: async (params) => await conversations.prepare(params),
    materializeConversation: async (prepared, params) => {
      const conversation = await conversations.materialize(prepared, params);
      return { sessionId: conversation.sessionId, machineAdmissionTransport: deps.machineAdmissionTransport };
    },
  });
}
