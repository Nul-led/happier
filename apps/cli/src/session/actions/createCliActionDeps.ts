import { homedir } from 'node:os';
import { randomUUID } from 'node:crypto';

import {
  projectSessionActivityCompatibilityV1,
  SESSION_LIST_AWARENESS_VIEW_V1,
  AcpConfigOptionOverridesV1Schema,
  buildAcpConfigOptionOverridesV1,
  AccountSettingMutationV1Schema,
  BackendTargetRefV2Schema,
  derivePluginSessionInputLocalIdV1,
  MemorySearchResultV1Schema,
  MemoryWindowV1Schema,
  buildBackendTargetKeyV2,
  getActionSpec,
  RuntimeDescriptorV1Schema,
  PromptExternalLinksV1Schema,
  exportPromptLibraryArtifact,
  installPromptRegistryItemInLibrary,
  updatePromptBundleInLibrary,
  updatePromptDocInLibrary,
  SessionMcpSelectionV1Schema,
  SessionAccessErrorCodeV1Schema,
  SessionModelSelectionV1Schema,
  SessionModelSelectionResolutionError,
  SessionCreationCorrespondenceV1Schema,
  SessionCreationTargetPreparationResultV1Schema,
  SessionCreationDirectoryApprovalV1Schema,
  HandoffTargetReplacementPreflightResultV1Schema,
  SCM_WORKTREE_REMOVE_AUTHORIZATION_TOKEN,
  SessionAuthoringTerminalV1Schema,
  normalizeSessionCreationOrganizationPlacementV1,
  normalizeSpawnSessionErrorDetail,
  SPAWN_SESSION_ERROR_DETAIL_KINDS,
  isSessionCreationCorrespondenceConflictSpawnErrorDetail,
  isSessionCreationOrganizationInvalidSpawnErrorDetail,
  supportsMachineOperationProtocolCapabilityV1,
  supportsMachineSessionSpawnProtocolVersionV1,
  ProviderConnectionIdSchema,
  resolveExplicitSessionSpawnMachineTarget,
  resolveSessionModelSelectionInputRefV1,
  mergeSpawnConfigOptionAliases,
  parseBackendTargetKeyV2,
  readBackendTargetRefV2,
  readRuntimeDescriptorV1FromMetadata,
  resolveActionBackendTargetSelection,
  withExecutionRunStartFailureDetails,
  type ConnectedServiceBindingsV2,
  type SessionAgentSpawnPolicyV1,
  type SpawnConfigOptionValue,
  type SessionBridgeLifecycleHookEventIdV1,
  type SessionModelSelectionV1,
  type SessionUsageLimitRecoveryResumePromptModeV1,
  type SessionUsageLimitRecoveryV1,
  type ActionExecutorDeps,
  type ActionExecutorContext,
  type BackendTargetRefV2,
  type ScmDiffSummaryGenerateInput,
  type PromptRegistryFetchedItemV1,
  type SessionSpawnNewInputV2,
  type SessionSpawnNewResultV1,
  type SessionCreationDirectoryApprovalV1,
  type SessionCreationPreparedCheckoutV1,
  type SessionCreationTargetPreparationRequestV1,
  type SessionCreationTargetPreparationResultV1,
  type AgentExecutionTargetV1,
  type ActionCaller,
  type ComposerAttachmentInputV1,
  type SessionInputAdmissionResultV1,
  type SessionMessageSendResultV1,
  HAPPIER_STRUCTURED_INPUT_METADATA_KEY_V1,
  WorkflowActionFailureV1Schema,
  WorkflowIngressContextV1Schema,
} from '@happier-dev/protocol';
import type { PromptAssetAdapter } from '@happier-dev/plugin-sdk/resources';
import { doesWorkflowImmediateEligibleStepTargetSession } from '@/daemon/workflows/coordinator';
import { SpawnSessionTerminalSchema } from '@/rpc/handlers/spawnSessionOptionsContract';
import { SPAWN_SESSION_ERROR_CODES } from '@/session/shared/spawnSessionContract';
import { createStableSpawnNonce } from '@/session/shared/spawnNonce';
import {
  AGENT_IDS,
  DEFAULT_AGENT_ID,
  parsePermissionIntentAlias,
  resolvePermissionIntentFromSessionMetadata,
  resolveCanonicalAgentIdFromFlavor,
  resolveAgentIdFromSessionMetadata,
  isBundledAgentId,
  type AgentId,
  type PermissionIntent,
} from '@happier-dev/agents';
import { BUNDLED_AGENT_CONTRIBUTION_IDENTITIES } from '@happier-dev/agents/agent-ids';
import { configuration } from '@/configuration';
import { isAuthenticationError } from '@/api/client/httpStatusError';
import { readMachineOperationProtocolCapabilitiesV1 } from '@/api/machine/machineOperationProtocolCapabilities';
import {
  SessionInitialAccessEnvelopeHostError,
  SessionInitialAccessUpdateRequiredError,
} from '@/api/session/sessionCreationInitialAccess';
import { getPreferredHostName } from '@/daemon/machine/metadata';
import { createCliApprovalsArtifactStore } from '@/session/actions/approvals/artifactStore';
import { createCredentialedAccountArtifactStore } from '@/api/artifacts/accountArtifactStore';
import { createWorkflowDefinitionActions } from './workflowDefinitions';
import { createWorkflowActionExecutor } from './workflowActionExecutor';
import { createWorkflowRunActionOwner } from './workflowRunActions';
import { createWorkflowRunStorageClient } from '@/daemon/workflows/workflowRunStorageClient';
import { isWorkflowRuntimeEnabled } from '@/daemon/automation/workflowFeatureGate';
import { listCurrentAccountMachines } from '@/api/machine/resolveCurrentAccountMachineTarget';
import { readAgentCatalogSnapshot } from '@/agent/catalog/snapshot';
import { prepareWorkflowAcceptedWorkspaceTarget, restoreRecordedWorkflowWorkspace } from '@/daemon/workflows/resolveWorkflowWorkspace';
import {
  createAutomationAccountEncryptionMaterialSnapshotV1,
  resolveValidatedAutomationAccountEncryptionV1,
} from '@/plugins/runtime/automations/automationAccountCurrentness';
import { fetchChangesAccountId } from '@/api/changes';
import { readSettings, type StoredCredentials } from '@/persistence';
import {
  createSpawnedSession,
  type DirectSpawnedSessionTransport,
  type ReplaySeededSessionCreationV1,
} from '@/session/services/createSpawnedSession';
import { resolveSessionHandoffSourceAuthority } from '@/session/handoff/resolveSessionHandoffSourceAuthority';
import { buildReplaySeededSpawnRecipe } from '@/session/replay/buildReplaySeededSpawnRecipe';
import { resolveReplaySourceContextAuthority } from '@/session/replay/resolveReplaySourceContextAuthority';
import {
  type ResolveSpawnConnectedServicesTeamResourceCatalog,
  resolveSessionSpawnConnectedServicesDefaultsPayload,
} from '@/session/services/spawnConnectedServicesDefaults';
import { getSessionEvents } from '@/session/services/getSessionEvents';
import { getSessionTranscript } from '@/session/services/getSessionTranscript';
import { projectCliSessionAwarenessV1 } from '@/cli/output/session/sessionAwareness';
import { fetchAccountEncryptionCurrentness } from '@/api/client/connectedServiceCredentialApi';
import { getSessionStatus } from '@/session/services/getSessionStatus';
import { createSessionBoardActionDeps } from '@/session/board/sessionBoardActionDeps';
import { createSessionDiscussionActionDeps } from '@/session/discussions/sessionDiscussionActionDeps';
import { createSessionListActionDependency } from './sessionListActionDependency';
import {
  resolveExternalActionServerRequestHeaders,
  type ExternalActionHomeBinding,
} from '@/api/externalActionExecutionAuthorization';
import { requestSessionStop } from '@/session/services/requestSessionStop';
import {
  admitPluginSessionInputAttachmentsV1,
  buildPluginSessionInputAttachmentDraftsV1,
} from '@/session/composer/admitPluginSessionInputAttachmentsV1';

type SessionSpawnNewErrorResult = Extract<SessionSpawnNewResultV1, Readonly<{ type: 'error' }>>;

/**
 * Keeps physical-host and atomic-create initial-access failures on the strict spawn
 * settlement instead of erasing Lane 04/Lane 06 recovery meaning behind a
 * generic process failure. The projection carries no key or response body.
 */
export function projectSessionInitialAccessEnvelopeHostErrorResult(
  error: unknown,
): SessionSpawnNewErrorResult | null {
  const code = error instanceof SessionInitialAccessEnvelopeHostError
    ? error.code
    : error && typeof error === 'object' && typeof (error as { code?: unknown }).code === 'string'
      ? (error as { code: string }).code
      : null;
  const parsedSessionAccessError = SessionAccessErrorCodeV1Schema.safeParse(code);
  if (parsedSessionAccessError.success) {
    return {
      type: 'error',
      code: parsedSessionAccessError.data,
      retryable: false,
    };
  }
  switch (code) {
    case 'not_authenticated':
      return { type: 'error', code: 'permission_denied', retryable: false };
    case 'session_data_key_unavailable':
      return { type: 'error', code, retryable: false };
    case 'session_access_request_failed':
      return { type: 'error', code, retryable: true };
    case 'unsupported_action':
      return { type: 'error', code: 'incompatible_target', retryable: false };
    default:
      return null;
  }
}
import type { ComposerAttachmentSendPreparationRegistryV1 } from '@/session/composer/prepareComposerAttachmentDraftsForSendV1';
import { notifyComposerAttachmentsAfterMessageAccepted } from '@/session/composer/notifyComposerAttachmentsAfterMessageAccepted';
import {
  sendSessionMessage,
  type SendSessionMessageResult,
} from '@/session/services/sendSessionMessage';
import { findPersistedSessionUserMessageAdmission } from '@/api/session/client/transcript/sessionUserMessageAdmissionRejoin';
import { validateComposerAttachmentRejoinCorrespondenceV1 } from '@/session/services/admitSessionStructuredInputV1';
import {
  buildCausalSessionInputAdmissionV1,
  buildSessionSpawnInitialInputAdmissionForLocalIdV1,
  buildPluginSessionInputAdmissionV1,
} from '@/session/services/sessionInputAdmissionIdentity';
import {
  indexAgentRoutingIdsByContributionIdentity,
  readAgentRoutingIdForContributionIdentity,
} from '@/plugins/projection/registry/agentRoutingIdentity';
import { resolveSessionCreationAgentTarget } from '@/session/creation/resolveSessionCreationAgentTarget';
import { setSessionArchivedState } from '@/session/services/setSessionArchivedState';
import { setSessionModel } from '@/session/services/setSessionModel';
import { setSessionMode } from '@/session/services/setSessionMode';
import { setSessionPermissionMode } from '@/session/services/setSessionPermissionMode';
import { setSessionTitle } from '@/session/services/setSessionTitle';
import { waitForSessionIdle } from '@/session/services/waitForSessionIdle';
import { requestInactiveSessionResume } from '@/session/services/requestInactiveSessionResume';
import { resolveSessionMachineWorkspacePath } from '@/session/machineControlLocality';
import {
  resolveCurrentSessionCapabilityBinding,
  resolveCurrentSessionUiBinding,
} from '@/session/presentation/currentSessionUiBindings';

import type {
  SessionStoredContentCryptoContext,
} from '@/session/transport/encryption/sessionStoredContentCodec';
import {
  cancelExecutionRunStream,
  ensureExecutionRun,
  ensureOrStartExecutionRun,
  executeExecutionRunAction,
  getExecutionRun,
  listExecutionRuns,
  readExecutionRunStream,
  startExecutionRun,
  startExecutionRunStream,
  stopExecutionRun,
  waitForExecutionRun,
} from '@/session/services/executionRuns';
import { buildPluginInstallApprovalPreview } from '@/plugins/devLoop/installApprovalPreview';
import {
  normalizeExecutionRunWaitTimeoutMs,
} from '@/session/services/executionRunWaitTiming';
import { resolveSessionTransportContext } from '@/session/services/resolveSessionTransportContext';
import { fetchSessionById, fetchSessionByIdCompat, type RawSessionRecord } from '@/session/transport/http/sessionsHttp';
import { callSessionRpc } from '@/session/transport/rpc/sessionRpc';
import {
  callMachineRpc,
  readMachineRpcRequestDisposition,
} from '@/session/transport/rpc/machineRpc';
import { RPC_METHODS, SESSION_RPC_METHODS } from '@happier-dev/protocol/rpc';
import {
  isRpcMethodNotAvailableError,
  isRpcMethodNotFoundError,
  readRpcErrorCode,
} from '@happier-dev/protocol/rpcErrors';
import { routeSessionCatalogControl } from '@/session/catalogControls/sessionCatalogControlRouter';
import { routeSessionGoalControl } from '@/session/goalControls/sessionGoalControlRouter';
import {
  normalizeUsageLimitRecoveryOperationResult,
} from '@/session/usageLimitRecoveryControls/sessionUsageLimitRecoveryOperationResult';
import { executePluginDevLoopAction } from '@/plugins/devLoop/actions';
import { executePluginSettingsAdministrationAction } from '@/plugins/settings/administration';
import { getSessionHostBridge } from '@/agent/runtime/bridges/session/SessionHostBridge';
import { resolveBackendTargetFromSessionMetadata } from '@/session/backendTargets/resolveBackendTargetFromSessionMetadata';
import { resolveSessionAgentSpawnInheritedOverridesFromMetadata } from '@/session/fork/resolveForkInheritedOverridesFromMetadata';
import { createCliActionInventoryDeps } from './cliActionDeps/createCliActionInventoryDeps';
import {
  readSessionAgentState,
  readSessionMetadata,
} from './cliActionDeps/sessionStateReaders';
import {
  HostSubagentStoreError,
  hostSubagentStore,
  type HostSubagentActor,
} from '@/session/subagents/hostSubagentStore';
import {
  resolveUsageLimitRecoveryEnabled,
  usageLimitRecoveryDisabledResult,
} from '@/features/usageLimitRecoveryFeatureGate';
import { createPromptAssetAdapterRegistry } from '@/prompts/assets/createPromptAssetAdapterRegistry';
import {
  deletePromptAsset,
  discoverPromptAssets,
  writePromptAsset,
} from '@/prompts/assets/actions';
import { createPromptRegistryAdapterRegistry } from '@/prompts/registries/createPromptRegistryAdapterRegistry';
import {
  fetchPromptRegistryItem,
  installPromptRegistryItem,
  scanPromptRegistrySource,
} from '@/prompts/registries/actions';
import { createPluginPermissionGrantActionExecutor } from '@/plugins/runtime/lifecycle/permissions/pluginPermissionGrantActionExecutor';
import { createPluginWebhookActionExecutor } from '@/plugins/runtime/webhooks/pluginWebhookActionExecutor';
import { createAutomationConversationActionExecutor } from '@/plugins/runtime/automations/automationConversationActionExecutor';
import {
  createAutomationEventActionExecutor,
  type ResolveAutomationEventAdoptedDefinitionSetV1,
} from '@/plugins/runtime/automations/automationEventActionExecutor';
import type {
  RevalidatePluginActionCallerImmutableGeneration,
  RevalidatePluginActionCallerMaterialization,
} from '@/plugins/runtime/invocation/services/actionCaller';
import { executeScmActionOperation } from '@/scm/actions/executeScmActionOperation';
import { executeScmDiffSummaryAction } from '@/scm/actions/executeScmDiffSummaryAction';
import { createCliReviewCommentActionExecutorFromCredentials } from '@/agent/reviews/comments/executor';
import { executePluginExternalSessionAction } from './externalSessions/pluginExternalSessionActionExecutor';
import type {
  ExternalSessionPluginAdmissionOwner,
} from './externalSessions/pluginExternalSessionAdmissionOwner';
import { bootstrapAccountSettingsContext } from '@/settings/accountSettings/bootstrapAccountSettingsContext';
import type { RuntimeActionSettingsProvider } from '@/settings/actionsSettingsProvider';
import { resolveWorkspaceRefById } from '@/settings/accountSettings/workspaceRefsV1';
import type { CliServerFeaturesSnapshot } from '@/features/serverFeaturesClient';
import {
  updateAccountSettingsV2WithRetry,
  type AccountSettingsMutationResult,
} from '@/settings/accountSettings/updateAccountSettingsV2WithRetry';

/**
 * Projects the low-level send wrapper onto the one public Action result.
 * Admission evidence is authoritative even when acknowledgement or waiting
 * failed after a durable effect. A successful unprotected send predates the
 * admission envelope, so its resolved local id is projected as accepted.
 */
function projectSessionMessageSendActionResult(
  result: SendSessionMessageResult,
): SessionMessageSendResultV1 | null {
  if (!result.ok && result.settlementResult) return result.settlementResult;
  if (result.admissionResult) return result.admissionResult;
  if (result.ok) return { status: 'accepted', localId: result.localId };
  return null;
}

function notSupported(): never {
  throw new Error('action_not_supported_in_cli');
}

type PromptExternalLinkPersistenceSettlement =
  | Readonly<{
    status: 'applied' | 'satisfied' | 'unchanged';
    version: number;
  }>
  | Readonly<{
    status: 'conflict';
    currentVersion: number;
  }>
  | Readonly<{
    status: 'outcomeUnknown';
    lastKnownVersion: number;
  }>
  | Readonly<{
    status: 'cancelled';
    submitted: false;
  }>
  | Readonly<{
    status: 'locked';
    reason: 'encryptionMaterialUnavailable' | 'modeMismatch' | 'contentUnreadable';
  }>
  | Readonly<{
    status: 'invalid';
    reason: 'unknownKey' | 'invalidValue' | 'duplicateKey' | 'tooLarge' | 'tooDeep';
  }>
  | Readonly<{
    status: 'unavailable';
    retryable: boolean;
  }>;

/**
 * The action response reports the independent Settings settlement without
 * ever exposing the Account Settings document that produced it.
 */
function projectPromptExternalLinkPersistenceSettlement(
  result: AccountSettingsMutationResult,
): PromptExternalLinkPersistenceSettlement {
  switch (result.status) {
    case 'applied':
    case 'satisfied':
    case 'unchanged':
      return Object.freeze({ status: result.status, version: result.version });
    case 'conflict':
      return Object.freeze({ status: result.status, currentVersion: result.currentVersion });
    case 'outcomeUnknown':
      return Object.freeze({ status: result.status, lastKnownVersion: result.lastKnownVersion });
    case 'cancelled':
      return Object.freeze({ status: result.status, submitted: result.submitted });
    case 'locked':
      return Object.freeze({ status: result.status, reason: result.reason });
    case 'invalid':
      return Object.freeze({ status: result.status, reason: result.reason });
    case 'unavailable':
      return Object.freeze({ status: result.status, retryable: result.retryable });
  }
}

function serializeHostSubagentStoreError(error: unknown): Readonly<{ ok: false; errorCode: string; error: string }> {
  if (error instanceof HostSubagentStoreError) {
    return { ok: false, errorCode: error.code, error: error.code };
  }
  throw error;
}

function deriveHostSubagentActor(caller: ActionCaller): HostSubagentActor {
  if (caller.kind !== 'plugin' || !caller.contributionLocalId?.trim()) {
    return { kind: 'externalRpc' };
  }
  return {
    kind: 'plugin',
    pluginId: caller.pluginId,
    agentId: caller.contributionLocalId,
  };
}

function normalizeStringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function executionRunActionFailure(
  code: string,
  message?: string,
  details?: unknown,
): Readonly<{ ok: false; errorCode: string; error: string; details?: unknown }> {
  return {
    ok: false,
    errorCode: code,
    error: message ?? code,
    ...(details !== undefined ? { details } : {}),
  };
}

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function isExecutionRunActionAbort(error: unknown, signal?: AbortSignal): boolean {
  return signal?.aborted === true || readRecord(error).name === 'AbortError';
}

function hasPossiblyAcceptedSpawnNonce(error: unknown): boolean {
  const details = readRecord(readRecord(error).details);
  return typeof details.spawnNonce === 'string' && details.spawnNonce.trim().length > 0;
}

/**
 * The Action surface consumes only the protocol-owned terminal detail, never
 * daemon/server wording. Direct daemon-control failures carry it at
 * `details.errorDetail`; the awaiter path nests the original response once.
 */
function hasSessionCreationOrganizationInvalidDetail(error: unknown): boolean {
  const details = readRecord(readRecord(error).details);
  return isSessionCreationOrganizationInvalidSpawnErrorDetail(
    details.errorDetail,
  ) || isSessionCreationOrganizationInvalidSpawnErrorDetail(
    readRecord(details.spawnResponse).errorDetail,
  );
}

function hasSessionCreationCorrespondenceConflictDetail(error: unknown): boolean {
  const details = readRecord(readRecord(error).details);
  return isSessionCreationCorrespondenceConflictSpawnErrorDetail(
    details.errorDetail,
  ) || isSessionCreationCorrespondenceConflictSpawnErrorDetail(
    readRecord(details.spawnResponse).errorDetail,
  );
}

function readResumePromptMode(value: unknown): SessionUsageLimitRecoveryResumePromptModeV1 | undefined {
  return value === 'standard' || value === 'off' || value === 'custom' ? value : undefined;
}

export type ResumeInactiveSessionWhenUsageLimitReady = (input: Readonly<{
  sessionId: string;
  rawSession: RawSessionRecord;
  metadata: Record<string, unknown>;
}>) => Promise<boolean>;

export type ScheduleInactiveSessionUsageLimitRecoveryCheck = (input: Readonly<{
  sessionId: string;
  recovery: SessionUsageLimitRecoveryV1;
  runCheckNow: () => Promise<unknown>;
}>) => Promise<void> | void;

export type CancelInactiveSessionUsageLimitRecoveryCheck = (input: Readonly<{
  sessionId: string;
  issueFingerprint: string;
  armedAtMs: number;
  runtimeAuthRecoveryAttemptId?: string;
}>) => Promise<void> | void;

/**
 * Reads the current record from the inactive usage-limit recovery lifecycle owner so an
 * in-flight readiness probe can be fenced against a cancellation, exhaustion or replacement
 * that landed while it was running.
 */
export type ReadInactiveSessionUsageLimitRecovery = (input: Readonly<{
  sessionId: string;
}>) => SessionUsageLimitRecoveryV1 | null;

export type CancelConnectedServiceRuntimeAuthRecovery = (input: Readonly<{
  sessionId: string;
  attemptId: string;
}>) => Promise<unknown> | unknown;

export type RetryTemporaryThrottleNow = (input: Readonly<{
  sessionId: string;
}>) => Promise<unknown> | unknown;

/**
 * Host-private exact-daemon path used only after the public V2 Action owner
 * has admitted an already server-stamped request. It replaces transport, not
 * Session creation policy, normalization, or lifecycle ownership.
 */
export type SessionSpawnDirectTargetTransport = Readonly<{
  machineId: string;
  prepare: (
    request: SessionCreationTargetPreparationRequestV1,
    options?: Readonly<{ signal?: AbortSignal }>,
  ) => Promise<SessionCreationTargetPreparationResultV1>;
  /** Exact-daemon compensation; absent predecessors deliberately leak safely. */
  rollbackCheckout?: (checkout: SessionCreationPreparedCheckoutV1) => Promise<void>;
  spawnedSession: DirectSpawnedSessionTransport;
}>;

export type MachineActionDirectTargetTransport = Readonly<{
  machineId: string;
  invoke: (
    method: string,
    request: unknown,
    options?: Readonly<{
      signal?: AbortSignal;
      executionRunPermissionRequestStore?: unknown;
      executionRunWorkflowObservationSink?: unknown;
    }>,
  ) => Promise<unknown>;
}>;

type CurrentMachineControlIdentity = Readonly<{
  machineId: string | null;
  host: string | null;
  homeDir: string | null;
}>;

function readStringRecord(value: unknown): Record<string, string> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const entries = Object.entries(value as Record<string, unknown>);
  if (!entries.every(([, entryValue]) => typeof entryValue === 'string')) return undefined;
  return Object.fromEntries(entries) as Record<string, string>;
}

function readConfigOptionsRecord(value: unknown): Record<string, SpawnConfigOptionValue> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const entries = Object.entries(value as Record<string, unknown>);
  if (!entries.every(([, entryValue]) => (
    typeof entryValue === 'string'
    || typeof entryValue === 'number' && Number.isFinite(entryValue)
    || typeof entryValue === 'boolean'
    || entryValue === null
  ))) {
    return undefined;
  }
  return Object.fromEntries(entries) as Record<string, SpawnConfigOptionValue>;
}

function resolveParentSpawnPolicyDeniedField(params: Readonly<{
  policy: SessionAgentSpawnPolicyV1;
  input: SessionSpawnNewInputV2;
  requestedBackendTarget: BackendTargetRefV2;
  parentDirectory: string | null;
  parentMachineId: string | null;
  parentBackendTarget: BackendTargetRefV2 | null;
}>): string | null {
  const { policy, input } = params;
  if (
    !policy.allowCustomDirectory
    && (!params.parentDirectory || input.directory !== params.parentDirectory)
  ) return 'directory';
  if (
    !policy.allowCrossMachine
    && (!params.parentMachineId || input.executionTarget.machineId !== params.parentMachineId)
  ) return 'executionTarget.machineId';
  if (
    !policy.allowBackendTargetOverride
    && (
      !params.parentBackendTarget
      || buildBackendTargetKeyV2(params.requestedBackendTarget)
        !== buildBackendTargetKeyV2(params.parentBackendTarget)
    )
  ) return 'agentTarget';
  return null;
}

async function resolveSpawnConnectedServicesDefaultPayload(params: Readonly<{
  backendTarget: NonNullable<ReturnType<typeof readBackendTargetRefV2>>;
  credentials: StoredCredentials;
  resolveTeamCredentialResourceCatalog?: ResolveSpawnConnectedServicesTeamResourceCatalog;
}>): Promise<Readonly<{
  connectedServices: ConnectedServiceBindingsV2;
  connectedServicesUpdatedAt: number;
}> | null> {
  if (params.backendTarget.sourceKind !== 'built_in') return null;
  // ONE defaulting owner (QA2-F02): session spawn and execution-run start resolve defaults
  // through the same fresh-bootstrap owner; no local settings-snapshot path.
  return await resolveSessionSpawnConnectedServicesDefaultsPayload({
    agentId: params.backendTarget.backendId,
    credentials: params.credentials,
    ...(params.resolveTeamCredentialResourceCatalog
      ? { resolveTeamCredentialResourceCatalog: params.resolveTeamCredentialResourceCatalog }
      : {}),
  });
}

type PendingAgentRequestKind = 'permission' | 'user_action';

/**
 * The Action-executor dependency contract owns the V2-only capability
 * requirement; this transport only consumes it, so it is read back from that
 * declaration instead of being restated here.
 */
type ExecutionRunProtocolV2Requirement = Parameters<
  NonNullable<ActionExecutorDeps['executionRunCheckProtocolV2']>
>[1];

function permissionRequestNotFoundResult(sessionId: string) {
  return {
    ok: false,
    errorCode: 'permission_request_not_found',
    errorMessage: 'permission_request_not_found',
    sessionId,
  } as const;
}

function isKnownCompletedRequestId(params: Readonly<{
  rawSession: Readonly<{ agentState?: unknown }>;
  requestId: string;
  kind: PendingAgentRequestKind;
}> & SessionStoredContentCryptoContext): boolean {
  const agentState = readSessionAgentState(params);
  const completedRequests = agentState?.completedRequests;
  if (!completedRequests || typeof completedRequests !== 'object' || Array.isArray(completedRequests)) {
    return false;
  }

  const completed = (completedRequests as Record<string, unknown>)[params.requestId];
  if (!completed || typeof completed !== 'object' || Array.isArray(completed)) {
    return false;
  }

  const requestKind = (completed as Record<string, unknown>).kind;
  if (params.kind === 'user_action') return requestKind === 'user_action';
  return requestKind === 'permission' || typeof requestKind === 'undefined';
}

const DETACHED_EXECUTION_RUN_CALLER_LIFECYCLE_METHODS = new Set<string>([
  SESSION_RPC_METHODS.EXECUTION_RUN_START,
  SESSION_RPC_METHODS.EXECUTION_RUN_ENSURE,
  SESSION_RPC_METHODS.EXECUTION_RUN_ENSURE_OR_START,
  SESSION_RPC_METHODS.EXECUTION_RUN_SEND,
  SESSION_RPC_METHODS.EXECUTION_RUN_ACTION,
  SESSION_RPC_METHODS.EXECUTION_RUN_STREAM_START,
  SESSION_RPC_METHODS.EXECUTION_RUN_STREAM_START_V2,
  SESSION_RPC_METHODS.EXECUTION_RUN_STREAM_CANCEL,
  SESSION_RPC_METHODS.EXECUTION_RUN_STOP,
  SESSION_RPC_METHODS.EXECUTION_RUN_WAIT,
]);

/**
 * An exact Action Home is one target: its server id and its base URL are bound
 * together or not at all. The Home-bound dependency owners already refuse a
 * half-bound target, so callers express the same pair here instead of letting
 * one half reach an owner that would fall back to the configured active Home.
 */
export type CliActionExactHomeTarget =
  | Readonly<{ serverId?: undefined; serverHttpBaseUrl?: undefined }>
  | Readonly<{ serverId: string; serverHttpBaseUrl: string }>;

export function createCliActionDeps(params: Readonly<{
  token: string;
  credentials?: StoredCredentials;
  sessionId: string;
  rawSession?: Readonly<{
    metadata?: unknown;
    path?: unknown;
    host?: unknown;
    machineId?: unknown;
  }> | null;
  getCurrentSessionBackendTarget?: (() => BackendTargetRefV2 | null | undefined) | null;
  happyHomeDir?: string;
  readRegisteredPromptAssetAdapters?: () => ReadonlyMap<string, PromptAssetAdapter>;
  resolveAutomationEventAdoptedDefinitionSet?: ResolveAutomationEventAdoptedDefinitionSetV1;
  revalidatePluginActionCallerMaterialization?: RevalidatePluginActionCallerMaterialization;
  revalidatePluginActionCallerImmutableGeneration?: RevalidatePluginActionCallerImmutableGeneration;
  isUsageLimitRecoveryEnabled?: (() => Promise<boolean> | boolean) | null;
  externalSessionPluginAdmissionOwner?: ExternalSessionPluginAdmissionOwner;
  machineAdmissionTransport?: NonNullable<
    Parameters<typeof sendSessionMessage>[0]['machineAdmissionTransport']
  >;
  sessionSpawnDirectTargetTransport?: SessionSpawnDirectTargetTransport;
  machineActionDirectTargetTransport?: MachineActionDirectTargetTransport;
  /**
   * Read at dispatch time so the plugin runtime's declared Composer attachments
   * are reachable from the Session-input writer. It is absent for hosts that
   * run no plugin runtime, in which case a declared attachment is refused
   * rather than dropped.
   */
  resolveComposerAttachmentSendPreparation?: () => ComposerAttachmentSendPreparationRegistryV1 | null;
  /** Reads the daemon's already-retained snapshot for this exact Home. */
  resolveServerFeaturesSnapshot?: () =>
    | CliServerFeaturesSnapshot
    | undefined
    | Promise<CliServerFeaturesSnapshot | undefined>;
  /** Exact Home-bound policy/settings snapshot owned by the runtime constructor. */
  actionsSettingsProvider?: RuntimeActionSettingsProvider;
  resolveTeamCredentialResourceCatalog?: ResolveSpawnConnectedServicesTeamResourceCatalog;
  /** Existing daemon authority owner shared with coordinator effect currentness. */
  workflowAcceptedAuthorizationCurrentness?: (input: Readonly<{
    authorization: import('@happier-dev/protocol').WorkflowAcceptedAuthorizationV1;
    signal?: AbortSignal;
  }>) => boolean | Promise<boolean>;
}> & SessionStoredContentCryptoContext & ExternalActionHomeBinding & CliActionExactHomeTarget): ActionExecutorDeps {
  // Re-formed once so the proven pair travels to every Home-bound owner
  // together; the two params fields decorrelate as soon as they are spread apart.
  const exactHome: CliActionExactHomeTarget =
    params.serverId !== undefined && params.serverHttpBaseUrl !== undefined
      ? { serverId: params.serverId, serverHttpBaseUrl: params.serverHttpBaseUrl }
      : {};
  const readServerFeaturesSnapshot = async (): Promise<CliServerFeaturesSnapshot | undefined> =>
    await params.resolveServerFeaturesSnapshot?.();
  const resolveServerRequestHeaders = (
    context: ActionExecutorContext,
    effectActionId: string,
    request: Readonly<{ method: string; path: string; body?: unknown }>,
  ): Readonly<Record<string, string>> | null => {
    const resolved = resolveExternalActionServerRequestHeaders({
      context,
      effectActionId,
      method: request.method,
      path: request.path,
      ...(request.body === undefined ? {} : { body: request.body }),
      daemonToken: params.token,
      serverIdentityId: params.serverIdentityId,
      ...(params.externalActionMachineRequestPrivateKey
        ? { privateKey: params.externalActionMachineRequestPrivateKey }
        : {}),
      ...(params.externalActionMachineInstallationId
        ? { installationId: params.externalActionMachineInstallationId }
        : {}),
    });
    return resolved.ok ? resolved.headers : null;
  };
  const inventoryDeps = createCliActionInventoryDeps(params);
  const approvalsStore = params.credentials ? createCliApprovalsArtifactStore({ credentials: params.credentials }) : null;
  const workflowDefinitions = params.credentials
    ? createWorkflowDefinitionActions({ artifactStore: createCredentialedAccountArtifactStore(params.credentials) })
    : null;
  const pluginPermissionGrantAction = params.credentials
    ? createPluginPermissionGrantActionExecutor({
      credentials: params.credentials,
      ...(params.revalidatePluginActionCallerMaterialization
        ? { revalidateCallerMaterialization: params.revalidatePluginActionCallerMaterialization }
        : {}),
    })
    : null;
  const pluginWebhookAction = params.credentials
    ? createPluginWebhookActionExecutor({
      credentials: params.credentials,
      ...(params.revalidatePluginActionCallerMaterialization
        ? { revalidateCallerMaterialization: params.revalidatePluginActionCallerMaterialization }
        : {}),
    })
    : null;
  const automationConversationAction = params.credentials
    ? createAutomationConversationActionExecutor({
      credentials: params.credentials,
      ...(params.revalidatePluginActionCallerMaterialization
        ? { revalidateCallerMaterialization: params.revalidatePluginActionCallerMaterialization }
        : {}),
      ...(params.revalidatePluginActionCallerImmutableGeneration
        ? { revalidateCallerImmutableGeneration: params.revalidatePluginActionCallerImmutableGeneration }
        : {}),
    })
    : null;
  const automationEventAction = params.credentials && params.resolveAutomationEventAdoptedDefinitionSet
    ? createAutomationEventActionExecutor({
      credentials: params.credentials,
      resolveAdoptedDefinitionSet: params.resolveAutomationEventAdoptedDefinitionSet,
      ...(params.revalidatePluginActionCallerMaterialization
        ? { revalidateCallerMaterialization: params.revalidatePluginActionCallerMaterialization }
        : {}),
      ...(params.revalidatePluginActionCallerImmutableGeneration
        ? { revalidateCallerImmutableGeneration: params.revalidatePluginActionCallerImmutableGeneration }
        : {}),
    })
    : null;
  const reviewCommentAction = params.credentials
    ? createCliReviewCommentActionExecutorFromCredentials({ credentials: params.credentials })
    : null;
  const promptAssetAdapterRegistry = createPromptAssetAdapterRegistry({
    ...(params.readRegisteredPromptAssetAdapters
      ? { readRegisteredAdapters: params.readRegisteredPromptAssetAdapters }
      : {}),
  });
  const promptRegistryAdapterRegistry = createPromptRegistryAdapterRegistry();
  let currentSessionMetadata = readSessionMetadata({
    ...params,
    rawSession: params.rawSession,
  });
  type ResolvedSessionTransport = Extract<
    Awaited<ReturnType<typeof resolveSessionTransportContext>>,
    Readonly<{ ok: true }>
  >;
  type LifecycleHookSessionContext = Readonly<{
    machineId?: string;
    cwd?: string;
    workspaceId?: string;
  }>;

  const sessionTransportCache = new Map<string, ResolvedSessionTransport>();
  const ambiguousSpawnActionRequestIds = new Set<string>();
  const callMachineAction = async (input: Readonly<{
    machineId: string;
    method: string;
    request: unknown;
    signal?: AbortSignal;
  }>): Promise<unknown> => {
    const direct = params.machineActionDirectTargetTransport;
    if (direct?.machineId === input.machineId) {
      return await direct.invoke(
        input.method,
        input.request,
        input.signal ? { signal: input.signal } : undefined,
      );
    }
    return await callMachineRpc({
      credentials: params.credentials!,
      machineId: input.machineId,
      method: input.method,
      request: input.request,
      ...(input.signal ? { signal: input.signal } : {}),
    });
  };

  const readCurrentSessionMetadata = async (): Promise<Record<string, unknown> | null> => {
    if (currentSessionMetadata) return currentSessionMetadata;

    try {
      const rawSession = await fetchSessionById({ token: params.token, sessionId: params.sessionId });
      currentSessionMetadata = readSessionMetadata({
        ...params,
        rawSession,
      });
      return currentSessionMetadata;
    } catch {
      currentSessionMetadata = null;
      return null;
    }
  };

  const resolveCurrentSessionValue = async (key: 'path' | 'host' | 'machineId'): Promise<string | null> => {
    const rawValue = params.rawSession?.[key];
    if (typeof rawValue === 'string' && rawValue.trim().length > 0) {
      return rawValue.trim();
    }

    const metadata = await readCurrentSessionMetadata();
    const metadataValue = metadata?.[key];
    return typeof metadataValue === 'string' && metadataValue.trim().length > 0
      ? metadataValue.trim()
      : null;
  };

  const resolveWorkflowIngressContext = async (
    context: ActionExecutorContext,
  ): Promise<ReturnType<typeof WorkflowIngressContextV1Schema.parse> | undefined> => {
    const callingSessionId = normalizeStringValue(context.defaultSessionId);
    if (!callingSessionId || callingSessionId !== normalizeStringValue(params.sessionId)) return undefined;

    // The live Session client is the canonical current Agent authority for the
    // hosting Session. The synced Session record is a fallback for a field the
    // live context does not supply, never an unconditional prerequisite.
    let backendTarget: BackendTargetRefV2 | null = null;
    try {
      backendTarget = params.getCurrentSessionBackendTarget?.() ?? null;
    } catch {
      backendTarget = null;
    }
    if (!backendTarget) {
      backendTarget = resolveBackendTargetFromSessionMetadata(await readCurrentSessionMetadata());
    }
    const agentId = backendTarget?.sourceKind === 'built_in'
      ? backendTarget.backendId
      : resolveAgentIdFromSessionMetadata(await readCurrentSessionMetadata());
    let agentIdentity: Readonly<{ pluginId: string; localId: string }> | undefined;
    if (agentId) {
      // A built-in backend target already carries the live Session's resolved
      // Agent id, whose contribution identity is generated with the bundle.
      // Open installed Agent ids still resolve through the active catalog.
      agentIdentity = backendTarget?.sourceKind === 'built_in' && isBundledAgentId(agentId)
        ? BUNDLED_AGENT_CONTRIBUTION_IDENTITIES[agentId]
        : readAgentCatalogSnapshot().agentDefinitionsById.get(agentId)?.identity;
    }
    const machineId = await resolveCurrentSessionValue('machineId');
    const directory = await resolveCurrentSessionValue('path');
    return WorkflowIngressContextV1Schema.parse({
      ...(agentIdentity ? { agentTarget: { kind: 'agent', identity: agentIdentity } } : {}),
      ...(machineId ? { machineId } : {}),
      ...(directory ? { directory } : {}),
    });
  };

  const workflowAction = workflowDefinitions && params.credentials
    ? createWorkflowActionExecutor({
        isWorkflowFeatureEnabled: async () => {
          try {
            return isWorkflowRuntimeEnabled(process.env, await readServerFeaturesSnapshot());
          } catch {
            return false;
          }
        },
        resolveIngressContext: async (args) => await resolveWorkflowIngressContext(args.context),
        resolveTargetValidation: async (args) => {
          try {
            const machines = await listCurrentAccountMachines({
              token: params.token,
              ...(params.serverHttpBaseUrl ? { serverHttpBaseUrl: params.serverHttpBaseUrl } : {}),
              ...(args.context.signal ? { signal: args.context.signal } : {}),
            });
            const target = resolveExplicitSessionSpawnMachineTarget({
              machineId: args.input.target?.machineId,
              machines: machines.map((machine) => ({ machineId: machine.id })),
            });
            if (target.kind === 'resolved') return { targetValidation: 'checked' as const };
          } catch {
            // The canonical inventory owner reported an unavailable observation.
          }
          return {
            targetValidation: 'unavailable' as const,
            targetIssues: [{
              code: 'target_unavailable' as const,
              path: '/target/machineId',
              message: 'The requested Workflow target is unavailable.',
              severity: 'error' as const,
            }],
          };
        },
        definitions: workflowDefinitions,
        runs: createWorkflowRunActionOwner({
          doesImmediateEligibleStepTargetSession: doesWorkflowImmediateEligibleStepTargetSession,
          resolveAccountId: async (signal) => await fetchChangesAccountId({
            token: params.token,
            ...(signal ? { signal } : {}),
          }),
          storage: {
            execute: async (operation, options) => {
              const publisherMachineId = normalizeStringValue(options?.publisherMachineId);
              const operationMachineId = publisherMachineId ?? (typeof operation.machineId === 'string' && operation.machineId.trim()
                ? operation.machineId.trim()
                : null);
              const settingsMachineId = operationMachineId ? null : normalizeStringValue((await readSettings()).machineId);
              const machineId = operationMachineId ?? settingsMachineId ?? await resolveCurrentSessionValue('machineId');
              if (!machineId) throw Object.assign(new Error('target_unavailable'), { code: 'target_unavailable' });
              return await createWorkflowRunStorageClient({
                token: params.token,
                machineId,
                ...(params.serverHttpBaseUrl ? { serverHttpBaseUrl: params.serverHttpBaseUrl } : {}),
              }).execute(
                operation as Parameters<ReturnType<typeof createWorkflowRunStorageClient>['execute']>[0],
                options?.signal ? { signal: options.signal } : {},
              );
            },
          },
          definitions: workflowDefinitions,
          resolveEncryption: async (signal) => {
            const resolved = await resolveValidatedAutomationAccountEncryptionV1({
              signal: signal ?? new AbortController().signal,
              resolveAccountEncryptionCurrentness: async (currentnessSignal) => await fetchAccountEncryptionCurrentness({
                token: params.token,
                ...(currentnessSignal ? { signal: currentnessSignal } : {}),
              }),
              resolveAccountEncryptionMaterial: async () => createAutomationAccountEncryptionMaterialSnapshotV1(params.credentials!),
            });
            if (resolved.kind !== 'available') throw Object.assign(new Error('content_unavailable'), { code: 'content_unavailable' });
            return resolved;
          },
          prepareWorkspace: async ({ projectTarget, definition }) => {
            if (!projectTarget.workspaceRefId) {
              return await prepareWorkflowAcceptedWorkspaceTarget({ projectTarget, definition });
            }
            const settings = await bootstrapAccountSettingsContext({
              credentials: params.credentials!,
              mode: 'blocking',
              refresh: 'force',
            });
            return await prepareWorkflowAcceptedWorkspaceTarget({
              projectTarget,
              definition,
              currentServerId: params.serverId ?? configuration.activeServerId,
              resolveWorkspaceRef: (workspaceRefId) => resolveWorkspaceRefById(
                settings.settings.workspaceRefsV1,
                workspaceRefId,
              ),
            });
          },
          restoreWorkspace: async (workspace) => await restoreRecordedWorkflowWorkspace({ workspace }),
          ...(params.workflowAcceptedAuthorizationCurrentness
            ? { isAcceptedAuthorizationCurrent: params.workflowAcceptedAuthorizationCurrentness }
            : {}),
        }),
      })
    : null;

  let currentMachineControlIdentityPromise: Promise<CurrentMachineControlIdentity> | null = null;

  const readCurrentMachineControlIdentity = async (): Promise<CurrentMachineControlIdentity> => {
    currentMachineControlIdentityPromise ??= (async () => {
      let machineId: string | null = null;
      try {
        machineId = normalizeStringValue((await readSettings()).machineId);
      } catch {
        machineId = null;
      }

      let host: string | null = null;
      try {
        host = normalizeStringValue(await getPreferredHostName());
      } catch {
        host = null;
      }

      return {
        machineId,
        host,
        homeDir: normalizeStringValue(homedir()),
      };
    })();
    return await currentMachineControlIdentityPromise;
  };

  const resolveSessionSpawnAgentInventorySelection: NonNullable<
    ActionExecutorDeps['resolveSessionSpawnAgentInventorySelection']
  > = ({ agentTarget }) => {
    const resolvedTarget = resolveSessionCreationAgentTarget(agentTarget);
    return resolvedTarget
      ? {
          agentId: resolvedTarget.agentId,
          backendTargetKey: buildBackendTargetKeyV2(resolvedTarget.backendTarget),
        }
      : null;
  };

  const requireLocalPromptActionMachine = async (machineId: string): Promise<Readonly<{
    ok: true;
  }> | Readonly<{
    ok: false;
    errorCode: 'machine_not_found';
    error: 'machine_not_found';
  }>> => {
    const current = await readCurrentMachineControlIdentity();
    return current.machineId === machineId
      ? { ok: true }
      : { ok: false, errorCode: 'machine_not_found', error: 'machine_not_found' };
  };

  const readPromptExternalLinks = async (): Promise<
    | Readonly<{ status: 'valid'; value: ReturnType<typeof PromptExternalLinksV1Schema.parse> }>
    | Readonly<{ status: 'invalid' }>
    | ReturnType<typeof notSupported>
  > => {
    if (!params.credentials) return notSupported();
    const context = await bootstrapAccountSettingsContext({
      credentials: params.credentials,
      mode: 'blocking',
      refresh: 'force',
    });
    const persisted = context.rawSettings ?? context.settings;
    if (!Object.hasOwn(persisted, 'promptExternalLinksV1')) {
      return { status: 'valid', value: { v: 1, links: [] } };
    }
    const parsed = PromptExternalLinksV1Schema.safeParse(persisted.promptExternalLinksV1);
    return parsed.success
      ? { status: 'valid', value: parsed.data }
      : { status: 'invalid' };
  };

  const persistPromptExternalLink = async (
    nextLinks: ReturnType<typeof PromptExternalLinksV1Schema.parse> | undefined,
    sourceWasInvalid: boolean,
    signal?: AbortSignal,
  ): Promise<PromptExternalLinkPersistenceSettlement | undefined> => {
    const nextLink = nextLinks?.links.at(-1);
    if (!nextLink) return undefined;
    if (sourceWasInvalid) {
      return Object.freeze({ status: 'invalid', reason: 'invalidValue' });
    }
    if (!params.credentials) {
      return Object.freeze({ status: 'unavailable' as const, retryable: false });
    }
    try {
      const mutation = AccountSettingMutationV1Schema.parse({
        operations: [{
          op: 'set',
          key: 'promptExternalLinksV1',
          value: nextLinks,
        }],
      });
      const result = await updateAccountSettingsV2WithRetry({
        credentials: params.credentials,
        signal,
        mutation,
      });
      return projectPromptExternalLinkPersistenceSettlement(result);
    } catch {
      // The artifact operation has already succeeded. Preserve that success
      // and report only the independent link-persistence settlement.
      return Object.freeze({ status: 'unavailable' as const, retryable: false });
    }
  };

  const resolveTransportForSession = async (idOrPrefix: string): Promise<ResolvedSessionTransport | Readonly<{
    ok: false;
    code: string;
    candidates?: string[];
  }>> => {
    if (!params.credentials) {
      return { ok: false, code: 'not_authenticated' };
    }

    const normalized = String(idOrPrefix ?? '').trim();
    if (!normalized) {
      return { ok: false, code: 'session_not_found' };
    }
    const cachedTransport = sessionTransportCache.get(normalized);
    if (cachedTransport) return cachedTransport;

    const serverFeaturesSnapshot = await readServerFeaturesSnapshot();
    const resolved = await resolveSessionTransportContext({
      credentials: params.credentials,
      idOrPrefix: normalized,
      ...(serverFeaturesSnapshot ? { serverFeaturesSnapshot } : {}),
    });
    if (!resolved.ok) {
      return {
        ok: false,
        code: resolved.code,
        ...(resolved.candidates ? { candidates: resolved.candidates } : {}),
      };
    }

    const cached: ResolvedSessionTransport = resolved;
    sessionTransportCache.set(resolved.sessionId, cached);
    // If the input is already a full id, also cache by that literal.
    sessionTransportCache.set(normalized, cached);
    return cached;
  };

  const resumeInactiveSessionTransport = async (input: Readonly<{
    transport: ResolvedSessionTransport;
    localId: string;
    signal?: AbortSignal;
    waitForReady?: boolean;
  }>) => {
    if (input.transport.rawSession.active === true) {
      return { ok: true } as const;
    }
    if (!params.credentials) {
      return {
        ok: false,
        code: 'unsupported',
        message: 'Inactive session resume requires authentication',
      } as const;
    }
    const metadata = readSessionMetadata({
      ...input.transport,
      rawSession: input.transport.rawSession,
    }) ?? {};
    return await requestInactiveSessionResume({
      credentials: params.credentials,
      sessionId: input.transport.sessionId,
      localId: input.localId,
      rawSession: input.transport.rawSession,
      metadata,
      ...(input.signal ? { signal: input.signal } : {}),
      ...(input.waitForReady === true ? { waitForReady: true } : {}),
    });
  };

  type ExecutionRunActionTransportOptions = Readonly<{
    serverId?: string | null;
    originSessionId?: string | null;
    targetMachineId?: string | null;
    exactMachineId?: string | null;
    signal?: AbortSignal;
    permissionRequestStore?: unknown;
    workflowObservationSink?: unknown;
  }>;
  type ExecutionRunMachineTarget =
    | Readonly<{ ok: true; machineId: string }>
    | Readonly<{ ok: false; errorCode: 'execution_run_target_not_selected' | 'execution_run_target_unavailable' }>;

  const readExecutionRunTransportMachineId = (transport: ResolvedSessionTransport): string | null => {
    const metadata = readSessionMetadata({ ...transport, rawSession: transport.rawSession });
    return normalizeStringValue(transport.rawSession.machineId)
      ?? normalizeStringValue(metadata?.machineId);
  };

  /**
   * Scope selection is authoritative before this point. This only resolves the
   * already-selected Session's daemon (or the caller's current device outside
   * a Session); it never scans, falls back, or accepts a machine id from Action
   * input.
   */
  const resolveExecutionRunMachineTarget = async (
    sessionId: string | null,
    opts?: ExecutionRunActionTransportOptions,
  ): Promise<ExecutionRunMachineTarget> => {
    const preflightMachineId = normalizeStringValue(opts?.exactMachineId);
    if (preflightMachineId) return { ok: true, machineId: preflightMachineId };

    // A bound host admits this target before Action dispatch. It is neither
    // mutable Action input nor a fallback candidate: V2 capability preflight
    // must interrogate this exact daemon before the resulting exactMachineId
    // pins every later control.
    const admittedMachineId = normalizeStringValue(opts?.targetMachineId);
    if (admittedMachineId) return { ok: true, machineId: admittedMachineId };

    const originSessionId = normalizeStringValue(opts?.originSessionId);
    const ownSessionId = params.sessionId !== 'cli-global' && params.sessionId !== 'plugin-global'
      ? normalizeStringValue(params.sessionId)
      : null;
    const targetSessionId = sessionId ?? originSessionId ?? ownSessionId;

    if (targetSessionId) {
      const transport = await resolveTransportForSession(targetSessionId);
      if (!transport.ok) return { ok: false, errorCode: 'execution_run_target_unavailable' };
      const machineId = readExecutionRunTransportMachineId(transport);
      return machineId
        ? { ok: true, machineId }
        : { ok: false, errorCode: 'execution_run_target_unavailable' };
    }

    const local = await readCurrentMachineControlIdentity();
    return local.machineId
      ? { ok: true, machineId: local.machineId }
      : { ok: false, errorCode: 'execution_run_target_not_selected' };
  };

  const callDetachedExecutionRunRpc = async (
    sessionId: string | null,
    method: string,
    request: unknown,
    opts?: ExecutionRunActionTransportOptions,
  ): Promise<unknown> => {
    const isStart = method === SESSION_RPC_METHODS.EXECUTION_RUN_START;
    const failure = (code: string, runCreation: 'noRunCreated' | 'outcomeUnknown', message?: string) => ({
      ok: false as const,
      code,
      ...(message ? { message } : {}),
      ...(isStart
        ? { details: withExecutionRunStartFailureDetails(undefined, runCreation) }
        : {}),
    });
    if (!params.credentials) {
      return failure('not_authenticated', 'noRunCreated');
    }
    const target = await resolveExecutionRunMachineTarget(sessionId, opts);
    if (!target.ok) return failure(target.errorCode, 'noRunCreated');
    try {
      if (opts?.permissionRequestStore !== undefined || opts?.workflowObservationSink !== undefined) {
        const direct = params.machineActionDirectTargetTransport;
        if (!direct || direct.machineId !== target.machineId) {
          return failure('execution_run_target_unavailable', 'noRunCreated');
        }
        return await direct.invoke(method, request, {
          ...(opts.signal ? { signal: opts.signal } : {}),
          ...(opts.permissionRequestStore === undefined
            ? {}
            : { executionRunPermissionRequestStore: opts.permissionRequestStore }),
          ...(opts.workflowObservationSink === undefined
            ? {}
            : { executionRunWorkflowObservationSink: opts.workflowObservationSink }),
        });
      }
      return await callMachineRpc({
        credentials: params.credentials,
        machineId: target.machineId,
        method,
        request,
        ...(DETACHED_EXECUTION_RUN_CALLER_LIFECYCLE_METHODS.has(method)
          ? { timeoutMs: null }
          : {}),
        ...(opts?.signal ? { signal: opts.signal } : {}),
      });
    } catch (error) {
      const requestDisposition = readMachineRpcRequestDisposition(error);
      const runCreation = requestDisposition === 'notSent'
        ? 'noRunCreated'
        : 'outcomeUnknown';
      if (
        method === SESSION_RPC_METHODS.EXECUTION_RUN_SEND
        && requestDisposition !== 'notSent'
      ) {
        return failure(
          'execution_run_send_outcome_unknown',
          'outcomeUnknown',
          'The execution-run input may have been accepted before its response failed',
        );
      }
      if (isExecutionRunActionAbort(error, opts?.signal)) {
        return failure('cancelled', runCreation);
      }
      return failure('execution_run_target_unavailable', runCreation);
    }
  };

  const readExecutionRunProtocolV2 = async (
    sessionId: string | null,
    requirement: ExecutionRunProtocolV2Requirement,
    opts?: ExecutionRunActionTransportOptions,
  ): Promise<
    | Readonly<{ ok: true; exactMachineId: string }>
    | Readonly<{ ok: false; errorCode: string; error: string }>
  > => {
    if (!params.credentials) {
      return executionRunActionFailure('not_authenticated');
    }
    if (opts?.signal?.aborted) {
      return executionRunActionFailure('cancelled');
    }
    const target = await resolveExecutionRunMachineTarget(sessionId, opts);
    if (!target.ok) return executionRunActionFailure(target.errorCode);
    try {
      const response = await callMachineAction({
        machineId: target.machineId,
        method: RPC_METHODS.CAPABILITIES_DETECT,
        request: { requests: [{ id: 'tool.executionRuns' }] },
        ...(opts?.signal ? { signal: opts.signal } : {}),
      });
      const result = readRecord(readRecord(response).results)['tool.executionRuns'];
      const data = readRecord(readRecord(result).data);
      const features = readRecord(data.features);
      if (
        readRecord(result).ok !== true
        || data.protocolVersion !== 2
        || (requirement.detachedScope && features.detachedScope !== true)
        || (requirement.startAndWait && features.startAndWait !== true)
        || (requirement.exactInputResults && features.exactInputResults !== true)
        || (requirement.runScopedAgentBindings && features.runScopedAgentBindings !== true)
        || (requirement.secretReferenceOverlay && features.secretReferenceOverlay !== true)
      ) {
        return executionRunActionFailure('execution_run_protocol_unsupported');
      }
      return { ok: true, exactMachineId: target.machineId };
    } catch (error) {
      if (isExecutionRunActionAbort(error, opts?.signal)) {
        return executionRunActionFailure('cancelled');
      }
      if (isRpcMethodNotAvailableError(error) || isRpcMethodNotFoundError(error)) {
        return executionRunActionFailure('execution_run_protocol_unsupported');
      }
      return executionRunActionFailure('execution_run_target_unavailable');
    }
  };

  const callSessionRpcForTransport = async (
    transport: ResolvedSessionTransport,
    methodSuffix: string,
    request: unknown,
    signal?: AbortSignal,
  ): Promise<unknown> => {
    if (!params.credentials) {
      return { ok: false, errorCode: 'not_authenticated', error: 'not_authenticated' };
    }

    try {
      return await callSessionRpc({
        ...transport,
        token: params.credentials.token,
        sessionId: transport.sessionId,
        method: `${transport.sessionId}:${methodSuffix}`,
        request,
        ...(signal ? { signal } : {}),
      });
    } catch (error) {
      const errorCode = readRpcErrorCode(error) ?? 'session_rpc_failed';
      return {
        ok: false,
        errorCode,
        error: errorCode,
        errorMessage: error instanceof Error ? error.message : errorCode,
        sessionId: transport.sessionId,
      };
    }
  };

  const normalizeLifecycleHookSessionContext = (context: Readonly<{
    machineId?: unknown;
    cwd?: unknown;
    workspaceId?: unknown;
  }>): LifecycleHookSessionContext => {
    const machineId = normalizeStringValue(context.machineId);
    const cwd = normalizeStringValue(context.cwd);
    const workspaceId = normalizeStringValue(context.workspaceId);
    return {
      ...(machineId ? { machineId } : {}),
      ...(cwd ? { cwd } : {}),
      ...(workspaceId ? { workspaceId } : {}),
    };
  };

  const resolveLifecycleHookSessionContext = async (event: Readonly<{
    happySessionId: string;
    exactSessionContext?: LifecycleHookSessionContext;
  }>): Promise<LifecycleHookSessionContext> => {
    if (event.exactSessionContext !== undefined) {
      return normalizeLifecycleHookSessionContext(event.exactSessionContext);
    }

    if (event.happySessionId === params.sessionId) {
      const metadata = await readCurrentSessionMetadata();
      return normalizeLifecycleHookSessionContext({
        machineId: await resolveCurrentSessionValue('machineId'),
        cwd: await resolveCurrentSessionValue('path'),
        workspaceId: metadata?.workspaceId,
      });
    }

    try {
      const transport = await resolveTransportForSession(event.happySessionId);
      if (!transport.ok) return {};
      const metadata = readSessionMetadata({
        ...transport,
        rawSession: transport.rawSession,
      });
      return normalizeLifecycleHookSessionContext({
        machineId: normalizeStringValue(transport.rawSession.machineId) ?? metadata?.machineId,
        cwd: normalizeStringValue(transport.rawSession.path) ?? metadata?.path,
        workspaceId: metadata?.workspaceId,
      });
    } catch {
      return {};
    }
  };

  const dispatchSessionLifecycleHookEvent = async (event: Readonly<{
    eventId: SessionBridgeLifecycleHookEventIdV1;
    happySessionId: string;
    backendTarget?: string;
    exactSessionContext?: LifecycleHookSessionContext;
    payload: Record<string, unknown>;
  }>): Promise<void> => {
    const happyHomeDir = typeof params.happyHomeDir === 'string' && params.happyHomeDir.trim().length > 0
      ? params.happyHomeDir.trim()
      : null;
    if (!happyHomeDir) {
      return;
    }
    const sessionContext = await resolveLifecycleHookSessionContext(event);

    await getSessionHostBridge().emitLifecycleHookEvent({
      happyHomeDir,
      eventId: event.eventId,
      happySessionId: event.happySessionId,
      ...sessionContext,
      ...(event.backendTarget ? { backendTarget: event.backendTarget } : {}),
      payload: event.payload,
    });
  };

  const callResolvedSessionRpc = async (
    sessionId: string,
    method: string,
    request: unknown,
    signal?: AbortSignal,
  ): Promise<unknown> => {
    if (!params.credentials) {
      return { ok: false, errorCode: 'not_authenticated', error: 'not_authenticated' };
    }
    const transport = await resolveTransportForSession(sessionId);
    if (!transport.ok) {
      return { ok: false, errorCode: transport.code, error: transport.code, ...(transport.candidates ? { candidates: transport.candidates } : {}) };
    }
    return await callSessionRpcForTransport(transport, method, request, signal);
  };

  const isUsageLimitRecoveryEnabled = async (): Promise<boolean> => {
    if (typeof params.isUsageLimitRecoveryEnabled === 'function') {
      return await params.isUsageLimitRecoveryEnabled();
    }
    return await resolveUsageLimitRecoveryEnabled();
  };

  const callRoutedSessionGoalControl = async (
    sessionId: string,
    operation: 'get' | 'set' | 'clear',
    request: Record<string, unknown>,
  ): Promise<unknown> => {
    if (!params.credentials) {
      return normalizeUsageLimitRecoveryOperationResult(
        { ok: false, errorCode: 'not_authenticated', error: 'not_authenticated' },
        { sessionId },
      );
    }

    const transport = await resolveTransportForSession(sessionId);
    if (!transport.ok) {
      return normalizeUsageLimitRecoveryOperationResult(
        {
          ok: false,
          errorCode: transport.code,
          error: transport.code,
        },
        { sessionId },
      );
    }

    const metadata = readSessionMetadata({
      ...transport,
      rawSession: transport.rawSession,
    });
    const currentMachineIdentity = await readCurrentMachineControlIdentity();
    return await routeSessionGoalControl({
      ...transport,
      token: params.credentials.token,
      credentials: params.credentials,
      sessionId: transport.sessionId,
      rawSession: transport.rawSession,
      metadata,
      currentMachineId: currentMachineIdentity.machineId,
      currentMachineHost: currentMachineIdentity.host,
      currentMachineHomeDir: currentMachineIdentity.homeDir,
      operation,
      ...(operation === 'set' ? { request } : {}),
      callLiveSessionRpc: async () => await callSessionRpcForTransport(
        transport,
        operation === 'get'
          ? SESSION_RPC_METHODS.SESSION_GOAL_GET
          : operation === 'clear'
            ? SESSION_RPC_METHODS.SESSION_GOAL_CLEAR
            : SESSION_RPC_METHODS.SESSION_GOAL_SET,
        request,
      ),
    });
  };

  const callRoutedSessionCatalogControl = async (
    sessionId: string,
    operation: 'vendorPlugins' | 'skills',
    request: Readonly<{ cwd?: string }>,
  ): Promise<unknown> => {
    if (!params.credentials) {
      return operation === 'vendorPlugins'
        ? { unsupported: true, vendorPlugins: [], diagnostic: 'not_authenticated' }
        : { unsupported: true, skills: [], diagnostic: 'not_authenticated' };
    }

    const transport = await resolveTransportForSession(sessionId);
    if (!transport.ok) {
      return operation === 'vendorPlugins'
        ? { unsupported: true, vendorPlugins: [], diagnostic: transport.code }
        : { unsupported: true, skills: [], diagnostic: transport.code };
    }

    const metadata = readSessionMetadata({
      ...transport,
      rawSession: transport.rawSession,
    });
    const currentMachineIdentity = await readCurrentMachineControlIdentity();
    const method = operation === 'vendorPlugins'
      ? SESSION_RPC_METHODS.SESSION_VENDOR_PLUGIN_CATALOG_LIST
      : SESSION_RPC_METHODS.SESSION_SKILL_CATALOG_LIST;
    const rpcRequest = {
      ...(typeof request.cwd === 'string' && request.cwd.trim().length > 0 ? { cwd: request.cwd.trim() } : {}),
    };
    return await routeSessionCatalogControl({
      ...transport,
      token: params.credentials.token,
      credentials: params.credentials,
      sessionId: transport.sessionId,
      rawSession: transport.rawSession,
      metadata,
      currentMachineId: currentMachineIdentity.machineId,
      currentMachineHost: currentMachineIdentity.host,
      currentMachineHomeDir: currentMachineIdentity.homeDir,
      operation,
      ...('cwd' in rpcRequest ? { cwd: rpcRequest.cwd } : {}),
      callLiveSessionRpc: async () => await callSessionRpcForTransport(
        transport,
        method,
        rpcRequest,
      ),
    });
  };

  const callRoutedUsageLimitRecoveryControl = async (
    sessionId: string,
    operation: 'enable' | 'cancel' | 'checkNow' | 'switchAccountNow' | 'consumeResetCredit',
    request: Record<string, unknown>,
  ): Promise<unknown> => {
    if (!params.credentials) {
      return normalizeUsageLimitRecoveryOperationResult(
        { ok: false, errorCode: 'not_authenticated', error: 'not_authenticated' },
        { sessionId },
      );
    }

    const transport = await resolveTransportForSession(sessionId);
    if (!transport.ok) {
      return normalizeUsageLimitRecoveryOperationResult(
        {
          ok: false,
          errorCode: transport.code,
          error: transport.code,
        },
        { sessionId },
      );
    }

    const metadata = readSessionMetadata({
      ...transport,
      rawSession: transport.rawSession,
    });
    if (transport.rawSession.active === true) {
      return normalizeUsageLimitRecoveryOperationResult(await callSessionRpcForTransport(
        transport,
        operation === 'enable'
          ? SESSION_RPC_METHODS.SESSION_USAGE_LIMIT_WAIT_RESUME_ENABLE
          : operation === 'cancel'
            ? SESSION_RPC_METHODS.SESSION_USAGE_LIMIT_WAIT_RESUME_CANCEL
            : operation === 'consumeResetCredit'
              ? SESSION_RPC_METHODS.SESSION_USAGE_LIMIT_CONSUME_RESET_CREDIT
              : SESSION_RPC_METHODS.SESSION_USAGE_LIMIT_CHECK_NOW,
        request,
      ), { sessionId: transport.sessionId });
    }

    const rawMachineId = normalizeStringValue(transport.rawSession.machineId);
    const metadataMachineId = normalizeStringValue(metadata?.machineId);
    if (rawMachineId && metadataMachineId && rawMachineId !== metadataMachineId) {
      return normalizeUsageLimitRecoveryOperationResult({
        ok: false,
        errorCode: 'session_usage_limit_recovery_control_target_machine_mismatch',
        error: 'session_usage_limit_recovery_control_target_machine_mismatch',
      }, { sessionId: transport.sessionId });
    }
    const machineId = rawMachineId ?? metadataMachineId;
    if (!machineId) {
      return normalizeUsageLimitRecoveryOperationResult({
        ok: false,
        errorCode: 'session_usage_limit_recovery_control_target_machine_unavailable',
        error: 'session_usage_limit_recovery_control_target_machine_unavailable',
      }, { sessionId: transport.sessionId });
    }

    const method = operation === 'enable'
      ? RPC_METHODS.DAEMON_SESSION_USAGE_LIMIT_WAIT_RESUME_ENABLE
      : operation === 'cancel'
        ? RPC_METHODS.DAEMON_SESSION_USAGE_LIMIT_WAIT_RESUME_CANCEL
        : operation === 'consumeResetCredit'
          ? RPC_METHODS.DAEMON_SESSION_USAGE_LIMIT_CONSUME_RESET_CREDIT
          : RPC_METHODS.DAEMON_SESSION_USAGE_LIMIT_CHECK_NOW;
    try {
      return normalizeUsageLimitRecoveryOperationResult(await callMachineRpc({
        credentials: params.credentials,
        machineId,
        method,
        request,
      }), { sessionId: transport.sessionId });
    } catch {
      return normalizeUsageLimitRecoveryOperationResult({
        ok: false,
        errorCode: 'session_usage_limit_recovery_control_target_machine_unavailable',
        error: 'session_usage_limit_recovery_control_target_machine_unavailable',
      }, { sessionId: transport.sessionId });
    }
  };

  const executeSessionBoundScmAction: NonNullable<ActionExecutorDeps['scmActionExecute']> = async ({
    actionId,
    input,
    context,
    executeCanonicalAction,
  }) => {
    if (!params.credentials) {
      return { ok: false, errorCode: 'not_authenticated', error: 'not_authenticated' };
    }
    const inputRecord = input && typeof input === 'object' && !Array.isArray(input)
      ? input as Readonly<Record<string, unknown>>
      : {};
    if (actionId === 'scm.reviewWorkspace.materializePrepared') {
      const selectedRoot = normalizeStringValue(inputRecord.cwd);
      if (!selectedRoot) {
        return { ok: false, errorCode: 'invalid_input', error: 'invalid_input' };
      }
      return await executeScmActionOperation({
        actionId,
        input: inputRecord,
        workingDirectory: selectedRoot,
        accessPolicy: { kind: 'restrictedRoots', roots: [selectedRoot] },
        ...(context.signal ? { signal: context.signal } : {}),
      });
    }
    const sessionId = normalizeStringValue(context.defaultSessionId);
    if (!sessionId) {
      return { ok: false, errorCode: 'session_not_selected', error: 'session_not_selected' };
    }
    const transport = await resolveTransportForSession(sessionId);
    if (!transport.ok) {
      return { ok: false, errorCode: transport.code, error: transport.code };
    }

    const metadata = readSessionMetadata({
      ...transport,
      rawSession: transport.rawSession,
    });
    const persistedWorkingDirectory = normalizeStringValue(transport.rawSession.path)
      ?? normalizeStringValue(metadata?.path);
    if (!persistedWorkingDirectory) {
      return {
        ok: false,
        errorCode: 'scm_action_worktree_unavailable',
        error: 'scm_action_worktree_unavailable',
      };
    }

    const currentMachine = await readCurrentMachineControlIdentity();
    const workingDirectory = metadata
      ? resolveSessionMachineWorkspacePath({
          metadata,
          currentMachineId: currentMachine.machineId,
          candidatePath: persistedWorkingDirectory,
        }) ?? persistedWorkingDirectory
      : persistedWorkingDirectory;
    const sessionMachineId = normalizeStringValue(transport.rawSession.machineId)
      ?? normalizeStringValue(metadata?.machineId);
    const sessionHost = normalizeStringValue(transport.rawSession.host)
      ?? normalizeStringValue(metadata?.host);
    const machineMismatch = Boolean(
      sessionMachineId
      && currentMachine.machineId
      && sessionMachineId !== currentMachine.machineId,
    );
    const hostMismatch = Boolean(
      !sessionMachineId
      && sessionHost
      && currentMachine.host
      && sessionHost !== currentMachine.host,
    );
    if (machineMismatch || hostMismatch) {
      return {
        ok: false,
        errorCode: 'scm_action_session_not_local',
        error: 'scm_action_session_not_local',
      };
    }

    const sessionBoundInput = actionId === 'scm.repository.clone'
      ? inputRecord
      : actionId === 'scm.pullRequest.prepareWorktree'
        ? { ...inputRecord, cwd: workingDirectory, sourcePath: workingDirectory }
        : { ...inputRecord, cwd: workingDirectory };
    const backendTarget = (() => {
      if (actionId !== 'scm.diffSummary.generate') return null;
      const selector = sessionBoundInput.modelSelector;
      const selectorRecord = selector && typeof selector === 'object' && !Array.isArray(selector)
        ? selector as Readonly<Record<string, unknown>>
        : {};
      const targetKey = normalizeStringValue(selectorRecord.backendTargetKey);
      if (targetKey) {
        try {
          const target = parseBackendTargetKeyV2(targetKey);
          if (target.kind === 'backend') return target;
          const catalog = readAgentCatalogSnapshot();
          const agentId = readAgentRoutingIdForContributionIdentity(
            indexAgentRoutingIdsByContributionIdentity([...catalog.agentDefinitionsById.values()]),
            target.identity,
          );
          return agentId
            ? BackendTargetRefV2Schema.parse({
                kind: 'backend',
                backendId: agentId,
                sourceKind: 'built_in',
              })
            : null;
        } catch {
          return null;
        }
      }
      return resolveBackendTargetFromSessionMetadata(metadata);
    })();

    return await executeScmActionOperation({
      actionId,
      input: sessionBoundInput,
      workingDirectory,
      accessPolicy: { kind: 'restrictedRoots', roots: [workingDirectory] },
      ...(context.signal ? { signal: context.signal } : {}),
      executeDiffSummary: async ({ request }) => await executeScmDiffSummaryAction({
        request: request as ScmDiffSummaryGenerateInput,
        backendTarget,
        executeCanonicalAction,
      }),
    });
  };

  type SessionSpawnTargetPreparation =
    | Readonly<{
        ok: true;
        preparedTarget: Extract<
          SessionCreationTargetPreparationResultV1,
          Readonly<{ ok: true }>
        >;
      }>
    | Readonly<{
        ok: false;
        result: Extract<SessionSpawnNewResultV1, Readonly<{ type: 'error' }>>;
      }>;

  /**
   * A direct transport is installed only by the authenticated exact-machine
   * receiver. Once that receiver has selected this daemon, its local profile
   * id is not an Account-routing identity: retain the portable server id in
   * the Action input and approval artifact instead of comparing it to that
   * profile-local value.
   */
  const isCurrentSessionSpawnExecutionTarget = (executionTarget: Readonly<{
    serverId: string;
    machineId: string;
  }>): boolean => {
    const directTargetTransport = params.sessionSpawnDirectTargetTransport;
    if (directTargetTransport?.machineId === executionTarget.machineId) {
      return true;
    }
    const activeServerId = String(configuration.activeServerId ?? '').trim();
    return Boolean(activeServerId && executionTarget.serverId === activeServerId);
  };

  /**
   * One exact-target bridge to the daemon-owned preparation RPC. Both the
   * Action approval probe and the eventual V2 spawn consume this owner; no
   * caller resolves a remote path or synthesizes its directory state.
   */
  const prepareSessionSpawnTarget = async (input: Readonly<{
    executionTarget: Readonly<{ serverId: string; machineId: string }>;
    directory: string;
    checkoutCreationDraft?: SessionCreationTargetPreparationRequestV1['checkoutCreationDraft'];
    signal?: AbortSignal;
  }>): Promise<SessionSpawnTargetPreparation> => {
    if (!params.credentials) {
      return {
        ok: false,
        result: { type: 'error', code: 'permission_denied', retryable: false },
      };
    }
    if (input.signal?.aborted) {
      return {
        ok: false,
        result: { type: 'error', code: 'cancelled', retryable: true },
      };
    }

    const directTargetTransport = params.sessionSpawnDirectTargetTransport;
    if (
      directTargetTransport
      && directTargetTransport.machineId !== input.executionTarget.machineId
    ) {
      return {
        ok: false,
        result: { type: 'error', code: 'target_unavailable', retryable: false },
      };
    }

    let rawPreparedTarget: unknown;
    try {
      rawPreparedTarget = directTargetTransport
        ? await directTargetTransport.prepare(
          {
            directory: input.directory,
            ...(input.checkoutCreationDraft !== undefined
              ? { checkoutCreationDraft: input.checkoutCreationDraft }
              : {}),
          },
          input.signal ? { signal: input.signal } : undefined,
        )
        : await callMachineAction({
            machineId: input.executionTarget.machineId,
            method: RPC_METHODS.DAEMON_SESSION_CREATION_PREPARE,
            request: {
              directory: input.directory,
              ...(input.checkoutCreationDraft !== undefined
                ? { checkoutCreationDraft: input.checkoutCreationDraft }
                : {}),
            },
            ...(input.signal ? { signal: input.signal } : {}),
          });
    } catch (error) {
      if (input.signal?.aborted) {
        return {
          ok: false,
          result: { type: 'error', code: 'cancelled', retryable: true },
        };
      }
      if (isRpcMethodNotAvailableError(error) || isRpcMethodNotFoundError(error)) {
        return {
          ok: false,
          result: { type: 'error', code: 'incompatible_target', retryable: false },
        };
      }
      if (isAuthenticationError(error)) {
        return {
          ok: false,
          result: { type: 'error', code: 'permission_denied', retryable: false },
        };
      }
      return {
        ok: false,
        result: { type: 'error', code: 'machine_offline', retryable: true },
      };
    }

    const preparedTarget = SessionCreationTargetPreparationResultV1Schema.safeParse(rawPreparedTarget);
    if (!preparedTarget.success) {
      return {
        ok: false,
        result: { type: 'error', code: 'incompatible_target', retryable: false },
      };
    }
    if (!preparedTarget.data.ok) {
      if (preparedTarget.data.code === 'invalid_directory') {
        return {
          ok: false,
          result: { type: 'error', code: 'invalid_input', retryable: false },
        };
      }
      if (preparedTarget.data.code === 'checkout_unavailable') {
        return {
          ok: false,
          result: { type: 'error', code: 'incompatible_target', retryable: false },
        };
      }
      return {
        ok: false,
        result: { type: 'error', code: 'spawn_failed', retryable: true },
      };
    }
    return { ok: true, preparedTarget: preparedTarget.data };
  };

  const rollbackKnownCreatedSessionCheckout = async (input: Readonly<{
    executionTarget: Readonly<{ serverId: string; machineId: string }>;
    checkout: SessionCreationPreparedCheckoutV1 | null;
  }>): Promise<void> => {
    if (input.checkout?.created !== true) return;

    try {
      const directTargetTransport = params.sessionSpawnDirectTargetTransport;
      if (directTargetTransport) {
        if (
          directTargetTransport.machineId === input.executionTarget.machineId
          && directTargetTransport.rollbackCheckout
        ) {
          await directTargetTransport.rollbackCheckout(input.checkout);
        }
        return;
      }
      await callMachineAction({
        machineId: input.executionTarget.machineId,
        method: RPC_METHODS.SCM_WORKTREE_REMOVE,
        request: {
          cwd: input.checkout.finalDirectory,
          worktreePath: input.checkout.finalDirectory,
          confirmed: true,
          authorizationToken: SCM_WORKTREE_REMOVE_AUTHORIZATION_TOKEN,
        },
      });
    } catch {
      // Compensation is best-effort. Preserve the original pre-spawn failure;
      // a cleanup failure must never disguise it or trigger an unsafe retry.
    }
  };

  return {
    resolveSessionSpawnAgentInventorySelection,
    scmActionExecute: executeSessionBoundScmAction,
    executionRunCheckProtocolV2: async (sessionId, requirement, opts) => {
      if (
        !requirement.detachedScope
        && !requirement.startAndWait
        && !requirement.exactInputResults
        && !requirement.runScopedAgentBindings
        && !requirement.secretReferenceOverlay
      ) {
        return { ok: true };
      }
      return await readExecutionRunProtocolV2(sessionId, requirement, opts);
    },
    executionRunStart: async (sessionId, request, opts) => {
      if (sessionId === null) {
        return await callDetachedExecutionRunRpc(
          sessionId,
          SESSION_RPC_METHODS.EXECUTION_RUN_START,
          request,
          opts,
        );
      }
      const transport = await resolveTransportForSession(sessionId);
      if (!transport.ok) {
        return {
          ok: false,
          code: transport.code,
          ...(transport.candidates ? { candidates: transport.candidates } : {}),
          details: withExecutionRunStartFailureDetails(undefined, 'noRunCreated'),
        };
      }
      const admittedMachineId = normalizeStringValue(opts?.exactMachineId);
      if (
        admittedMachineId
        && readExecutionRunTransportMachineId(transport) !== admittedMachineId
      ) {
        return {
          ok: false,
          code: 'execution_run_target_unavailable',
          details: withExecutionRunStartFailureDetails(undefined, 'noRunCreated'),
        };
      }
      const resumed = await resumeInactiveSessionTransport({
        transport,
        localId: `execution.run.start:${randomUUID()}`,
        ...(opts?.signal ? { signal: opts.signal } : {}),
        waitForReady: true,
      });
      if (!resumed.ok) {
        return {
          ok: false,
          code: 'execution_run_target_unavailable',
          message: resumed.message,
          details: withExecutionRunStartFailureDetails(undefined, 'noRunCreated'),
        };
      }
      return await startExecutionRun({
        ...transport,
        token: params.token,
        sessionId: transport.sessionId,
        request,
        ...(opts?.signal ? { signal: opts.signal } : {}),
      });
    },
    executionRunList: async (sessionId, request, opts) => {
      if (sessionId === null) {
        return await callDetachedExecutionRunRpc(
          sessionId,
          SESSION_RPC_METHODS.EXECUTION_RUN_LIST,
          request,
          opts,
        );
      }
      const transport = await resolveTransportForSession(sessionId);
      if (!transport.ok) {
        return { ok: false, code: transport.code, ...(transport.candidates ? { candidates: transport.candidates } : {}) };
      }
      return await listExecutionRuns({
        ...transport,
        token: params.token,
        sessionId: transport.sessionId,
        request,
        skipLiveRpc: transport.rawSession.active === false,
        ...(opts?.signal ? { signal: opts.signal } : {}),
      });
    },
    executionRunGet: async (sessionId, request, opts) => {
      if (sessionId === null) {
        return await callDetachedExecutionRunRpc(
          sessionId,
          SESSION_RPC_METHODS.EXECUTION_RUN_GET,
          request,
          opts,
        );
      }
      const transport = await resolveTransportForSession(sessionId);
      if (!transport.ok) {
        return { ok: false, code: transport.code, ...(transport.candidates ? { candidates: transport.candidates } : {}) };
      }
      return await getExecutionRun({
        ...transport,
        token: params.token,
        sessionId: transport.sessionId,
        request,
        ...(opts?.signal ? { signal: opts.signal } : {}),
      });
    },
    detachedExecutionRunSend: async (sessionId, request, opts) =>
      await callDetachedExecutionRunRpc(
        sessionId,
        SESSION_RPC_METHODS.EXECUTION_RUN_SEND,
        request,
        opts,
      ),
    executionRunEnsure: async (sessionId, request, opts) => {
      if (sessionId === null) {
        return await callDetachedExecutionRunRpc(
          sessionId,
          SESSION_RPC_METHODS.EXECUTION_RUN_ENSURE,
          request,
          opts,
        );
      }
      const transport = await resolveTransportForSession(sessionId);
      if (!transport.ok) {
        return { ok: false, code: transport.code, ...(transport.candidates ? { details: transport.candidates } : {}) };
      }
      return await ensureExecutionRun({
        ...transport,
        token: params.token,
        sessionId: transport.sessionId,
        request,
        ...(opts?.signal ? { signal: opts.signal } : {}),
      });
    },
    executionRunEnsureOrStart: async (sessionId, request, opts) => {
      if (sessionId === null) {
        return await callDetachedExecutionRunRpc(
          sessionId,
          SESSION_RPC_METHODS.EXECUTION_RUN_ENSURE_OR_START,
          request,
          opts,
        );
      }
      const transport = await resolveTransportForSession(sessionId);
      if (!transport.ok) {
        return { ok: false, code: transport.code, ...(transport.candidates ? { details: transport.candidates } : {}) };
      }
      return await ensureOrStartExecutionRun({
        ...transport,
        token: params.token,
        sessionId: transport.sessionId,
        request,
        ...(opts?.signal ? { signal: opts.signal } : {}),
      });
    },
    executionRunStreamStart: async (sessionId, request, opts) => {
      if (sessionId === null) {
        return await callDetachedExecutionRunRpc(
          sessionId,
          SESSION_RPC_METHODS.EXECUTION_RUN_STREAM_START,
          request,
          opts,
        );
      }
      const transport = await resolveTransportForSession(sessionId);
      if (!transport.ok) {
        return { ok: false, code: transport.code, ...(transport.candidates ? { details: transport.candidates } : {}) };
      }
      return await startExecutionRunStream({
        ...transport,
        token: params.token,
        sessionId: transport.sessionId,
        request,
        ...(opts?.signal ? { signal: opts.signal } : {}),
      });
    },
    executionRunStreamRead: async (sessionId, request, opts) => {
      if (sessionId === null) {
        return await callDetachedExecutionRunRpc(
          sessionId,
          SESSION_RPC_METHODS.EXECUTION_RUN_STREAM_READ,
          request,
          opts,
        );
      }
      const transport = await resolveTransportForSession(sessionId);
      if (!transport.ok) {
        return { ok: false, code: transport.code, ...(transport.candidates ? { details: transport.candidates } : {}) };
      }
      return await readExecutionRunStream({
        ...transport,
        token: params.token,
        sessionId: transport.sessionId,
        request,
        ...(opts?.signal ? { signal: opts.signal } : {}),
      });
    },
    executionRunStreamCancel: async (sessionId, request, opts) => {
      if (sessionId === null) {
        return await callDetachedExecutionRunRpc(
          sessionId,
          SESSION_RPC_METHODS.EXECUTION_RUN_STREAM_CANCEL,
          request,
          opts,
        );
      }
      const transport = await resolveTransportForSession(sessionId);
      if (!transport.ok) {
        return { ok: false, code: transport.code, ...(transport.candidates ? { details: transport.candidates } : {}) };
      }
      return await cancelExecutionRunStream({
        ...transport,
        token: params.token,
        sessionId: transport.sessionId,
        request,
        ...(opts?.signal ? { signal: opts.signal } : {}),
      });
    },
    executionRunStop: async (sessionId, request, opts) => {
      if (sessionId === null) {
        return await callDetachedExecutionRunRpc(
          sessionId,
          SESSION_RPC_METHODS.EXECUTION_RUN_STOP,
          request,
          opts,
        );
      }
      const transport = await resolveTransportForSession(sessionId);
      if (!transport.ok) {
        return { ok: false, code: transport.code, ...(transport.candidates ? { candidates: transport.candidates } : {}) };
      }
      return await stopExecutionRun({
        ...transport,
        token: params.token,
        sessionId: transport.sessionId,
        request,
        ...(opts?.signal ? { signal: opts.signal } : {}),
      });
    },
    executionRunAction: async (sessionId, request, opts) => {
      if (sessionId === null) {
        return await callDetachedExecutionRunRpc(
          sessionId,
          SESSION_RPC_METHODS.EXECUTION_RUN_ACTION,
          request,
          opts,
        );
      }
      const transport = await resolveTransportForSession(sessionId);
      if (!transport.ok) {
        return { ok: false, code: transport.code, ...(transport.candidates ? { candidates: transport.candidates } : {}) };
      }
      return await executeExecutionRunAction({
        ...transport,
        token: params.token,
        sessionId: transport.sessionId,
        request,
        ...(opts?.signal ? { signal: opts.signal } : {}),
      });
    },
    executionRunWait: async (sessionId, request, opts) => {
      if (sessionId === null) {
        return await callDetachedExecutionRunRpc(
          sessionId,
          SESSION_RPC_METHODS.EXECUTION_RUN_WAIT,
          request,
          opts,
        );
      }
      const transport = await resolveTransportForSession(sessionId);
      if (!transport.ok) {
        return { ok: false, code: transport.code, ...(transport.candidates ? { candidates: transport.candidates } : {}) };
      }

      return await waitForExecutionRun({
        ...transport,
        token: params.token,
        sessionId: transport.sessionId,
        runId: request.runId,
        timeoutMs: normalizeExecutionRunWaitTimeoutMs(request.timeoutSeconds),
        ...(opts?.signal ? { signal: opts.signal } : {}),
      });
    },
    reviewStartInline: async ({ sessionId, input }) => {
      return await callResolvedSessionRpc(sessionId, SESSION_RPC_METHODS.SESSION_REVIEW_START_INLINE, input);
    },
    ...(reviewCommentAction
      ? {
        reviewCommentAction: async ({ actionId, input, reviewCommentPrincipal, signal }) =>
          await reviewCommentAction(actionId, input, {
            ...(reviewCommentPrincipal ? { principal: reviewCommentPrincipal } : {}),
            ...(signal ? { signal } : {}),
          }),
      }
      : {}),

    daemonMemorySearch: async ({ machineId, query, signal }) => {
      if (!params.credentials) return notSupported();
      const result = MemorySearchResultV1Schema.parse(await callMachineRpc({
        credentials: params.credentials,
        machineId,
        method: RPC_METHODS.DAEMON_MEMORY_SEARCH,
        request: query,
        ...(signal ? { signal } : {}),
      }));
      if (!result.ok) return result;

      const visibleThroughSeqBySessionId = new Map<string, number>();
      await Promise.all([...new Set(result.hits.map((hit) => hit.sessionId))].map(async (sessionId) => {
        try {
          const session = await fetchSessionById({
            token: params.credentials!.token,
            sessionId,
            ...(signal ? { signal } : {}),
          });
          if (session && Number.isSafeInteger(session.seq) && session.seq >= 0) {
            visibleThroughSeqBySessionId.set(sessionId, session.seq);
          }
        } catch {
          signal?.throwIfAborted();
          // The daemon index is derived state. An unreadable Session cannot be
          // returned as Action data, even when its retained summary still exists.
        }
      }));
      signal?.throwIfAborted();
      return {
        ...result,
        hits: result.hits.filter((hit) => {
          const visibleThroughSeq = visibleThroughSeqBySessionId.get(hit.sessionId);
          return visibleThroughSeq !== undefined
            && hit.seqFrom <= visibleThroughSeq
            && hit.seqTo <= visibleThroughSeq;
        }),
      };
    },
    daemonMemoryGetWindow: async ({ machineId, sessionId, seqFrom, seqTo, signal }) => {
      if (!params.credentials) return notSupported();
      const session = await fetchSessionById({
        token: params.credentials.token,
        sessionId,
        ...(signal ? { signal } : {}),
      });
      const visibleThroughSeq = session?.seq;
      if (
        typeof visibleThroughSeq !== 'number'
        || !Number.isSafeInteger(visibleThroughSeq)
        || visibleThroughSeq < 0
        || seqFrom > visibleThroughSeq
        || seqTo > visibleThroughSeq
      ) {
        throw Object.assign(
          new Error('Memory window is outside the current Session projection.'),
          { code: 'not_authenticated' as const },
        );
      }
      return MemoryWindowV1Schema.parse(await callMachineRpc({
        credentials: params.credentials,
        machineId,
        method: RPC_METHODS.DAEMON_MEMORY_GET_WINDOW,
        request: { v: 1, sessionId, seqFrom, seqTo },
        ...(signal ? { signal } : {}),
      }));
    },
    daemonMemoryEnsureUpToDate: async ({ machineId, sessionId }) => {
      if (!params.credentials) return notSupported();
      return await callMachineRpc({
        credentials: params.credentials,
        machineId,
        method: RPC_METHODS.DAEMON_MEMORY_ENSURE_UP_TO_DATE,
        request: sessionId ? { sessionId } : {},
      });
    },
    daemonPromptAssetsDiscover: async ({ request, signal }) => await discoverPromptAssets({
      registry: promptAssetAdapterRegistry,
      request,
      ...(signal ? { signal } : {}),
    }),
    daemonPromptAssetsDelete: async ({ request, signal }) => await deletePromptAsset({
      registry: promptAssetAdapterRegistry,
      request,
      ...(signal ? { signal } : {}),
    }),
    daemonPromptRegistryScanSource: async ({ request }) => await scanPromptRegistrySource({
      registry: promptRegistryAdapterRegistry,
      request,
    }),
    daemonPromptRegistryInstall: async ({ request, signal }) => await installPromptRegistryItem({
      registry: promptRegistryAdapterRegistry,
      assetRegistry: promptAssetAdapterRegistry,
      request,
      ...(signal ? { signal } : {}),
    }),
    promptDocUpdate: async ({ signal, ...request }) => {
      if (!approvalsStore) return notSupported();
      return await updatePromptDocInLibrary({
        store: approvalsStore.promptLibraryStore,
        request,
        ...(signal ? { signal } : {}),
      });
    },
    promptBundleUpdate: async ({ signal, ...request }) => {
      if (!approvalsStore) return notSupported();
      return await updatePromptBundleInLibrary({
        store: approvalsStore.promptLibraryStore,
        request,
        ...(signal ? { signal } : {}),
      });
    },
    promptAssetExport: async ({ signal, ...request }) => {
      if (!approvalsStore) return notSupported();
      const localMachine = await requireLocalPromptActionMachine(request.machineId);
      if (!localMachine.ok) return localMachine;
      const promptExternalLinks = await readPromptExternalLinks();
      if ('ok' in promptExternalLinks && promptExternalLinks.ok === false) return promptExternalLinks;
      const result = await exportPromptLibraryArtifact({
        store: approvalsStore.promptLibraryStore,
        write: async ({ request: writeRequest, signal: writeSignal }) => await writePromptAsset({
          registry: promptAssetAdapterRegistry,
          request: writeRequest,
          ...(writeSignal ? { signal: writeSignal } : {}),
        }),
        request: {
          ...request,
          workspacePath: request.directory ?? null,
          targetInput: request.targetPath ?? request.targetName ?? '',
          promptExternalLinks: promptExternalLinks.status === 'valid'
            ? promptExternalLinks.value
            : { v: 1, links: [] },
        },
        randomId: randomUUID,
        ...(signal ? { signal } : {}),
      });
      if (!result.ok) return result;
      const externalLinkPersistence = await persistPromptExternalLink(
        result.nextPromptExternalLinks,
        promptExternalLinks.status === 'invalid',
        signal,
      );
      return {
        ...result,
        ...(externalLinkPersistence ? { externalLinkPersistence } : {}),
      };
    },
    promptRegistryInstall: async ({ signal, ...request }) => {
      if (!approvalsStore) return notSupported();
      const localMachine = await requireLocalPromptActionMachine(request.machineId);
      if (!localMachine.ok) return localMachine;
      let fetchedItem: PromptRegistryFetchedItemV1 | null = null;
      const promptExternalLinks = await readPromptExternalLinks();
      if ('ok' in promptExternalLinks && promptExternalLinks.ok === false) return promptExternalLinks;
      const result = await installPromptRegistryItemInLibrary({
        store: approvalsStore.promptLibraryStore,
        fetchItem: async ({ sourceId, itemId, configuredSources, signal: fetchSignal }) => {
          const fetched = await fetchPromptRegistryItem({
            registry: promptRegistryAdapterRegistry,
            sourceId,
            itemId,
            configuredSources,
            ...(fetchSignal ? { signal: fetchSignal } : {}),
          });
          if (fetched.ok) fetchedItem = fetched.item;
          return fetched;
        },
        install: async ({ request: installRequest, signal: installSignal }) => await installPromptRegistryItem({
          registry: promptRegistryAdapterRegistry,
          assetRegistry: promptAssetAdapterRegistry,
          request: installRequest,
          ...(fetchedItem ? { fetchedItem } : {}),
          ...(installSignal ? { signal: installSignal } : {}),
        }),
        request: {
          ...request,
          promptExternalLinks: promptExternalLinks.status === 'valid'
            ? promptExternalLinks.value
            : { v: 1, links: [] },
        },
        randomId: randomUUID,
        ...(signal ? { signal } : {}),
      });
      if (!result.ok) return result;
      const externalLinkPersistence = await persistPromptExternalLink(
        result.nextPromptExternalLinks,
        promptExternalLinks.status === 'invalid',
        signal,
      );
      return {
        ...result,
        ...(externalLinkPersistence ? { externalLinkPersistence } : {}),
      };
    },

    sessionOpen: async ({ sessionId, serverId, actionRequestId, signal }) => {
      if (!params.credentials) return notSupported();
      const exactServerId = normalizeStringValue(serverId);
      const boundServerId = normalizeStringValue(params.serverId);
      if (!exactServerId || !boundServerId || exactServerId !== boundServerId) {
        return { ok: false, errorCode: 'session_not_found', error: 'session_not_found' };
      }
      const transport = await resolveTransportForSession(sessionId);
      if (!transport.ok) {
        return { ok: false, errorCode: transport.code, error: transport.code };
      }
      if (transport.rawSession.active === true) {
        return {
          ok: true,
          status: 'opened',
          sessionId: transport.sessionId,
          serverId: exactServerId,
          address: { serverId: exactServerId, sessionId: transport.sessionId },
        };
      }
      const localId = normalizeStringValue(actionRequestId) ?? `session.open:${transport.sessionId}`;
      const resumed = await resumeInactiveSessionTransport({
        transport,
        localId,
        ...(signal ? { signal } : {}),
      });
      return resumed.ok
        ? {
            ok: true,
            status: 'opened',
            sessionId: transport.sessionId,
            serverId: exactServerId,
            address: { serverId: exactServerId, sessionId: transport.sessionId },
          }
        : { ok: false, errorCode: resumed.code, error: resumed.message };
    },
    sessionFork: async ({
      sessionId,
      forkPoint,
      strategy,
      replaySummaryRunner,
      replayMaxSeedChars,
      requestId,
      signal,
    }) => {
      if (!params.credentials) return notSupported();
      const transport = await resolveTransportForSession(sessionId);
      if (!transport.ok) {
        return { ok: false, errorCode: transport.code, error: transport.code };
      }
      const metadata = readSessionMetadata({ ...transport, rawSession: transport.rawSession });
      const machineId = normalizeStringValue(transport.rawSession.machineId)
        ?? normalizeStringValue(metadata?.machineId);
      if (!machineId) {
        return { ok: false, errorCode: 'machine_not_found', error: 'machine_not_found' };
      }
      return await callMachineAction({
        machineId,
        method: RPC_METHODS.SESSION_FORK,
        request: {
          parentSessionId: transport.sessionId,
          forkPoint,
          ...(strategy ? { strategy } : {}),
          ...(replaySummaryRunner ? { replaySummaryRunner } : {}),
          ...(replayMaxSeedChars !== undefined ? { replayMaxSeedChars } : {}),
          ...(requestId ? { requestId } : {}),
        },
        ...(signal ? { signal } : {}),
      });
    },
    sessionContinueWithReplay: async (args) => {
      if (!params.credentials) return notSupported();
      const machineId = (await readCurrentMachineControlIdentity()).machineId;
      if (!machineId) {
        return { ok: false, errorCode: 'machine_not_found', error: 'machine_not_found' };
      }
      const { signal, ...request } = args;
      return await callMachineRpc({
        credentials: params.credentials,
        machineId,
        method: RPC_METHODS.SESSION_CONTINUE_WITH_REPLAY,
        request,
        ...(signal ? { signal } : {}),
      });
    },
    sessionRollback: async ({ sessionId, target, signal }) => await callResolvedSessionRpc(
      sessionId,
      SESSION_RPC_METHODS.SESSION_ROLLBACK,
      { sessionId, ...(target ? { target } : {}) },
      signal,
    ),
    checkpointCodeRollback: async ({ request, signal }) => await callResolvedSessionRpc(
      request.sessionId,
      SESSION_RPC_METHODS.SESSION_CHECKPOINT_CODE_ROLLBACK,
      request,
      signal,
    ),
    sessionCheckpoint: async ({ request, signal }) => await callResolvedSessionRpc(
      request.sessionId,
      SESSION_RPC_METHODS.SESSION_CHECKPOINT,
      request,
      signal,
    ),
    sessionRestore: async ({ request, signal }) => await callResolvedSessionRpc(
      request.sessionId,
      SESSION_RPC_METHODS.SESSION_RESTORE,
      request,
      signal,
    ),
    sessionHandoffTargetReplacementApprovalPreflight: async ({
      targetMachineId,
      targetPath,
      workspaceAction,
      serverId,
      operationId,
      signal,
    }) => {
      if (workspaceAction?.kind !== 'copy_once' && workspaceAction?.kind !== 'create_relationship') {
        return { type: 'not_required' as const };
      }
      if (!params.credentials || !targetPath?.trim() || !serverId?.trim() || !operationId.trim()) {
        return { type: 'error' as const, result: { ok: false, errorCode: 'invalid_input', error: 'invalid_input' } };
      }
      try {
        return HandoffTargetReplacementPreflightResultV1Schema.parse(await callMachineAction({
          machineId: targetMachineId,
          method: RPC_METHODS.DAEMON_WORKSPACE_SYNC_TARGET_REPLACEMENT_PREFLIGHT,
          request: {
            v: 1,
            serverId: serverId.trim(),
            machineId: targetMachineId,
            operationId: operationId.trim(),
            targetPath: targetPath.trim(),
            ...(workspaceAction.kind === 'create_relationship' && workspaceAction.mode === 'mirror_exactly'
              ? { activatesExactMirror: true }
              : {}),
          },
          ...(signal ? { signal } : {}),
        }));
      } catch (error) {
        const errorCode = readRpcErrorCode(error) ?? 'target_unavailable';
        return { type: 'error' as const, result: { ok: false, errorCode, error: errorCode } };
      }
    },
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
      if (!params.credentials) return notSupported();
      const transport = await resolveTransportForSession(sessionId);
      if (!transport.ok) {
        return { ok: false, errorCode: transport.code, error: transport.code };
      }
      // One owner for the handoff source facts, shared with the daemon's tracked
      // coordinator: machine custody and transcript-storage authority both come
      // from OWNER metadata, and an unresolved link refuses here rather than
      // being stamped as `persisted` on a request that stops the source.
      const source = resolveSessionHandoffSourceAuthority({
        credentials: params.credentials,
        rawSession: transport.rawSession,
        accountEncryptionMode: transport.accountEncryptionCurrentness.mode,
      });
      if (!source.ok) {
        return { ok: false, errorCode: source.errorCode, error: source.error };
      }
      const sourceMachineId = source.sourceMachineId;
      return await callMachineAction({
        machineId: sourceMachineId,
        method: RPC_METHODS.DAEMON_SESSION_HANDOFF_START_V3,
        request: {
          sessionId: transport.sessionId,
          sourceMachineId,
          targetMachineId,
          sessionStorageMode: source.sessionStorageMode,
          ...(targetPath ? { targetPath } : {}),
          ...(targetSessionStorageMode ? { targetSessionStorageMode } : {}),
          preferredTransportStrategies: ['direct_peer', 'server_routed_stream'],
          ...(workspaceAction ? { workspaceAction } : {}),
          ...(serverId ? { accountServerId: serverId } : {}),
          ...(actionRequestId ? { actionRequestId } : {}),
          ...(handoffTargetReplacementApproval ? { handoffTargetReplacementApproval } : {}),
          ...(handoffTargetReplacementApprovalReceiptId ? {
            handoffTargetReplacementApprovalReceiptId,
            handoffTargetReplacementApprovalActionInput,
          } : {}),
        },
        ...(signal ? { signal } : {}),
      });
    },
    sessionSpawnNewAgentPolicyPreflight: async ({ input, policy }) => {
      const requestedTarget = resolveSessionCreationAgentTarget(input.agentTarget);
      if (!requestedTarget) return { type: 'denied' as const, field: 'agentTarget' };
      const parentDirectory = await resolveCurrentSessionValue('path');
      const parentMachineId = await resolveCurrentSessionValue('machineId');
      let parentBackendTarget: BackendTargetRefV2 | null = null;
      try {
        parentBackendTarget = params.getCurrentSessionBackendTarget?.() ?? null;
      } catch {
        parentBackendTarget = null;
      }
      const deniedField = resolveParentSpawnPolicyDeniedField({
        policy,
        input,
        requestedBackendTarget: requestedTarget.backendTarget,
        parentDirectory,
        parentMachineId,
        parentBackendTarget,
      });
      return deniedField
        ? { type: 'denied' as const, field: deniedField }
        : { type: 'allowed' as const };
    },
    sessionSpawnNewDirectoryApprovalPreflight: async ({ input, signal }) => {
      if (!params.credentials) {
        return {
          type: 'error' as const,
          result: { type: 'error' as const, code: 'permission_denied' as const, retryable: false },
        };
      }
      if (signal?.aborted) {
        return {
          type: 'error' as const,
          result: { type: 'error' as const, code: 'cancelled' as const, retryable: true },
        };
      }
      if (!isCurrentSessionSpawnExecutionTarget(input.executionTarget)) {
        return {
          type: 'error' as const,
          result: { type: 'error' as const, code: 'target_unavailable' as const, retryable: false },
        };
      }
      if (input.checkoutCreationDraft) {
        // A worktree is materialized by the SCM owner, not by the raw
        // directory-creation authorization path.
        return { type: 'not_required' as const };
      }

      const preparation = await prepareSessionSpawnTarget({
        executionTarget: input.executionTarget,
        directory: input.directory,
        ...(signal ? { signal } : {}),
      });
      if (!preparation.ok) {
        return { type: 'error' as const, result: preparation.result };
      }
      if (!preparation.preparedTarget.directoryCreationRequired) {
        return { type: 'not_required' as const };
      }
      const approval: SessionCreationDirectoryApprovalV1 = {
        v: 1,
        executionTarget: input.executionTarget,
        directory: preparation.preparedTarget.directory,
      };
      return { type: 'approval_required' as const, approval };
    },
    sessionSpawnNew: async ({
      executionTarget,
      directory,
      initialAccess,
      primaryTeamId,
      teamCredentialBindings,
      organizationPlacement,
      placementOrigin,
      agentTarget,
      modelSelection,
      profileId,
      secretReferenceOverlay,
      permissionMode,
      agentModeId,
      configuration: configurationSnapshot,
      connectedServices,
      mcpSelection,
      transcriptStorage,
      terminal,
      checkoutCreationDraft,
      title,
      initialInput,
      agentSessionStartupInstructionsV1,
      sessionCreationTag,
      sourceContext,
      legacyMetadataLabel,
      actionCaller,
      callerSurface,
      actionRequestId,
      resumeActionRequest,
      sessionCreationDirectoryApproval,
      signal,
    }): Promise<SessionSpawnNewResultV1> => {
      if (!params.credentials) {
        return { type: 'error', code: 'permission_denied', retryable: false };
      }
      if (signal?.aborted) {
        return { type: 'error', code: 'cancelled', retryable: true };
      }
      if ((initialInput?.attachments?.length ?? 0) > 0 && actionCaller.kind !== 'plugin') {
        return { type: 'error', code: 'invalid_input', retryable: false };
      }

      if (!isCurrentSessionSpawnExecutionTarget(executionTarget)) {
        return { type: 'error', code: 'target_unavailable', retryable: false };
      }
      const normalizedActionRequestId = normalizeStringValue(actionRequestId);
      if (resumeActionRequest === true && !normalizedActionRequestId) {
        return { type: 'error', code: 'invalid_input', retryable: false };
      }
      const spawnNonce = normalizedActionRequestId
        ? createStableSpawnNonce('session.spawn_new.action', { actionRequestId: normalizedActionRequestId })
        : undefined;

      const directTargetTransport = params.sessionSpawnDirectTargetTransport;
      let placementOriginSupported = Boolean(directTargetTransport);
      let secretReferenceOverlaySupported = Boolean(directTargetTransport);
      if (
        directTargetTransport
        && directTargetTransport.machineId !== executionTarget.machineId
      ) {
        return { type: 'error', code: 'target_unavailable', retryable: false };
      }
      if (!directTargetTransport) {
        let targetCapabilityProjection: Awaited<ReturnType<typeof readMachineOperationProtocolCapabilitiesV1>>;
        try {
          targetCapabilityProjection = await readMachineOperationProtocolCapabilitiesV1({
            credentials: params.credentials,
            machineId: executionTarget.machineId,
            ...(signal ? { signal } : {}),
          });
        } catch (error) {
          const spawnMayHaveBeenAccepted = hasPossiblyAcceptedSpawnNonce(error);
          if (signal?.aborted) {
            if (spawnMayHaveBeenAccepted) {
              return {
                type: 'pending',
                retryWithSameCreationKey: true,
                outcome: 'unknown',
              };
            }
            return { type: 'error', code: 'cancelled', retryable: true };
          }
          if (isAuthenticationError(error)) {
            return { type: 'error', code: 'permission_denied', retryable: false };
          }
          return { type: 'error', code: 'machine_offline', retryable: true };
        }
        if (
          !targetCapabilityProjection
          || !supportsMachineOperationProtocolCapabilityV1(
            targetCapabilityProjection.capabilities,
            'sessionSpawn',
          )
        ) {
          if (initialAccess !== undefined || primaryTeamId !== undefined) {
            return {
              type: 'error', code: 'update_required', retryable: false,
              details: new SessionInitialAccessUpdateRequiredError('daemon').details,
            };
          }
          return { type: 'error', code: 'incompatible_target', retryable: false };
        }
        placementOriginSupported = supportsMachineOperationProtocolCapabilityV1(
          targetCapabilityProjection.capabilities,
          'sessionSpawnPlacementOrigin',
        );
        secretReferenceOverlaySupported = supportsMachineSessionSpawnProtocolVersionV1(
          targetCapabilityProjection.capabilities,
          2,
        );
      }
      if (secretReferenceOverlay && !secretReferenceOverlaySupported) {
        return {
          type: 'error',
          code: 'update_required',
          retryable: false,
          details: {
            kind: 'update_required',
            operation: 'session.spawn_new',
            component: 'daemon',
            reason: 'session_secret_reference_overlay_update_required',
          },
        };
      }

      const resolvedAgentTarget = resolveSessionCreationAgentTarget(agentTarget);
      if (!resolvedAgentTarget) {
        return { type: 'error', code: 'target_unavailable', retryable: false };
      }
      const { backendTarget } = resolvedAgentTarget;
      const connectedServicesDefaults = connectedServices === undefined
        ? await resolveSpawnConnectedServicesDefaultPayload({
            credentials: params.credentials,
            backendTarget,
            ...(params.resolveTeamCredentialResourceCatalog
              ? { resolveTeamCredentialResourceCatalog: params.resolveTeamCredentialResourceCatalog }
              : {}),
          })
        : null;
      if (signal?.aborted) {
        return { type: 'error', code: 'cancelled', retryable: true };
      }
      const resolvedConnectedServices = connectedServices
        ?? connectedServicesDefaults?.connectedServices;
      const resolvedConnectedServicesUpdatedAt = connectedServicesDefaults?.connectedServicesUpdatedAt;
      const normalizedPlacement =
        normalizeSessionCreationOrganizationPlacementV1(organizationPlacement);
      const normalizedTerminal = terminal === undefined
        ? undefined
        : SessionAuthoringTerminalV1Schema.safeParse(terminal);
      if (normalizedTerminal !== undefined && !normalizedTerminal.success) {
        return { type: 'error', code: 'invalid_input', retryable: false };
      }
      const spawnTerminal = normalizedTerminal === undefined
        ? undefined
        : SpawnSessionTerminalSchema.safeParse(normalizedTerminal.data);
      if (spawnTerminal !== undefined && !spawnTerminal.success) {
        return { type: 'error', code: 'invalid_input', retryable: false };
      }
      const windowsTerminal = normalizedTerminal?.data.windows;
      const normalizedConfigurationOverrides = configurationSnapshot
        ? buildAcpConfigOptionOverridesV1({
            updatedAt: Math.max(
              configurationSnapshot.mode.updatedAtMs,
              configurationSnapshot.model.updatedAtMs,
              configurationSnapshot.permissionIntent.updatedAtMs,
              ...Object.values(configurationSnapshot.options).map((entry) => entry.updatedAtMs),
            ),
            overrides: Object.fromEntries(
              Object.entries(configurationSnapshot.options).map(([key, entry]) => [
                key,
                { updatedAt: entry.updatedAtMs, value: entry.value },
              ]),
            ),
          })
        : undefined;
      const resolvedModelSelection = modelSelection
        ?? (configurationSnapshot?.model.value
          ? SessionModelSelectionV1Schema.parse({
              v: 1,
              updatedAt: configurationSnapshot.model.updatedAtMs,
              ref: {
                agentTargetKey: buildBackendTargetKeyV2(backendTarget),
                providerConnectionId: null,
                modelId: configurationSnapshot.model.value,
              },
            })
          : undefined);
      const requestedPermissionMode = permissionMode
        ?? configurationSnapshot?.permissionIntent.value
        ?? undefined;
      const resolvedPermissionMode = requestedPermissionMode
        ? parsePermissionIntentAlias(requestedPermissionMode)
        : undefined;
      if (requestedPermissionMode && !resolvedPermissionMode) {
        return { type: 'error', code: 'invalid_input', retryable: false };
      }
      const resolvedAgentModeId = agentModeId
        ?? configurationSnapshot?.mode.value
        ?? undefined;
      const startupInstructionsMarker = agentSessionStartupInstructionsV1
        ? {
            v: agentSessionStartupInstructionsV1.v,
            id: agentSessionStartupInstructionsV1.id,
            revision: agentSessionStartupInstructionsV1.revision,
          }
        : null;
      const targetPreparation = await prepareSessionSpawnTarget({
        executionTarget,
        directory,
        ...(checkoutCreationDraft !== undefined ? { checkoutCreationDraft } : {}),
        ...(signal ? { signal } : {}),
      });
      if (!targetPreparation.ok) return targetPreparation.result;
      const preparedTarget = targetPreparation.preparedTarget;
      const failBeforeSpawn = async (
        result: Extract<SessionSpawnNewResultV1, Readonly<{ type: 'error' }>>,
      ): Promise<SessionSpawnNewResultV1> => {
        await rollbackKnownCreatedSessionCheckout({
          executionTarget,
          checkout: preparedTarget.checkout,
        });
        return result;
      };
      if (signal?.aborted) {
        return await failBeforeSpawn({ type: 'error', code: 'cancelled', retryable: true });
      }
      const directoryApproval = SessionCreationDirectoryApprovalV1Schema.safeParse(
        sessionCreationDirectoryApproval,
      );
      if (
        preparedTarget.directoryCreationRequired
        && (
          !directoryApproval.success
          || directoryApproval.data.executionTarget.serverId !== executionTarget.serverId
          || directoryApproval.data.executionTarget.machineId !== executionTarget.machineId
          || directoryApproval.data.directory !== preparedTarget.directory
        )
      ) {
        return await failBeforeSpawn({ type: 'error', code: 'permission_denied', retryable: false });
      }
      const normalizedDirectory = preparedTarget.directory;
      const immutableCheckout = preparedTarget.checkout
        ? {
            kind: preparedTarget.checkout.kind,
            finalDirectory: preparedTarget.checkout.finalDirectory,
            baseRef: preparedTarget.checkout.baseRef,
            branchMode: preparedTarget.checkout.branchMode,
          }
        : null;
      const correspondence = SessionCreationCorrespondenceV1Schema.parse({
        v: 1,
        sessionCreationTag,
        recipe: {
          execution: {
            machineId: executionTarget.machineId,
            directory: normalizedDirectory,
          },
          organization: normalizedPlacement,
          agentTarget,
          modelSelection: resolvedModelSelection ?? null,
          profileId: profileId ?? null,
          ...(secretReferenceOverlay ? { secretReferenceOverlay } : {}),
          requestedPermissionMode: resolvedPermissionMode ?? null,
          agentModeId: resolvedAgentModeId ?? null,
          configuration: configurationSnapshot ?? null,
          connectedServices: resolvedConnectedServices ?? null,
          mcpSelection: mcpSelection ?? null,
          transcriptStorage: transcriptStorage ?? null,
          terminal: normalizedTerminal?.data ?? null,
          agentSessionStartupInstructionsMarkerV1: startupInstructionsMarker,
          checkout: immutableCheckout,
        },
      });
      // A source recipe is required semantics, not a hint: it is resolved to an
      // exact cutoff before any Session row exists, and a failure creates no
      // child so the authoring draft and its chip stay intact.
      let replaySeededCreation: ReplaySeededSessionCreationV1 | undefined;
      if (sourceContext && resumeActionRequest !== true) {
        let sourceAuthority: Awaited<ReturnType<typeof resolveReplaySourceContextAuthority>>;
        try {
          sourceAuthority = await resolveReplaySourceContextAuthority({
            credentials: params.credentials,
            sourceSessionId: sourceContext.sourceSessionId,
          });
        } catch (error) {
          return await failBeforeSpawn(isAuthenticationError(error)
            ? { type: 'error', code: 'permission_denied', retryable: false }
            : { type: 'error', code: 'spawn_failed', retryable: true });
        }
        if (sourceAuthority.status !== 'owned') {
          return await failBeforeSpawn(sourceAuthority.status === 'not_owned'
            ? { type: 'error', code: 'permission_denied', retryable: false }
            : { type: 'error', code: 'spawn_failed', retryable: true });
        }
        const recipeResult = await buildReplaySeededSpawnRecipe({
          credentials: params.credentials,
          cwd: normalizedDirectory,
          source: {
            sourceSessionId: sourceContext.sourceSessionId,
            forkPoint: sourceContext.forkPoint,
          },
          agentHintAgentId: resolvedAgentTarget.agentId,
          // Source-local media survives only when the source and selected child
          // target are proven to be the same exact machine and this process is
          // directly preparing that target. A replacement relation or a direct
          // transport alone does not make an old workspace path usable.
          mediaContinuityUsableOnCreatingMachine:
            Boolean(directTargetTransport)
            && sourceAuthority.sourceMachineId === executionTarget.machineId,
        });
        if (!recipeResult.ok) {
          // The two recipe failures — an unhydratable source and an empty seed —
          // are not distinguishable at this owner, and neither created a child.
          // Report the retryable form so a transient source read does not strand
          // an otherwise valid authoring attempt.
          return await failBeforeSpawn({ type: 'error', code: 'spawn_failed', retryable: true });
        }
        replaySeededCreation = {
          tag: sessionCreationTag,
          flavor: resolvedAgentTarget.agentId,
          metadata: {
            ...recipeResult.recipe.metadata,
            sessionCreationCorrespondenceV1: correspondence,
          },
          sourceRecipe: {
            sourceSessionId: sourceContext.sourceSessionId,
            cutoffSeqInclusive: recipeResult.recipe.cutoffSeqInclusive,
          },
        };
      }
      try {
        const created = await createSpawnedSession({
          credentials: params.credentials,
          directory: normalizedDirectory,
          ...(initialAccess !== undefined ? { initialAccess } : {}),
          ...(primaryTeamId !== undefined ? { primaryTeamId } : {}),
          ...(teamCredentialBindings !== undefined ? { teamCredentialBindings } : {}),
          machineId: executionTarget.machineId,
          backendTarget,
          sessionCreationTag,
          ...(replaySeededCreation ? { replaySeededCreation } : {}),
          ...(sourceContext ? { sourceContext } : {}),
          approvedNewDirectoryCreation: preparedTarget.directoryCreationRequired,
          ...(legacyMetadataLabel ? { legacyMetadataLabel } : {}),
          sessionCreationCorrespondence: correspondence,
          organizationPlacement: normalizedPlacement,
          ...(placementOrigin && placementOriginSupported ? { placementOrigin } : {}),
          ...(resolvedModelSelection ? { modelSelection: resolvedModelSelection } : {}),
          ...(profileId ? { profileId } : {}),
          ...(secretReferenceOverlay ? { secretReferenceOverlay } : {}),
          ...(resolvedPermissionMode ? { permissionMode: resolvedPermissionMode } : {}),
          ...(resolvedAgentModeId ? { agentModeId: resolvedAgentModeId } : {}),
          ...(normalizedConfigurationOverrides
            ? { sessionConfigOptionOverrides: normalizedConfigurationOverrides }
            : {}),
          ...(resolvedConnectedServices ? { connectedServices: resolvedConnectedServices } : {}),
          ...(resolvedConnectedServicesUpdatedAt !== undefined
            ? { connectedServicesUpdatedAt: resolvedConnectedServicesUpdatedAt }
            : {}),
          ...(mcpSelection ? { mcpSelection } : {}),
          ...(transcriptStorage ? { transcriptStorage } : {}),
          ...(spawnTerminal?.data ? { terminal: spawnTerminal.data } : {}),
          ...(windowsTerminal?.launchMode
            ? { windowsRemoteSessionLaunchMode: windowsTerminal.launchMode }
            : {}),
          ...(windowsTerminal?.console
            ? { windowsRemoteSessionConsole: windowsTerminal.console }
            : {}),
          ...(windowsTerminal?.windowName
            ? { windowsTerminalWindowName: windowsTerminal.windowName }
            : {}),
          ...(configurationSnapshot?.providerSessionResume
            ? { resume: configurationSnapshot.providerSessionResume.providerSessionId }
            : {}),
          ...(title ? { initialTitle: title } : {}),
          ...(initialInput ? { initialInput } : {}),
          ...(initialInput
            ? {
                buildInitialInputHandoff: (localId: string) => {
                  const admission = buildSessionSpawnInitialInputAdmissionForLocalIdV1({
                    actionCaller,
                    callerSurface,
                    localId,
                  });
                  const attachments = initialInput.attachments ?? [];
                  if (attachments.length === 0 || actionCaller.kind !== 'plugin') {
                    return admission;
                  }
                  return {
                    ...admission,
                    meta: {
                      [HAPPIER_STRUCTURED_INPUT_METADATA_KEY_V1]: {
                        v: 1,
                        composerAttachments: buildPluginSessionInputAttachmentDraftsV1({
                          pluginId: actionCaller.pluginId,
                          messageLocalId: localId,
                          authored: attachments,
                        }),
                      },
                    },
                  };
                },
              }
            : {}),
          ...(params.machineAdmissionTransport
            ? { machineAdmissionTransport: params.machineAdmissionTransport }
            : {}),
          ...(directTargetTransport
            ? { directTransport: directTargetTransport.spawnedSession }
            : {}),
          ...(params.machineActionDirectTargetTransport?.machineId === executionTarget.machineId
            ? {
                machineActionTransport: params.machineActionDirectTargetTransport.invoke,
              }
            : {}),
          ...(agentSessionStartupInstructionsV1
            ? { agentSessionStartupInstructionsV1 }
            : {}),
          ...(spawnNonce ? { spawnNonce } : {}),
          ...(resumeActionRequest === true ? { resumeOnly: true } : {}),
          ...(signal ? { signal } : {}),
        });
        return {
          type: 'success',
          disposition: created.disposition,
          sessionId: created.sessionId,
          executionTarget,
          organizationPlacement: created.organizationPlacement,
          initialInput: created.initialInput,
        };
      } catch (error) {
        const initialAccessFailure = projectSessionInitialAccessEnvelopeHostErrorResult(error);
        if (initialAccessFailure) return initialAccessFailure;
        const code = error && typeof error === 'object'
          && typeof (error as { code?: unknown }).code === 'string'
          ? (error as { code: string }).code
          : '';
        if (isAuthenticationError(error)) {
          return { type: 'error', code: 'permission_denied', retryable: false };
        }
        if (hasSessionCreationOrganizationInvalidDetail(error)) {
          return { type: 'error', code: 'organization_invalid', retryable: false };
        }
        if (code === SPAWN_SESSION_ERROR_CODES.INVALID_REQUEST) {
          return { type: 'error', code: 'invalid_input', retryable: false };
        }
        if (code === 'creation_conflict' || hasSessionCreationCorrespondenceConflictDetail(error)) {
          return { type: 'error', code: 'creation_conflict', retryable: false };
        }
        if (
          code === SPAWN_SESSION_ERROR_CODES.SESSION_WEBHOOK_TIMEOUT
          || code === 'MACHINE_RPC_TIMEOUT'
        ) {
          return {
            type: 'pending',
            retryWithSameCreationKey: true,
            outcome: 'unknown',
          };
        }
        if (signal?.aborted) {
          return { type: 'error', code: 'cancelled', retryable: true };
        }
        if (code === SPAWN_SESSION_ERROR_CODES.DAEMON_RPC_UNAVAILABLE) {
          return { type: 'error', code: 'incompatible_target', retryable: false };
        }
        const details = readRecord(readRecord(error).details);
        for (const candidate of [details, details.errorDetail, readRecord(details.spawnResponse).errorDetail]) {
          const detail = normalizeSpawnSessionErrorDetail(candidate);
          if (detail?.kind === 'update_required') {
            return { type: 'error', code: 'update_required', retryable: false, details: detail };
          }
          if (detail?.kind === SPAWN_SESSION_ERROR_DETAIL_KINDS.PROVIDER_ERROR) {
            return {
              type: 'error', code: 'spawn_failed',
              retryable: detail.providerError.retryable,
              providerError: detail.providerError,
            };
          }
        }
        return { type: 'error', code: 'spawn_failed', retryable: true };
      }
    },
    ...(approvalsStore ?? {}),
    ...inventoryDeps,
    sessionSendMessage: async ({
      context,
      sessionId,
      message,
      recipient,
      displayText,
      messageMeta,
      requestedAction,
      actionCaller,
      idempotencyKey,
      localId,
      source,
      attachments,
      wait,
      timeoutSeconds,
      permissionModeOverride,
      modelOverride,
      providerConnectionId,
      sessionInputSource,
      callerSurface,
      signal,
    }) => {
      const pluginCaller = actionCaller?.kind === 'plugin' ? actionCaller : null;
      if (pluginCaller && typeof permissionModeOverride === 'string' && permissionModeOverride.trim().length > 0) {
        return {
          status: 'rejected' as const,
          code: 'session_input_invalid' as const,
        };
      }
      if (!params.credentials) {
        return pluginCaller
          ? { status: 'rejected' as const, code: 'session_input_unauthorized' as const }
          : { ok: false, errorCode: 'not_authenticated', error: 'not_authenticated' };
      }

      const normalizedWait = typeof wait === 'boolean' ? wait : false;
      const normalizedTimeoutSeconds =
        typeof timeoutSeconds === 'number' && Number.isFinite(timeoutSeconds) && timeoutSeconds > 0
          ? Math.min(3600, timeoutSeconds)
          : 300;
      const normalizedPermissionModeOverride = typeof permissionModeOverride === 'string' && permissionModeOverride.trim().length > 0
        ? permissionModeOverride.trim()
        : undefined;
      const normalizedProviderConnectionId = providerConnectionId === null
        ? null
        : providerConnectionId === undefined
          ? undefined
          : ProviderConnectionIdSchema.parse(providerConnectionId);
      const normalizedModelOverride = modelOverride === null
        ? null
        : typeof modelOverride === 'string' && modelOverride.trim().length > 0
          ? modelOverride.trim()
          : undefined;
      if (normalizedProviderConnectionId !== undefined
        && normalizedProviderConnectionId !== null
        && (normalizedModelOverride === undefined || normalizedModelOverride === null)) {
        return { ok: false, errorCode: 'invalid_parameters', error: 'invalid_parameters' };
      }
      const modelSelectionInput = normalizedModelOverride === undefined
        ? undefined
        : {
            ...(normalizedProviderConnectionId !== undefined
              ? { providerConnectionId: normalizedProviderConnectionId }
              : {}),
            modelId: normalizedModelOverride,
          };

      const externalActionRequest = context?.externalActionCredential !== undefined
        || context?.externalActionExecutionAuthorization !== undefined;
      const resolveAuthorizationHeaders = externalActionRequest
        ? (request: Readonly<{ method: string; path: string; body?: unknown }>) =>
            resolveServerRequestHeaders(context, 'session.message.send', request)
        : undefined;
      if (resolveAuthorizationHeaders && !resolveAuthorizationHeaders({
          method: 'GET',
          path: '/v1/account/encryption/currentness',
        })) {
        return {
          status: 'rejected' as const,
          code: 'session_input_unauthorized' as const,
        };
      }

      if (
        pluginCaller
        && (
          typeof pluginCaller.contributionLocalId !== 'string'
          || typeof idempotencyKey !== 'string'
        )
      ) {
        return {
          status: 'rejected' as const,
          code: 'session_input_untrusted_assertion' as const,
        };
      }
      const pluginLocalId = pluginCaller
        ? derivePluginSessionInputLocalIdV1({
            caller: pluginCaller,
            sessionId,
            idempotencyKey: idempotencyKey!,
          })
        : undefined;
      const pluginInputAdmission = pluginCaller
        ? buildPluginSessionInputAdmissionV1({
            caller: pluginCaller,
            surface: callerSurface,
            ...(source ? { source } : {}),
          })
        : undefined;
      const causalSessionInputAdmission = sessionInputSource
        ? buildCausalSessionInputAdmissionV1(sessionInputSource)
        : undefined;

      const authoredMessageText = String(message ?? '');

      // Declared attachments reach the canonical structured-input admission
      // owner before the Session writer, exactly as a Composer-authored draft
      // does. A retry first consults the durable Pending/transcript owner: the
      // plugin preparation callback is not an idempotent boundary and must not
      // run again after an outcome-unknown write.
      let admittedAttachmentMeta: Record<string, unknown> | undefined;
      let admittedComposerAttachments: readonly ComposerAttachmentInputV1[] = [];
      let admittedMessageText = authoredMessageText;
      let rejoinedMessageMeta: Record<string, unknown> | undefined;
      const composerAttachmentRegistry = params.resolveComposerAttachmentSendPreparation?.() ?? null;
      if (attachments && attachments.length > 0) {
        if (!pluginCaller || !pluginLocalId) {
          return {
            status: 'rejected' as const,
            code: 'session_input_untrusted_assertion' as const,
          };
        }
        const transport = await resolveTransportForSession(sessionId);
        if (!transport.ok) {
          return {
            status: 'rejected' as const,
            code: 'session_input_target_unavailable' as const,
          };
        }
        const rawAttachmentMeta = {
          [HAPPIER_STRUCTURED_INPUT_METADATA_KEY_V1]: {
            v: 1 as const,
            composerAttachments: buildPluginSessionInputAttachmentDraftsV1({
              pluginId: pluginCaller.pluginId,
              messageLocalId: pluginLocalId,
              authored: attachments,
            }),
          },
        };
        let persisted: Awaited<ReturnType<typeof findPersistedSessionUserMessageAdmission>>;
        try {
          persisted = await findPersistedSessionUserMessageAdmission({
            token: params.credentials.token,
            sessionId: transport.sessionId,
            localId: pluginLocalId,
            queryContext: transport.mode === 'plain'
              ? { encryptionMode: 'plain' }
              : {
                  encryptionMode: 'e2ee',
                  encryptionKey: transport.ctx.encryptionKey,
                  encryptionVariant: transport.ctx.encryptionVariant,
                },
          });
        } catch {
          return {
            status: 'outcomeUnknown' as const,
            localId: pluginLocalId,
            code: 'session_input_rejoin_unavailable',
          };
        }
        if (persisted) {
          try {
            validateComposerAttachmentRejoinCorrespondenceV1({
              meta: rawAttachmentMeta,
              preparedComposerAttachments: persisted.composerAttachments,
            });
          } catch {
            return {
              status: 'rejected' as const,
              code: 'session_input_idempotency_conflict' as const,
            };
          }
          admittedMessageText = persisted.text;
          rejoinedMessageMeta = persisted.meta;
          admittedComposerAttachments = persisted.composerAttachments;
        } else {
          const attachmentAdmission = await admitPluginSessionInputAttachmentsV1({
            attachments: composerAttachmentRegistry,
            pluginId: pluginCaller.pluginId,
            sessionId: transport.sessionId,
            messageLocalId: pluginLocalId,
            text: authoredMessageText,
            authored: attachments,
            ...(signal ? { signal } : {}),
          });
          if (attachmentAdmission.status === 'rejected') {
            return { status: 'rejected' as const, code: attachmentAdmission.code };
          }
          admittedAttachmentMeta = attachmentAdmission.meta;
          admittedComposerAttachments = attachmentAdmission.attachments;
        }
      }

      const dispatchMessageHook = async (canonicalSessionId: string, source: 'plugin' | 'user') => {
        try {
          await dispatchSessionLifecycleHookEvent({
            eventId: 'session.message.send',
            happySessionId: canonicalSessionId,
            payload: {
              sessionId: canonicalSessionId,
              text: admittedMessageText,
              source,
            },
          });
        } catch {
          // Hook dispatch is best-effort so a misbehaving plugin cannot break message send.
        }
      };

      const protectedInputAdmission = pluginInputAdmission ?? causalSessionInputAdmission;
      if (protectedInputAdmission) {
        const protectedResult = await sendSessionMessage({
          credentials: params.credentials,
          idOrPrefix: sessionId,
          message: admittedMessageText,
          ...(recipient ? { recipient } : {}),
          requestedAction,
          wait: normalizedWait,
          timeoutMs: normalizedTimeoutSeconds * 1000,
          ...(pluginLocalId
            ? { localId: pluginLocalId }
            : typeof localId === 'string' && localId.trim().length > 0
              ? { localId }
              : {}),
          inputAdmission: protectedInputAdmission,
          ...(rejoinedMessageMeta
            ? { messageMeta: rejoinedMessageMeta }
            : (admittedAttachmentMeta || messageMeta || displayText)
            ? {
                messageMeta: {
                  ...(messageMeta ?? {}),
                  ...(admittedAttachmentMeta ?? {}),
                  ...(displayText ? { displayText } : {}),
                },
              }
            : {}),
          ...(params.machineAdmissionTransport
            ? { machineAdmissionTransport: params.machineAdmissionTransport }
            : {}),
          ...(resolveAuthorizationHeaders ? { resolveAuthorizationHeaders } : {}),
          ...(params.machineActionDirectTargetTransport
            ? { machineResumeTransport: params.machineActionDirectTargetTransport.invoke }
            : {}),
          ...(modelSelectionInput ? { modelSelectionInput } : {}),
          ...(signal ? { signal } : {}),
        });
        const admissionResult = projectSessionMessageSendActionResult(protectedResult);
        if (!admissionResult) {
          return { status: 'rejected' as const, code: 'session_input_target_unavailable' as const };
        }
        if (!protectedResult.ok) return admissionResult;
        const canonicalSessionId = typeof protectedResult.sessionId === 'string'
          && protectedResult.sessionId.trim().length > 0
          ? protectedResult.sessionId
          : sessionId;
        if (
          composerAttachmentRegistry
          && (admissionResult.status === 'accepted' || admissionResult.status === 'alreadyAccepted')
        ) {
          notifyComposerAttachmentsAfterMessageAccepted({
            sessionId: canonicalSessionId,
            localId: admissionResult.localId,
            attachments: admittedComposerAttachments,
            notify: ({ attachment, event, signal: notificationSignal }) => (
              composerAttachmentRegistry.afterMessageAccepted({
                attachment,
                event,
                signal: notificationSignal,
              })
            ),
            signal: signal ?? new AbortController().signal,
          });
        }
        await dispatchMessageHook(canonicalSessionId, pluginCaller ? 'plugin' : 'user');
        return admissionResult;
      }

      const executionRunLocalId = recipient?.kind === 'execution_run'
        ? (typeof localId === 'string' && localId.trim().length > 0 ? localId : randomUUID())
        : undefined;
      const result = await sendSessionMessage({
        credentials: params.credentials,
        idOrPrefix: sessionId,
        message: String(message ?? ''),
        ...(recipient ? { recipient } : {}),
        ...(messageMeta || displayText ? {
          messageMeta: { ...(messageMeta ?? {}), ...(displayText ? { displayText } : {}) },
        } : {}),
        requestedAction,
        wait: normalizedWait,
        timeoutMs: normalizedTimeoutSeconds * 1000,
        // A caller-retained localId makes an ambiguous send retryable: the
        // durable pending queue is keyed by it, so resubmitting rejoins the
        // existing input instead of enqueuing a second message.
        ...(executionRunLocalId
          ? { localId: executionRunLocalId }
          : typeof localId === 'string' && localId.trim().length > 0
            ? { localId }
            : {}),
        ...(normalizedPermissionModeOverride ? { permissionModeOverride: normalizedPermissionModeOverride } : {}),
        ...(modelSelectionInput ? { modelSelectionInput } : {}),
        ...(resolveAuthorizationHeaders ? { resolveAuthorizationHeaders } : {}),
        ...(params.machineActionDirectTargetTransport
          ? { machineResumeTransport: params.machineActionDirectTargetTransport.invoke }
          : {}),
        ...(signal ? { signal } : {}),
      });
      const admissionResult = projectSessionMessageSendActionResult(result);
      if (!result.ok) {
        if (admissionResult) return admissionResult;
        return {
          ok: false,
          errorCode: result.code,
          error: result.code,
          ...(result.candidates ? { candidates: result.candidates } : {}),
          ...(result.message ? { message: result.message } : {}),
          ...(result.providerError ? { details: result.providerError } : {}),
        };
      }
      const canonicalSessionId = typeof result.sessionId === 'string' && result.sessionId.trim().length > 0
        ? result.sessionId
        : sessionId;
      await dispatchMessageHook(canonicalSessionId, 'user');
      // A successful send always projects an accepted admission from its
      // resolved local id, even for the legacy unprotected writer response.
      if (!admissionResult) throw new Error('Successful Session send is missing its admission projection');
      return admissionResult;
    },

    sessionStop: async ({ sessionId }) => {
      if (!params.credentials) {
        return { ok: false, errorCode: 'not_authenticated', error: 'not_authenticated' };
      }
      return await requestSessionStop({ credentials: params.credentials, idOrPrefix: sessionId });
    },

    sessionTitleSet: async ({ context, sessionId, title }) => {
      if (!params.credentials) {
        return { ok: false, errorCode: 'not_authenticated', error: 'not_authenticated' };
      }
      const normalizedTitle = String(title ?? '').trim();
      if (!normalizedTitle) {
        return { ok: false, errorCode: 'invalid_parameters', error: 'invalid_parameters' };
      }
      const resolveAuthorizationHeaders = (request: Readonly<{
        method: 'GET' | 'POST' | 'PATCH'; path: string; body?: unknown;
      }>) => resolveServerRequestHeaders(context, 'session.title.set', request);
      if (!resolveAuthorizationHeaders({
        method: 'GET', path: '/v1/account/encryption/currentness',
      })) {
        return { ok: false, errorCode: 'not_authenticated', error: 'not_authenticated' };
      }
      const res = await setSessionTitle({
        credentials: params.credentials,
        idOrPrefix: sessionId,
        title: normalizedTitle,
        resolveAuthorizationHeaders,
      });
      if (!res.ok) {
        return { ok: false, errorCode: res.code, error: res.code, ...(res.candidates ? { candidates: res.candidates } : {}) };
      }
      return { ok: true, sessionId: res.sessionId, title: normalizedTitle };
    },

    sessionPermissionModeSet: async ({ sessionId, permissionMode }) => {
      if (!params.credentials) {
        return { ok: false, errorCode: 'not_authenticated', error: 'not_authenticated' };
      }
      const parsed = parsePermissionIntentAlias(String(permissionMode ?? '').trim());
      if (!parsed) {
        return { ok: false, errorCode: 'invalid_parameters', error: 'invalid_parameters' };
      }
      const updatedAt = Date.now();
      const res = await setSessionPermissionMode({
        credentials: params.credentials,
        idOrPrefix: sessionId,
        permissionMode: parsed as PermissionIntent,
        updatedAt,
      });
      if (!res.ok) {
        return { ok: false, errorCode: res.code, error: res.code, ...(res.candidates ? { candidates: res.candidates } : {}) };
      }
      return { ok: true, sessionId: res.sessionId, permissionMode: parsed, updatedAt };
    },

    sessionModelSet: async ({ sessionId, modelId, providerConnectionId, teamCredentialModel, teamVisibilityGrantConsent }) => {
      if (!params.credentials) {
        return { ok: false, errorCode: 'not_authenticated', error: 'not_authenticated' };
      }
      const normalizedModelId = String(modelId ?? '').trim();
      if (!normalizedModelId && teamCredentialModel === undefined) {
        return { ok: false, errorCode: 'invalid_parameters', error: 'invalid_parameters' };
      }
      const res = await setSessionModel({
        credentials: params.credentials,
        idOrPrefix: sessionId,
        ...(normalizedModelId ? { modelId: normalizedModelId } : {}),
        ...(providerConnectionId !== undefined ? { providerConnectionId } : {}),
        ...(teamCredentialModel !== undefined ? { teamCredentialModel } : {}),
        ...(teamVisibilityGrantConsent !== undefined ? { teamVisibilityGrantConsent } : {}),
      });
      if (!res.ok) {
        const errorCode = 'code' in res ? res.code : res.status;
        return {
          ok: false,
          errorCode,
          error: errorCode,
          ...('candidates' in res && res.candidates ? { candidates: res.candidates } : {}),
          ...('status' in res
            ? {
                details: {
                  status: res.status,
                  activeSelection: 'activeSelection' in res ? res.activeSelection : undefined,
                  requestedSelection: 'requestedSelection' in res ? res.requestedSelection : undefined,
                  requestedTeamSelection: 'requestedTeamSelection' in res ? res.requestedTeamSelection : undefined,
                  ...('reason' in res && res.reason ? { reason: res.reason } : {}),
                },
              }
            : {}),
        };
      }
      if (res.status === 'intent_updated') {
        return {
          ok: true,
          status: res.status,
          sessionId: res.sessionId,
          modelId: 'ref' in res.selection ? res.selection.ref.modelId : res.selection.modelId,
          selection: res.selection,
          updatedAt: res.updatedAt,
        };
      }
      return {
        ...res,
        modelId: res.activeSelection.modelId,
      };
    },

    sessionArchiveSet: async ({ sessionId, archived }) => {
      if (!params.credentials) {
        return { ok: false, errorCode: 'not_authenticated', error: 'not_authenticated' };
      }
      return await setSessionArchivedState({ credentials: params.credentials, idOrPrefix: sessionId, archived: archived === true });
    },

    sessionStatusGet: async ({ sessionId, live }) => {
      if (!params.credentials) {
        return { ok: false, errorCode: 'not_authenticated', error: 'not_authenticated' };
      }
      return await getSessionStatus({ credentials: params.credentials, idOrPrefix: sessionId, live: live === true });
    },

    sessionWorkStateGet: async ({ sessionId }) => {
      return await callResolvedSessionRpc(sessionId, SESSION_RPC_METHODS.SESSION_WORK_STATE_GET, {});
    },

    sessionTerminalComposerClear: async ({ sessionId, expectedStateAtMs }) => {
      return await callResolvedSessionRpc(sessionId, SESSION_RPC_METHODS.SESSION_TERMINAL_COMPOSER_CLEAR, {
        sessionId,
        ...(typeof expectedStateAtMs === 'number' ? { expectedStateAtMs } : {}),
      });
    },

    sessionPendingInputInterruptAndRun: async ({ sessionId, localId, expectedStateAtMs }) => {
      return await callResolvedSessionRpc(sessionId, SESSION_RPC_METHODS.SESSION_PENDING_INPUT_INTERRUPT_AND_RUN, {
        sessionId,
        localId,
        ...(typeof expectedStateAtMs === 'number' ? { expectedStateAtMs } : {}),
      });
    },

    sessionGoalGet: async ({ sessionId }) => {
      return await callRoutedSessionGoalControl(sessionId, 'get', {});
    },

    sessionGoalSet: async ({ sessionId, objective, status, tokenBudget }) => {
      return await callRoutedSessionGoalControl(sessionId, 'set', {
        ...(typeof objective === 'string' ? { objective } : {}),
        ...(typeof status === 'string' && status.trim().length > 0 ? { status: status.trim() } : {}),
        ...(typeof tokenBudget !== 'undefined' ? { tokenBudget: tokenBudget ?? null } : {}),
      });
    },

    sessionGoalClear: async ({ sessionId }) => {
      return await callRoutedSessionGoalControl(sessionId, 'clear', {});
    },

    sessionUsageLimitWaitResumeEnable: async ({ sessionId, issueFingerprint, remember, resumePromptMode }) => {
      if (!await isUsageLimitRecoveryEnabled()) {
        return normalizeUsageLimitRecoveryOperationResult(usageLimitRecoveryDisabledResult(), { sessionId });
      }
      const normalizedResumePromptMode = readResumePromptMode(resumePromptMode);
      const request = {
        sessionId,
        ...(typeof issueFingerprint === 'string' ? { issueFingerprint } : {}),
        ...(remember === true ? { rememberPreference: true } : {}),
        ...(normalizedResumePromptMode ? { resumePromptMode: normalizedResumePromptMode } : {}),
      };
      return await callRoutedUsageLimitRecoveryControl(sessionId, 'enable', request);
    },

    sessionUsageLimitWaitResumeCancel: async ({ sessionId, issueFingerprint, armedAtMs, runtimeAuthRecoveryAttemptId }) => {
      if (!await isUsageLimitRecoveryEnabled()) {
        return normalizeUsageLimitRecoveryOperationResult(usageLimitRecoveryDisabledResult(), { sessionId });
      }
      const request = {
        sessionId,
        ...(issueFingerprint !== undefined ? { issueFingerprint } : {}),
        ...(typeof armedAtMs === 'number' && Number.isFinite(armedAtMs)
          ? { armedAtMs: Math.trunc(armedAtMs) }
          : {}),
        ...(typeof runtimeAuthRecoveryAttemptId === 'string' && runtimeAuthRecoveryAttemptId.trim().length > 0
          ? { runtimeAuthRecoveryAttemptId: runtimeAuthRecoveryAttemptId.trim() }
          : {}),
      };
      return await callRoutedUsageLimitRecoveryControl(sessionId, 'cancel', request);
    },

    sessionUsageLimitCheckNow: async ({ sessionId, agentId, resumePromptMode }) => {
      if (!await isUsageLimitRecoveryEnabled()) {
        return normalizeUsageLimitRecoveryOperationResult(usageLimitRecoveryDisabledResult(), { sessionId });
      }
      const normalizedAgentId = typeof agentId === 'string' ? agentId.trim() : '';
      const normalizedResumePromptMode = readResumePromptMode(resumePromptMode);
      return await callRoutedUsageLimitRecoveryControl(sessionId, 'checkNow', {
        sessionId,
        ...(normalizedAgentId.length > 0 ? { agentId: normalizedAgentId } : {}),
        ...(normalizedResumePromptMode ? { resumePromptMode: normalizedResumePromptMode } : {}),
      });
    },

    sessionUsageLimitSwitchAccountNow: async ({ sessionId, agentId, resumePromptMode }) => {
      if (!await isUsageLimitRecoveryEnabled()) {
        return normalizeUsageLimitRecoveryOperationResult(usageLimitRecoveryDisabledResult(), { sessionId });
      }
      const normalizedAgentId = typeof agentId === 'string' ? agentId.trim() : '';
      const normalizedResumePromptMode = readResumePromptMode(resumePromptMode);
      return await callRoutedUsageLimitRecoveryControl(sessionId, 'switchAccountNow', {
        sessionId,
        operation: 'switch_account_now',
        ...(normalizedAgentId.length > 0 ? { agentId: normalizedAgentId } : {}),
        ...(normalizedResumePromptMode ? { resumePromptMode: normalizedResumePromptMode } : {}),
      });
    },

    sessionUsageLimitConsumeResetCredit: async ({ sessionId, agentId, issueFingerprint, resumePromptMode }) => {
      if (!await isUsageLimitRecoveryEnabled()) {
        return normalizeUsageLimitRecoveryOperationResult(usageLimitRecoveryDisabledResult(), { sessionId });
      }
      const normalizedAgentId = typeof agentId === 'string' ? agentId.trim() : '';
      const normalizedIssueFingerprint = typeof issueFingerprint === 'string' ? issueFingerprint.trim() : '';
      const normalizedResumePromptMode = readResumePromptMode(resumePromptMode);
      return await callRoutedUsageLimitRecoveryControl(sessionId, 'consumeResetCredit', {
        sessionId,
        operation: 'consume_reset_credit',
        ...(normalizedAgentId.length > 0 ? { agentId: normalizedAgentId } : {}),
        ...(normalizedIssueFingerprint.length > 0 ? { issueFingerprint: normalizedIssueFingerprint } : {}),
        ...(normalizedResumePromptMode ? { resumePromptMode: normalizedResumePromptMode } : {}),
      });
    },

    sessionVendorPluginCatalogList: async ({ sessionId, cwd }) => {
      return await callRoutedSessionCatalogControl(sessionId, 'vendorPlugins', { cwd });
    },

    sessionSkillCatalogList: async ({ sessionId, cwd }) => {
      return await callRoutedSessionCatalogControl(sessionId, 'skills', { cwd });
    },

    sessionHistoryGet: async ({ sessionId, limit, format, includeMeta, includeStructuredPayload }) => {
	      if (!params.credentials) {
	        return { ok: false, errorCode: 'not_authenticated', error: 'not_authenticated' };
	      }
	      const normalizedLimit =
	        typeof limit === 'number' && Number.isFinite(limit) && limit > 0
	          ? Math.min(1000, Math.floor(limit))
	          : 50;
	      const normalizedFormat = format === 'raw' || format === 'compact' ? format : 'compact';
	      return await getSessionEvents({
	        credentials: params.credentials,
	        idOrPrefix: sessionId,
	        limit: normalizedLimit,
	        format: normalizedFormat,
	        includeMeta: includeMeta === true,
	        includeStructuredPayload: includeStructuredPayload === true,
	      });
	    },

    sessionTranscriptGet: async ({
      context,
      sessionId,
      projection,
      callerPluginId,
      limit,
      cursor,
      direction,
      scope,
      sidechainId,
      roles,
      includeTools,
      includeReasoning,
      includeEvents,
      includeMeta,
      includeRaw,
      includeStructuredPayload,
      maxCharsPerMessage,
      maxRawPayloadChars,
      signal,
    }) => {
      if (!params.credentials) {
        return { ok: false, errorCode: 'not_authenticated', errorMessage: 'not_authenticated' };
      }
      const resolveAuthorizationHeaders = (request: Readonly<{
        method: 'GET' | 'POST'; path: string; body?: unknown;
      }>) => resolveServerRequestHeaders(context, 'session.transcript.get', request);
      if (!resolveAuthorizationHeaders({
        method: 'GET', path: '/v1/account/encryption/currentness',
      })) {
        return { ok: false, errorCode: 'not_authenticated', errorMessage: 'not_authenticated' };
      }
      return await getSessionTranscript({
        credentials: params.credentials,
        resolveAuthorizationHeaders,
        idOrPrefix: sessionId,
        ...(projection ? { projection } : {}),
        ...(callerPluginId ? { callerPluginId } : {}),
        ...(typeof limit === 'number' ? { limit } : {}),
        ...(cursor !== undefined ? { cursor } : {}),
        ...(direction ? { direction } : {}),
        ...(scope ? { scope } : {}),
        ...(sidechainId !== undefined ? { sidechainId } : {}),
        ...(roles ? { roles } : {}),
        ...(typeof includeTools === 'boolean' ? { includeTools } : {}),
        ...(typeof includeReasoning === 'boolean' ? { includeReasoning } : {}),
        ...(typeof includeEvents === 'boolean' ? { includeEvents } : {}),
        ...(typeof includeMeta === 'boolean' ? { includeMeta } : {}),
        ...(typeof includeRaw === 'boolean' ? { includeRaw } : {}),
        ...(typeof includeStructuredPayload === 'boolean' ? { includeStructuredPayload } : {}),
        ...(maxCharsPerMessage !== undefined ? { maxCharsPerMessage } : {}),
        ...(maxRawPayloadChars !== undefined ? { maxRawPayloadChars } : {}),
        ...(signal ? { signal } : {}),
      });
    },

    sessionEventsGet: async ({
      sessionId,
      limit,
      cursor,
      direction,
      scope,
      sidechainId,
      roles,
      kinds,
      format,
      includeMeta,
      includeRaw,
      includeStructuredPayload,
      maxTextChars,
      maxPayloadChars,
    }) => {
      if (!params.credentials) {
        return { ok: false, errorCode: 'not_authenticated', errorMessage: 'not_authenticated' };
      }
      return await getSessionEvents({
        credentials: params.credentials,
        idOrPrefix: sessionId,
        ...(typeof limit === 'number' ? { limit } : {}),
        ...(cursor !== undefined ? { cursor } : {}),
        ...(direction ? { direction } : {}),
        ...(scope ? { scope } : {}),
        ...(sidechainId !== undefined ? { sidechainId } : {}),
        ...(roles ? { roles } : {}),
        ...(kinds ? { kinds } : {}),
        ...(format ? { format } : {}),
        ...(typeof includeMeta === 'boolean' ? { includeMeta } : {}),
        ...(typeof includeRaw === 'boolean' ? { includeRaw } : {}),
        ...(typeof includeStructuredPayload === 'boolean' ? { includeStructuredPayload } : {}),
        ...(typeof maxTextChars === 'number' ? { maxTextChars } : {}),
        ...(typeof maxPayloadChars === 'number' ? { maxPayloadChars } : {}),
      });
    },

	    sessionWaitIdle: async ({ sessionId, timeoutSeconds }) => {
	      if (!params.credentials) {
	        return { ok: false, errorCode: 'not_authenticated', error: 'not_authenticated' };
	      }
	      const normalizedTimeoutSeconds =
	        typeof timeoutSeconds === 'number' && Number.isFinite(timeoutSeconds) && timeoutSeconds > 0
	          ? Math.min(3600, timeoutSeconds)
	          : 300;
	      return await waitForSessionIdle({
	        credentials: params.credentials,
	        idOrPrefix: sessionId,
	        timeoutMs: Math.max(1, Math.floor(normalizedTimeoutSeconds * 1000)),
	      });
	    },

    sessionPermissionRemoteAction: async (args) => {
      const rejectUnavailable = (
        code: 'canceled' | 'mediationStateUnavailable' | 'ownerMachineUnavailable',
      ) => args.actionId === 'session.permission.remote.pending.list'
        ? { ok: false as const, errorCode: code, error: code }
        : args.actionId === 'session.permission.remote.grants.list'
          ? { ok: false as const, errorCode: code, error: code }
        : { status: 'rejected' as const, code };

      if (args.signal?.aborted) {
        return rejectUnavailable('canceled');
      }

      // The existing current-session binding is the only live owner lookup.
      // Do not fall back to the Action deps' construction session, a registry,
      // or a Session RPC: a remote decision must reach the exact active owner.
      const binding = resolveCurrentSessionCapabilityBinding(args.input.sessionId);
      if (!binding) {
        return rejectUnavailable('ownerMachineUnavailable');
      }
      const bindingIsStillCurrent = (): boolean => {
        if (args.signal?.aborted || binding.signal.aborted) return false;
        try {
          if (binding.isCurrent() !== true) return false;
        } catch {
          return false;
        }
        return resolveCurrentSessionCapabilityBinding(args.input.sessionId)?.scopeId === binding.scopeId;
      };
      if (!bindingIsStillCurrent()) {
        return rejectUnavailable('ownerMachineUnavailable');
      }

      const permissionHandler = binding.permissionHandler;
      if (!permissionHandler) {
        return rejectUnavailable('mediationStateUnavailable');
      }

      if (args.actionId === 'session.permission.remote.pending.list') {
        if (args.caller.kind !== 'plugin') {
          return rejectUnavailable('mediationStateUnavailable');
        }
        const list = permissionHandler.listMediatedPendingRequests;
        if (typeof list !== 'function') {
          return rejectUnavailable('mediationStateUnavailable');
        }
        const result = list.call(permissionHandler, {
          mediatorPluginId: args.caller.pluginId,
          sourceRef: args.input.sourceRef,
          sourceRevisionOrEpoch: args.input.sourceRevisionOrEpoch,
          ...('cursor' in args.input && args.input.cursor !== undefined
            ? { cursor: args.input.cursor }
            : {}),
        });
        if (args.signal?.aborted) {
          return rejectUnavailable('canceled');
        }
        return bindingIsStillCurrent()
          ? result
          : rejectUnavailable('ownerMachineUnavailable');
      }

      if (args.actionId === 'session.permission.remote.respond') {
        if (args.caller.kind !== 'plugin') {
          return rejectUnavailable('mediationStateUnavailable');
        }
        const contributionLocalId = args.caller.contributionLocalId;
        if (!contributionLocalId?.trim()) {
          return rejectUnavailable('mediationStateUnavailable');
        }
        const respond = permissionHandler.respondToMediatedPendingPermission;
        if (typeof respond !== 'function') {
          return rejectUnavailable('mediationStateUnavailable');
        }
        const result = await respond.call(permissionHandler, {
          sessionId: args.input.sessionId,
          turnId: args.input.turnId,
          requestId: args.input.requestId,
          sourceRef: args.input.sourceRef,
          sourceRevisionOrEpoch: args.input.sourceRevisionOrEpoch,
          idempotencyKey: args.input.idempotencyKey,
          actor: args.input.actor,
          decision: args.input.decision,
          scope: args.input.scope,
          mediator: {
            pluginId: args.caller.pluginId,
            contributionLocalId,
          },
          ...(args.signal ? { signal: args.signal } : {}),
        });
        if (args.signal?.aborted) {
          return rejectUnavailable('canceled');
        }
        return bindingIsStillCurrent()
          ? result
          : rejectUnavailable('ownerMachineUnavailable');
      }

      if (args.actionId === 'session.user_action.remote.answer') {
        if (args.caller.kind !== 'plugin') {
          return rejectUnavailable('mediationStateUnavailable');
        }
        const contributionLocalId = args.caller.contributionLocalId;
        if (!contributionLocalId?.trim()) {
          return rejectUnavailable('mediationStateUnavailable');
        }
        const answer = permissionHandler.respondToMediatedPendingUserAction;
        if (typeof answer !== 'function') {
          return rejectUnavailable('mediationStateUnavailable');
        }
        const result = await answer.call(permissionHandler, {
          sessionId: args.input.sessionId,
          turnId: args.input.turnId,
          requestId: args.input.requestId,
          sourceRef: args.input.sourceRef,
          sourceRevisionOrEpoch: args.input.sourceRevisionOrEpoch,
          answers: args.input.answers,
          mediator: {
            pluginId: args.caller.pluginId,
            contributionLocalId,
          },
          ...(args.signal ? { signal: args.signal } : {}),
        });
        if (args.signal?.aborted) {
          return rejectUnavailable('canceled');
        }
        return bindingIsStillCurrent()
          ? result
          : rejectUnavailable('ownerMachineUnavailable');
      }

      const viewer = args.caller.kind === 'plugin'
        ? { kind: 'mediatorPlugin' as const, pluginId: args.caller.pluginId }
        : args.caller.kind === 'host'
          ? { kind: 'host' as const }
          : null;
      if (!viewer) {
        return rejectUnavailable('mediationStateUnavailable');
      }

      if (args.actionId === 'session.permission.remote.grants.list') {
        const listGrants = permissionHandler.listMediatedPermissionGrants;
        if (typeof listGrants !== 'function') {
          return rejectUnavailable('mediationStateUnavailable');
        }
        const result = await listGrants.call(permissionHandler, {
          viewer,
          limit: args.input.limit,
          ...(args.input.cursor !== undefined ? { cursor: args.input.cursor } : {}),
          ...(args.signal ? { signal: args.signal } : {}),
        });
        if (args.signal?.aborted) {
          return rejectUnavailable('canceled');
        }
        if (!bindingIsStillCurrent()) {
          return rejectUnavailable('ownerMachineUnavailable');
        }
        return result ?? rejectUnavailable('mediationStateUnavailable');
      }

      const revoke = permissionHandler.revokeMediatedPermissionGrant;
      if (typeof revoke !== 'function') {
        return rejectUnavailable('mediationStateUnavailable');
      }
      const result = await revoke.call(permissionHandler, {
        turnId: args.input.turnId,
        requestId: args.input.requestId,
        grantId: args.input.grantId,
        caller: viewer,
        ...(args.signal ? { signal: args.signal } : {}),
      });
      if (args.signal?.aborted) {
        return rejectUnavailable('canceled');
      }
      return bindingIsStillCurrent()
        ? result
        : rejectUnavailable('ownerMachineUnavailable');
    },

    sessionPermissionRespond: async ({
      sessionId,
      decision,
      requestId,
      turnId,
      allowedTools,
      updatedPermissions,
      execPolicyAmendment,
      signal,
    }) => {
      if (!params.credentials) {
        return { ok: false, errorCode: 'not_authenticated', errorMessage: 'not_authenticated' };
      }

      const reqId = String(requestId ?? '').trim();
      if (!reqId) {
        return { ok: false, errorCode: 'permission_request_not_found', errorMessage: 'permission_request_not_found', sessionId };
      }

      const transport = await resolveTransportForSession(sessionId);
      if (!transport.ok) {
        return {
          ok: false,
          errorCode: transport.code,
          errorMessage: transport.code,
          ...(transport.candidates ? { candidates: transport.candidates } : {}),
        };
      }
      const approved = decision === 'allow';
      const legacyDecision =
        !approved
          ? 'denied'
          : execPolicyAmendment && typeof execPolicyAmendment === 'object'
            ? 'approved_execpolicy_amendment'
            : undefined;
      try {
        return await callSessionRpc({
          ...transport,
          token: params.credentials.token,
          sessionId: transport.sessionId,
          method: `${transport.sessionId}:session.permission.respond`,
          request: {
            id: reqId,
            ...(typeof turnId === 'string' && turnId.trim().length > 0 ? { turnId: turnId.trim() } : {}),
            approved,
            ...(legacyDecision ? { decision: legacyDecision } : {}),
            ...(Array.isArray(allowedTools) ? { allowedTools } : {}),
            ...(typeof updatedPermissions !== 'undefined' ? { updatedPermissions } : {}),
            ...(typeof execPolicyAmendment !== 'undefined' ? { execPolicyAmendment } : {}),
          },
          ...(signal ? { signal } : {}),
        });
      } catch (error) {
        return {
          ok: false,
          errorCode: readRpcErrorCode(error) ?? 'permission_update_failed',
          errorMessage: error instanceof Error ? error.message : 'permission_update_failed',
          sessionId: transport.sessionId,
        };
      }
    },
    sessionUserActionAnswer: async ({
      sessionId,
      requestId,
      answers,
      decision,
      reason,
      updatedPermissions,
      allowedTools,
      execPolicyAmendment,
      signal,
    }) => {
      if (!params.credentials) {
        return { ok: false, errorCode: 'not_authenticated', errorMessage: 'not_authenticated' };
      }

      const reqId = String(requestId ?? '').trim();
      if (!reqId) {
        return { ok: false, errorCode: 'permission_request_not_found', errorMessage: 'permission_request_not_found', sessionId };
      }

      const transport = await resolveTransportForSession(sessionId);
      if (!transport.ok) {
        return {
          ok: false,
          errorCode: transport.code,
          errorMessage: transport.code,
          ...(transport.candidates ? { candidates: transport.candidates } : {}),
        };
      }
      if (isKnownCompletedRequestId({
        ...transport,
        rawSession: transport.rawSession,
        requestId: reqId,
        kind: 'user_action',
      })) {
        return permissionRequestNotFoundResult(transport.sessionId);
      }
      const normalizedAnswers = Object.create(null) as Record<string, readonly string[]>;
      for (const entry of Array.isArray(answers) ? answers : []) {
        const question = String(entry?.question ?? '');
        if (question.trim().length > 0 && entry.values.length > 0) {
          normalizedAnswers[question] = [...entry.values];
        }
      }
      if (!decision && Object.keys(normalizedAnswers).length === 0) {
        return { ok: false, errorCode: 'invalid_parameters', errorMessage: 'invalid_parameters', sessionId: transport.sessionId };
      }

      const approved = decision ? decision === 'approve' : true;
      const legacyDecision =
        decision === 'reject'
          ? 'denied'
          : decision === 'request_changes'
            ? 'abort'
            : 'approved';
      try {
        return await callSessionRpc({
          ...transport,
          token: params.credentials.token,
          sessionId: transport.sessionId,
          method: `${transport.sessionId}:session.user_action.answer`,
          request: {
            id: reqId,
            approved,
            decision: legacyDecision,
            ...(decision ? { actionDecision: decision } : {}),
            ...(Object.keys(normalizedAnswers).length > 0 ? { answers: normalizedAnswers } : {}),
            ...(typeof reason === 'string' && reason.trim().length > 0 ? { reason: reason.trim() } : {}),
            ...(typeof updatedPermissions !== 'undefined' ? { updatedPermissions } : {}),
            ...(Array.isArray(allowedTools) ? { allowedTools } : {}),
            ...(typeof execPolicyAmendment !== 'undefined' ? { execPolicyAmendment } : {}),
          },
          ...(signal ? { signal } : {}),
        });
      } catch (error) {
        return {
          ok: false,
          errorCode: readRpcErrorCode(error) ?? 'permission_update_failed',
          errorMessage: error instanceof Error ? error.message : 'permission_update_failed',
          sessionId: transport.sessionId,
        };
      }
    },
    sessionModeSet: async ({ sessionId, modeId }) => {
      if (!params.credentials) {
        return { ok: false, errorCode: 'not_authenticated', error: 'not_authenticated' };
      }

      const normalizedModeId = String(modeId ?? '').trim();
      const updatedAt = Date.now();
      const res = await setSessionMode({
        credentials: params.credentials,
        idOrPrefix: sessionId,
        modeId: normalizedModeId,
        updatedAt,
      });
      if (!res.ok) {
        return { ok: false, errorCode: res.code, error: res.code, ...(res.candidates ? { candidates: res.candidates } : {}) };
      }
      return { ok: true, sessionId: res.sessionId, modeId: normalizedModeId, updatedAt };
    },
    sessionBoardAction: params.credentials
      ? createSessionBoardActionDeps({
          credentials: params.credentials,
          ...(params.resolveServerFeaturesSnapshot
            ? { resolveServerFeaturesSnapshot: params.resolveServerFeaturesSnapshot }
            : {}),
          ...exactHome,
          ...(params.serverIdentityId ? { serverIdentityId: params.serverIdentityId } : {}),
          ...(params.externalActionMachineRequestPrivateKey
            ? { externalActionMachineRequestPrivateKey: params.externalActionMachineRequestPrivateKey }
            : {}),
          ...(params.externalActionMachineInstallationId
            ? { externalActionMachineInstallationId: params.externalActionMachineInstallationId }
            : {}),
        }).sessionBoardAction
      : async () => ({ ok: false, errorCode: 'not_authenticated', error: 'not_authenticated' }),

    currentSessionPresentationApply: async ({ input, context, signal }) => {
      const sessionId = normalizeStringValue(context.defaultSessionId);
      if (!sessionId) {
        return { ok: false, errorCode: 'session_not_selected', error: 'session_not_selected' };
      }
      const operationId = normalizeStringValue(context.actionRequestId);
      if (!operationId) {
        return { ok: false, errorCode: 'action_request_id_required', error: 'action_request_id_required' };
      }
      const presentation = resolveCurrentSessionUiBinding(sessionId)?.presentation;
      if (!presentation) {
        return {
          ok: false,
          errorCode: 'current_session_presentation_unavailable',
          error: 'current_session_presentation_unavailable',
        };
      }

      const result = await presentation.present(
        { operationId, intent: input.intent },
        signal ? { signal } : undefined,
      );
      if (result.status === 'outcomeUnknown') {
        return { ok: false, errorCode: 'outcome_unknown', error: 'outcome_unknown' };
      }
      // `applied`/`unchanged` and `conflict`/`unavailable` each share one
      // constituent, so the carried evidence — not the status literal — is what
      // separates a settled revision from a diagnosed refusal.
      if ('diagnostic' in result) {
        const errorCode = result.diagnostic.code;
        return { ok: false, errorCode, error: errorCode };
      }
      return result;
    },

    sessionDiscussionAction: params.credentials
      ? createSessionDiscussionActionDeps({
          credentials: params.credentials,
          ...(params.resolveServerFeaturesSnapshot
            ? { resolveServerFeaturesSnapshot: params.resolveServerFeaturesSnapshot }
            : {}),
          ...exactHome,
          ...(params.serverIdentityId ? { serverIdentityId: params.serverIdentityId } : {}),
          ...(params.externalActionMachineRequestPrivateKey
            ? { externalActionMachineRequestPrivateKey: params.externalActionMachineRequestPrivateKey }
            : {}),
          ...(params.externalActionMachineInstallationId
            ? { externalActionMachineInstallationId: params.externalActionMachineInstallationId }
            : {}),
        }).sessionDiscussionAction
      : async () => ({ ok: false, errorCode: 'not_authenticated', error: 'not_authenticated' }),

    sessionList: params.credentials
      ? createSessionListActionDependency({
          credentials: params.credentials,
          ...(params.actionsSettingsProvider?.getAccountSettings
            ? { resolveAccountSettings: params.actionsSettingsProvider.getAccountSettings }
            : {}),
          ...(params.serverId ? { serverId: params.serverId } : {}),
          ...(params.serverIdentityId ? { serverIdentityId: params.serverIdentityId } : {}),
          ...(params.serverHttpBaseUrl ? { serverHttpBaseUrl: params.serverHttpBaseUrl } : {}),
          ...(params.externalActionMachineRequestPrivateKey
            ? { externalActionMachineRequestPrivateKey: params.externalActionMachineRequestPrivateKey }
            : {}),
          ...(params.externalActionMachineInstallationId
            ? { externalActionMachineInstallationId: params.externalActionMachineInstallationId }
            : {}),
        })
      : async () => ({ ok: false, errorCode: 'not_authenticated', error: 'not_authenticated' }),

    sessionActivityGet: async ({ context, sessionId, view, windowSeconds, signal }) => {
      if (!params.credentials) {
        return { ok: false, errorCode: 'not_authenticated', error: 'not_authenticated' };
      }
      if (windowSeconds !== undefined) {
        return {
          ok: false,
          errorCode: 'unsupported_action',
          error: 'unsupported_action:session.activity.get.windowSeconds',
        };
      }
      const resolveAuthorizationHeaders = (request: Readonly<{
        method: 'GET'; path: string;
      }>) => resolveServerRequestHeaders(context, 'session.activity.get', request);
      const currentnessAuthorizationHeaders = resolveAuthorizationHeaders({
        method: 'GET', path: '/v1/account/encryption/currentness',
      });
      if (!currentnessAuthorizationHeaders) {
        return { ok: false, errorCode: 'not_authenticated', error: 'not_authenticated' };
      }
      signal?.throwIfAborted();
      const serverFeaturesSnapshot = await readServerFeaturesSnapshot();
      signal?.throwIfAborted();
      const session = await fetchSessionByIdCompat({
        token: params.credentials.token,
        sessionId,
        resolveAuthorizationHeaders,
        ...(serverFeaturesSnapshot ? { serverFeaturesSnapshot } : {}),
        signal,
      });
      if (!session) {
        return { ok: false, errorCode: 'session_not_found', error: 'session_not_found', sessionId };
      }
      const currentness = await fetchAccountEncryptionCurrentness({
        token: params.credentials.token,
        authorizationHeaders: currentnessAuthorizationHeaders,
        signal,
      });
      signal?.throwIfAborted();
      const awareness = projectCliSessionAwarenessV1({
        credentials: params.credentials,
        accountEncryption: currentness,
        row: session,
        nowMs: Date.now(),
      });
      // The requested representation, from the one projector this Action already derives its
      // released booleans from. Omission keeps the compatibility digest below.
      if (view === SESSION_LIST_AWARENESS_VIEW_V1) return awareness;
      return {
        ...projectSessionActivityCompatibilityV1({
          awareness,
          facts: {
            // V2 Session rows do not carry the UI presence channel. Preserve that absence rather
            // than fabricating online/offline reachability from the orthogonal `active` fact.
            presence: null,
            active: session.active,
            thinking: session.thinking === true,
            updatedAt: session.updatedAt,
            // No `permissionRequestIds`: this path reads a V2 row, which carries pending counts
            // but no request identities. The released CLI/daemon response never had the field.
          },
        }),
        // cli-v0.2.11 and the current 0.2 daemon expose these ancillary raw counts.
        // Keep that response seam while status meaning comes only from awareness.
        pendingCount: session.pendingCount ?? 0,
        pendingPermissionRequestCount: session.pendingPermissionRequestCount ?? 0,
        pendingUserActionRequestCount: session.pendingUserActionRequestCount ?? 0,
      };
    },

    sessionRecentMessagesGet: async ({ sessionId, limit, cursor, includeUser, includeAssistant, maxCharsPerMessage }) => {
      if (!params.credentials) {
        return { ok: false, errorCode: 'not_authenticated', errorMessage: 'not_authenticated' };
      }
      return await getSessionTranscript({
        credentials: params.credentials,
        idOrPrefix: sessionId,
        ...(typeof limit === 'number' ? { limit } : {}),
        ...(Object.prototype.hasOwnProperty.call({ cursor }, 'cursor') ? { cursor: cursor ?? null } : {}),
        roles: [
          ...(includeUser === false ? [] : ['user' as const]),
          ...(includeAssistant === false ? [] : ['assistant' as const]),
        ],
        ...(Object.prototype.hasOwnProperty.call({ maxCharsPerMessage }, 'maxCharsPerMessage') ? { maxCharsPerMessage: maxCharsPerMessage ?? null } : {}),
      });
    },

    subagentsList: async (args) => {
      return await hostSubagentStore.list(args);
    },

    subagentsGet: async (args) => {
      return await hostSubagentStore.get(args);
    },

    subagentsWatch: async (args) => {
      try {
        return await new Promise((resolve, reject) => {
          try {
            let subscription: Readonly<{ unsubscribe(): void }> | null = null;
            let unsubscribeAfterRegister = false;
            subscription = hostSubagentStore.watch(args, (event) => {
              if (event.kind !== 'snapshot') return;
              resolve({
                kind: 'snapshot',
                subagents: event.subagents ?? [],
              });
              if (subscription) {
                subscription.unsubscribe();
              } else {
                unsubscribeAfterRegister = true;
              }
            });
            if (unsubscribeAfterRegister) {
              subscription.unsubscribe();
            }
          } catch (error) {
            reject(error);
          }
        });
      } catch (error) {
        return serializeHostSubagentStoreError(error);
      }
    },

    subagentsUpsert: async ({ input, caller }) => {
      try {
        return await hostSubagentStore.upsert({
          actor: deriveHostSubagentActor(caller),
          input,
        });
      } catch (error) {
        return serializeHostSubagentStoreError(error);
      }
    },

    subagentsUpdateStatus: async ({ input, caller }) => {
      try {
        return await hostSubagentStore.updateStatus({
          ...input,
          actor: deriveHostSubagentActor(caller),
        });
      } catch (error) {
        return serializeHostSubagentStoreError(error);
      }
    },

    subagentsComplete: async ({ input, caller }) => {
      try {
        return await hostSubagentStore.complete({
          ...input,
          actor: deriveHostSubagentActor(caller),
        });
      } catch (error) {
        return serializeHostSubagentStoreError(error);
      }
    },

    pluginsDevLoopAction: async ({ actionId, input, context }) => await executePluginDevLoopAction({
      actionId,
      input,
      happyHomeDir: params.happyHomeDir,
      workspaceRoot: await resolveCurrentSessionValue('path') ?? undefined,
      context,
    }),

    pluginSettingsAdministrationAction: async ({ actionId, input, context }) => (
      await executePluginSettingsAdministrationAction({
        actionId,
        input,
        happyHomeDir: params.happyHomeDir,
        ...(context.actionCaller ? { actionCaller: context.actionCaller } : {}),
        ...(context.signal ? { signal: context.signal } : {}),
      })
    ),

    pluginPermissionGrantAction: async (args) => pluginPermissionGrantAction
      ? await pluginPermissionGrantAction(args)
      : { ok: false, errorCode: 'not_authenticated', error: 'not_authenticated' },

    pluginWebhookAction: async (args) => pluginWebhookAction
      ? await pluginWebhookAction(args)
      : { ok: false, errorCode: 'not_authenticated', error: 'not_authenticated' },

    ...(automationEventAction ? {
      automationEventAction: async (args) => await automationEventAction(args),
    } : {}),

    workflowAction: async (args) => {
      if (!workflowAction) {
        return { ok: false, errorCode: 'content_unavailable', error: 'content_unavailable' };
      }
      try {
        let context = args.context;
        const isTrustedCallingSession = normalizeStringValue(args.context.defaultSessionId) === normalizeStringValue(params.sessionId);
        if (args.actionId === 'workflow.run.start'
          && isTrustedCallingSession
          && !(context.externalActionTarget?.kind === 'machine' && context.externalActionTarget.project)) {
          const [machineId, directory] = await Promise.all([
            resolveCurrentSessionValue('machineId'),
            resolveCurrentSessionValue('path'),
          ]);
          if (!machineId || !directory) throw Object.assign(new Error('target_unavailable'), { code: 'target_unavailable' });
          context = {
            ...context,
            externalActionTarget: {
              kind: 'machine',
              machineId,
              project: { machineId, directory },
            },
          };
        }
        return await workflowAction({ ...args, context } as Parameters<typeof workflowAction>[0]);
      } catch (error) {
        const code = error && typeof error === 'object' && typeof (error as { code?: unknown }).code === 'string'
          ? (error as { code: string }).code
          : 'content_unavailable';
        const failure = WorkflowActionFailureV1Schema.safeParse({
          ok: false,
          errorCode: code,
          error: error instanceof Error ? error.message : code,
          ...(error && typeof error === 'object' && 'details' in error
            ? { details: error.details }
            : {}),
        });
        return failure.success
          ? failure.data
          : { ok: false, errorCode: 'content_unavailable', error: 'content_unavailable' };
      }
    },

    automationConversationAction: async (args) => automationConversationAction
      ? await automationConversationAction(args)
      : { ok: false, errorCode: 'not_authenticated', error: 'not_authenticated' },

    pluginSessionHookManagementAction: async (args) => {
      const hookManagementAction =
        params.externalSessionPluginAdmissionOwner?.hookManagementAction;
      if (!hookManagementAction) {
        return {
          ok: false,
          errorCode: 'unsupported_action',
          error: `unsupported_action:${args.actionId}`,
        };
      }
      const execution = await hookManagementAction(
        args.actionId,
        args.input,
        {
          surface: 'action',
          ...(args.signal ? { signal: args.signal } : {}),
        },
      );
      return execution.ok ? execution.result : execution;
    },

    externalSessionAction: async (args) => params.credentials
      ? await executePluginExternalSessionAction(
          { ...args, credentials: params.credentials },
          params.externalSessionPluginAdmissionOwner?.materializeStart
            ? {
                materializeStart:
                  params.externalSessionPluginAdmissionOwner.materializeStart,
              }
            : {},
        )
      : { ok: false, errorCode: 'not_authenticated', error: 'not_authenticated' },

    buildApprovalPreview: async ({ actionId, input, defaultPreview }) => {
      if (actionId === 'plugins.install') {
        return await buildPluginInstallApprovalPreview({
          input,
          defaultPreview,
          workspaceRoot: await resolveCurrentSessionValue('path') ?? undefined,
        });
      }
      return defaultPreview;
    },

    resetGlobalVoiceAgent: () => {},
  };
}
