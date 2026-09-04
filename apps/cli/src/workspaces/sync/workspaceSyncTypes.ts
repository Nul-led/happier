import {
  computeWorkspaceSyncPolicyDigest as computeCanonicalWorkspaceSyncPolicyDigest,
  type DeleteWorkspaceSyncConflictLoserV1,
  type ReadWorkspaceSyncFileResultV1,
  type ReadWorkspaceSyncFileV1,
  type WorkspaceContentPolicyV1,
  type WorkspaceSyncConflictListV1,
  type WorkspaceSyncCopyOnceV1,
  type WorkspaceSyncRelationshipV1,
  type WorkspaceSyncStatusV1,
  type HandoffTargetReplacementApprovalV1,
} from '@happier-dev/protocol';
import type { WorkspaceRootOwnershipHandle } from './workspaceSyncRootOwnership';

export type {
  DeleteWorkspaceSyncConflictLoserV1,
  ReadWorkspaceSyncFileResultV1,
  ReadWorkspaceSyncFileV1,
  WorkspaceContentPolicyV1,
  WorkspaceSyncConflictListV1,
  WorkspaceSyncConflictV1,
  WorkspaceSyncCopyOnceV1,
  WorkspaceSyncModeV1,
  WorkspaceSyncPersistentModeV1,
  WorkspaceSyncRelationshipV1,
  WorkspaceSyncStatusV1,
} from '@happier-dev/protocol';

export function computeWorkspaceSyncPolicyDigest(policy: Omit<WorkspaceContentPolicyV1, 'policyDigest'>): string {
  return computeCanonicalWorkspaceSyncPolicyDigest(policy);
}

export type WorkspaceSyncRelationshipPreparation = Readonly<{
  transient: true;
  targetBootstrap: 'use_existing' | 'materialize_from_source_workspace';
  targetReplacementApproval?: HandoffTargetReplacementApprovalV1;
}>;

/** Daemon-local lifecycle interface; wire shapes remain protocol-owned. */
export interface ManagedWorkspaceSync {
  get(relationshipId: string, signal?: AbortSignal): Promise<WorkspaceSyncStatusV1 | null>;
  list(signal?: AbortSignal): Promise<readonly WorkspaceSyncStatusV1[]>;
  subscribe(relationshipId: string, signal: AbortSignal): AsyncIterable<WorkspaceSyncStatusV1>;
  ensure(definition: WorkspaceSyncRelationshipV1, signal?: AbortSignal, preparation?: WorkspaceSyncRelationshipPreparation): Promise<WorkspaceSyncStatusV1>;
  copyOnce(input: WorkspaceSyncCopyOnceV1, signal?: AbortSignal, ownershipHandles?: readonly WorkspaceRootOwnershipHandle[]): Promise<WorkspaceSyncStatusV1>;
  flush(relationshipId: string, signal?: AbortSignal): Promise<WorkspaceSyncStatusV1>;
  pause(relationshipId: string, signal?: AbortSignal): Promise<WorkspaceSyncStatusV1>;
  resume(relationshipId: string, signal?: AbortSignal): Promise<WorkspaceSyncStatusV1>;
  terminate(relationshipId: string, signal?: AbortSignal): Promise<void>;
  listConflicts(relationshipId: string, signal?: AbortSignal): Promise<WorkspaceSyncConflictListV1>;
  deleteConflictLoser(request: DeleteWorkspaceSyncConflictLoserV1, signal?: AbortSignal): Promise<WorkspaceSyncStatusV1>;
  readFile(request: ReadWorkspaceSyncFileV1, signal?: AbortSignal): Promise<ReadWorkspaceSyncFileResultV1>;
  withAuthorizedSourceSeedExport<T>(
    request: Readonly<{
      operationId: string;
      sourceWorkspaceRefId: string;
      targetMachineId: string;
      contentPolicy: WorkspaceContentPolicyV1;
    }>,
    exportSource: (canonicalSourcePath: string) => Promise<T>,
  ): Promise<T>;
  withSourceSeedAuthorization<T>(
    operation: WorkspaceSyncRelationshipV1 | WorkspaceSyncCopyOnceV1,
    ownershipHandles: readonly WorkspaceRootOwnershipHandle[],
    action: () => Promise<T>,
  ): Promise<T>;
}
