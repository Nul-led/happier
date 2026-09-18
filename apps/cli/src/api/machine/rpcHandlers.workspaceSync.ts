import {
  ReadWorkspaceSyncFileResultV1Schema,
  ReadWorkspaceSyncFileV1Schema,
  HandoffTargetReplacementPreflightResultV1Schema,
  HandoffTargetReplacementPreflightV1Schema,
  WorkspaceSyncConflictPageRequestV1Schema,
  WorkspaceSyncConflictPageV1Schema,
  WorkspaceSyncConflictResolveRpcInputV1Schema,
  WorkspaceSyncRelationshipIdV1Schema,
  WorkspaceSyncLegacyStateInspectionV1Schema,
  WorkspaceSyncStatusV1Schema,
  WorkspaceSyncTargetBootstrapPrepareResultV1Schema,
  WorkspaceSyncTargetBootstrapPrepareV1Schema,
  WorkspaceSyncTargetBootstrapReleaseResultV1Schema,
  WorkspaceSyncTargetBootstrapReleaseV1Schema,
  WorkspaceSyncTargetConflictDeleteV1Schema,
  WorkspaceSyncTargetFileReadV1Schema,
  type DeleteWorkspaceSyncConflictLoserV1,
  type WorkspaceSyncConflictResolveActionInputV1,
  type ReadWorkspaceSyncFileResultV1,
  type ReadWorkspaceSyncFileV1,
  type HandoffTargetReplacementPreflightResultV1,
  type HandoffTargetReplacementPreflightV1,
  type WorkspaceSyncConflictPageRequestV1,
  type WorkspaceSyncConflictPageV1,
  type WorkspaceContentPolicyV1,
  type WorkspaceSyncStatusV1,
  type WorkspaceSyncLegacyStateInspectionV1,
  type WorkspaceSyncTargetBootstrapPrepareResultV1,
  type WorkspaceSyncTargetBootstrapPrepareV1,
  type WorkspaceSyncTargetBootstrapReleaseResultV1,
  type WorkspaceSyncTargetBootstrapReleaseV1,
  type WorkspaceSyncTargetConflictDeleteV1,
  type WorkspaceSyncTargetFileReadV1,
} from '@happier-dev/protocol';
import { RPC_METHODS } from '@happier-dev/protocol/rpc';
import { RpcError, readRpcErrorCode } from '@happier-dev/protocol/rpcErrors';
import type { RpcHandler, RpcHandlerRegistrar } from '../rpc/types';
import type { DirectPeerOnDemandTransferScope } from '@/machines/transfer/directPeerTransport';
import type { TransferPayloadSource } from '@/machines/transfer/transferPayloadSource';

export type WorkspaceSyncRpcController = Readonly<{
  get(relationshipId: string, signal?: AbortSignal): Promise<WorkspaceSyncStatusV1 | null>;
  list(signal?: AbortSignal): Promise<readonly WorkspaceSyncStatusV1[]>;
  flush(relationshipId: string, signal?: AbortSignal): Promise<WorkspaceSyncStatusV1>;
  pause(relationshipId: string, signal?: AbortSignal): Promise<WorkspaceSyncStatusV1>;
  resume(relationshipId: string, signal?: AbortSignal): Promise<WorkspaceSyncStatusV1>;
  terminate(relationshipId: string, signal?: AbortSignal): Promise<void>;
  listConflicts(request: WorkspaceSyncConflictPageRequestV1, signal?: AbortSignal): Promise<WorkspaceSyncConflictPageV1>;
  deleteConflictLoser(
    request: DeleteWorkspaceSyncConflictLoserV1,
    signal: AbortSignal | undefined,
    actionReceiptId: string,
  ): Promise<WorkspaceSyncStatusV1>;
  readFile(request: ReadWorkspaceSyncFileV1, signal?: AbortSignal): Promise<ReadWorkspaceSyncFileResultV1>;
}>;

export type MachineWorkspaceSyncRpcService = Readonly<{
  controller: WorkspaceSyncRpcController;
  relationshipOwner: Readonly<{
    setEnabled(relationshipId: string, enabled: boolean, signal?: AbortSignal): Promise<void>;
    stop(relationshipId: string, signal?: AbortSignal): Promise<void>;
  }>;
  deleteConflictLoserAtTarget(
    request: WorkspaceSyncTargetConflictDeleteV1,
    signal?: AbortSignal,
  ): Promise<void>;
  readFileAtTarget(
    request: WorkspaceSyncTargetFileReadV1,
    signal?: AbortSignal,
  ): Promise<ReadWorkspaceSyncFileResultV1>;
  preflightHandoffTargetReplacement(
    request: HandoffTargetReplacementPreflightV1,
    signal?: AbortSignal,
  ): Promise<HandoffTargetReplacementPreflightResultV1>;
  prepareBootstrapAtTarget(
    request: WorkspaceSyncTargetBootstrapPrepareV1,
    signal?: AbortSignal,
  ): Promise<WorkspaceSyncTargetBootstrapPrepareResultV1>;
  releaseBootstrapAtTarget(
    request: WorkspaceSyncTargetBootstrapReleaseV1,
    signal?: AbortSignal,
  ): Promise<WorkspaceSyncTargetBootstrapReleaseResultV1>;
  prepareSourceSeedExport?(request: Readonly<{
    operationId: string;
    sourceWorkspaceRefId: string;
    targetMachineId: string;
    contentPolicy: WorkspaceContentPolicyV1;
  }>): Promise<Readonly<{ payloadSource: TransferPayloadSource; onDemandScope: DirectPeerOnDemandTransferScope }>>;
  inspectRetiredState(signal?: AbortSignal): Promise<WorkspaceSyncLegacyStateInspectionV1>;
  assertConflictResolutionAuthorized?(
    actionReceiptId: string,
    actionInput: WorkspaceSyncConflictResolveActionInputV1,
  ): Promise<void>;
}>;

function unavailable(): never {
  throw Object.assign(new Error('Workspace sync runtime is unavailable'), {
    code: 'workspace_sync_unavailable',
  });
}

function requireEmptyRequest(raw: unknown): void {
  if (raw === undefined || raw === null) return;
  if (typeof raw === 'object' && !Array.isArray(raw) && Object.keys(raw).length === 0) return;
  throw Object.assign(new Error('Invalid workspace sync request'), { code: 'invalid_request' });
}

// Workspace Sync has no Protocol error-code schema: its transported RPCs are
// private adapters. Keep promotion closed here so Node/fs codes never become
// caller-visible protocol identity merely because they use `error.code`.
const WORKSPACE_SYNC_RPC_ERROR_CODES: ReadonlySet<string> = new Set([
  'agent_unavailable',
  'bootstrap_definition_conflict',
  'cancelled',
  'conflict_changed',
  'conflict_resolution_unsupported',
  'controller_unavailable',
  'engine_unavailable',
  'git_selection_unavailable',
  'indeterminate',
  'invalid_request',
  'machine_carrier_unavailable',
  'peer_unavailable',
  'relationship_definition_conflict',
  'relationship_not_owned',
  'relationship_not_ready',
  'relationship_runtime_mismatch',
  'root_changed',
  'root_mismatch',
  'target_bootstrap_offline',
  'target_bootstrap_required',
  'target_unavailable',
  'workspace_file_unsupported',
  'workspace_machine_not_enrolled',
  'workspace_ref_not_ready',
  'workspace_root_identity_unavailable',
  'workspace_root_in_use',
  'workspace_root_ownership_compromised',
  'workspace_root_ownership_lost',
  'workspace_root_unsafe',
  'workspace_sync_unavailable',
] as const);

function projectWorkspaceSyncRpcError(error: unknown): unknown {
  if (readRpcErrorCode(error) !== undefined || !(error instanceof Error)) return error;
  const code = (error as Error & { code?: unknown }).code;
  if (typeof code !== 'string' || !WORKSPACE_SYNC_RPC_ERROR_CODES.has(code)) return error;
  return Object.assign(new RpcError(error.message, code), { code });
}

function createWorkspaceSyncRpcRegistrar(registrar: RpcHandlerRegistrar): RpcHandlerRegistrar {
  return {
    registerHandler<TRequest, TResponse>(method: string, handler: RpcHandler<TRequest, TResponse>): void {
      registrar.registerHandler(method, async (request, context) => {
        try {
          return await handler(request, context);
        } catch (error) {
          throw projectWorkspaceSyncRpcError(error);
        }
      });
    },
  };
}

export function registerMachineWorkspaceSyncRpcHandlers(params: Readonly<{
  rpcHandlerManager: RpcHandlerRegistrar;
  service?: MachineWorkspaceSyncRpcService;
}>): void {
  const rpcHandlerManager = createWorkspaceSyncRpcRegistrar(params.rpcHandlerManager);
  const service = (): MachineWorkspaceSyncRpcService => params.service ?? unavailable();
  const signal = (value: AbortSignal | undefined): AbortSignal => value ?? new AbortController().signal;

  rpcHandlerManager.registerHandler(RPC_METHODS.DAEMON_WORKSPACE_SYNC_GET, async (raw, context) => {
    const request = WorkspaceSyncRelationshipIdV1Schema.parse(raw);
    const status = await service().controller.get(request.relationshipId, signal(context?.signal));
    return { status: status === null ? null : WorkspaceSyncStatusV1Schema.parse(status) };
  });
  rpcHandlerManager.registerHandler(RPC_METHODS.DAEMON_WORKSPACE_SYNC_LIST, async (raw, context) => {
    requireEmptyRequest(raw);
    const statuses = await service().controller.list(signal(context?.signal));
    return { statuses: statuses.map((status) => WorkspaceSyncStatusV1Schema.parse(status)) };
  });

  rpcHandlerManager.registerHandler(RPC_METHODS.DAEMON_WORKSPACE_SYNC_FLUSH, async (raw, context) => {
    const request = WorkspaceSyncRelationshipIdV1Schema.parse(raw);
    const status = await service().controller.flush(request.relationshipId, signal(context?.signal));
    return { status: WorkspaceSyncStatusV1Schema.parse(status) };
  });
  rpcHandlerManager.registerHandler(RPC_METHODS.DAEMON_WORKSPACE_SYNC_PAUSE, async (raw, context) => {
    const request = WorkspaceSyncRelationshipIdV1Schema.parse(raw);
    await service().relationshipOwner.setEnabled(request.relationshipId, false, signal(context?.signal));
    return { ok: true as const };
  });
  rpcHandlerManager.registerHandler(RPC_METHODS.DAEMON_WORKSPACE_SYNC_RESUME, async (raw, context) => {
    const request = WorkspaceSyncRelationshipIdV1Schema.parse(raw);
    await service().relationshipOwner.setEnabled(request.relationshipId, true, signal(context?.signal));
    return { ok: true as const };
  });

  rpcHandlerManager.registerHandler(RPC_METHODS.DAEMON_WORKSPACE_SYNC_TERMINATE, async (raw, context) => {
    const request = WorkspaceSyncRelationshipIdV1Schema.parse(raw);
    await service().relationshipOwner.stop(request.relationshipId, signal(context?.signal));
    return { ok: true as const };
  });
  rpcHandlerManager.registerHandler(RPC_METHODS.DAEMON_WORKSPACE_SYNC_CONFLICTS_LIST, async (raw, context) => {
    const request = WorkspaceSyncConflictPageRequestV1Schema.parse(raw);
    return WorkspaceSyncConflictPageV1Schema.parse(
      await service().controller.listConflicts(request, signal(context?.signal)),
    );
  });
  rpcHandlerManager.registerHandler(RPC_METHODS.DAEMON_WORKSPACE_SYNC_CONFLICT_DELETE, async (raw, context) => {
    const parsed = WorkspaceSyncConflictResolveRpcInputV1Schema.safeParse(raw);
    const assertConflictResolutionAuthorized = service().assertConflictResolutionAuthorized;
    if (!parsed.success || !assertConflictResolutionAuthorized) {
      throw Object.assign(new Error('Confirmed workspace conflict Action receipt is required'), { code: 'approval_required' });
    }
    const { actionReceiptId, actionInput } = parsed.data;
    await assertConflictResolutionAuthorized(actionReceiptId, actionInput);
    const status = await service().controller.deleteConflictLoser(
      actionInput.request,
      signal(context?.signal),
      actionReceiptId,
    );
    return WorkspaceSyncStatusV1Schema.parse(status);
  });
  rpcHandlerManager.registerHandler(RPC_METHODS.DAEMON_WORKSPACE_SYNC_FILE_READ, async (raw, context) => {
    const request = ReadWorkspaceSyncFileV1Schema.parse(raw);
    return ReadWorkspaceSyncFileResultV1Schema.parse(
      await service().controller.readFile(request, signal(context?.signal)),
    );
  });
  rpcHandlerManager.registerHandler(RPC_METHODS.DAEMON_WORKSPACE_SYNC_TARGET_CONFLICT_DELETE, async (raw, context) => {
    const request = WorkspaceSyncTargetConflictDeleteV1Schema.parse(raw);
    await service().deleteConflictLoserAtTarget(request, signal(context?.signal));
    return { ok: true as const };
  });
  rpcHandlerManager.registerHandler(RPC_METHODS.DAEMON_WORKSPACE_SYNC_TARGET_FILE_READ, async (raw, context) => {
    const request = WorkspaceSyncTargetFileReadV1Schema.parse(raw);
    return ReadWorkspaceSyncFileResultV1Schema.parse(
      await service().readFileAtTarget(request, signal(context?.signal)),
    );
  });
  rpcHandlerManager.registerHandler(RPC_METHODS.DAEMON_WORKSPACE_SYNC_TARGET_REPLACEMENT_PREFLIGHT, async (raw, context) => {
    const request = HandoffTargetReplacementPreflightV1Schema.parse(raw);
    return HandoffTargetReplacementPreflightResultV1Schema.parse(
      await service().preflightHandoffTargetReplacement(request, signal(context?.signal)),
    );
  });
  rpcHandlerManager.registerHandler(RPC_METHODS.DAEMON_WORKSPACE_SYNC_TARGET_BOOTSTRAP_PREPARE, async (raw, context) => {
    const request = WorkspaceSyncTargetBootstrapPrepareV1Schema.parse(raw);
    return WorkspaceSyncTargetBootstrapPrepareResultV1Schema.parse(
      await service().prepareBootstrapAtTarget(request, signal(context?.signal)),
    );
  });
  rpcHandlerManager.registerHandler(RPC_METHODS.DAEMON_WORKSPACE_SYNC_TARGET_BOOTSTRAP_RELEASE, async (raw, context) => {
    const request = WorkspaceSyncTargetBootstrapReleaseV1Schema.parse(raw);
    return WorkspaceSyncTargetBootstrapReleaseResultV1Schema.parse(
      await service().releaseBootstrapAtTarget(request, signal(context?.signal)),
    );
  });
  rpcHandlerManager.registerHandler(RPC_METHODS.DAEMON_WORKSPACE_SYNC_LEGACY_INSPECT, async (raw, context) => {
    requireEmptyRequest(raw);
    return WorkspaceSyncLegacyStateInspectionV1Schema.parse(
      await service().inspectRetiredState(signal(context?.signal)),
    );
  });
}
