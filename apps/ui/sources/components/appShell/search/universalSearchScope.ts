import type { Session } from '@/sync/domains/state/storageTypes';
import type { WorkspaceRefV1 } from '@/sync/domains/workspaces/workspaceRefModel';
import type { ServerProfile } from '@/sync/domains/server/serverProfiles';
import type { UniversalSearchScopeSeed } from './UniversalSearchRuntimeContext';
import { buildUniversalSearchScopeKey } from './universalSearchResult';

export type UniversalSearchScopeChoice = Readonly<{
    key: string;
    label: string;
    scope: UniversalSearchScopeSeed;
}>;

export function buildUniversalSearchScopeKeyFromSeed(scope: UniversalSearchScopeSeed): string {
    return buildUniversalSearchScopeKey([
        scope.accountId,
        scope.serverId,
        scope.sessionId,
        scope.machineId,
        scope.rootPath,
    ]);
}

export function buildUniversalSearchScopeChoices(input: Readonly<{
    accountIdByServerId: ReadonlyMap<string, string>;
    profiles: readonly ServerProfile[];
    workspaces: readonly WorkspaceRefV1[];
    sessions: readonly Session[];
    readMachineTarget(sessionId: string): Readonly<{ machineId?: string; basePath?: string }> | null;
}>): readonly UniversalSearchScopeChoice[] {
    const choices: UniversalSearchScopeChoice[] = input.profiles.flatMap((profile) => {
        const accountId = input.accountIdByServerId.get(profile.id);
        if (!accountId) return [];
        const scope = {
            accountId,
            serverId: profile.id,
            sessionId: null,
            machineId: null,
            rootPath: null,
        } satisfies UniversalSearchScopeSeed;
        return [{ key: buildUniversalSearchScopeKeyFromSeed(scope), label: profile.name, scope }];
    });
    for (const workspace of input.workspaces) {
        const accountId = input.accountIdByServerId.get(workspace.serverId);
        if (!accountId) continue;
        const session = input.sessions.find((candidate) => {
            if (candidate.serverId !== workspace.serverId) return false;
            const target = input.readMachineTarget(candidate.id);
            return target?.machineId === workspace.machineId && target.basePath === workspace.rootPath;
        });
        const scope = {
            accountId,
            serverId: workspace.serverId,
            machineId: workspace.machineId,
            rootPath: workspace.rootPath,
            sessionId: session?.id ?? null,
        } satisfies UniversalSearchScopeSeed;
        choices.push({
            key: buildUniversalSearchScopeKeyFromSeed(scope),
            label: workspace.label?.trim() || workspace.rootPath,
            scope,
        });
    }
    return choices;
}
