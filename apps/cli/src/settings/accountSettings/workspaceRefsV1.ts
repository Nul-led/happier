import {
    type WorkspaceRefV1,
} from '@happier-dev/protocol';

import { getPathRemainderWithinBase } from '@/session/handoff/paths/sessionHandoffPathNormalization';

function normalizeIdentifier(value: string): string {
    return value.trim();
}

/** Resolve an Account-settings workspace identity only when the id is unique. */
export function resolveWorkspaceRefById(
    workspaceRefs: readonly WorkspaceRefV1[],
    workspaceRefId: string,
): WorkspaceRefV1 | null {
    const id = normalizeIdentifier(workspaceRefId);
    if (!id) return null;
    const matches = workspaceRefs.filter((ref) => normalizeIdentifier(ref.id) === id);
    return matches.length === 1 ? matches[0] ?? null : null;
}

export function resolveWorkspaceRefForMachineRoot(
    workspaceRefs: readonly WorkspaceRefV1[],
    scope: Readonly<{ machineId: string; rootPath: string }>,
): WorkspaceRefV1 | null {
    const machineId = normalizeIdentifier(scope.machineId);
    const rootPath = scope.rootPath.trim();
    if (!machineId || !rootPath) return null;
    const matches = workspaceRefs.filter((ref) => (
        normalizeIdentifier(ref.machineId) === machineId
        && getPathRemainderWithinBase(ref.rootPath, rootPath) === ''
    ));
    return matches.length === 1 ? matches[0] ?? null : null;
}
