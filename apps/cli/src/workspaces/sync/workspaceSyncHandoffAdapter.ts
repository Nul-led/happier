import {
  type ManagedWorkspaceSync,
  type WorkspaceSyncCopyOnceV1,
} from './workspaceSyncTypes';
import { validateWorkspaceSyncContentPolicy } from './workspaceSyncSettings';
import type { HandoffTargetReplacementApprovalV1, HandoffWorkspaceActionV1 } from '@happier-dev/protocol';
import type { WorkspaceRootOwnershipHandle } from './workspaceSyncRootOwnership';
import type {
  PreparedWorkspaceSyncRelationship,
  WorkspaceSyncRelationshipOwner,
} from './workspaceSyncRelationshipOwner';

/**
 * Handoff's only workspace integration seam.  The adapter deliberately knows
 * about product actions and lifecycle, while ManagedWorkspaceSync owns all
 * Mutagen/session mechanics.
 */

export type WorkspaceSyncHandoffAction = HandoffWorkspaceActionV1;

export type PrepareWorkspaceSyncHandoffInput = Readonly<{
  operationId: string;
  /** Host-derived Account Home scope, required only for relationship creation. */
  accountServerId?: string;
  targetReplacementApproval?: HandoffTargetReplacementApprovalV1;
  action: WorkspaceSyncHandoffAction;
  sourceMachineId: string;
  targetMachineId: string;
  sourceWorkspaceRefId?: string;
  targetWorkspaceRefId?: string;
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
  relationshipOwner?: Pick<WorkspaceSyncRelationshipOwner, 'materializeEndpoints' | 'prepareCreate'>;
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
  relationshipTransaction?: PreparedWorkspaceSyncRelationship;
}>;

function copyOnceInput(input: PrepareWorkspaceSyncHandoffInput): WorkspaceSyncCopyOnceV1 {
  if (input.action.kind !== 'copy_once') throw new Error('workspace sync action is not copy_once');
  if (!input.sourceWorkspaceRefId || !input.targetWorkspaceRefId) {
    throw Object.assign(new Error('Workspace copy endpoints are unavailable'), { code: 'workspace_ref_not_ready' });
  }
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
      const existingOperation = preparedByOperation.get(input.operationId);
      if (existingOperation) {
        const existingInput = existingOperation.input;
        const matches = existingInput.accountServerId === input.accountServerId
          && existingInput.sourceMachineId === input.sourceMachineId
          && existingInput.targetMachineId === input.targetMachineId
          && existingInput.sourceWorkspaceRefId === input.sourceWorkspaceRefId
          && existingInput.targetWorkspaceRefId === input.targetWorkspaceRefId
          && existingInput.sourceRootPath === input.sourceRootPath
          && existingInput.targetRootPath === input.targetRootPath
          && JSON.stringify(existingInput.action) === JSON.stringify(input.action);
        if (!matches) {
          throw Object.assign(new Error('Workspace sync operation identity is already in use'), {
            code: 'workspace_sync_operation_conflict',
          });
        }
        return existingOperation.prepared;
      }
      if (input.action.kind !== 'none' && (!input.sourceRootPath.trim() || !input.targetRootPath.trim())) {
        throw Object.assign(new Error('workspace_root_unsafe'), { code: 'workspace_root_unsafe' });
      }
      if (input.action.kind === 'copy_once') validateWorkspaceSyncContentPolicy(input.action.contentPolicy);
      if (input.action.kind === 'create_relationship') {
        if (!deps.relationshipOwner) {
          throw Object.assign(new Error('Workspace relationship owner is unavailable'), { code: 'workspace_sync_unavailable' });
        }
        const accountServerId = input.accountServerId?.trim();
        if (!accountServerId) {
          throw Object.assign(new Error('Workspace relationship Account Home is unavailable'), { code: 'workspace_ref_not_ready' });
        }
        const relationshipTransaction = await deps.relationshipOwner.prepareCreate({
          operationId: input.operationId,
          serverId: accountServerId,
          sourceMachineId: input.sourceMachineId,
          sourceRootPath: input.sourceRootPath,
          targetMachineId: input.targetMachineId,
          targetRootPath: input.targetRootPath,
          mode: input.action.mode,
          contentPolicy: validateWorkspaceSyncContentPolicy(input.action.contentPolicy),
          // Bootstrap mechanics are daemon-owned. New targets are inspected
          // under target custody; a non-empty replacement still fails closed
          // until the canonical Action approval is replayed.
          targetBootstrap: 'materialize_from_source_workspace',
          ...(input.targetReplacementApproval ? { targetReplacementApproval: input.targetReplacementApproval } : {}),
          flushBeforeCommit: true,
          ...(input.signal ? { signal: input.signal } : {}),
        });
        const prepared: WorkspaceSyncHandoffPrepared = {
          kind: input.action.kind,
          operationId: input.operationId,
          relationshipId: relationshipTransaction.relationship.relationshipId,
          action: input.action,
          status: relationshipTransaction.status,
        };
        preparedByOperation.set(input.operationId, { prepared, input, relationshipTransaction });
        return prepared;
      }
      let effectiveInput = input;
      if (input.action.kind === 'copy_once' && (!input.sourceWorkspaceRefId || !input.targetWorkspaceRefId)) {
        const accountServerId = input.accountServerId?.trim();
        if (!deps.relationshipOwner || !accountServerId) {
          throw Object.assign(new Error('Workspace copy Account Home is unavailable'), { code: 'workspace_ref_not_ready' });
        }
        const endpoints = await deps.relationshipOwner.materializeEndpoints({
          serverId: accountServerId,
          sourceMachineId: input.sourceMachineId,
          sourceRootPath: input.sourceRootPath,
          targetMachineId: input.targetMachineId,
          targetRootPath: input.targetRootPath,
          ...(input.signal ? { signal: input.signal } : {}),
        });
        effectiveInput = {
          ...input,
          sourceWorkspaceRefId: endpoints.source.id,
          targetWorkspaceRefId: endpoints.target.id,
        };
      }
      if (input.action.kind !== 'none' && typeof deps.bootstrap !== 'function') {
        throw Object.assign(new Error('Workspace sync bootstrap authority is unavailable'), { code: 'workspace_sync_unavailable' });
      }
      const fence = input.action.kind === 'none' ? undefined : await deps.bootstrap(effectiveInput);
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
        preparedByOperation.set(input.operationId, { prepared, input: effectiveInput, ...(fence ? { fence } : {}) });
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
      } else if (prepared.action.kind === 'create_relationship' && prepared.relationshipId) {
        // prepareCreate's first flush proves the relationship is ready while
        // the source is live; this second flush captures the final delta only
        // after the handoff coordinator has quiesced that source. The new
        // relationship is intentionally not durable yet, so it must use the
        // daemon-local engine rather than the settings-backed controller.
        status = await deps.sync.flush(prepared.relationshipId, input.signal);
      }
      // A newly-created relationship becomes durable only after the engine has
      // completed the final source-quiesced flush, and before target custody is
      // committed. The later adapter commit is cleanup-only.
      await operation?.relationshipTransaction?.commit();
      if (operation) preparedByOperation.set(input.operationId, { ...operation, finalized: true, finalizedStatus: status });
      return {
        kind: prepared.action.kind,
        operationId: input.operationId,
        ...(prepared.action.kind === 'relationship'
          ? { relationshipId: prepared.action.relationshipId }
          : prepared.action.kind === 'create_relationship' && prepared.relationshipId
            ? { relationshipId: prepared.relationshipId }
            : {}),
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
      // Target custody is already committed. This phase releases only the
      // prepare fence; durable relationship publication happened in finalize.
      // Keep prepared authority until release succeeds so cleanup is retryable.
      await operation?.fence?.release('commit');
      preparedByOperation.delete(input.operationId);
      return {
        kind: action.kind,
        operationId: input.operationId,
        ...(action.kind === 'relationship'
          ? { relationshipId: action.relationshipId }
          : action.kind === 'create_relationship' && prepared.relationshipId
            ? { relationshipId: prepared.relationshipId }
            : {}),
        ...(status === undefined ? {} : { status }),
      };
    },

    async abort(input: AbortWorkspaceSyncHandoffInput): Promise<void> {
      const operation = preparedByOperation.get(input.operationId);
      const cleanup = await Promise.allSettled([
        ...(operation?.prepared.action.kind === 'copy_once'
          ? [deps.sync.terminate(input.operationId)]
          : []),
        ...(operation?.relationshipTransaction
          ? [operation.relationshipTransaction.abort()]
          : []),
        ...(operation?.fence
          ? [operation.fence.release('abort')]
          : []),
      ]);
      const failures = cleanup.flatMap((result) => result.status === 'rejected' ? [result.reason] : []);
      if (failures.length === 1) throw failures[0];
      if (failures.length > 1) {
        throw new AggregateError(failures, 'Workspace handoff abort cleanup failed');
      }
      preparedByOperation.delete(input.operationId);
    },
  };
}
