import {
  approvalArtifactBodyMatchesHeaderV1,
  buildApprovalRequestArtifactHeaderV1,
  ApprovalRequestSchema,
  normalizeActionsSettingsV1,
  buildBackendTargetKeyV2,
  createActionExecutor,
  getSharedBlockingApprovalCoordinator,
  isActionEnabledByActionsSettings,
  isApprovalRequiredByActionsSettings,
  PluginWebhookActionHttpPathsV1,
  type PluginWebhookPresentUserActionIdV1,
  projectPluginFailureText,
  SessionModelTransitionRequestV1Schema,
  SessionModelTransitionResultV1Schema,
  type ActionExecutorContext,
  type ActionExecutorDeps,
  type ActionExecuteResult,
  type ActionDefinitionV1,
  type ActionId,
  type ApprovalRequest,
  type SessionModelTransitionRequestV1,
  type SessionModelTransitionResultV1,
  type SessionSpawnNewInputV2,
  type SessionSpawnNewResultV1,
  type SessionInputAdmissionResultV1,
  MemorySearchResultV1Schema,
  supportsMachineOperationProtocolCapabilityV1,
  supportsMachineSessionSpawnProtocolVersionV1,
  readServerEnabledBit,
  projectSessionFollowSourceKeyPreparationAfterSetV1,
  type SessionFollowActionOutputV1,
  type SessionFollowSourceKeyPreparationResultV1,
} from '@happier-dev/protocol';
import {
  SESSION_BOARD_ACTION_INPUT_SCHEMAS_V1,
  projectSessionBoardAdapterFailureV1,
  projectSessionBoardFeatureDecisionFailureV1,
  type SessionBoardActionFailureV1,
  type SessionBoardOutcomeUnknownDetailsV1,
} from '@happier-dev/protocol/sessions/board';
import {
    resolveAmbientProviderConnectionForModelIntent,
    resolveModelSelectionIntentFromSessionMetadata,
} from '@happier-dev/agents';
import {
  createModelIntentMetadataCasCandidate,
  runModelIntentAtAuthoritativeDisposition,
} from '@happier-dev/agents/session/state/metadataWriters';
import { RPC_METHODS, SESSION_RPC_METHODS } from '@happier-dev/protocol/rpc';

import { captureActionAccountContext, type ActionAccountContext } from './actionAccountContext';
import { createMachinePoolActionClient, MachinePoolActionError } from '@/sync/api/machines/machinePoolActions';
import { createRunnerActivationClient, RunnerActivationClientError } from '@/sync/api/ephemeralRunner/runnerActivationClient';
import type { RunnerActivationCreateRequestV1 } from '@happier-dev/protocol/ephemeralRunner/activation';
import { getReadyServerFeatures } from '@/sync/api/capabilities/getReadyServerFeatures';
import { resolveAccountScopedCryptoMaterialFromCredentials } from '@/sync/domains/connectedServices/resolveAccountScopedCryptoMaterialFromCredentials';
import { publishDisplayTitleToMetadata } from '@/sync/state/displayTitlePublish';
import { createUiExecutionRunActionDeps } from './executionRunActionDeps';
import {
    forkSession as forkSessionOp,
    rollbackSessionCheckpointCode as rollbackSessionCheckpointCodeOp,
    rollbackSessionConversation as rollbackSessionConversationOp,
    sessionStopWithServerScope,
} from '@/sync/ops/sessions';
import {
  preflightSessionHandoffTargetReplacement,
  startSessionHandoff as startSessionHandoffOp,
} from '@/sync/ops/sessionHandoffs';
import { sessionRpcWithServerScope } from '@/sync/runtime/orchestration/serverScopedRpc/serverScopedSessionRpc';
import {
  sendSessionMessageWithServerScope,
  type ServerScopedSessionSendMessageResult,
} from '@/sync/runtime/orchestration/serverScopedRpc/serverScopedSessionSendMessage';
import { machineRpcWithServerScope } from '@/sync/runtime/orchestration/serverScopedRpc/serverScopedMachineRpc';
import { captureActiveServerAccountScopeLifetime } from '@/sync/domains/scope/activeServerAccountScope';
import {
  authorizeMemorySessionRange,
  authorizeMemorySearchResult,
  captureMemorySearchSessionReadAuthority,
  readMemorySearchSessionForServerScope,
  readMemorySearchSessionHydrationConcurrencyLimit,
} from '@/sync/domains/memory/hydrateMemorySearchSessionTargets';
import { voiceSessionManager } from '@/voice/session/voiceSession';
import { VOICE_AGENT_GLOBAL_SESSION_ID } from '@/voice/agent/voiceAgentGlobalSessionId';
import { teleportVoiceAgentToSessionRoot } from '@/voice/agent/teleportVoiceAgentToSessionRoot';
import { storage } from '@/sync/domains/state/storage';
import { resolveHappierReplayConfig } from '@/sync/domains/session/resume/happierReplayPrompt';
import { resolveLocalFeaturePolicyEnabled } from '@/sync/domains/features/featureLocalPolicy';
import { resolveSessionForkStrategyAvailability } from '@/sync/domains/sessionFork/forkUiSupport';
import { resolveSessionForkReplayOptions } from '@/sync/domains/sessionFork/resolveSessionForkReplayOptions';
import { resetVoiceAgentPersistenceState } from '@/voice/persistence/resetVoiceAgentPersistenceState';
import {
  areServerProfileIdentifiersEquivalent,
  resolveServerProfileForPortableIdentity,
  resolveServerProfileScopeIdForIdentifier,
} from '@/sync/domains/server/serverProfiles';
import type { ArtifactHeader } from '@/sync/domains/artifacts/artifactTypes';
import { openSessionForVoiceTool } from '@/voice/tools/actionImpl/openSession';
import { resolveVoiceActionSessionReference } from '@/voice/tools/actionImpl/resolveVoiceActionSessionReference';
import { readAdmittedSessionReferenceCorpusOptions } from '@/voice/tools/actionImpl/admittedSessionReferenceCorpus';
import { normalizeSessionAddress } from '@/sync/domains/session/sessionAddress';
import { setPrimaryActionSessionId, setTrackedSessionIds } from '@/voice/tools/actionImpl/sessionTargets';
import { listSessionsForVoiceTool } from '@/voice/tools/actionImpl/sessionList';
import { getSessionActivityForVoiceTool } from '@/voice/tools/actionImpl/sessionActivity';
import {
  getSessionRecentMessagesForVoiceTool,
  getSessionTranscriptForVoiceTool,
} from '@/voice/tools/actionImpl/sessionRecentMessages';
import { listRecentPathsForVoiceTool } from '@/voice/tools/actionImpl/pathsListRecent';
import { listProjectsForActions } from './listProjects';
import {
  listPromptInvocationsForActions,
  resolvePromptInvocationForActions,
} from './resolvePromptInvocations';
import { listSpawnProfilesForActions } from './listSpawnProfiles';
import {
  listAgentConfigOptionsForActions,
  listAgentSessionModesForActions,
  listSpawnConnectedServicesForActions,
  resolveSessionSpawnAgentInventorySelectionForActions,
} from './agentInventoryActionDeps';
import { listMachinesForVoiceTool } from '@/voice/tools/actionImpl/machinesList';
import { listServersForVoiceTool } from '@/voice/tools/actionImpl/serversList';
import { listReviewEnginesForVoiceTool } from '@/voice/tools/actionImpl/reviewEnginesList';
import { listAgentBackendsForVoiceTool, listAgentModelsForVoiceTool } from '@/voice/tools/actionImpl/agentCatalogList';
import { createReviewCommentsHttpActionExecutor } from '@/sync/domains/reviews/comments/api';
import { createPluginPermissionGrantHttpActionExecutor } from '@/sync/domains/plugins/permissions/api';
import { createPluginWebhookEndpointHttpActionExecutor } from '@/sync/api/plugins/webhooks/endpointActions';
import { sessionFollowAction } from '@/sync/api/session/sessionFollowApi';
import { prepareSessionFollowSourceKey } from '@/components/sessions/follow/prepareSessionFollowSourceKey';
import { sessionReadStateAction } from '@/sync/api/session/sessionReadStateAction';
import { createSessionBoardActionAdapter } from '@/sync/api/session/sessionBoardActions';
import { machineContributionRegistryProjectionDescribe } from '@/sync/ops/machineContributionRegistryProjection';
import { EMPTY_PLUGIN_UI_PROJECTION, resolvePluginUiProjectionState } from '@/sync/domains/plugins/ui/projection';
import { getServerFeaturesSnapshot } from '@/sync/api/capabilities/serverFeaturesClient';
import { resolveRuntimeFeatureDecisionFromSnapshot } from '@/sync/domains/features/featureDecisionRuntime';
import { sync } from '@/sync/sync';
import { publishAcpSessionModeOverrideToMetadata } from '@/sync/state/acpSessionModeOverridePublish';
import { updatePromptDoc } from '@/sync/ops/promptLibrary/promptDocs';
import { updateSkillPromptBundle } from '@/sync/ops/promptLibrary/promptBundles';
import { writePromptLibraryArtifactToExternalAsset } from '@/sync/ops/promptLibrary/exportPromptLibraryArtifact';
import { installPromptRegistryItem } from '@/sync/ops/promptLibrary/installPromptRegistryItem';
import { canRollbackConversation } from '@/sync/domains/sessionRollback/rollbackUiSupport';
import type { CurrentProjectedAgentCapabilities } from '@/agents/backendCatalog/currentAgentCapabilities';
import { completeSessionForkNavigation } from '@/sync/domains/sessionFork/completeSessionForkNavigation';
import { readMachineControlTargetForSession } from '@/sync/ops/sessionMachineTarget';
import { createUiWorkflowAction } from './workflowActionDeps';
import {
  resolveSessionActionDefaultBackend,
  resolveSessionActionDefaultTarget,
} from '@/sync/domains/session/resolveSessionActionDefaultBackend';

import {
  isRequestedSessionModeSupported,
  isSessionModeActionAvailable,
  normalizeRequestedSessionModeId,
  resolveSessionModeActionControl,
  serializeSessionModeActionOptions,
} from './sessionModeActionSupport';
import {
  createDefaultRuntimeActionExecutor,
  type CreateDefaultRuntimeActionExecutorInput,
} from './defaultRuntimeActionExecutor';
import { readSessionOwnerMetadataView } from '@/sync/domains/session/readSessionOwnerMetadataView';
import { executeAccountPluginDataEraseAction } from '@/sync/domains/plugins/settings/accountPluginDataEraseAction';
import { signOutEverywhere } from '@/sync/api/account/signOutEverywhere';
import {
    createCurrentAccountApiToken,
    listCurrentAccountApiTokens,
    revokeAllCurrentAccountApiTokens,
    revokeCurrentAccountApiToken,
} from '@/sync/api/account/apiTokens';
import {
  enrollAccountPassword,
  fetchAccountSecurity,
  requestAccountSignInEmailChange,
  submitAccountPasswordChange,
  submitAccountPasswordRemove,
} from '@/sync/api/auth/accountSecurity';

/**
 * Scope retirement discards Account-owned result content but cannot undo a sent
 * write, so the invocation reports back the exact packet the adapter froze for
 * this Home and Session before dispatch. Nothing else can be an `outcome_unknown`
 * answer: without that packet there is no ambiguous write to reconcile, and the
 * retirement stays a definite refusal.
 */
export function projectRetiredSessionBoardActionFailure(input: Readonly<{
  mutationDispatched: boolean;
  retirementStatus: string;
  recoveryDetails: SessionBoardOutcomeUnknownDetailsV1 | null;
}>): SessionBoardActionFailureV1 {
  if (!input.mutationDispatched || !input.recoveryDetails) {
    return projectSessionBoardAdapterFailureV1({ code: input.retirementStatus }, 'forbidden');
  }
  return {
    ok: false,
    errorCode: 'outcome_unknown',
    error: 'outcome_unknown',
    details: input.recoveryDetails,
  };
}

/** Canonical Action projection of the scoped sender's transport envelope. */
export function projectServerScopedSessionSendMessageResult(
  delivery: ServerScopedSessionSendMessageResult,
): SessionInputAdmissionResultV1 | Extract<ServerScopedSessionSendMessageResult, { ok: false }> {
  if (!delivery.ok) return delivery;
  const ack = delivery.ack && typeof delivery.ack === 'object' && !Array.isArray(delivery.ack)
    ? delivery.ack as Readonly<Record<string, unknown>>
    : null;
  const localId = typeof ack?.localId === 'string' ? ack.localId.trim() : '';
  if (!localId) {
    return { ok: false, errorCode: 'invalid_action_output', error: 'invalid_action_output' };
  }
  return ack?.accepted === true
    ? { status: 'accepted', localId }
    : { status: 'outcomeUnknown', localId, code: 'session_input_pending' };
}

  type OpenSessionOptions = Readonly<{ serverId?: string | null }>;

function projectSessionInteractionRpcResult(result: unknown): unknown {
  return result === undefined || result === null ? { ok: true } : result;
}

export type ApprovalReplayRoute = Readonly<{
  serverId: string;
  serverIdentityId: string;
  originServerId: string;
}>;

export function isApprovalExecutionOriginCurrentForAccountContext(input: Readonly<{
  origin: Readonly<{
    serverId: string;
    serverIdentityId?: string;
    accountId?: string;
  }>;
  accountServerId: string;
  accountId: string;
}>): boolean {
  if (input.origin.accountId && input.origin.accountId !== input.accountId) return false;
  const serverIdentityId = input.origin.serverIdentityId?.trim() ?? '';
  if (serverIdentityId) {
    const resolution = resolveServerProfileForPortableIdentity(serverIdentityId);
    return resolution.kind === 'resolved'
      && resolution.profile.serverIdentityId?.trim() === serverIdentityId
      && areServerProfileIdentifiersEquivalent(resolution.profile.id, input.accountServerId);
  }
  return areServerProfileIdentifiersEquivalent(input.origin.serverId, input.accountServerId);
}

export function requiresExactDaemonApprovalReplay(approval: ApprovalRequest): boolean {
  if (approval.v !== 2) return false;
  const origin = approval.executionOriginV1;
  return origin.surface === 'api'
    || origin.surface === 'agent'
    || origin.surface === 'rpc'
    || origin.surface === 'mcp'
    || origin.surface === 'cli'
    || origin.caller.kind === 'plugin'
    || origin.caller.kind === 'automationRun';
}

export function resolveApprovalReplayRoute(approval: ApprovalRequest | null): ApprovalReplayRoute | null {
  if (approval?.v !== 2) return null;
  const originServerId = approval.executionOriginV1.serverId.trim();
  const serverIdentityId = approval.executionOriginV1.serverIdentityId?.trim() ?? '';
  if (!originServerId || !serverIdentityId) return null;
  const resolution = resolveServerProfileForPortableIdentity(serverIdentityId);
  if (
    resolution.kind !== 'resolved'
    || resolution.profile.serverIdentityId?.trim() !== serverIdentityId
  ) return null;
  return {
    serverId: resolution.profile.id,
    serverIdentityId,
    originServerId,
  };
}

export async function replayApprovalRequestAtExactDaemon(input: Readonly<{
  artifactId: string;
  decision: 'approve' | 'reject';
  executionTarget: Readonly<{
    /** Current-device profile id used only to route the RPC transport. */
    serverId: string;
    machineId: string;
    /** Stable Home identity used by the daemon to fail closed on a wrong route. */
    serverIdentityId?: string;
    /** Immutable creator-local profile id retained as replay currentness evidence. */
    originServerId?: string;
  }>;
  signal?: AbortSignal;
}>): Promise<unknown> {
  return await machineRpcWithServerScope({
    serverId: input.executionTarget.serverId,
    machineId: input.executionTarget.machineId,
    method: RPC_METHODS.APPROVAL_REQUEST_DECIDE,
    payload: {
      artifactId: input.artifactId,
      decision: input.decision,
      serverId: input.executionTarget.serverId,
      ...(input.executionTarget.serverIdentityId
        ? { serverIdentityId: input.executionTarget.serverIdentityId }
        : {}),
      ...(input.executionTarget.originServerId
        ? { originServerId: input.executionTarget.originServerId }
        : {}),
    },
    ...(input.signal === undefined ? {} : { signal: input.signal }),
  });
}

/**
 * Routes consumption of an already-approved built-in Action Artifact to its
 * exact daemon. No decision or authority crosses this private transport.
 */
export async function replayApprovedApprovalRequestAtExactDaemon(input: Readonly<{
  artifactId: string;
  executionTarget: Readonly<{
    /** Current-device profile id used only to route the RPC transport. */
    serverId: string;
    machineId: string;
    /** Stable Home identity retained by the replay route; not part of this payload. */
    serverIdentityId?: string;
    /** Immutable creator-local profile id retained by the replay route; not part of this payload. */
    originServerId?: string;
  }>;
  signal?: AbortSignal;
}>): Promise<ActionExecuteResult> {
  return await machineRpcWithServerScope<ActionExecuteResult, Readonly<{ artifactId: string }>>({
    serverId: input.executionTarget.serverId,
    machineId: input.executionTarget.machineId,
    method: RPC_METHODS.APPROVAL_REQUEST_REPLAY_APPROVED,
    payload: { artifactId: input.artifactId },
    ...(input.signal === undefined ? {} : { signal: input.signal }),
  });
}

  function buildDefaultActionExecutor(opts?: Readonly<{
  resolveServerIdForSessionId?: (sessionId: string) => string | null;
  resolveServerNameForSessionId?: (sessionId: string) => string | null;
  openSession?: (sessionId: string, options?: OpenSessionOptions) => void | Promise<void>;
  runtimeActions?: CreateDefaultRuntimeActionExecutorInput;
  listContributedActionDefinitions?: () => readonly ActionDefinitionV1[];
  /** Optional surface-local policy composed with the canonical Action settings policy. */
  isActionEnabled?: NonNullable<ActionExecutorDeps['isActionEnabled']>;
  /** Optional delivery leaf used by a surface that needs specialized ingress semantics. */
  sessionSendMessage?: NonNullable<ActionExecutorDeps['sessionSendMessage']>;
  /** Mounted host resolver carrying an explicitly complete selected-Home corpus. */
  resolveSessionReference?: NonNullable<ActionExecutorDeps['resolveSessionReference']>;
  /** Current external Agent declaration supplied by a rendered lifecycle control. */
  currentAgentCapabilities?: CurrentProjectedAgentCapabilities | null;
  /**
   * The Session-access family port, supplied by a surface that already knows the
   * exact Account scope, availability and staleness lifetime the request belongs
   * to. Those are per-mount facts the shared executor cannot resolve, so the
   * surface owns reachability while the executor keeps admission and validation.
   */
  sessionAccessAction?: NonNullable<ActionExecutorDeps['sessionAccessAction']>;
  /** Optional Session human-discussion family port bound by a mounted surface. */
  sessionDiscussionAction?: NonNullable<ActionExecutorDeps['sessionDiscussionAction']>;
  /**
   * The Home family port, bound by the caller to the exact Home and Account.
   * Without it, the shared executor rejects Home and Teams actions as unsupported.
   */
  homeDomainAction?: NonNullable<ActionExecutorDeps['homeDomainAction']>;
  /** Subordinate target-bound transport for a confirmed workspace conflict Action. */
  workspaceSyncConflictResolve?: NonNullable<ActionExecutorDeps['workspaceSyncConflictResolve']>;
  workflowAction?: NonNullable<ActionExecutorDeps['workflowAction']>;
  }>, accountContext?: ActionAccountContext & { settings: Awaited<ReturnType<ActionAccountContext['readSettings']>> }): ReturnType<typeof createActionExecutor> {
    type AgentsBackendsListArgs = Readonly<{ includeDisabled?: boolean; limit?: number; machineId?: string }>;
    type AgentsModelsListArgs = Readonly<{ agentId?: string; machineId?: string; serverId?: string; limit?: number; backendTargetKey?: string }>;

  const resolveSessionMachineId = (sessionId: string, metadata: { machineId?: unknown } | null | undefined): string => {
    const controlMachineId = readMachineControlTargetForSession(sessionId)?.machineId ?? '';
    if (controlMachineId) {
      return controlMachineId;
    }
    return typeof metadata?.machineId === 'string' ? String(metadata.machineId).trim() : '';
  };

  const resolveActionsSettingsSnapshot = () => {
    const raw = accountContext
      ? (accountContext.readLiveSettings() ?? accountContext.settings)?.actionsSettingsV1
      : storage.getState().settings?.actionsSettingsV1;
    return normalizeActionsSettingsV1(raw);
  };
  const executeReviewCommentAction = createReviewCommentsHttpActionExecutor(accountContext ? {
    request: accountContext.request,
    resolveEventStorageContext: async () => accountContext.accountMode === 'plain'
      ? { accountId: accountContext.accountId, mode: 'plain' }
      : { accountId: accountContext.accountId, mode: 'e2ee', material: resolveAccountScopedCryptoMaterialFromCredentials(accountContext.credentials) },
  } : undefined);
  const executePluginPermissionGrantAction = createPluginPermissionGrantHttpActionExecutor(accountContext ? { request: accountContext.request } : undefined);
  const executePluginWebhookAction = createPluginWebhookEndpointHttpActionExecutor(accountContext ? { request: accountContext.request } : undefined);
  const approvalCoordinator = getSharedBlockingApprovalCoordinator();

  const deps: ActionExecutorDeps = {
    ...(opts?.workflowAction
      ? { workflowAction: opts.workflowAction }
      : accountContext
        ? { workflowAction: createUiWorkflowAction({ account: accountContext }) }
        : {}),
    resolveSessionReference: opts?.resolveSessionReference ?? (async ({ sessionId, sessionTitle, context, signal }) => {
      // An exact tuple needs no corpus. A bare id or title is resolved against the one admitted
      // corpus — the focused data-active Sessions pane's membership and its own completeness — so
      // every host answers unique/ambiguous/incomplete/none from the same evidence instead of
      // failing closed forever for want of one (Lane 07.1 §3).
      const currentState = storage.getState();
      const options = normalizeSessionAddress(context.serverId, sessionId)
        ? null
        : readAdmittedSessionReferenceCorpusOptions(currentState);
      return await resolveVoiceActionSessionReference({
        ...(sessionId ? { sessionId } : {}),
        ...(sessionTitle ? { sessionTitle } : {}),
        ...(context.serverId ? { serverId: context.serverId } : {}),
        ...(signal ? { signal } : {}),
      }, options ? { state: currentState, options } : null);
    }),
    isApprovalExecutionOriginCurrent: async ({ origin }) => {
      if (!accountContext) return false;
      accountContext.assertCurrent();
      return isApprovalExecutionOriginCurrentForAccountContext({
        origin,
        accountServerId: accountContext.serverId,
        accountId: accountContext.accountId,
      });
    },
    sessionFollowAction: async (args) => {
      const result = await sessionFollowAction(args);
      const failed = typeof result === 'object'
        && result !== null
        && 'ok' in result
        && result.ok === false;
      if (args.actionId !== 'session.follow.sources.set' || failed) return result;

      const serverId = args.serverId ?? args.context.serverId;
      if (!serverId) return result;
      const relation = args.input as Readonly<{
        sourceSessionId: string;
        destinationSessionId: string;
      }>;
      let preparation: SessionFollowSourceKeyPreparationResultV1;
      try {
        preparation = await prepareSessionFollowSourceKey({
          serverId,
          sourceSessionId: relation.sourceSessionId,
          destinationSessionId: relation.destinationSessionId,
        });
      } catch {
        preparation = { kind: 'waiting', reason: 'runner_unreachable' };
      }
      return projectSessionFollowSourceKeyPreparationAfterSetV1(
        result as SessionFollowActionOutputV1['session.follow.sources.set'],
        preparation,
      );
    },
    sessionReadStateAction,
    sessionBoardAction: async (args) => {
      const input = SESSION_BOARD_ACTION_INPUT_SCHEMAS_V1[args.actionId].parse(args.input);
      const sessionId = input.sessionId ?? args.context.defaultSessionId;
      const serverId = args.context.serverId ?? (sessionId ? opts?.resolveServerIdForSessionId?.(sessionId) : null);
      if (!sessionId || !serverId) {
        return { ok: false as const, errorCode: 'unsupported_action' as const, error: 'unsupported_action' as const };
      }
      const address = { serverId, sessionId };
      let mutationDispatched = false;
      let recoveryDetails: SessionBoardOutcomeUnknownDetailsV1 | null = null;
      const executed = await sync.withSessionSystemRecordRuntime(address, async (runtime) => {
        // The store row publishes the already-normalized projection; re-normalizing a raw
        // `effectiveAccess` field the row never carries refused every Board mutation.
        const access = runtime.session.access ?? null;
        if (!access) {
          return { ok: false as const, errorCode: 'session_board_forbidden' as const, error: 'session_board_forbidden' as const };
        }
        const snapshot = await getServerFeaturesSnapshot({ serverId });
        const decision = resolveRuntimeFeatureDecisionFromSnapshot({ featureId: 'sessions.board', settings: storage.getState().settings, snapshot });
        if (decision?.state !== 'enabled') {
          return projectSessionBoardFeatureDecisionFailureV1(args.actionId, decision);
        }
        const result = await createSessionBoardActionAdapter({
          scope: runtime.scope, session: address, repository: runtime.repository,
          request: (path, init, options) => runtime.request(path, init, options),
          contentContext: runtime.contentContext,
          onMutationPrepared: (details) => {
            recoveryDetails = details;
          },
          onMutationIssued: () => {
            mutationDispatched = true;
          },
          resolveInstalledSurfaceProjection: async (session, signal) => {
            if (!runtime.isCurrent()) return null;
            const target = readMachineControlTargetForSession({ ...session, accountId: runtime.scope.accountId });
            if (!target) return null;
            const described = await machineContributionRegistryProjectionDescribe(target.machineId, { serverId: session.serverId, signal });
            if (!runtime.isCurrent() || !described.supported) return null;
            const currentTarget = readMachineControlTargetForSession({ ...session, accountId: runtime.scope.accountId });
            if (currentTarget?.machineId !== target.machineId) return null;
            return resolvePluginUiProjectionState(EMPTY_PLUGIN_UI_PROJECTION, described.projection);
          },
          capabilities: { readTranscript: access.capabilities.readTranscript, editSessionRecords: access.capabilities.editSessionRecords },
        })(args);
        return result;
      });
      if (executed.status === 'ok') return executed.value;
      // Retirement discards Account-owned result content, but cannot undo a sent write.
      return projectRetiredSessionBoardActionFailure({
        mutationDispatched,
        retirementStatus: executed.status,
        recoveryDetails,
      });
    },
    listContributedActionDefinitions: opts?.listContributedActionDefinitions,
    isActionEnabled: (actionId: ActionId, ctx) =>
      {
        if (opts?.isActionEnabled && !opts.isActionEnabled(actionId, ctx)) {
          return false;
        }
        if (
          !isActionEnabledByActionsSettings(actionId, resolveActionsSettingsSnapshot(), {
            surface: ctx.surface ?? null,
            placement: ctx.placement ?? null,
          })
        ) {
          return false;
        }
        if (actionId !== 'session.mode.set') {
          return true;
        }
        const sessionId = typeof ctx.defaultSessionId === 'string' ? ctx.defaultSessionId.trim() : '';
        if (!sessionId) {
          return true;
        }
        const session = (storage.getState() as any)?.sessions?.[sessionId] ?? null;
        return isSessionModeActionAvailable(session);
      },
    isActionApprovalRequired: (actionId, ctx) =>
      isApprovalRequiredByActionsSettings(actionId, resolveActionsSettingsSnapshot(), {
        surface: ctx.surface ?? null,
        authority: ctx.authority,
      }),
    ...createUiExecutionRunActionDeps(),
    resolveSessionSpawnAgentInventorySelection: resolveSessionSpawnAgentInventorySelectionForActions,
    runtimeActionExecute: createDefaultRuntimeActionExecutor(opts?.runtimeActions),
    accountPluginDataEraseAction: async ({ input, signal }) => await executeAccountPluginDataEraseAction(
      input,
      signal ? { signal } : undefined,
    ),
    accountSessionsSignOutEverywhereAction: async ({ input, signal }) => await signOutEverywhere(
      input,
      signal ? { signal } : undefined,
    ),
    accountApiTokensCreateAction: async ({ input, signal }) => await createCurrentAccountApiToken(
      input,
      signal ? { signal } : undefined,
    ),
    accountApiTokensListAction: async ({ input, signal }) => await listCurrentAccountApiTokens(
      input,
      signal ? { signal } : undefined,
    ),
    accountApiTokensRevokeAction: async ({ input, signal }) => await revokeCurrentAccountApiToken(
      input,
      signal ? { signal } : undefined,
    ),
    accountApiTokensRevokeAllAction: async ({ input, signal }) => await revokeAllCurrentAccountApiTokens(
      input,
      signal ? { signal } : undefined,
    ),
    ...(accountContext ? {
      accountSecurityGetAction: async ({ signal }) => {
        accountContext.assertCurrent();
        const result = await fetchAccountSecurity(accountContext.request, signal);
        accountContext.assertCurrent();
        return result;
      },
      accountPasswordEnrollAction: async ({ input, signal }) => {
        accountContext.assertCurrent();
        const result = await enrollAccountPassword(accountContext.request, input, signal);
        accountContext.assertCurrent();
        return result;
      },
      accountPasswordChangeAction: async ({ input, signal }) => {
        accountContext.assertCurrent();
        const result = await submitAccountPasswordChange(accountContext.request, input, signal);
        accountContext.assertCurrent();
        return result;
      },
      accountPasswordRemoveAction: async ({ input, signal }) => {
        accountContext.assertCurrent();
        const result = await submitAccountPasswordRemove(accountContext.request, input, signal);
        accountContext.assertCurrent();
        return result;
      },
      accountEmailChangeRequestAction: async ({ input, signal }) => {
        accountContext.assertCurrent();
        const result = await requestAccountSignInEmailChange(accountContext.request, input, signal);
        accountContext.assertCurrent();
        return result;
      },
    } : {}),

    sessionOpen: async ({ sessionId, serverId }) =>
      opts?.openSession
        ? (
          serverId
            ? await opts.openSession(sessionId, { serverId })
            : await opts.openSession(sessionId),
          {
            ok: true,
            status: 'opened',
            sessionId,
            serverId,
            address: { serverId, sessionId },
          } as const
        )
        : await openSessionForVoiceTool({
          sessionId,
          serverId,
          resolveServerIdForSessionId: serverId
            ? (targetSessionId) => targetSessionId === sessionId ? serverId : opts?.resolveServerIdForSessionId?.(targetSessionId) ?? null
            : opts?.resolveServerIdForSessionId,
          resolveServerNameForSessionId: opts?.resolveServerNameForSessionId,
        }),

    sessionFork: async ({ sessionId, serverId }) => {
      const sid = String(sessionId ?? '').trim();
      if (!sid) return { ok: false, errorCode: 'invalid_parameters', errorMessage: 'invalid_parameters' };
      const resolvedServerId = String(serverId ?? opts?.resolveServerIdForSessionId?.(sid) ?? '').trim();
      const stateAny: any = storage.getState();
      const session = stateAny?.sessions?.[sid] ?? null;
      const metadata = session ? readSessionOwnerMetadataView(session) : null;
      const machineId = resolveSessionMachineId(sid, metadata);

      const settings = stateAny?.settings ?? null;
      const forkPoint = { type: 'latest' } as const;
      // One fork policy for every surface. This executor has no strategy modal
      // to show, so it reads the same availability the modal renders and asks
      // for the exact route that modal would have offered. An unqualified
      // request is what let the daemon settle on Replay for an account that
      // turned Replay off.
      const availability = resolveSessionForkStrategyAvailability({
        session,
        forkPoint,
        replayEnabled: resolveHappierReplayConfig(settings ?? {}).enabled,
        // Source-context continuation is a navigation to the New Session
        // screen; this executor has no such route, so it is not one of its
        // options rather than a route it silently fails to take.
        agentSwitchingEnabled: false,
        currentAgentCapabilities: opts?.currentAgentCapabilities,
      });
      if (!availability.native && !availability.replay) {
        return { ok: false, errorCode: 'action_disabled', errorMessage: 'action_disabled' };
      }
      const replayOptions = resolveSessionForkReplayOptions({
        settings,
        executionRunsEnabled: resolveLocalFeaturePolicyEnabled('execution.runs', settings ?? {}),
      });

      const result = await forkSessionOp({
        ...(machineId ? { machineId } : {}),
        serverId: resolvedServerId || undefined,
        parentSessionId: sid,
        forkPoint,
        // `auto` is the only value that can fall through to Replay, so it stays
        // the request exactly while Replay is a route the account allows.
        ...(availability.replay ? {} : { strategy: 'native' as const }),
        ...replayOptions,
      } as any);
      if ((result as any)?.ok !== true) return result as any;

      const childSessionId = String((result as any).childSessionId ?? '').trim();
      if (childSessionId) {
        await completeSessionForkNavigation({
          childSessionId,
          parentSessionId: sid,
          ...(resolvedServerId ? { serverId: resolvedServerId } : {}),
          navigate: async (targetSessionId, navigationOptions) => {
            const navigationServerId = navigationOptions?.serverId ?? resolvedServerId;
            if (opts?.openSession) {
              if (navigationServerId) {
                await opts.openSession(targetSessionId, { serverId: navigationServerId });
              } else {
                await opts.openSession(targetSessionId);
              }
              return;
            }
            await openSessionForVoiceTool({
              sessionId: targetSessionId,
              serverId: navigationServerId,
              resolveServerIdForSessionId: navigationServerId
                ? (candidateSessionId) => candidateSessionId === targetSessionId
                  ? navigationServerId
                  : opts?.resolveServerIdForSessionId?.(candidateSessionId) ?? null
                : opts?.resolveServerIdForSessionId,
              resolveServerNameForSessionId: opts?.resolveServerNameForSessionId,
            });
          },
        });
      }
      return { ok: true, status: 'forked', parentSessionId: sid, childSessionId };
    },

    sessionStop: async ({ sessionId, serverId }) =>
      await sessionStopWithServerScope(sessionId, { serverId }),

    sessionTerminalComposerClear: async ({ sessionId, expectedStateAtMs, serverId }) =>
      await sessionRpcWithServerScope({
        sessionId,
        serverId,
        method: SESSION_RPC_METHODS.SESSION_TERMINAL_COMPOSER_CLEAR,
        payload: {
          sessionId,
          ...(typeof expectedStateAtMs === 'number' && Number.isFinite(expectedStateAtMs)
            ? { expectedStateAtMs }
            : {}),
        },
      }),

    sessionPendingInputInterruptAndRun: async ({ sessionId, localId, expectedStateAtMs, serverId }) =>
      await sessionRpcWithServerScope({
        sessionId,
        serverId,
        method: SESSION_RPC_METHODS.SESSION_PENDING_INPUT_INTERRUPT_AND_RUN,
        payload: {
          sessionId,
          localId,
          ...(typeof expectedStateAtMs === 'number' && Number.isFinite(expectedStateAtMs)
            ? { expectedStateAtMs }
            : {}),
        },
      }),

    sessionRollback: async ({ sessionId, serverId, target }) => {
      const sid = String(sessionId ?? '').trim();
      if (!sid) return { ok: false, errorCode: 'invalid_parameters', errorMessage: 'invalid_parameters' };
      const resolvedTarget = target ?? { type: 'latest_turn' };
      const session = (storage.getState() as any)?.sessions?.[sid] ?? null;
      if (!canRollbackConversation({
        session,
        target: resolvedTarget,
        currentAgentCapabilities: opts?.currentAgentCapabilities,
      })) {
        return { ok: false, errorCode: 'action_disabled', errorMessage: 'action_disabled' };
      }
      return await rollbackSessionConversationOp({
        sessionId: sid,
        serverId,
        target: resolvedTarget,
      });
    },

    checkpointCodeRollback: async ({ request, serverId }) =>
      await rollbackSessionCheckpointCodeOp({ request, serverId }),

    sessionHandoffTargetReplacementApprovalPreflight: async ({
      targetMachineId,
      targetPath,
      workspaceAction,
      serverId,
      operationId,
      signal,
    }) => await preflightSessionHandoffTargetReplacement({
      targetMachineId,
      targetPath: targetPath ?? '',
      serverId: serverId ?? '',
      operationId,
      workspaceAction: workspaceAction ?? { kind: 'none' },
      ...(signal ? { signal } : {}),
    }),

    sessionHandoffStart: async ({
      sessionId,
      targetMachineId,
      targetPath,
      targetSessionStorageMode,
      workspaceAction,
      serverId,
      actionRequestId,
      handoffTargetReplacementApproval,
      handoffTargetReplacementApprovalReceiptId,
      handoffTargetReplacementApprovalActionInput,
      signal,
    }) => {
      const sid = String(sessionId ?? '').trim();
      const tid = String(targetMachineId ?? '').trim();
      if (!sid || !tid) return { ok: false, errorCode: 'invalid_parameters', errorMessage: 'invalid_parameters' };

      const stateAny: any = storage.getState();
      const session = stateAny?.sessions?.[sid] ?? null;
      const metadata = session ? readSessionOwnerMetadataView(session) : null;
      // Only the source machine is resolved here. Which storage the target
      // imports into is derived by the source daemon from the owner metadata it
      // loads itself, before the operation claim and before any stop or export,
      // so a cold or unprojected client view must not refuse a valid handoff.
      const sourceMachineId = resolveSessionMachineId(sid, metadata);

      return await startSessionHandoffOp({
        sessionId: sid,
        sourceMachineId: sourceMachineId || undefined,
        targetMachineId: tid,
        ...(targetPath ? { targetPath } : {}),
        ...(targetSessionStorageMode ? { targetSessionStorageMode } : {}),
        ...(workspaceAction ? { workspaceAction } : {}),
        serverId,
        ...(actionRequestId ? { actionRequestId } : {}),
        ...(handoffTargetReplacementApproval ? { handoffTargetReplacementApproval } : {}),
        ...(handoffTargetReplacementApprovalReceiptId ? {
          handoffTargetReplacementApprovalReceiptId,
          handoffTargetReplacementApprovalActionInput,
        } : {}),
        ...(signal ? { signal } : {}),
      });
    },

    sessionSpawnNew: async ({
      sessionCreationTag: _sessionCreationTag,
      legacyMetadataLabel: _legacyMetadataLabel,
      actionCaller: _actionCaller,
      callerSurface: _callerSurface,
      sessionAgentSpawnPolicyV1: _sessionAgentSpawnPolicyV1,
      actionRequestId: _actionRequestId,
      resumeActionRequest: _resumeActionRequest,
      signal,
      ...input
    }) => {
      const { placementOrigin, ...exactInput } = input;
      const serverId = resolveServerProfileScopeIdForIdentifier(input.executionTarget.serverId);
      const machine = storage.getState().machineListByServerId[serverId]
        ?.find((candidate) => candidate.id === input.executionTarget.machineId);
      if (
        input.secretReferenceOverlay
        && !supportsMachineSessionSpawnProtocolVersionV1(
          machine?.operationProtocolCapabilities,
          2,
        )
      ) {
        return {
          type: 'error' as const,
          code: 'update_required' as const,
          retryable: false as const,
          details: {
            kind: 'update_required' as const,
            operation: 'session.spawn_new' as const,
            component: 'daemon' as const,
            reason: 'session_secret_reference_overlay_update_required',
          },
        };
      }
      const supportsOrigin = !machine?.revokedAt && !machine?.replacedByMachineId
        && supportsMachineOperationProtocolCapabilityV1(machine?.operationProtocolCapabilities, 'sessionSpawnPlacementOrigin');
      return await machineRpcWithServerScope<SessionSpawnNewResultV1, SessionSpawnNewInputV2>({
        serverId: input.executionTarget.serverId,
        machineId: input.executionTarget.machineId,
        method: RPC_METHODS.SESSION_SPAWN_NEW,
        payload: placementOrigin && supportsOrigin ? { ...exactInput, placementOrigin } : exactInput,
        signal,
      });
    },

    approvalRequestApprovedReplay: async ({ artifactId, request, signal }) => {
      if (!requiresExactDaemonApprovalReplay(request)) return null;
      const replayRoute = resolveApprovalReplayRoute(request);
      const machineId = request.v === 2 ? request.executionOriginV1.machineId?.trim() ?? '' : '';
      if (!replayRoute || !machineId) {
        return {
          ok: false,
          errorCode: 'approval_origin_unavailable',
          error: 'approval_origin_unavailable',
        };
      }
      return await replayApprovedApprovalRequestAtExactDaemon({
        artifactId,
        executionTarget: { ...replayRoute, machineId },
        ...(signal === undefined ? {} : { signal }),
      });
    },

    pathsListRecent: async ({ machineId, limit }) => await listRecentPathsForVoiceTool({ machineId, limit }),
    projectsList: async (args) => await listProjectsForActions(args),
    promptInvocationsList: async (args) => listPromptInvocationsForActions(args),
    promptInvocationResolve: async (args) => await resolvePromptInvocationForActions(args),
    spawnProfilesList: async (args) => listSpawnProfilesForActions(args),
    machinesList: async ({ limit }) => await listMachinesForVoiceTool({ limit }),
    serversList: async ({ limit }) => await listServersForVoiceTool({ limit }),
    reviewEnginesList: async ({ sessionId, includeDisabled }) => await listReviewEnginesForVoiceTool({ sessionId, includeDisabled }),
    reviewCommentAction: async ({ actionId, input, signal }) => signal
      ? await executeReviewCommentAction(actionId, input, { signal })
      : await executeReviewCommentAction(actionId, input),
    pluginPermissionGrantAction: async ({ actionId, input, signal }) => signal
      ? await executePluginPermissionGrantAction(actionId, input, { signal })
      : await executePluginPermissionGrantAction(actionId, input),
    // Session access: only a mounted surface knows the exact Account scope,
    // collaboration availability and staleness lifetime, so it supplies the port
    // and the executor keeps admission, settings, approval and result validation.
    ...(opts?.sessionAccessAction ? { sessionAccessAction: opts.sessionAccessAction } : {}),
    ...(opts?.sessionDiscussionAction ? { sessionDiscussionAction: opts.sessionDiscussionAction } : {}),
    // Home governance and Teams require a captured scope; focus cannot supply it.
    ...(opts?.homeDomainAction ? { homeDomainAction: opts.homeDomainAction } : {}),
    ...(opts?.workspaceSyncConflictResolve ? { workspaceSyncConflictResolve: opts.workspaceSyncConflictResolve } : {}),
    // Personal Machine Pools use the same captured Account/Home transport, feature decision,
    // enablement and approval lifetime as every other immediate scoped Action.
    machinePoolAction: async (args) => {
      if (!accountContext) return { ok: false, errorCode: 'unsupported_action', error: 'unsupported_action' };
      accountContext.assertCurrent();
      const features = await getReadyServerFeatures({ serverId: accountContext.serverId });
      if (!features || readServerEnabledBit(features, 'machines.pools') !== true) {
        return { ok: false, errorCode: 'machine_pools_unavailable', error: 'machine_pools_unavailable' };
      }
      try {
        return await createMachinePoolActionClient({ request: accountContext.request }).execute(args.actionId, args.input, {
          serverId: accountContext.serverId, ...(args.signal ? { signal: args.signal } : {}),
        });
      } catch (error) {
        if (error instanceof MachinePoolActionError) {
          return { ok: false, errorCode: error.detail?.code ?? 'machine_pool_request_failed', error: error.message, details: error.detail };
        }
        throw error;
      }
    },
    // Temporary computer activation: the same captured Account/Home transport,
    // server feature decision and approval lifetime as every other immediate
    // scoped Action. The activation client stays the one Runner transport owner.
    ephemeralRunnerAction: async (args) => {
      if (!accountContext) return { ok: false, errorCode: 'unsupported_action', error: 'unsupported_action' };
      accountContext.assertCurrent();
      const features = await getReadyServerFeatures({ serverId: accountContext.serverId });
      if (!features || readServerEnabledBit(features, 'sessions.ephemeralRunner') !== true) {
        return { ok: false, errorCode: 'runner_unavailable', error: 'runner_unavailable' };
      }
      const client = createRunnerActivationClient(accountContext.request);
      try {
        if (args.actionId === 'sessions.runner.activation.create') {
          return await client.create(args.input as RunnerActivationCreateRequestV1);
        }
        const { activationId } = args.input as Readonly<{ activationId: string }>;
        if (args.actionId === 'sessions.runner.activation.get') {
          return await client.read(activationId, args.signal);
        }
        await client.cancel(activationId);
        return { activationId, closed: true };
      } catch (error) {
        if (error instanceof RunnerActivationClientError) {
          return { ok: false, errorCode: error.serverCode ?? error.code, error: error.message };
        }
        throw error;
      }
    },
    pluginWebhookAction: async ({ actionId, input, signal }) => {
      if (!Object.hasOwn(PluginWebhookActionHttpPathsV1, actionId)) {
        return {
          ok: false,
          errorCode: 'unsupported_action',
          error: `unsupported_action:${actionId}`,
        } as const;
      }
      const publicEndpointActionId = actionId as PluginWebhookPresentUserActionIdV1;
      return signal
        ? await executePluginWebhookAction(publicEndpointActionId, input, { signal })
        : await executePluginWebhookAction(publicEndpointActionId, input);
    },
    agentsBackendsList: async (args) => {
      const { includeDisabled, limit, machineId } = args as AgentsBackendsListArgs;
      return await listAgentBackendsForVoiceTool({ includeDisabled, limit, machineId });
    },
    agentsModelsList: async (args) => {
      const { agentId, machineId, serverId, limit, backendTargetKey } = args as AgentsModelsListArgs;
      return await listAgentModelsForVoiceTool({ agentId, machineId, serverId, limit, backendTargetKey });
    },
    agentsConfigOptionsList: async (args) => await listAgentConfigOptionsForActions(args),
    agentsSessionModesList: async (args) => await listAgentSessionModesForActions(args),
    spawnConnectedServicesList: async (args) => await listSpawnConnectedServicesForActions(args),

    sessionSendMessage: opts?.sessionSendMessage ?? (async ({ sessionId, message, serverId, recipient, requestedAction }) => {
      const delivery = await sendSessionMessageWithServerScope({
        sessionId,
        message,
        serverId,
        recipient,
        requestedAction,
      });
      return projectServerScopedSessionSendMessageResult(delivery);
    }),

    sessionTitleSet: async ({ sessionId, title, serverId }) => {
      const sid = String(sessionId ?? '').trim();
      const normalizedTitle = String(title ?? '').trim();
      if (!sid || !normalizedTitle) {
        return { ok: false, errorCode: 'invalid_parameters', errorMessage: 'invalid_parameters' };
      }

      const updatedAt = Date.now();
      try {
        await publishDisplayTitleToMetadata({
          sessionId: sid,
          title: normalizedTitle,
          updatedAt,
          updateSessionMetadataWithRetry: async (targetSessionId, updater) => {
            await sync.patchSessionMetadataWithRetry(
              targetSessionId,
              updater,
              { serverId: typeof serverId === 'string' && serverId.trim().length > 0 ? serverId.trim() : null },
            );
          },
        });
      } catch (error) {
        const err = new Error(error instanceof Error ? error.message : 'action_failed');
        (err as Error & { code?: string }).code = 'action_failed';
        throw err;
      }

      return { ok: true, sessionId: sid, title: normalizedTitle, updatedAt };
    },

    sessionPermissionRespond: async ({ sessionId, requestId, turnId, decision, serverId }) => {
      const reqId = String(requestId ?? '').trim();
      if (!reqId) {
        return { ok: false, errorCode: 'permission_request_not_found', errorMessage: 'permission_request_not_found', sessionId };
      }
      const request = decision === 'allow'
        ? { id: reqId, ...(turnId ? { turnId } : {}), approved: true }
        : { id: reqId, ...(turnId ? { turnId } : {}), approved: false };
      return projectSessionInteractionRpcResult(await sessionRpcWithServerScope({
        sessionId,
        serverId,
        method: RPC_METHODS.SESSION_PERMISSION_RESPOND,
        payload: request,
      }));
    },
    sessionPermissionRemoteAction: async (args) => {
      const rejectUnavailable = (
        code: 'canceled' | 'mediationStateUnavailable' | 'ownerMachineUnavailable',
      ) => args.actionId === 'session.permission.remote.pending.list'
        || args.actionId === 'session.permission.remote.grants.list'
        ? { ok: false as const, errorCode: code, error: code }
        : { status: 'rejected' as const, code };
      if (args.signal?.aborted) {
        return rejectUnavailable('canceled');
      }
      try {
        const result = await sessionRpcWithServerScope({
          sessionId: args.input.sessionId,
          serverId: args.serverId,
          method: args.actionId,
          payload: args.input,
        });
        return args.signal?.aborted ? rejectUnavailable('canceled') : result;
      } catch (error) {
        if (args.signal?.aborted) {
          return rejectUnavailable('canceled');
        }
        throw error;
      }
    },
    sessionUserActionAnswer: async ({ sessionId, requestId, answers, decision, reason, updatedPermissions, serverId }) => {
      const reqId = String(requestId ?? '').trim();
      if (!reqId) {
        return { ok: false, errorCode: 'permission_request_not_found', errorMessage: 'permission_request_not_found', sessionId };
      }
      const normalizedAnswers = Object.create(null) as Record<string, readonly string[]>;
      for (const entry of Array.isArray(answers) ? answers : []) {
        const question = String(entry?.question ?? '');
        if (question.trim().length > 0 && entry.values.length > 0) {
          normalizedAnswers[question] = [...entry.values];
        }
      }
      if (!decision && Object.keys(normalizedAnswers).length === 0) {
        return { ok: false, errorCode: 'invalid_parameters', errorMessage: 'invalid_parameters', sessionId };
      }
      const approved = decision ? decision === 'approve' : true;
      return projectSessionInteractionRpcResult(await sessionRpcWithServerScope({
        sessionId,
        serverId,
        method: RPC_METHODS.SESSION_USER_ACTION_ANSWER,
        payload: {
          id: reqId,
          approved,
          ...(Object.keys(normalizedAnswers).length > 0 ? { answers: normalizedAnswers } : {}),
          ...(typeof reason === 'string' && reason.trim().length > 0 ? { reason: reason.trim() } : {}),
          ...(typeof updatedPermissions !== 'undefined' ? { updatedPermissions } : {}),
        },
      }));
    },
    sessionModeSet: async ({ sessionId, modeId }) => {
      const session = (storage.getState() as any)?.sessions?.[sessionId] ?? null;
      const control = resolveSessionModeActionControl(session);
      const normalizedModeId = normalizeRequestedSessionModeId(control, modeId);
      if (!isRequestedSessionModeSupported(control, normalizedModeId)) {
        return { ok: false, errorCode: 'invalid_parameters', error: 'invalid_parameters' };
      }
      await publishAcpSessionModeOverrideToMetadata({
        sessionId,
        modeId: normalizedModeId,
        updatedAt: Date.now(),
        updateSessionMetadataWithRetry: sync.patchSessionMetadataWithRetry,
      });
      return { ok: true, sessionId, modeId: normalizedModeId };
    },
    sessionModelSet: async (args) => {
      const { sessionId, modelId, providerConnectionId, serverId } = args;
      const normalizedSessionId = String(sessionId ?? '').trim();
      const normalizedModelId = String(modelId ?? '').trim();
      if (!normalizedSessionId || !normalizedModelId) {
        return { ok: false, errorCode: 'invalid_parameters', error: 'invalid_parameters' };
      }

      const session = storage.getState().sessions[normalizedSessionId] ?? null;
      if (!session) {
        return { ok: false, errorCode: 'session_not_found', error: 'session_not_found' };
      }
      const hasExplicitProviderConnectionId = Object.prototype.hasOwnProperty.call(
        args,
        'providerConnectionId',
      );
      const resolveRequest = (candidateSession: typeof session) => {
        const backend = resolveSessionActionDefaultBackend({
          session: candidateSession,
        });
        const target = resolveSessionActionDefaultTarget(backend);
        if (!target) return null;
        const agentTargetKey = buildBackendTargetKeyV2(target);
        const ownerMetadata = readSessionOwnerMetadataView(candidateSession);
        const currentIntent = resolveModelSelectionIntentFromSessionMetadata(
          ownerMetadata,
          agentTargetKey,
        );
        let resolvedProviderConnectionId: string | null;
        if (hasExplicitProviderConnectionId) {
          resolvedProviderConnectionId = providerConnectionId ?? null;
        } else {
          const ambient = resolveAmbientProviderConnectionForModelIntent({
            metadata: ownerMetadata,
            agentTargetKey,
            sessionActive: candidateSession.active === true,
          });
          // Unreadable Session Provider state is not a native selection. Refuse
          // before the transition RPC or the inactive metadata CAS runs.
          if (ambient.status === 'unreadable') return { refusal: ambient.code } as const;
          resolvedProviderConnectionId = ambient.providerConnectionId;
        }
        const parsed = SessionModelTransitionRequestV1Schema.safeParse({
          v: 1,
          selection: {
            agentTargetKey,
            providerConnectionId: resolvedProviderConnectionId,
            modelId: normalizedModelId,
          },
        });
        return parsed.success
          ? {
            request: parsed.data,
            currentIntent,
            agentTargetKey,
          }
          : null;
      };
      const initialRequest = resolveRequest(session);
      if (initialRequest && 'refusal' in initialRequest) {
        return {
          ok: false,
          errorCode: initialRequest.refusal,
          error: initialRequest.refusal,
        };
      }
      if (!initialRequest) {
        return {
          ok: false,
          errorCode: 'model_selection_agent_target_unknown',
          error: 'model_selection_agent_target_unknown',
        };
      }

      const invokeActiveOwner = async (
        request: SessionModelTransitionRequestV1,
      ) => {
        let transition: SessionModelTransitionResultV1;
        try {
          const result = await sessionRpcWithServerScope<
            SessionModelTransitionResultV1,
            SessionModelTransitionRequestV1
          >({
            sessionId: normalizedSessionId,
            serverId,
            method: SESSION_RPC_METHODS.SESSION_MODEL_TRANSITION,
            payload: request,
          });
          transition = SessionModelTransitionResultV1Schema.parse(result);
        } catch (error) {
          transition = SessionModelTransitionResultV1Schema.parse({
            ok: false,
            status: 'owner_unavailable',
            activeSelection: null,
            requestedSelection: request.selection,
            reason: projectPluginFailureText(error),
          });
        }
        if (!transition.ok) {
          return {
            ok: false,
            errorCode: transition.status,
            error: transition.status,
            details: {
              status: transition.status,
              activeSelection: transition.activeSelection,
              requestedSelection: transition.requestedSelection,
              ...(transition.reason ? { reason: transition.reason } : {}),
            },
          };
        }
        return {
          ...transition,
          sessionId: normalizedSessionId,
          modelId: transition.activeSelection.modelId,
        };
      };

      return await runModelIntentAtAuthoritativeDisposition({
        observedActive: session.active === true,
        invokeObservedActiveOwner: async () =>
          await invokeActiveOwner(initialRequest.request),
        updateInactiveIntent: async () => {
          const candidate = createModelIntentMetadataCasCandidate({
            selection: initialRequest.request.selection,
          });
          await sync.patchSessionMetadataWithRetry(
            normalizedSessionId,
            candidate.update,
            {
              serverId:
                typeof serverId === 'string'
                && serverId.trim().length > 0
                  ? serverId.trim()
                  : null,
              sessionExpectation: { kind: 'inactive_model_intent' },
            },
          );
          const candidateState = candidate.readState();
          if (
            !candidateState.accepted
            || candidateState.updatedAt === null
          ) {
            return {
              ok: false,
              errorCode: 'superseded',
              error: 'superseded',
              details: {
                status: 'superseded',
                activeSelection:
                  initialRequest.currentIntent?.selection ?? {
                    agentTargetKey: initialRequest.agentTargetKey,
                    providerConnectionId: null,
                    modelId: 'default',
                  },
                requestedSelection: initialRequest.request.selection,
                reason: 'accepted_intent_was_superseded',
              },
            };
          }
          return {
            ok: true,
            status: 'intent_updated',
            sessionId: normalizedSessionId,
            modelId: initialRequest.request.selection.modelId,
            selection: initialRequest.request.selection,
            updatedAt: candidateState.updatedAt,
          };
        },
        resolveAndInvokeActiveOwnerAfterConflict: async () => {
          const currentSession =
            storage.getState().sessions[normalizedSessionId] ?? null;
          if (!currentSession || currentSession.active !== true) {
            return {
              ok: false,
              errorCode: 'owner_unavailable',
              error: 'owner_unavailable',
              details: {
                status: 'owner_unavailable',
                activeSelection: null,
                requestedSelection: initialRequest.request.selection,
                reason: 'session_model_transition_owner_unproven',
              },
            };
          }
          const currentRequest = resolveRequest(currentSession);
          if (currentRequest && 'refusal' in currentRequest) {
            return {
              ok: false,
              errorCode: currentRequest.refusal,
              error: currentRequest.refusal,
            };
          }
          if (!currentRequest) {
            return {
              ok: false,
              errorCode: 'owner_unavailable',
              error: 'owner_unavailable',
              details: {
                status: 'owner_unavailable',
                activeSelection: null,
                requestedSelection: initialRequest.request.selection,
                reason:
                  'session_model_transition_owner_metadata_unavailable',
              },
            };
          }
          return await invokeActiveOwner(currentRequest.request);
        },
      });
    },
    sessionModesList: async ({ sessionId }) => {
      const session = (storage.getState() as any)?.sessions?.[sessionId] ?? null;
      return {
        items: serializeSessionModeActionOptions(resolveSessionModeActionControl(session)).map((option) => ({
          id: option.value,
          label: option.label,
          ...(typeof option.description === 'string' && option.description.trim().length > 0
            ? { description: option.description }
            : {}),
        })),
      };
    },

    sessionTargetPrimarySet: async ({ sessionId, serverId }) => await setPrimaryActionSessionId({ sessionId, serverId }),
    sessionTargetTrackedSet: async (targets) => await setTrackedSessionIds({
        ...('sessionAddresses' in targets ? { sessionAddresses: targets.sessionAddresses } : { sessionIds: targets.sessionIds }),
        serverId: targets.context.serverId,
        corpus: readAdmittedSessionReferenceCorpusOptions(storage.getState()) ?? undefined,
    }),
    sessionList: listSessionsForVoiceTool,
    sessionActivityGet: async (params) => await getSessionActivityForVoiceTool(params),
    sessionTranscriptGet: async ({ sessionId, serverId, projection, limit, cursor, roles, maxCharsPerMessage }) =>
      await getSessionTranscriptForVoiceTool({
        sessionId,
        ...(serverId !== undefined ? { serverId } : {}),
        ...(projection ? { projection } : {}),
        ...(limit !== undefined ? { limit } : {}),
        ...(cursor !== undefined ? { cursor } : {}),
        ...(roles ? { roles } : {}),
        ...(maxCharsPerMessage !== undefined ? { maxCharsPerMessage } : {}),
      }),
    sessionRecentMessagesGet: async ({ sessionId, serverId, limit, cursor, includeUser, includeAssistant, maxCharsPerMessage }) =>
      await getSessionRecentMessagesForVoiceTool({ sessionId, serverId, limit, cursor, includeUser, includeAssistant, maxCharsPerMessage }),

    resetGlobalVoiceAgent: async () => {
      await resetVoiceAgentPersistenceState({
        stop: async () => await voiceSessionManager.stop(VOICE_AGENT_GLOBAL_SESSION_ID),
      });
    },
    teleportVoiceAgentToSessionRoot: async ({ sessionId }) => await teleportVoiceAgentToSessionRoot({ sessionId }),

    daemonMemorySearch: async ({ machineId, query, serverId, signal }) => {
      const accountLifetime = captureActiveServerAccountScopeLifetime();
      if (!accountLifetime) {
        return { v: 1, ok: false, errorCode: 'memory_invalid_query', error: 'Account scope is unavailable.' };
      }
      const exactServerId = String(serverId ?? accountLifetime.scope.serverId).trim();
      if (!exactServerId || !areServerProfileIdentifiersEquivalent(exactServerId, accountLifetime.scope.serverId)) {
        return { v: 1, ok: false, errorCode: 'memory_invalid_query', error: 'Exact Account scope is unavailable.' };
      }
      const authority = await captureMemorySearchSessionReadAuthority({
        serverId: exactServerId,
        accountId: accountLifetime.scope.accountId,
      });
      try {
        const result = MemorySearchResultV1Schema.parse(await machineRpcWithServerScope({
          machineId,
          serverId: exactServerId,
          accountId: accountLifetime.scope.accountId,
          preferScoped: true,
          method: RPC_METHODS.DAEMON_MEMORY_SEARCH,
          payload: query,
          ...(signal ? { signal } : {}),
        }));
        if (!result.ok) return result;
        return await authorizeMemorySearchResult({
          result,
          serverId: exactServerId,
          accountId: accountLifetime.scope.accountId,
          authority,
          accountLifetime,
          readSessionForServerScope: readMemorySearchSessionForServerScope,
          concurrencyLimit: readMemorySearchSessionHydrationConcurrencyLimit(),
          ...(signal ? { signal } : {}),
        });
      } finally {
        await authority.release();
      }
    },

    daemonMemoryGetWindow: async ({ machineId, sessionId, seqFrom, seqTo, serverId, signal }) => {
      const accountLifetime = captureActiveServerAccountScopeLifetime();
      const exactServerId = String(serverId ?? accountLifetime?.scope.serverId ?? '').trim();
      if (
        !accountLifetime
        || !exactServerId
        || !areServerProfileIdentifiersEquivalent(exactServerId, accountLifetime.scope.serverId)
      ) {
        throw Object.assign(new Error('Exact Account scope is unavailable.'), { code: 'not_authenticated' as const });
      }
      const authority = await captureMemorySearchSessionReadAuthority({
        serverId: exactServerId,
        accountId: accountLifetime.scope.accountId,
      });
      try {
        const authorized = await authorizeMemorySessionRange({
          target: {
            sessionKey: `${accountLifetime.scope.accountId}:${exactServerId}:${sessionId}`,
            serverId: exactServerId,
            accountId: accountLifetime.scope.accountId,
            sessionId,
          },
          seqFrom,
          seqTo,
          authority,
          accountLifetime,
          readSessionForServerScope: readMemorySearchSessionForServerScope,
          ...(signal ? { signal } : {}),
        });
        if (!authorized) {
          throw Object.assign(new Error('Memory window is outside the current Session projection.'), {
            code: 'not_authenticated' as const,
          });
        }
        return await machineRpcWithServerScope({
          machineId,
          serverId: exactServerId,
          accountId: accountLifetime.scope.accountId,
          preferScoped: true,
          method: RPC_METHODS.DAEMON_MEMORY_GET_WINDOW,
          payload: { v: 1, sessionId, seqFrom, seqTo },
          ...(signal ? { signal } : {}),
        });
      } finally {
        await authority.release();
      }
    },

    daemonMemoryEnsureUpToDate: async ({ machineId, sessionId, serverId }) =>
      await machineRpcWithServerScope({
        machineId,
        serverId,
        method: RPC_METHODS.DAEMON_MEMORY_ENSURE_UP_TO_DATE,
        payload: sessionId ? { sessionId } : {},
      }),

    approvalsCreate: async ({ request }) => {
      const header: ArtifactHeader = buildApprovalRequestArtifactHeaderV1(request);
      const artifactId = await (accountContext ? accountContext.createArtifact(header, JSON.stringify(request)) : sync.createArtifactWithHeader(header, JSON.stringify(request)));
      approvalCoordinator.notifyApprovalUpdated({ artifactId, request });
      return { artifactId };
    },

    approvalsGet: async ({ artifactId }) => {
      const local = accountContext ? null : storage.getState().artifacts[artifactId] ?? null;
      const localBody = local?.body;
      const localHeader = local?.header;
      // The reader is body-authoritative but still indexes on the header, so a
      // locked or header-less Artifact has nothing to match against.
      if (localHeader && typeof localBody === 'string') {
        const parsed = approvalArtifactBodyMatchesHeaderV1(localHeader, localBody);
        if (parsed?.family === 'built_in') return parsed.request;
      }

      const full = await (accountContext ? accountContext.fetchArtifact(artifactId) : sync.fetchArtifactWithBody(artifactId));
      if (full) {
        if (!accountContext) storage.getState().updateArtifact(full);
        const body = full.body;
        if (typeof body !== 'string' || !full.header) return null;
        const parsed = approvalArtifactBodyMatchesHeaderV1(full.header, body);
        return parsed?.family === 'built_in' ? parsed.request : null;
      }

      return null;
    },

    approvalsUpdate: async ({ artifactId, request }) => {
      const header: ArtifactHeader = buildApprovalRequestArtifactHeaderV1(request);

      if (accountContext) {
        await accountContext.updateArtifact(artifactId, header, JSON.stringify(request));
      } else {
        await sync.updateArtifactWithHeader(artifactId, header, JSON.stringify(request));
      }
      approvalCoordinator.notifyApprovalUpdated({ artifactId, request });
      return { ok: true };
    },

    approvalsResolveBlockingDecision: async ({ artifactId, request, decision }) =>
      await approvalCoordinator.resolveBlockingDecision({ artifactId, request, decision }),

    approvalsWaitForDecision: async ({ artifactId, request, serverId, signal }) => {
      const decision = await approvalCoordinator.waitForDecision({
        artifactId,
        request,
        serverId,
        signal,
        readRequest: async () => await deps.approvalsGet?.({ artifactId, serverId: serverId ?? null }) ?? null,
      });
      return { ...decision, request: ApprovalRequestSchema.parse(decision.request) };
    },

    promptDocUpdate: async ({ artifactId, title, markdown, folderId, tags }) => {
      await updatePromptDoc({ artifactId, title, markdown, ...(typeof folderId !== 'undefined' ? { folderId } : {}), ...(tags ? { tags } : {}) });
      return { ok: true, artifactId };
    },

    promptBundleUpdate: async ({ artifactId, title, skillMarkdown, folderId, tags }) => {
      await updateSkillPromptBundle({ artifactId, title, skillMarkdown, ...(typeof folderId !== 'undefined' ? { folderId } : {}), ...(tags ? { tags } : {}) });
      return { ok: true, artifactId };
    },

    promptAssetExport: async ({ artifactId, machineId, assetTypeId, scope, serverId, directory, targetPath, targetName, installMode }) => {
      const expectedSettingsScope = storage.getState().settingsScope ?? null;
      const result = await writePromptLibraryArtifactToExternalAsset({
        artifactId,
        machineId,
        assetTypeId,
        scope,
        serverId,
        workspacePath: directory ?? null,
        targetInput: targetPath ?? targetName ?? '',
        installMode,
        promptExternalLinks: storage.getState().settings.promptExternalLinksV1,
        previewOnly: false,
      });
      if (!result.ok || !result.nextPromptExternalLinks) {
        return { ok: false, errorCode: result.ok ? 'invalid_parameters' : (result.errorCode ?? 'invalid_parameters'), error: result.ok ? 'invalid_parameters' : result.error };
      }
      sync.applySettings({ promptExternalLinksV1: result.nextPromptExternalLinks }, {
        expectedSettingsScope,
        source: 'ui',
      });
      return { ok: true, artifactId, exported: true };
    },

    promptRegistryInstall: async ({ machineId, sourceId, itemId, configuredSources, serverId, installTarget }) => {
      const expectedSettingsScope = storage.getState().settingsScope ?? null;
      const result = await installPromptRegistryItem({
        machineId,
        sourceId,
        itemId,
        configuredSources,
        serverId,
        promptExternalLinks: storage.getState().settings.promptExternalLinksV1,
        ...(installTarget ? { installTarget } : {}),
      });
      if (!result.ok) {
        return { ok: false, errorCode: 'invalid_parameters', error: result.error, ...(result.artifactId ? { artifactId: result.artifactId } : {}) };
      }
      if (result.nextPromptExternalLinks) {
        sync.applySettings({ promptExternalLinksV1: result.nextPromptExternalLinks }, {
          expectedSettingsScope,
          source: 'ui',
        });
      }
      return { ok: true, artifactId: result.artifactId, exported: result.exported };
    },

    ...(opts?.resolveServerIdForSessionId ? { resolveServerIdForSessionId: opts.resolveServerIdForSessionId } : {}),
  };

  const executor = createActionExecutor(deps);

  // Surface attribution is owned by the host that constructs the executor, mirroring
  // `apps/cli/src/session/actions/createCliActionExecutor.ts` (`?? 'cli'`). This factory is the
  // app client's entrypoint, so an unattributed caller is a `ui` caller — a `voice` or `plugin`
  // caller stamps its own surface and still wins. Without this the surface reaches the catalog
  // gate nullish, which now fails closed (INV-1 / DEC-2).
  const resolveContext = (context: Parameters<typeof executor.execute>[2]): ActionExecutorContext => ({
    ...(context ?? {}),
    surface: context?.surface ?? 'ui',
    authority: context?.authority ?? 'present_user',
  });

  return {
    prepare: async (actionId, input, context) => await executor.prepare(actionId, input, resolveContext(context)),
    execute: async (actionId, input, context) => await executor.execute(actionId, input, resolveContext(context)),
    replayApprovedApprovalRequest: async (args) => await executor.replayApprovedApprovalRequest(args),
  };
}


type DefaultActionExecutorOptions = Parameters<typeof buildDefaultActionExecutor>[0];
type DefaultActionExecuteContext = Readonly<{
  serverId: string;
  signal?: AbortSignal;
  /** Rejects before admission when a caller is acting on an Account-owned projection. */
  expectedAccountId?: string;
  /** Synchronously consumes a failure only while this captured Account is still current. */
  onCurrentError?: (error: unknown) => void;
}>;

export function isActionAccountScopeChangedError(error: unknown): boolean {
  return error instanceof Error
    && 'code' in error
    && error.code === 'action_account_scope_changed';
}

/**
 * Runs an immediate Action and its synchronous result consumer inside one captured Account/Home
 * lifetime. Deferred preparation deliberately retains its separate runPrepared custody below.
 */
export async function withDefaultActionExecuteContext<TResult>(
  opts: DefaultActionExecutorOptions,
  context: DefaultActionExecuteContext,
  work: (executor: ReturnType<typeof createActionExecutor>, account: ActionAccountContext) => Promise<TResult>,
): Promise<TResult> {
  const account = await captureActionAccountContext(context.serverId, context.signal);
  try {
    try {
      if (context.expectedAccountId !== undefined && account.accountId !== context.expectedAccountId) {
        throw Object.assign(new Error('action_account_scope_changed'), { code: 'action_account_scope_changed' });
      }
      const settings = await account.readSettings();
      account.assertCurrent();
      const result = await work(buildDefaultActionExecutor(opts, { ...account, settings }), account);
      account.assertCurrent();
      return result;
    } catch (error) {
      if (!context.onCurrentError) throw error;
      // Account-currentness failures are custody refusals, not failures belonging to the stale
      // projection. Every other failure may be synchronously projected before this lifetime ends.
      if (isActionAccountScopeChangedError(error)) throw error;
      account.assertCurrent();
      context.onCurrentError(error);
      account.assertCurrent();
      throw error;
    }
  } finally {
    account.dispose();
  }
}

export function createDefaultActionExecutor(opts?: DefaultActionExecutorOptions): ReturnType<typeof createActionExecutor> {
  const unscoped = buildDefaultActionExecutor(opts);
  const accountScopeFailure = (error: unknown) => isActionAccountScopeChangedError(error)
    ? { ok: false as const, errorCode: 'action_account_scope_changed', error: 'action_account_scope_changed' }
    : null;
  return {
    execute: async (actionId, input, context) => {
      const serverId = context?.serverId;
      if (!serverId) return await unscoped.execute(actionId, input, context);
      try {
        return await withDefaultActionExecuteContext(opts, { ...context, serverId }, async (executor, account) => (
          await executor.execute(actionId, input, {
            ...context,
            ...(account.serverIdentityId ? { serverIdentityId: account.serverIdentityId } : {}),
            runtimeAccountId: account.accountId,
          })
        ));
      } catch (error) {
        const failure = accountScopeFailure(error);
        if (failure) return failure;
        throw error;
      }
    },
    prepare: async (actionId, input, context) => {
      if (!context?.serverId) return await unscoped.prepare(actionId, input, context);
      const account = await captureActionAccountContext(context.serverId, context.signal);
      try {
        const settings = await account.readSettings();
        account.assertCurrent();
        const prepared = await buildDefaultActionExecutor(opts, { ...account, settings }).prepare(actionId, input, {
          ...context,
          ...(account.serverIdentityId ? { serverIdentityId: account.serverIdentityId } : {}),
          runtimeAccountId: account.accountId,
        });
        account.assertCurrent();
        account.dispose();
        if (prepared.kind === 'settled') return prepared;
        let result: ReturnType<typeof prepared.invocation.run> | undefined;
        return {
          kind: 'ready',
          invocation: {
            run: () => {
              result ??= account.runPrepared(() => prepared.invocation.run());
              return result;
            },
          },
        };
      } catch (error) {
        account.dispose();
        const failure = accountScopeFailure(error);
        if (failure) return { kind: 'settled', result: failure };
        throw error;
      }
    },
    replayApprovedApprovalRequest: async (args) => await unscoped.replayApprovedApprovalRequest(args),
  };
}
