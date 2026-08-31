import {
  DeleteWorkspaceSyncConflictLoserV1Schema,
  ReadWorkspaceSyncFileResultV1Schema,
  ReadWorkspaceSyncFileV1Schema,
  WorkspaceSyncConflictListV1Schema,
  WorkspaceSyncRelationshipIdV1Schema,
  WorkspaceSyncStatusV1Schema,
  WorkspaceSyncTargetBootstrapPrepareResultV1Schema,
  WorkspaceSyncTargetBootstrapPrepareV1Schema,
  WorkspaceSyncTargetBootstrapReleaseResultV1Schema,
  WorkspaceSyncTargetBootstrapReleaseV1Schema,
  WorkspaceSyncTargetConflictDeleteV1Schema,
  WorkspaceSyncTargetFileReadV1Schema,
  type DeleteWorkspaceSyncConflictLoserV1,
  type ReadWorkspaceSyncFileResultV1,
  type ReadWorkspaceSyncFileV1,
  type WorkspaceSyncConflictListV1,
  type WorkspaceSyncStatusV1,
  type WorkspaceSyncTargetBootstrapPrepareResultV1,
  type WorkspaceSyncTargetBootstrapPrepareV1,
  type WorkspaceSyncTargetBootstrapReleaseResultV1,
  type WorkspaceSyncTargetBootstrapReleaseV1,
  type WorkspaceSyncTargetConflictDeleteV1,
  type WorkspaceSyncTargetFileReadV1,
} from '@happier-dev/protocol';
import { RPC_METHODS } from '@happier-dev/protocol/rpc';
import type { RpcHandlerRegistrar } from '../rpc/types';

export type WorkspaceSyncRpcController = Readonly<{
  get(relationshipId: string, signal?: AbortSignal): Promise<WorkspaceSyncStatusV1 | null>;
  list(signal?: AbortSignal): Promise<readonly WorkspaceSyncStatusV1[]>;
  flush(relationshipId: string, signal?: AbortSignal): Promise<WorkspaceSyncStatusV1>;
  pause(relationshipId: string, signal?: AbortSignal): Promise<WorkspaceSyncStatusV1>;
  resume(relationshipId: string, signal?: AbortSignal): Promise<WorkspaceSyncStatusV1>;
  terminate(relationshipId: string, signal?: AbortSignal): Promise<void>;
  listConflicts(relationshipId: string, signal?: AbortSignal): Promise<WorkspaceSyncConflictListV1>;
  deleteConflictLoser(request: DeleteWorkspaceSyncConflictLoserV1, signal?: AbortSignal): Promise<WorkspaceSyncStatusV1>;
  readFile(request: ReadWorkspaceSyncFileV1, signal?: AbortSignal): Promise<ReadWorkspaceSyncFileResultV1>;
}>;

export type MachineWorkspaceSyncRpcService = Readonly<{
  controller: WorkspaceSyncRpcController;
  deleteConflictLoserAtTarget(
    request: WorkspaceSyncTargetConflictDeleteV1,
    signal?: AbortSignal,
  ): Promise<void>;
  readFileAtTarget(
    request: WorkspaceSyncTargetFileReadV1,
    signal?: AbortSignal,
  ): Promise<ReadWorkspaceSyncFileResultV1>;
  prepareBootstrapAtTarget(
    request: WorkspaceSyncTargetBootstrapPrepareV1,
    signal?: AbortSignal,
  ): Promise<WorkspaceSyncTargetBootstrapPrepareResultV1>;
  releaseBootstrapAtTarget(
    request: WorkspaceSyncTargetBootstrapReleaseV1,
    signal?: AbortSignal,
  ): Promise<WorkspaceSyncTargetBootstrapReleaseResultV1>;
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

export function registerMachineWorkspaceSyncRpcHandlers(params: Readonly<{
  rpcHandlerManager: RpcHandlerRegistrar;
  service?: MachineWorkspaceSyncRpcService;
}>): void {
  const service = (): MachineWorkspaceSyncRpcService => params.service ?? unavailable();
  const signal = (value: AbortSignal | undefined): AbortSignal => value ?? new AbortController().signal;

  params.rpcHandlerManager.registerHandler(RPC_METHODS.DAEMON_WORKSPACE_SYNC_GET, async (raw, context) => {
    const request = WorkspaceSyncRelationshipIdV1Schema.parse(raw);
    const status = await service().controller.get(request.relationshipId, signal(context?.signal));
    return { status: status === null ? null : WorkspaceSyncStatusV1Schema.parse(status) };
  });
  params.rpcHandlerManager.registerHandler(RPC_METHODS.DAEMON_WORKSPACE_SYNC_LIST, async (raw, context) => {
    requireEmptyRequest(raw);
    const statuses = await service().controller.list(signal(context?.signal));
    return { statuses: statuses.map((status) => WorkspaceSyncStatusV1Schema.parse(status)) };
  });

  for (const [method, command] of [
    [RPC_METHODS.DAEMON_WORKSPACE_SYNC_FLUSH, 'flush'],
    [RPC_METHODS.DAEMON_WORKSPACE_SYNC_PAUSE, 'pause'],
    [RPC_METHODS.DAEMON_WORKSPACE_SYNC_RESUME, 'resume'],
  ] as const) {
    params.rpcHandlerManager.registerHandler(method, async (raw, context) => {
      const request = WorkspaceSyncRelationshipIdV1Schema.parse(raw);
      const status = await service().controller[command](request.relationshipId, signal(context?.signal));
      return { status: WorkspaceSyncStatusV1Schema.parse(status) };
    });
  }

  params.rpcHandlerManager.registerHandler(RPC_METHODS.DAEMON_WORKSPACE_SYNC_TERMINATE, async (raw, context) => {
    const request = WorkspaceSyncRelationshipIdV1Schema.parse(raw);
    await service().controller.terminate(request.relationshipId, signal(context?.signal));
    return { ok: true as const };
  });
  params.rpcHandlerManager.registerHandler(RPC_METHODS.DAEMON_WORKSPACE_SYNC_CONFLICTS_LIST, async (raw, context) => {
    const request = WorkspaceSyncRelationshipIdV1Schema.parse(raw);
    return WorkspaceSyncConflictListV1Schema.parse(
      await service().controller.listConflicts(request.relationshipId, signal(context?.signal)),
    );
  });
  params.rpcHandlerManager.registerHandler(RPC_METHODS.DAEMON_WORKSPACE_SYNC_CONFLICT_DELETE, async (raw, context) => {
    const request = DeleteWorkspaceSyncConflictLoserV1Schema.parse(raw);
    const status = await service().controller.deleteConflictLoser(request, signal(context?.signal));
    return { status: WorkspaceSyncStatusV1Schema.parse(status) };
  });
  params.rpcHandlerManager.registerHandler(RPC_METHODS.DAEMON_WORKSPACE_SYNC_FILE_READ, async (raw, context) => {
    const request = ReadWorkspaceSyncFileV1Schema.parse(raw);
    return ReadWorkspaceSyncFileResultV1Schema.parse(
      await service().controller.readFile(request, signal(context?.signal)),
    );
  });
  params.rpcHandlerManager.registerHandler(RPC_METHODS.DAEMON_WORKSPACE_SYNC_TARGET_CONFLICT_DELETE, async (raw, context) => {
    const request = WorkspaceSyncTargetConflictDeleteV1Schema.parse(raw);
    await service().deleteConflictLoserAtTarget(request, signal(context?.signal));
    return { ok: true as const };
  });
  params.rpcHandlerManager.registerHandler(RPC_METHODS.DAEMON_WORKSPACE_SYNC_TARGET_FILE_READ, async (raw, context) => {
    const request = WorkspaceSyncTargetFileReadV1Schema.parse(raw);
    return ReadWorkspaceSyncFileResultV1Schema.parse(
      await service().readFileAtTarget(request, signal(context?.signal)),
    );
  });
  params.rpcHandlerManager.registerHandler(RPC_METHODS.DAEMON_WORKSPACE_SYNC_TARGET_BOOTSTRAP_PREPARE, async (raw, context) => {
    const request = WorkspaceSyncTargetBootstrapPrepareV1Schema.parse(raw);
    return WorkspaceSyncTargetBootstrapPrepareResultV1Schema.parse(
      await service().prepareBootstrapAtTarget(request, signal(context?.signal)),
    );
  });
  params.rpcHandlerManager.registerHandler(RPC_METHODS.DAEMON_WORKSPACE_SYNC_TARGET_BOOTSTRAP_RELEASE, async (raw, context) => {
    const request = WorkspaceSyncTargetBootstrapReleaseV1Schema.parse(raw);
    return WorkspaceSyncTargetBootstrapReleaseResultV1Schema.parse(
      await service().releaseBootstrapAtTarget(request, signal(context?.signal)),
    );
  });
}
