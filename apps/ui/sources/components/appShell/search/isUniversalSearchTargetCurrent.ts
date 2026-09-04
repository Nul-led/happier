import type { ResolvedSettingsPageNode } from '@/components/settings/catalog/types';
import type { WorkspaceTargetForSession } from '@/sync/domains/session/resolveWorkspaceTargetForSession';
import type { WorkspaceRefV1 } from '@/sync/domains/workspaces/workspaceRefModel';
import { areServerProfileIdentifiersEquivalent } from '@/sync/domains/server/serverProfiles';
import {
    normalizeWorkspaceScopeBase,
    type WorkspaceScopeBase,
} from '@/sync/domains/workspaces/workspaceScope';
import type { UniversalSearchTarget } from './universalSearchResult';

function areWorkspaceScopesEqual(left: WorkspaceScopeBase, right: WorkspaceScopeBase): boolean {
    const normalizedLeft = normalizeWorkspaceScopeBase(left);
    const normalizedRight = normalizeWorkspaceScopeBase(right);
    return normalizedLeft !== null
        && normalizedRight !== null
        && areServerProfileIdentifiersEquivalent(normalizedLeft.serverId, normalizedRight.serverId)
        && normalizedLeft.machineId === normalizedRight.machineId
        && normalizedLeft.rootPath === normalizedRight.rootPath;
}

/**
 * Currentness fences authority/scope, not hydration. A transcript hit may name
 * an archived or unloaded session which the scoped navigation owner can still
 * materialize, so session presence in the UI store is deliberately irrelevant.
 */
export function isUniversalSearchTargetCurrent(input: Readonly<{
    target: UniversalSearchTarget;
    accountScope: Readonly<{ serverId: string; accountId: string; current: boolean }> | null;
    workspaces: readonly WorkspaceRefV1[];
    settingsPages: ReadonlyMap<string, ResolvedSettingsPageNode>;
    resolveSessionWorkspaceTarget: (target: Readonly<{
        serverId: string;
        accountId: string;
        sessionId: string;
    }>) => WorkspaceTargetForSession | null;
    isWorkspaceScopeReachable: (scope: WorkspaceScopeBase) => boolean;
}>): boolean {
    const { target } = input;
    if (target.kind === 'session') {
        return input.accountScope?.current === true
            && input.accountScope.accountId === target.accountId
            && areServerProfileIdentifiersEquivalent(input.accountScope.serverId, target.serverId);
    }
    if (target.kind === 'project') {
        return input.accountScope?.current === true
            && input.accountScope.accountId === target.accountId
            && areServerProfileIdentifiersEquivalent(input.accountScope.serverId, target.serverId)
            && input.workspaces.some((workspace) => workspace.id === target.workspaceRefId
                && areWorkspaceScopesEqual(workspace, target))
            && input.isWorkspaceScopeReachable(target);
    }
    if (target.kind === 'settingsPage') {
        return [...input.settingsPages.values()].some((page) => page.route === target.route);
    }
    if (!target.serverId) return false;
    const capturedScope = normalizeWorkspaceScopeBase(target.scope);
    if (
        input.accountScope?.current !== true
        || input.accountScope.accountId !== target.accountId
        || !areServerProfileIdentifiersEquivalent(input.accountScope.serverId, target.serverId)
        || capturedScope === null
        || !areServerProfileIdentifiersEquivalent(target.serverId, capturedScope.serverId)
    ) return false;
    if (target.workspaceRefId) {
        return input.workspaces.some((workspace) => workspace.id === target.workspaceRefId
            && areWorkspaceScopesEqual(workspace, capturedScope))
            && input.isWorkspaceScopeReachable(capturedScope);
    }
    if (!target.sessionId) return false;
    const currentScope = input.resolveSessionWorkspaceTarget({
        serverId: target.serverId,
        accountId: target.accountId,
        sessionId: target.sessionId,
    });
    return currentScope !== null
        && areWorkspaceScopesEqual(capturedScope, currentScope)
        && input.isWorkspaceScopeReachable(currentScope);
}
