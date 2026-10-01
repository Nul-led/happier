import { useRouter } from '@/components/appShell/workspace/destinationRoute';

import { buildNewSessionTempDataFromSessionConfiguration } from '@/components/sessions/authoring/draft/sessionConfigurationSeed';
import { resolveNewSessionDraftRouteIdentity } from '@/components/sessions/new/navigation/newSessionDraftRouteIdentity';
import { buildNewSessionLaunchRouteParams } from '@/components/sessions/new/navigation/newSessionRouteParams';
import { storage, useSetting } from '@/sync/domains/state/storage';
import type { Session } from '@/sync/domains/state/storageTypes';
import { storeTempData } from '@/utils/sessions/tempDataStore';
import { readMachineControlTargetForSession } from '@/sync/ops/sessionMachineTarget';
import { useOpenProject } from '@/components/projects/useOpenProject';
import {
    useUniversalSearchRuntime,
    type UniversalSearchScopeSeed,
} from '@/components/appShell/search/UniversalSearchRuntimeContext';

import type { CreateSessionFromWorkspaceScopeOptions, NewSessionGroupTarget } from './resolveSessionListHeaderActionHandlers';

type WorkspaceScopeHint = Readonly<{
    serverId: string;
    machineId: string;
    rootPath: string;
}>;

function normalizeString(value: unknown): string | null {
    return typeof value === 'string' && value.trim().length > 0
        ? value.trim()
        : null;
}

function resolveSeedSession(sessionId: unknown): Session | null {
    const normalizedSessionId = normalizeString(sessionId);
    if (!normalizedSessionId) {
        return null;
    }
    const session = (storage.getState().sessions as Record<string, Session | undefined>)[normalizedSessionId];
    return session ?? null;
}

export function useSessionListNavigationActions(
    universalSearchScope?: UniversalSearchScopeSeed,
) {
    const router = useRouter();
    const openProject = useOpenProject();
    const universalSearch = useUniversalSearchRuntime();
    const rememberLastProjectSessionSelections = useSetting('rememberLastProjectSessionSelections') !== false;

    return {
        handleOpenProject(workspaceRefId: string) {
            openProject(workspaceRefId);
        },
        handleCreateSessionFromWorkspaceScope(
            target: NewSessionGroupTarget,
            options?: CreateSessionFromWorkspaceScopeOptions,
        ) {
            const draftId = resolveNewSessionDraftRouteIdentity({ routeDraftId: undefined }).draftId;
            if (!('rootPath' in target)) {
                // A machine's Chats group starts another no-folder session on that machine.
                const seedSession = rememberLastProjectSessionSelections
                    ? resolveSeedSession(options?.seedSessionId)
                    : null;
                const dataId = storeTempData(seedSession
                    ? buildNewSessionTempDataFromSessionConfiguration({ session: seedSession, machineId: target.machineId })
                    : { machineId: target.machineId, directoryKind: 'managed' });
                router.push({
                    pathname: '/new',
                    params: {
                        ...buildNewSessionLaunchRouteParams({
                            draftId,
                            machineId: target.machineId,
                            targetServerId: target.serverId,
                        }),
                        dataId,
                    },
                } as any);
                return;
            }
            const scopeHint: WorkspaceScopeHint = target;
            const seedSessionId = normalizeString(options?.seedSessionId);
            const seedSession = rememberLastProjectSessionSelections
                ? resolveSeedSession(seedSessionId)
                : null;
            const seedMachineTarget = seedSessionId
                ? readMachineControlTargetForSession(seedSessionId)
                : null;
            const directory = seedMachineTarget?.machineId === scopeHint.machineId
                ? seedMachineTarget.basePath
                : scopeHint.rootPath;
            if (seedSession) {
                const dataId = storeTempData(buildNewSessionTempDataFromSessionConfiguration({
                    session: seedSession,
                    machineId: scopeHint.machineId,
                    directoryOverride: directory,
                }));
                router.push({
                    pathname: '/new',
                    params: {
                        ...buildNewSessionLaunchRouteParams({
                            draftId,
                            machineId: scopeHint.machineId,
                            directory,
                            targetServerId: scopeHint.serverId,
                        }),
                        dataId,
                    },
                } as any);
                return;
            }
            router.push({
                pathname: '/new',
                params: buildNewSessionLaunchRouteParams({
                    draftId,
                    machineId: scopeHint.machineId,
                    directory,
                    targetServerId: scopeHint.serverId,
                }),
            } as any);
        },
        handleOpenArchivedSessions() {
            router.push('/session/archived');
        },
        /**
         * Escalates the contextual query through the canonical Search opener,
         * which chooses the modal or native route for the current platform.
         */
        handleOpenUniversalSearch(query: string) {
            const normalizedQuery = normalizeString(query);
            if (universalSearchScope) {
                universalSearch.open(normalizedQuery ?? undefined, universalSearchScope);
                return;
            }
            universalSearch.open(normalizedQuery ?? undefined);
        },
    };
}
