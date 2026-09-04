import {
  normalizeSessionHandoffWorkspaceRootPath,
  type HandoffWorkspaceActionV1,
  type WorkspaceRefV1,
  type WorkspaceSyncRelationshipV1,
} from '@happier-dev/protocol';

import { resolveWorkspaceRefForMachineRoot } from '@/settings/accountSettings/workspaceRefsV1';
import { validateWorkspaceSyncRelationship } from '@/workspaces/sync/workspaceSyncSettings';

export type SessionHandoffWorkspaceContext = Readonly<{
  sourceWorkspaceRefId: string;
  targetWorkspaceRefId: string;
  sourceRootPath: string;
  targetRootPath: string;
  controllerMachineId: string;
  contentSelection: 'git_worktree' | 'all_files';
}>;

/**
 * Resolves an existing relationship's handoff endpoints. `copy_once` and
 * `create_relationship` materialize their `WorkspaceRef` values inside the
 * daemon relationship owner instead, so no caller-supplied endpoint identity is
 * representable here.
 */
export type ResolveSessionHandoffWorkspaceContextInput = Readonly<{
  action: Extract<HandoffWorkspaceActionV1, Readonly<{ kind: 'relationship' }>>;
  workspaceRefs: readonly WorkspaceRefV1[];
  relationships: readonly WorkspaceSyncRelationshipV1[];
  sourceMachineId: string;
  sourceRootPath?: string;
  targetMachineId: string;
  targetRootPath?: string;
}>;

function contextError(code: string, message: string): Error {
  return Object.assign(new Error(message), { code });
}

function exactRefById(refs: readonly WorkspaceRefV1[], id: string): WorkspaceRefV1 | null {
  const normalizedId = id.trim();
  if (!normalizedId) return null;
  const matches = refs.filter((ref) => ref.id.trim() === normalizedId);
  return matches.length === 1 ? matches[0]! : null;
}

function exactRefByScope(
  refs: readonly WorkspaceRefV1[],
  machineId: string,
  rootPath: string,
): WorkspaceRefV1 | null {
  return resolveWorkspaceRefForMachineRoot(refs, { machineId, rootPath });
}

function normalizedRoot(value: unknown): string {
  return normalizeSessionHandoffWorkspaceRootPath(value)
    ?? (() => { throw contextError('workspace_root_unsafe', 'Workspace sync root is unsafe'); })();
}

export function resolveSessionHandoffWorkspaceContext(
  input: ResolveSessionHandoffWorkspaceContextInput,
): SessionHandoffWorkspaceContext {
  const action = input.action;
  const sourceMachineId = input.sourceMachineId.trim();
  const targetMachineId = input.targetMachineId.trim();
  const sourceRootPath = normalizedRoot(input.sourceRootPath);
  if (!sourceMachineId || !targetMachineId) {
    throw contextError('workspace_ref_not_ready', 'Workspace sync machine identity is unavailable');
  }

  const relationshipMatches = input.relationships.filter((candidate) => (
    candidate.relationshipId.trim() === action.relationshipId.trim() && candidate.enabled
  ));
  if (relationshipMatches.length !== 1) {
    throw contextError('relationship_not_ready', 'Workspace sync relationship is not ready');
  }
  const relationship = validateWorkspaceSyncRelationship(relationshipMatches[0]!);
  const alpha = exactRefById(input.workspaceRefs, relationship.alphaWorkspaceRefId);
  const beta = exactRefById(input.workspaceRefs, relationship.betaWorkspaceRefId);
  if (!alpha || !beta) {
    throw contextError('workspace_ref_not_ready', 'Workspace sync relationship endpoint is unavailable');
  }
  const sourceByScope = exactRefByScope(input.workspaceRefs, sourceMachineId, sourceRootPath);
  if (!sourceByScope || (sourceByScope.id !== alpha.id && sourceByScope.id !== beta.id)) {
    throw contextError('relationship_source_mismatch', 'Source workspace is not an endpoint of the selected relationship');
  }
  const target = sourceByScope.id === alpha.id ? beta : alpha;
  if (target.machineId.trim() !== targetMachineId) {
    throw contextError('relationship_target_mismatch', 'Target machine is not the opposite relationship endpoint');
  }
  const targetRootPath = normalizedRoot(target.rootPath);
  if (input.targetRootPath !== undefined) {
    const requestedTargetRoot = normalizedRoot(input.targetRootPath);
    const requestedTarget = exactRefByScope(input.workspaceRefs, targetMachineId, requestedTargetRoot);
    if (!requestedTarget || requestedTarget.id !== target.id) {
      throw contextError('relationship_target_mismatch', 'Target path is not the opposite relationship endpoint');
    }
  }
  return {
    sourceWorkspaceRefId: sourceByScope.id,
    targetWorkspaceRefId: target.id,
    sourceRootPath: sourceByScope.rootPath,
    targetRootPath,
    controllerMachineId: relationship.controllerMachineId,
    contentSelection: relationship.contentPolicy.selection,
  };
}
