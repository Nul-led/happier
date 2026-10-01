import {
  type ManagedWorkspaceSync,
  type WorkspaceSyncCopyOnceV1,
} from './workspaceSyncTypes';
import { validateWorkspaceSyncContentPolicy } from './workspaceSyncSettings';
import type {
  HandoffTargetReplacementApprovalV1,
  HandoffWorkspaceActionV1,
  WorkspaceSyncPrepareBetweenResultV1,
  WorkspaceSyncStatusV1,
} from '@happier-dev/protocol';
import type { WorkspaceRootOwnershipHandle } from './workspaceSyncRootOwnership';
import type {
  PreparedWorkspaceSyncRelationship,
  WorkspaceSyncRelationshipOwner,
} from './workspaceSyncRelationshipOwner';
import { assertWorkspaceSyncStatusClean, prepareWorkspaceSyncRelationship } from './workspaceSyncPreparation';

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
  targetReplacementApprovalReceiptId?: string;
  targetReplacementApprovalActionInput?: unknown;
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
  /**
   * `true` when this operation persisted a new relationship definition, `false`
   * when an exact existing definition was reused. Absent for actions that
   * publish no relationship.
   */
  relationshipCreated?: boolean;
  action: WorkspaceSyncHandoffAction;
  status?: WorkspaceSyncStatusV1;
  traversed?: Extract<WorkspaceSyncPrepareBetweenResultV1, { ok: true }>['traversed'];
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
  relationshipCreated?: boolean;
  status?: WorkspaceSyncStatusV1;
  traversed?: Extract<WorkspaceSyncPrepareBetweenResultV1, { ok: true }>['traversed'];
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
  prepareBetween?: (
    request: Readonly<{ sourceWorkspaceRefId: string; targetWorkspaceRefId: string }>,
    signal?: AbortSignal,
  ) => Promise<WorkspaceSyncPrepareBetweenResultV1>;
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
  /** Retry identity remains the admitted request, before endpoint resolution. */
  admittedInput: PrepareWorkspaceSyncHandoffInput;
  executionInput: PrepareWorkspaceSyncHandoffInput;
  fence?: Readonly<{
    release(reason: 'abort' | 'commit'): Promise<void>;
    ownershipHandles?: readonly WorkspaceRootOwnershipHandle[];
  }>;
  finalizedStatus?: WorkspaceSyncStatusV1;
  finalizedRoute?: Extract<WorkspaceSyncPrepareBetweenResultV1, { ok: true }>['traversed'];
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

async function prepareLinkedRoute(
  deps: WorkspaceSyncHandoffAdapterDeps,
  input: PrepareWorkspaceSyncHandoffInput,
): Promise<Extract<WorkspaceSyncPrepareBetweenResultV1, { ok: true }>['traversed']> {
  if (!deps.prepareBetween) {
    throw Object.assign(new Error('Linked workspace preparation is unavailable'), { code: 'workspace_sync_unavailable' });
  }
  if (!input.sourceWorkspaceRefId || !input.targetWorkspaceRefId) {
    throw Object.assign(new Error('Linked workspace endpoints are unavailable'), { code: 'workspace_ref_not_ready' });
  }
  const result = await deps.prepareBetween({
    sourceWorkspaceRefId: input.sourceWorkspaceRefId,
    targetWorkspaceRefId: input.targetWorkspaceRefId,
  }, input.signal);
  if (!result.ok) {
    const completedIds = result.completed.map(({ relationshipId }) => relationshipId);
    const partial = completedIds.length > 0;
    const message = partial
      ? `Some files synchronized through ${completedIds.join(' → ')}; ${result.blockedRelationshipId ?? 'the next link'} is blocked (${result.errorCode})`
      : `Workspace preparation stopped at ${result.blockedRelationshipId ?? result.errorCode}`;
    throw Object.assign(new Error(message), {
      code: partial ? 'workspace_sync_partial_route_blocked' : result.errorCode,
      details: result,
    });
  }
  return result.traversed;
}

export function createWorkspaceSyncHandoffAdapter(deps: WorkspaceSyncHandoffAdapterDeps): WorkspaceSyncHandoffAdapter {
  const preparedByOperation = new Map<string, PreparedOperation>();
  const relationshipController = deps.relationshipController ?? deps.sync;

  return {
    async prepare(input: PrepareWorkspaceSyncHandoffInput): Promise<WorkspaceSyncHandoffPrepared> {
      input.signal?.throwIfAborted();
      const existingOperation = preparedByOperation.get(input.operationId);
      if (existingOperation) {
        const existingInput = existingOperation.admittedInput;
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
          ...(input.targetReplacementApprovalReceiptId ? {
            targetReplacementApprovalReceiptId: input.targetReplacementApprovalReceiptId,
            targetReplacementApprovalActionInput: input.targetReplacementApprovalActionInput,
          } : {}),
          flushBeforeCommit: true,
          ...(input.signal ? { signal: input.signal } : {}),
        });
        let preparedStatus: WorkspaceSyncStatusV1;
        try {
          preparedStatus = assertWorkspaceSyncStatusClean(relationshipTransaction.status);
        } catch (error) {
          try {
            await relationshipTransaction.abort();
          } catch (cleanupError) {
            throw new AggregateError(
              [error, cleanupError],
              'Workspace relationship preparation failed and cleanup is pending',
            );
          }
          throw error;
        }
        const prepared: WorkspaceSyncHandoffPrepared = {
          kind: input.action.kind,
          operationId: input.operationId,
          relationshipId: relationshipTransaction.relationship.relationshipId,
          relationshipCreated: !relationshipTransaction.reused,
          action: input.action,
          status: preparedStatus,
        };
        preparedByOperation.set(input.operationId, { prepared, admittedInput: input, executionInput: input, relationshipTransaction });
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
      const sameLinkedWorkspace = input.action.kind === 'linked_workspace'
        && input.sourceWorkspaceRefId !== undefined
        && input.sourceWorkspaceRefId === input.targetWorkspaceRefId;
      const fence = input.action.kind === 'none' || sameLinkedWorkspace ? undefined : await deps.bootstrap(effectiveInput);
      try {
        let status: WorkspaceSyncStatusV1 | undefined;
        let traversed: WorkspaceSyncHandoffPrepared['traversed'];
        if (input.action.kind === 'relationship') {
          // Initial materialization/readiness occurs while the source session
          // is still active. The coordinator performs finalize only after the
          // source has been quiesced.
          status = await prepareWorkspaceSyncRelationship(relationshipController, input.action.relationshipId, input.signal);
        } else if (input.action.kind === 'linked_workspace') {
          traversed = await prepareLinkedRoute(deps, effectiveInput);
        }
        const prepared: WorkspaceSyncHandoffPrepared = {
          kind: input.action.kind,
          operationId: input.operationId,
          action: input.action,
          ...(input.action.kind === 'relationship'
            ? { relationshipId: input.action.relationshipId, relationshipCreated: false }
            : {}),
          ...(status === undefined ? {} : { status }),
          ...(traversed === undefined ? {} : { traversed }),
        };
        preparedByOperation.set(input.operationId, { prepared, admittedInput: input, executionInput: effectiveInput, ...(fence ? { fence } : {}) });
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
      const preparedInput = operation?.executionInput;
      let status = prepared.status;
      let traversed = prepared.traversed;
      if (prepared.action.kind === 'copy_once') {
        if (!preparedInput) throw Object.assign(new Error('Workspace sync preparation authority is unavailable'), { code: 'workspace_sync_prepare_missing' });
        status = assertWorkspaceSyncStatusClean(
          await deps.sync.copyOnce(copyOnceInput(preparedInput), input.signal, operation?.fence?.ownershipHandles),
        );
      } else if (prepared.action.kind === 'relationship' && prepared.action.flushBeforeCommit) {
        status = await prepareWorkspaceSyncRelationship(relationshipController, prepared.action.relationshipId, input.signal);
      } else if (prepared.action.kind === 'create_relationship' && prepared.relationshipId) {
        // prepareCreate's first flush proves the relationship is ready while
        // the source is live; this second flush captures the final delta only
        // after the handoff coordinator has quiesced that source. Account
        // Settings already carries disabled intent, while the daemon-local
        // transient engine remains the only active runtime until final READY.
        status = await prepareWorkspaceSyncRelationship(deps.sync, prepared.relationshipId, input.signal);
      } else if (prepared.action.kind === 'linked_workspace') {
        if (!preparedInput) throw Object.assign(new Error('Workspace sync preparation authority is unavailable'), { code: 'workspace_sync_prepare_missing' });
        traversed = await prepareLinkedRoute(deps, preparedInput);
      }
      // After the final source-quiesced flush, the transaction publishes target
      // READY and settles replacement custody before enabling and reconciling
      // the durable relationship. The later adapter commit is cleanup-only.
      await operation?.relationshipTransaction?.commit();
      if (operation) preparedByOperation.set(input.operationId, { ...operation, finalized: true, finalizedStatus: status, finalizedRoute: traversed });
      return {
        kind: prepared.action.kind,
        operationId: input.operationId,
        ...(prepared.action.kind === 'relationship'
          ? { relationshipId: prepared.action.relationshipId, relationshipCreated: false }
          : prepared.action.kind === 'create_relationship' && prepared.relationshipId
            ? { relationshipId: prepared.relationshipId, relationshipCreated: prepared.relationshipCreated ?? true }
            : {}),
        ...(status === undefined ? {} : { status }),
        ...(traversed === undefined ? {} : { traversed }),
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
      const traversed = operation?.finalizedRoute ?? prepared.traversed;
      // Target custody is already committed. This phase releases only the
      // prepare fence; durable relationship publication happened in finalize.
      // Keep prepared authority until release succeeds so cleanup is retryable.
      await operation?.fence?.release('commit');
      preparedByOperation.delete(input.operationId);
      return {
        kind: action.kind,
        operationId: input.operationId,
        ...(action.kind === 'relationship'
          ? { relationshipId: action.relationshipId, relationshipCreated: false }
          : action.kind === 'create_relationship' && prepared.relationshipId
            ? { relationshipId: prepared.relationshipId, relationshipCreated: prepared.relationshipCreated ?? true }
            : {}),
        ...(status === undefined ? {} : { status }),
        ...(traversed === undefined ? {} : { traversed }),
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
