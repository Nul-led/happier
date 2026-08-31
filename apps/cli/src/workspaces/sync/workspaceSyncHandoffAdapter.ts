import {
  type ManagedWorkspaceSync,
  type WorkspaceSyncCopyOnceV1,
} from './workspaceSyncTypes';
import { validateWorkspaceSyncContentPolicy } from './workspaceSyncSettings';
import type { HandoffWorkspaceActionV1 } from '@happier-dev/protocol';
import type { WorkspaceRootOwnershipHandle } from './workspaceSyncRootOwnership';

/**
 * Handoff's only workspace integration seam.  The adapter deliberately knows
 * about product actions and lifecycle, while ManagedWorkspaceSync owns all
 * Mutagen/session mechanics.
 */

export type WorkspaceSyncHandoffAction = HandoffWorkspaceActionV1;

export type PrepareWorkspaceSyncHandoffInput = Readonly<{
  operationId: string;
  action: WorkspaceSyncHandoffAction;
  sourceMachineId: string;
  targetMachineId: string;
  sourceWorkspaceRefId: string;
  targetWorkspaceRefId: string;
  sourceRootPath: string;
  targetRootPath: string;
  signal?: AbortSignal;
}>;

export type WorkspaceSyncHandoffPrepared = Readonly<{
  kind: WorkspaceSyncHandoffAction['kind'];
  operationId: string;
  relationshipId?: string;
  action: WorkspaceSyncHandoffAction;
  status?: unknown;
}>;

export type CommitWorkspaceSyncHandoffInput = Readonly<{
  operationId: string;
  prepared: WorkspaceSyncHandoffPrepared;
  signal?: AbortSignal;
}>;

export type WorkspaceSyncHandoffCommitted = Readonly<{
  kind: WorkspaceSyncHandoffAction['kind'];
  operationId: string;
  relationshipId?: string;
  status?: unknown;
}>;
export type FinalizeWorkspaceSyncHandoffInput = CommitWorkspaceSyncHandoffInput;
export type WorkspaceSyncHandoffFinalized = WorkspaceSyncHandoffCommitted;

export type AbortWorkspaceSyncHandoffInput = Readonly<{
  operationId: string;
  prepared?: WorkspaceSyncHandoffPrepared;
  signal?: AbortSignal;
}>;

export type WorkspaceSyncHandoffAdapterDeps = Readonly<{
  sync: ManagedWorkspaceSync;
  relationshipController?: Pick<ManagedWorkspaceSync, 'flush'>;
  bootstrap: (input: PrepareWorkspaceSyncHandoffInput) => Promise<Readonly<{
    release(reason: 'abort' | 'commit'): Promise<void>;
    ownershipHandles?: readonly WorkspaceRootOwnershipHandle[];
  }>>;
}>;

export interface WorkspaceSyncHandoffAdapter {
  prepare(input: PrepareWorkspaceSyncHandoffInput): Promise<WorkspaceSyncHandoffPrepared>;
  finalize(input: FinalizeWorkspaceSyncHandoffInput): Promise<WorkspaceSyncHandoffFinalized>;
  commit(input: CommitWorkspaceSyncHandoffInput): Promise<WorkspaceSyncHandoffCommitted>;
  abort(input: AbortWorkspaceSyncHandoffInput): Promise<void>;
}

type PreparedOperation = Readonly<{
  prepared: WorkspaceSyncHandoffPrepared;
  input: PrepareWorkspaceSyncHandoffInput;
  fence?: Readonly<{
    release(reason: 'abort' | 'commit'): Promise<void>;
    ownershipHandles?: readonly WorkspaceRootOwnershipHandle[];
  }>;
  finalizedStatus?: unknown;
  finalized?: boolean;
}>;

function copyOnceInput(input: PrepareWorkspaceSyncHandoffInput): WorkspaceSyncCopyOnceV1 {
  if (input.action.kind !== 'copy_once') throw new Error('workspace sync action is not copy_once');
  return {
    v: 1,
    operationId: input.operationId,
    controllerMachineId: input.sourceMachineId,
    alphaWorkspaceRefId: input.sourceWorkspaceRefId,
    betaWorkspaceRefId: input.targetWorkspaceRefId,
    contentPolicy: validateWorkspaceSyncContentPolicy(input.action.contentPolicy),
  };
}

export function createWorkspaceSyncHandoffAdapter(deps: WorkspaceSyncHandoffAdapterDeps): WorkspaceSyncHandoffAdapter {
  const preparedByOperation = new Map<string, PreparedOperation>();
  const relationshipController = deps.relationshipController ?? deps.sync;

  return {
    async prepare(input: PrepareWorkspaceSyncHandoffInput): Promise<WorkspaceSyncHandoffPrepared> {
      input.signal?.throwIfAborted();
      if (input.action.kind !== 'none' && (!input.sourceRootPath.trim() || !input.targetRootPath.trim())) {
        throw Object.assign(new Error('workspace_root_unsafe'), { code: 'workspace_root_unsafe' });
      }
      if (input.action.kind === 'copy_once') validateWorkspaceSyncContentPolicy(input.action.contentPolicy);
      if (input.action.kind !== 'none' && typeof deps.bootstrap !== 'function') {
        throw Object.assign(new Error('Workspace sync bootstrap authority is unavailable'), { code: 'workspace_sync_unavailable' });
      }
      const fence = input.action.kind === 'none' ? undefined : await deps.bootstrap(input);
      try {
        let status: unknown;
        if (input.action.kind === 'relationship') {
          // Initial materialization/readiness occurs while the source session
          // is still active. The coordinator performs finalize only after the
          // source has been quiesced.
          status = await relationshipController.flush(input.action.relationshipId, input.signal);
        }
        const prepared: WorkspaceSyncHandoffPrepared = {
          kind: input.action.kind,
          operationId: input.operationId,
          action: input.action,
          ...(input.action.kind === 'relationship' ? { relationshipId: input.action.relationshipId } : {}),
          ...(status === undefined ? {} : { status }),
        };
        preparedByOperation.set(input.operationId, { prepared, input, ...(fence ? { fence } : {}) });
        return prepared;
      } catch (error) {
        await fence?.release('abort');
        throw error;
      }
    },

    async finalize(input: FinalizeWorkspaceSyncHandoffInput): Promise<WorkspaceSyncHandoffFinalized> {
      input.signal?.throwIfAborted();
      const operation = preparedByOperation.get(input.operationId);
      if (!operation && input.prepared.action.kind !== 'none') {
        throw Object.assign(new Error('Workspace sync preparation authority is unavailable'), { code: 'workspace_sync_prepare_missing' });
      }
      const prepared = operation?.prepared ?? input.prepared;
      const preparedInput = operation?.input;
      let status = prepared.status;
      if (prepared.action.kind === 'copy_once') {
        if (!preparedInput) throw Object.assign(new Error('Workspace sync preparation authority is unavailable'), { code: 'workspace_sync_prepare_missing' });
        status = await deps.sync.copyOnce(copyOnceInput(preparedInput), input.signal, operation?.fence?.ownershipHandles);
      } else if (prepared.action.kind === 'relationship' && prepared.action.flushBeforeCommit) {
        status = await relationshipController.flush(prepared.action.relationshipId, input.signal);
      }
      if (operation) preparedByOperation.set(input.operationId, { ...operation, finalized: true, finalizedStatus: status });
      return {
        kind: prepared.action.kind,
        operationId: input.operationId,
        ...(prepared.action.kind === 'relationship' ? { relationshipId: prepared.action.relationshipId } : {}),
        ...(status === undefined ? {} : { status }),
      };
    },

    async commit(input: CommitWorkspaceSyncHandoffInput): Promise<WorkspaceSyncHandoffCommitted> {
      input.signal?.throwIfAborted();
      const operation = preparedByOperation.get(input.operationId);
      const prepared = operation?.prepared ?? input.prepared;
      const action = prepared.action;
      if (action.kind !== 'none' && !operation) {
        throw Object.assign(new Error('Workspace sync preparation authority is unavailable'), { code: 'workspace_sync_prepare_missing' });
      }
      if (action.kind !== 'none' && !operation?.finalized) {
        throw Object.assign(new Error('Workspace sync finalization is required before target resume'), { code: 'workspace_sync_finalize_missing' });
      }
      const status = operation?.finalizedStatus ?? prepared.status;
      // Commit only publishes the already-finalized result and releases the
      // prepare fence. It must not move bytes after target resume. Keep the
      // prepared authority until release succeeds so a transient target-side
      // cleanup failure remains safely retryable.
      await operation?.fence?.release('commit');
      preparedByOperation.delete(input.operationId);
      return {
        kind: action.kind,
        operationId: input.operationId,
        ...(action.kind === 'relationship' ? { relationshipId: action.relationshipId } : {}),
        ...(status === undefined ? {} : { status }),
      };
    },

    async abort(input: AbortWorkspaceSyncHandoffInput): Promise<void> {
      input.signal?.throwIfAborted();
      const operation = preparedByOperation.get(input.operationId);
      if (operation?.prepared.action.kind === 'copy_once') {
        await deps.sync.terminate(input.operationId, input.signal);
      }
      await operation?.fence?.release('abort');
      preparedByOperation.delete(input.operationId);
    },
  };
}
