import { readSessionDirectoryKind } from '@happier-dev/protocol';
import * as React from 'react';
import { Platform, View } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { useRouter } from 'expo-router';

import type { MemorySearchHitV1 } from '@happier-dev/protocol';
import { normalizeMemorySearchSessionId } from '@/sync/domains/memory/applyMemorySearchSessionEligibility';

import { useAppShellPluginUiProjection } from '@/components/appShell/plugins/AppShellPluginUiProjection';
import { useOptionalCurrentUiContextReader } from '@/components/appShell/currentUiContext/CurrentUiContextProvider';
import { useScopedPluginUiProjection } from '@/components/plugins/projection/useScopedPluginUiProjection';
import { usePluginSurfaceDestinationNavigationBinding } from '@/components/plugins/surfaces/pluginSurfaceDestinationNavigation';
import type { Command } from '@/components/appShell/commandPalette/types';
import { Modal } from '@/modal';
import { useNavigateToSession } from '@/hooks/session/useNavigateToSession';
import { useResolvedSettingsPageCatalog } from '@/components/settings/catalog/runtime/useResolvedSettingsPageCatalog';
import type { ResolvedSettingsPageNode } from '@/components/settings/catalog/types';
import { buildSettingsSearchRows, indexSettingsSearchPages } from '@/components/settings/shell/settingsSearchRows';
import {
    SelectionList,
    createDefaultDynamicSectionCache,
    type SelectionListDynamicSectionCache,
    type SelectionListOption,
    type SelectionListFilter,
    type SelectionListStep,
} from '@/components/ui/selectionList';
import {
    useAllMachines,
    useAllSessions,
    useSessionListRowsByServerId,
    useSessionOrganizationProjection,
} from '@/sync/store/hooks';
import { getSyncSingleton } from '@/sync/runtime/getSyncSingleton';
import { areServerAccountScopesEqual, createServerAccountScope } from '@/sync/domains/scope/serverAccountScope';
import { ensureSessionMetadataInventoryForServerAccountScope } from '@/sync/domains/session/fetchSessionMetadataInventoryForServerAccountScope';
import { storage, useSetting } from '@/sync/domains/state/storage';
import {
    captureActiveServerAccountScopeLifetime,
    type ActiveServerAccountScopeLifetime,
} from '@/sync/domains/scope/activeServerAccountScope';
import {
    useServerCredentialAccountScopes,
    type ServerCredentialAccountScopeBinding,
} from '@/sync/domains/scope/useServerCredentialAccountScopes';
import { searchDaemonMemory } from '@/sync/domains/memory/searchDaemonMemory';
import { searchHomeMemory } from '@/sync/domains/memory/searchHomeMemory';
import {
    useMemorySearchProvider,
} from '@/sync/domains/memory/useMemorySearchProvider';
import {
    captureMemorySearchSessionReadAuthority,
    authorizeMemorySearchResult,
    readMemorySearchSessionHydrationConcurrencyLimit,
    readMemorySearchSessionForServerScope,
} from '@/sync/domains/memory/hydrateMemorySearchSessionTargets';
import { searchWorkspaceFiles } from '@/sync/domains/workspaces/files/workspaceFileSearch';
import { searchWorkspaceCommits } from '@/scm/search/searchWorkspaceCommits';
import { readMachineControlTargetForSession } from '@/sync/ops/sessionMachineTarget';
import { resolveWorkspaceTargetForSession } from '@/sync/domains/session/resolveWorkspaceTargetForSession';
import { findWorkspaceRefByScope } from '@/sync/domains/workspaces/workspaceRefs';
import { isWorkspaceScopeReachable } from '@/sync/domains/workspaces/workspaceReachability';
import { getSessionName } from '@/utils/sessions/sessionUtils';
import { Icon } from '@/components/ui/icons/Icon';
import { getMachineDisplayName } from '@/utils/sessions/machineUtils';
import { t } from '@/text';
import { transcriptSearchUnavailableHint } from './transcriptSearchUnavailableHint';
import { readSessionListRowsForServerId } from '@/sync/domains/session/listing/sessionListRowStateLookup';
import {
    buildCanonicalSessionListPrimarySearchText,
    buildCanonicalSessionListSearchText,
} from '@/components/sessions/shell/useSessionListSearchTextByKey';
import { buildSessionOrganizationListViewState } from '@/sync/domains/session/organization/viewState';
import { sessionTagKey } from '@/components/sessions/shell/sessionTagUtils';
import type { TerminalJumpTarget } from '@/components/sessions/terminal/jump/terminalJumpTarget';
import { useTerminalJumpStep } from '@/components/sessions/terminal/jump/useTerminalJumpStep';
import { useTerminalJumpScopeChrome } from '@/components/sessions/terminal/jump/useTerminalJumpScopeChrome';

import { activateUniversalSearchResult } from './activateUniversalSearchResult';
import {
    buildUniversalSearchSections,
    findCommandForOptionId,
    type UniversalSearchProjectEntity,
    type UniversalSearchSessionEntity,
    type UniversalSearchSettingsPageEntity,
    type UniversalSearchSource,
} from './buildUniversalSearchSections';
import { buildPluginSearchProviderSections, type PluginSearchActivationOutcome } from './pluginSearchProviderSections';
import {
    buildUniversalSearchScopeKey,
    buildUniversalSearchSessionTitleKey,
    UNIVERSAL_SEARCH_SOURCE_IDS,
    type UniversalSearchResult,
} from './universalSearchResult';
import { UniversalSearchNativeHost } from './native/UniversalSearchNativeHost';
import { runUniversalSearchActivation } from './runUniversalSearchActivation';
import { isUniversalSearchTargetCurrent } from './isUniversalSearchTargetCurrent';
import { prepareUniversalSearchResult } from './prepareUniversalSearchResult';
import { buildUniversalSearchWorkspaceFileResults } from './workspaceFileSearchResults';
import { useOpenProject } from '@/components/projects/useOpenProject';
import { useServerProfilesGeneration } from '@/hooks/server/useServerProfilesGeneration';
import {
    areServerProfileIdentifiersEquivalent,
    listServerProfiles,
    resolveServerProfileScopeId,
    resolveServerProfileScopeIdForIdentifier,
} from '@/sync/domains/server/serverProfiles';
import {
    canonicalizeUniversalSearchScopeSeed,
    type UniversalSearchScopeSeed,
} from './UniversalSearchRuntimeContext';
import { resolveHomeDisplayLabel } from '@/components/settings/server/homeDisplayName';
import {
    buildUniversalSearchScopeChoices,
    buildUniversalSearchScopeKeyFromSeed,
} from './universalSearchScope';

const styles = StyleSheet.create(() => ({
    root: { flex: 1, minHeight: 0, width: '100%' },
}));

type PendingActivation = () => Promise<unknown>;

function useUniversalSearchDynamicCache(
    scope: UniversalSearchScopeSeed,
    credentialBinding: ServerCredentialAccountScopeBinding | null,
    pluginAccountLifetime: ActiveServerAccountScopeLifetime | null,
    pluginAccountLifetimeRevision: number,
): SelectionListDynamicSectionCache {
    const key = `${scope.serverId ?? ''}\u0000${scope.accountId ?? ''}\u0000${credentialBinding?.revision ?? -1}\u0000${pluginAccountLifetimeRevision}`;
    const cache = React.useMemo(() => createDefaultDynamicSectionCache(), [key]);
    React.useEffect(() => {
        const credentialRetirement = credentialBinding?.onRetire(() => cache.clear()) ?? null;
        const pluginRetirement = pluginAccountLifetime?.onRetire(() => cache.clear()) ?? null;
        return () => {
            credentialRetirement?.dispose();
            pluginRetirement?.dispose();
            cache.clear();
        };
    }, [cache, credentialBinding, key, pluginAccountLifetime]);
    return cache;
}

function useCurrentPluginAccountLifetime(): Readonly<{
    lifetime: ActiveServerAccountScopeLifetime | null;
    revision: number;
}> {
    const [, renderRetirement] = React.useReducer((value: number) => value + 1, 0);
    const lifetime = captureActiveServerAccountScopeLifetime();
    const identity = React.useRef({ lifetime, revision: 0 });
    if (identity.current.lifetime !== lifetime) {
        identity.current = { lifetime, revision: identity.current.revision + 1 };
    }
    React.useEffect(() => {
        if (!lifetime) return;
        const retirement = lifetime.onRetire(renderRetirement);
        return () => retirement.dispose();
    }, [lifetime]);
    return { lifetime, revision: identity.current.revision };
}

/** Every catalog page by id, so a settings result stays current only while its page is offered. */
function settingsPageNodesById(nodes: readonly ResolvedSettingsPageNode[]): ReadonlyMap<string, ResolvedSettingsPageNode> {
    const result = new Map<string, ResolvedSettingsPageNode>();
    const visit = (items: readonly ResolvedSettingsPageNode[]) => {
        for (const item of items) {
            result.set(item.id, item);
            if (item.children) visit(item.children);
        }
    };
    visit(nodes);
    return result;
}

function memoryHitResult(hit: MemorySearchHitV1, serverId: string, accountId: string, title: string): UniversalSearchResult {
    const sessionId = normalizeMemorySearchSessionId(hit.sessionId);
    return {
        id: `${sessionId}:${hit.seqFrom}:${hit.seqTo}`,
        scopeKey: buildUniversalSearchScopeKey([accountId, serverId, sessionId, hit.seqFrom, hit.seqTo]),
        sourceId: UNIVERSAL_SEARCH_SOURCE_IDS.transcript,
        kind: 'message',
        title,
        subtitle: hit.summary,
        target: { kind: 'session', serverId, accountId, sessionId, seq: hit.seqFrom },
    };
}

export type UniversalSearchControllerProps = Readonly<{
    commands: readonly Command[];
    initialQuery?: string;
    activeSessionId?: string | null;
    initialScope?: UniversalSearchScopeSeed;
    /** Open in the Terminals scope of this session pane (Jump to a terminal, terminal lab B4). */
    terminalJump?: TerminalJumpTarget;
    presentation: 'modal' | 'route';
    onRequestClose(): void;
}>;

function resolveInitialScope(props: Pick<UniversalSearchControllerProps, 'activeSessionId' | 'initialScope'>): UniversalSearchScopeSeed {
    if (props.initialScope) return canonicalizeUniversalSearchScopeSeed(props.initialScope);
    const activeAccountScope = captureActiveServerAccountScopeLifetime()?.scope;
    return canonicalizeUniversalSearchScopeSeed({
        accountId: activeAccountScope?.accountId ?? null,
        serverId: activeAccountScope?.serverId ?? null,
        sessionId: props.activeSessionId ?? null,
        machineId: null,
        rootPath: null,
    });
}

export function UniversalSearchController(props: UniversalSearchControllerProps): React.ReactElement {
    const { theme } = useUnistyles();
    const [scope, setScope] = React.useState<UniversalSearchScopeSeed>(() => resolveInitialScope(props));
    const [query, setQuery] = React.useState(() => props.initialQuery?.trim() ?? '');
    const [selectedOptionId, setSelectedOptionId] = React.useState<string | null>(null);
    const [sessionInventoryStatus, setSessionInventoryStatus] = React.useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
    // The Terminals scope (Jump): one session's terminals until the person drops the scope with ⌫
    // on an empty field or the chip's ×, then the ordinary search over everything.
    const [terminalScope, setTerminalScope] = React.useState<TerminalJumpTarget | null>(() => props.terminalJump ?? null);
    const terminalJump = useTerminalJumpStep({ target: terminalScope, query });
    const committedResultRef = React.useRef<UniversalSearchResult | null>(null);
    const committedPluginActivationRef = React.useRef<PendingActivation | null>(null);
    const profilesGeneration = useServerProfilesGeneration();
    const profiles = React.useMemo(() => listServerProfiles(), [profilesGeneration]);
    const credentialBindings = useServerCredentialAccountScopes(profiles.map(resolveServerProfileScopeId));
    const selectedCredentialBinding = scope.serverId
        ? credentialBindings.get(scope.serverId) ?? null
        : null;
    const selectedCredentialIsCurrent = selectedCredentialBinding?.isCurrent() === true
        && selectedCredentialBinding.accountId === scope.accountId;
    React.useEffect(() => {
        if (!scope.serverId || !selectedCredentialBinding || scope.accountId === selectedCredentialBinding.accountId) return;
        setScope((current) => current.serverId === scope.serverId
            ? { ...current, accountId: selectedCredentialBinding.accountId }
            : current);
    }, [scope.accountId, scope.serverId, selectedCredentialBinding]);
    const memoryProvider = useMemorySearchProvider(scope.serverId
        ? { kind: 'exact', serverId: scope.serverId, machineId: scope.machineId }
        : { kind: 'none' });
    const homeCredentialRevision = selectedCredentialBinding?.revision ?? -1;
    const pluginAccount = useCurrentPluginAccountLifetime();
    const dynamicSectionCache = useUniversalSearchDynamicCache(
        scope,
        selectedCredentialBinding,
        pluginAccount.lifetime,
        pluginAccount.revision,
    );
    const navigateToSession = useNavigateToSession();
    const router = useRouter();
    const openProject = useOpenProject();
    const settingsCatalog = useResolvedSettingsPageCatalog();
    const sessions = useAllSessions();
    const sessionListRowsByServerId = useSessionListRowsByServerId();
    const workspaceRefs = useSetting('workspaceRefsV1');
    const canonicalScopeServerId = scope.serverId
        ? resolveServerProfileScopeIdForIdentifier(scope.serverId)
        : null;
    const sessionOrganizationProjection = useSessionOrganizationProjection(canonicalScopeServerId);
    const sessionOrganizationListViewState = React.useMemo(() => buildSessionOrganizationListViewState({
        serverId: canonicalScopeServerId ?? '',
        projection: sessionOrganizationProjection,
    }), [canonicalScopeServerId, sessionOrganizationProjection]);
    const appShellPluginProjection = useAppShellPluginUiProjection();
    const scopedPluginProjectionEnabled = canonicalScopeServerId !== null && scope.machineId !== null;
    const scopedPluginProjection = useScopedPluginUiProjection({
        serverId: canonicalScopeServerId,
        machineId: scope.machineId,
        enabled: scopedPluginProjectionEnabled,
    });
    const appShellProjectionMatchesScope = Boolean(
        canonicalScopeServerId
        && (appShellPluginProjection.serverId == null
            || areServerProfileIdentifiersEquivalent(
                appShellPluginProjection.serverId,
                canonicalScopeServerId,
            )),
    );
    const pluginProjection = !scopedPluginProjectionEnabled && appShellProjectionMatchesScope
        ? appShellPluginProjection
        : scopedPluginProjection;
    const currentUiContextReader = useOptionalCurrentUiContextReader();
    const pluginNavigationBinding = usePluginSurfaceDestinationNavigationBinding();

    const hasSessionDiscoveryQuery = query.trim().length > 0;
    React.useEffect(() => {
        if (
            !hasSessionDiscoveryQuery
            || !scope.serverId
            || !scope.accountId
            || !selectedCredentialIsCurrent
            || !selectedCredentialBinding
        ) {
            setSessionInventoryStatus('idle');
            return;
        }
        const exactAccountScope = createServerAccountScope(scope.serverId, scope.accountId);
        if (!exactAccountScope) {
            setSessionInventoryStatus('error');
            return;
        }
        const controller = new AbortController();
        let current = true;
        setSessionInventoryStatus('loading');
        void ensureSessionMetadataInventoryForServerAccountScope({
            scope: exactAccountScope,
            accountLifetime: selectedCredentialBinding,
            signal: controller.signal,
        }).then(() => {
            if (current && !controller.signal.aborted && selectedCredentialBinding.isCurrent()) {
                setSessionInventoryStatus('ready');
            }
        }).catch((error: unknown) => {
            if (!current || controller.signal.aborted || !selectedCredentialBinding.isCurrent()) return;
            if (error instanceof Error && error.name === 'AbortError') return;
            setSessionInventoryStatus('error');
        });
        return () => {
            current = false;
            controller.abort();
        };
    }, [hasSessionDiscoveryQuery, scope.accountId, scope.serverId, selectedCredentialBinding, selectedCredentialIsCurrent]);

    const machines = useAllMachines();
    const machineNameById = React.useMemo(() => new Map(
        machines.flatMap((machine) => {
            const name = getMachineDisplayName(machine);
            return name ? [[machine.id, name] as const] : [];
        }),
    ), [machines]);
    const sessionEntities = React.useMemo<readonly UniversalSearchSessionEntity[]>(() => {
        if (!scope.serverId || !scope.accountId || !selectedCredentialIsCurrent) return [];
        const canonicalServerId = canonicalScopeServerId!;
        const rows = readSessionListRowsForServerId(sessionListRowsByServerId, canonicalServerId) ?? {};
        return Object.values(rows).map((session) => {
            const metadata = session.metadata;
            // A no-folder session is a chat, not a project: its private folder is never a label or a scope.
            const withoutFolder = readSessionDirectoryKind(metadata) === 'managed';
            const path = !withoutFolder && typeof metadata?.path === 'string' ? metadata.path : '';
            const machineId = typeof metadata?.machineId === 'string' ? metadata.machineId : '';
            const workspace = path && machineId
                ? findWorkspaceRefByScope(workspaceRefs, { serverId: canonicalServerId, machineId, rootPath: path })
                : null;
            // One quiet meta line: the project, then the machine it runs on ("happier · MacBook Pro").
            const projectLabel = withoutFolder
                ? t('session.folderless.chats')
                : workspace?.label?.trim() || path.split(/[\\/]/).filter(Boolean).pop() || '';
            const subtitle = [projectLabel, machineNameById.get(machineId) ?? ''].filter(Boolean).join(' · ');
            return {
                sessionId: session.id,
                serverId: canonicalServerId,
                accountId: scope.accountId!,
                title: getSessionName(session, canonicalServerId),
                ...(subtitle ? { subtitle } : {}),
                searchText: buildCanonicalSessionListSearchText({
                    sessionId: session.id,
                    renderable: session,
                    tags: (sessionOrganizationListViewState.sessionTagsV1[sessionTagKey(canonicalServerId, session.id)] ?? [])
                        .flatMap((tag) => tag.display.status === 'available' ? [tag.display.value] : []),
                    workspaceDisplayLabel: workspace?.label ?? null,
                }),
                exactSearchText: buildCanonicalSessionListPrimarySearchText({
                    sessionId: session.id,
                    renderable: session,
                    workspaceDisplayLabel: workspace?.label ?? null,
                }),
                updatedAt: session.updatedAt,
            };
        }).sort((a, b) => b.updatedAt - a.updatedAt);
    }, [canonicalScopeServerId, machineNameById, scope.accountId, scope.serverId, selectedCredentialIsCurrent, sessionListRowsByServerId, sessionOrganizationListViewState.sessionTagsV1, workspaceRefs]);
    const sessionNameByTarget = React.useMemo(
        () => new Map(sessionEntities.map((session) => [
            buildUniversalSearchSessionTitleKey(session.accountId, session.serverId, session.sessionId),
            session.title,
        ])),
        [sessionEntities],
    );
    const projects = React.useMemo<readonly UniversalSearchProjectEntity[]>(() => workspaceRefs
        .filter((workspace) => Boolean(scope.serverId && scope.accountId && selectedCredentialIsCurrent)
            && areServerProfileIdentifiersEquivalent(workspace.serverId, scope.serverId))
        .slice()
        .sort((a, b) => (b.lastOpenedAtMs ?? b.createdAtMs) - (a.lastOpenedAtMs ?? a.createdAtMs))
        .map((workspace) => ({
            workspaceRefId: workspace.id,
            serverId: resolveServerProfileScopeIdForIdentifier(workspace.serverId),
            accountId: scope.accountId!,
            machineId: workspace.machineId,
            rootPath: workspace.rootPath,
            title: workspace.label?.trim() || workspace.rootPath.split(/[\\/]/).filter(Boolean).pop() || workspace.rootPath,
            subtitle: workspace.rootPath,
            lastOpenedAtMs: workspace.lastOpenedAtMs ?? workspace.createdAtMs,
        })), [scope.accountId, scope.serverId, selectedCredentialIsCurrent, workspaceRefs]);

    const settingsPages = React.useMemo(() => indexSettingsSearchPages(settingsCatalog.tree), [settingsCatalog.tree]);
    const settingsById = React.useMemo(() => settingsPageNodesById(settingsCatalog.tree), [settingsCatalog.tree]);
    // One Settings group: the pages the query names, then individual settings, projected by the
    // same row owner as the settings rail (title + "Page › Section").
    const searchSettingsPages = React.useCallback((value: string): UniversalSearchSettingsPageEntity[] => {
        const { pageRows, settingRows } = buildSettingsSearchRows(settingsCatalog.search(value), settingsPages);
        return [...pageRows, ...settingRows].map((row) => ({
            id: row.kind === 'setting' ? `setting:${row.id}` : row.id,
            route: row.route,
            title: row.title,
            ...(row.subtitle ? { subtitle: row.subtitle } : {}),
        }));
    }, [settingsCatalog, settingsPages]);

    const transcript = React.useMemo<UniversalSearchSource>(() => {
        if (!scope.serverId) return { status: 'absent' };
        const unavailableReason = memoryProvider.unavailableReason;
        if (!selectedCredentialIsCurrent || !memoryProvider.provider) {
            return {
                status: 'unavailable',
                resolverKey: `transcript:${scope.accountId ?? ''}:${scope.serverId}:${homeCredentialRevision}:${unavailableReason ?? 'disabled'}`,
                hint: selectedCredentialIsCurrent
                    ? transcriptSearchUnavailableHint(unavailableReason)
                    : t('memorySearchSettings.status.unavailableLight'),
            };
        }
        const resolverKey = memoryProvider.provider === 'home'
            ? `home:${scope.accountId ?? ''}:${memoryProvider.homeServerId ?? ''}:${memoryProvider.homeReadiness ?? 'unknown'}:${homeCredentialRevision}`
            : `daemon:${scope.accountId ?? ''}:${memoryProvider.daemonTarget?.serverId ?? ''}:${memoryProvider.daemonTarget?.machineId ?? ''}`;
        if (!memoryProvider.queryAvailable) {
            return {
                status: 'unavailable',
                resolverKey,
                hint: transcriptSearchUnavailableHint(unavailableReason),
            };
        }
        return {
            status: 'ready',
            resolverKey,
            ...(memoryProvider.provider === 'daemon'
                ? { resultHint: t('memorySearchSettings.budgets.groupFooter') }
                : {}),
            resolve: async (value, signal) => {
                const serverId = memoryProvider.provider === 'home'
                    ? memoryProvider.homeServerId
                    : memoryProvider.daemonTarget?.serverId ?? null;
                const accountLifetime = selectedCredentialBinding;
                if (
                    !serverId
                    || !accountLifetime
                    || !accountLifetime.isCurrent()
                    || accountLifetime.accountId !== scope.accountId
                ) return [];
                const requestController = new AbortController();
                const abortRequest = () => requestController.abort();
                if (signal.aborted) abortRequest();
                else signal.addEventListener('abort', abortRequest, { once: true });
                const retirement = accountLifetime.onRetire(abortRequest);
                let authority: Awaited<ReturnType<typeof captureMemorySearchSessionReadAuthority>> | null = null;
                try {
                    authority = await captureMemorySearchSessionReadAuthority({
                        serverId,
                        accountId: accountLifetime.accountId,
                    });
                    if (requestController.signal.aborted || !accountLifetime.isCurrent()) return [];
                    const response = memoryProvider.provider === 'home'
                        ? await searchHomeMemory({ serverId: memoryProvider.homeServerId!, accountId: accountLifetime.accountId, query: value, scope: { type: 'global' }, mode: 'auto', maxResults: 20, signal: requestController.signal })
                        : await searchDaemonMemory({ serverId: memoryProvider.daemonTarget!.serverId, accountId: accountLifetime.accountId, machineId: memoryProvider.daemonTarget!.machineId, query: value, scope: { type: 'global' }, mode: 'auto', maxResults: 20, signal: requestController.signal });
                    if (!response.ok) throw new Error(response.error);
                    const normalizedHits = response.hits.flatMap<MemorySearchHitV1>((hit) => {
                        const sessionId = normalizeMemorySearchSessionId(hit.sessionId);
                        return sessionId ? [{ ...hit, sessionId }] : [];
                    });
                    const authorizedResponse = await authorizeMemorySearchResult({
                        result: { ...response, hits: normalizedHits },
                        serverId,
                        accountId: accountLifetime.accountId,
                        authority,
                        accountLifetime,
                        readSessionForServerScope: readMemorySearchSessionForServerScope,
                        concurrencyLimit: readMemorySearchSessionHydrationConcurrencyLimit(),
                        signal: requestController.signal,
                    });
                    if (
                        requestController.signal.aborted
                        || !accountLifetime.isCurrent()
                        || !authorizedResponse.ok
                    ) return [];
                    return authorizedResponse.hits.map((hit) => memoryHitResult(
                            hit,
                            serverId,
                            accountLifetime.accountId,
                            (() => {
                                const freshRow = readSessionListRowsForServerId(
                                    storage.getState().sessionListRowsByServerId,
                                    serverId,
                                )?.[hit.sessionId];
                                const freshTitle = freshRow ? getSessionName(freshRow, serverId).trim() : '';
                                const capturedTitle = sessionNameByTarget.get(buildUniversalSearchSessionTitleKey(
                                    accountLifetime.accountId,
                                    serverId,
                                    hit.sessionId,
                                ))?.trim() ?? '';
                                const title = freshTitle || capturedTitle;
                                return title && title !== hit.summary
                                    ? title
                                    : t('sessionsList.sessionFallbackLabel');
                            })(),
                        ));
                } finally {
                    retirement.dispose();
                    signal.removeEventListener('abort', abortRequest);
                    await authority?.release();
                }
            },
        };
    }, [homeCredentialRevision, memoryProvider, scope.accountId, scope.serverId, selectedCredentialBinding, selectedCredentialIsCurrent, sessionNameByTarget]);

    const activeSession = React.useMemo(
        () => scope.serverId && scope.accountId && pluginAccount.lifetime?.isCurrent() === true
            && areServerAccountScopesEqual(
                pluginAccount.lifetime.scope,
                createServerAccountScope(scope.serverId, scope.accountId),
            )
            ? sessions.find((session) => session.id === scope.sessionId
            && Boolean(scope.serverId)
            && areServerProfileIdentifiersEquivalent(session.serverId, scope.serverId)
            && readSessionListRowsForServerId(sessionListRowsByServerId, scope.serverId)?.[session.id] !== undefined) ?? null
            : null,
        [pluginAccount.lifetime, scope.accountId, scope.serverId, scope.sessionId, sessionListRowsByServerId, sessions],
    );
    const workspaceScope = React.useMemo(() => {
        if (scope.serverId && scope.machineId && scope.rootPath) {
            return { serverId: scope.serverId, machineId: scope.machineId, rootPath: scope.rootPath };
        }
        if (!activeSession) return null;
        const serverId = resolveServerProfileScopeIdForIdentifier(scope.serverId);
        const accountId = scope.accountId?.trim() ?? '';
        if (!serverId || !accountId) return null;
        const target = readMachineControlTargetForSession({
            serverId,
            accountId,
            sessionId: activeSession.id,
        });
        if (!target || !serverId || !target.machineId || !target.basePath) return null;
        return { serverId, machineId: target.machineId, rootPath: target.basePath };
    }, [activeSession, scope.accountId, scope.machineId, scope.rootPath, scope.serverId]);
    const workspaceResolverKey = workspaceScope
        ? `${workspaceScope.serverId}:${workspaceScope.machineId}:${workspaceScope.rootPath}:${selectedCredentialBinding?.accountId ?? ''}:${selectedCredentialBinding?.revision ?? -1}`
        : '';
    const workspaceRef = React.useMemo(
        () => workspaceScope ? findWorkspaceRefByScope(workspaceRefs, workspaceScope) : null,
        [workspaceRefs, workspaceScope],
    );
    const workspaceActivationAvailable = Boolean(activeSession || workspaceRef);
    // Workspace search must use the shared machine-liveness owner. A valid
    // Session/workspace reference with an offline machine is still a real
    // target, but it cannot answer until the machine is reachable; expose that
    // state as a non-activatable section hint instead of issuing a doomed RPC.
    const workspaceScopeReachable = workspaceScope ? isWorkspaceScopeReachable(workspaceScope) : false;
    const workspaceSearchAvailable = workspaceActivationAvailable && selectedCredentialIsCurrent;
    const workspaceUnavailableHint = t('newSession.machineOfflineInlineTitle');
    const files = React.useMemo<UniversalSearchSource>(() => {
        if (!workspaceScope || !workspaceSearchAvailable || !selectedCredentialBinding) return { status: 'absent' };
        if (!workspaceScopeReachable) {
            return {
                status: 'unavailable',
                resolverKey: `${workspaceResolverKey}|offline`,
                hint: workspaceUnavailableHint,
            };
        }
        return {
            status: 'ready',
            resolverKey: workspaceResolverKey,
            resolve: async (value, signal) => {
                const page = await searchWorkspaceFiles({
                    scope: workspaceScope,
                    query: value,
                    limit: 20,
                    resultType: 'file',
                    accountLifetime: selectedCredentialBinding,
                    signal,
                    includeCoverage: true,
                });
                return {
                    results: buildUniversalSearchWorkspaceFileResults({
                        files: page.items,
                        accountId: selectedCredentialBinding.accountId,
                        scope: workspaceScope,
                        workspaceRefId: workspaceRef?.id ?? null,
                        sessionId: activeSession?.id ?? null,
                    }),
                    ...(page.truncated
                        ? { resultHint: t('universalSearch.moreResultsAvailable') }
                        : {}),
                };
            },
        };
    }, [activeSession?.id, selectedCredentialBinding, workspaceRef?.id, workspaceResolverKey, workspaceScope, workspaceScopeReachable, workspaceSearchAvailable, workspaceUnavailableHint]);
    const commits = React.useMemo<UniversalSearchSource>(() => {
        if (!workspaceScope || !workspaceSearchAvailable || !selectedCredentialBinding) return { status: 'absent' };
        if (!workspaceScopeReachable) {
            return {
                status: 'unavailable',
                resolverKey: `${workspaceResolverKey}|offline`,
                hint: workspaceUnavailableHint,
            };
        }
        return {
            status: 'ready',
            resolverKey: workspaceResolverKey,
            resolve: async (value, signal) => {
                const outcome = await searchWorkspaceCommits({
                    scope: workspaceScope,
                    accountId: selectedCredentialBinding.accountId,
                    accountIsCurrent: () => selectedCredentialBinding.isCurrent(),
                    query: value,
                    limit: 20,
                    signal,
                });
                if (outcome.status === 'unavailable') throw new Error(outcome.message ?? outcome.reason);
                if (outcome.status === 'recentOnly') {
                    return {
                        results: [],
                        emptyHint: t('universalSearch.commitsUpdateRequired'),
                    };
                }
                return outcome.entries.map((entry) => ({
                    id: entry.sha,
                    scopeKey: buildUniversalSearchScopeKey([selectedCredentialBinding.accountId, workspaceScope.serverId, workspaceScope.machineId, workspaceScope.rootPath]),
                    sourceId: UNIVERSAL_SEARCH_SOURCE_IDS.commits,
                    kind: 'workspaceCommit',
                    title: entry.subject,
                    subtitle: `${entry.shortSha} · ${entry.authorName}`,
                    target: { kind: 'workspaceCommit', scope: workspaceScope, sha: entry.sha, workspaceRefId: workspaceRef?.id ?? null, sessionId: activeSession?.id ?? null, serverId: workspaceScope.serverId, accountId: selectedCredentialBinding.accountId },
                }));
            },
        };
    }, [activeSession?.id, selectedCredentialBinding, workspaceRef?.id, workspaceResolverKey, workspaceScope, workspaceScopeReachable, workspaceSearchAvailable, workspaceUnavailableHint]);

    const accountLifetime = pluginAccount.lifetime;
    const currentPluginProjectionRef = React.useRef(pluginProjection.pluginUiProjection);
    currentPluginProjectionRef.current = pluginProjection.pluginUiProjection;
    const pluginScopeIsCurrent = React.useCallback((pluginId: string, occurrenceId: string) => {
        const current = currentPluginProjectionRef.current;
        return accountLifetime !== null
            && accountLifetime.isCurrent()
            && Object.values(current?.searchProvidersById ?? {}).some((provider) => (
                provider.pluginId === pluginId && provider.occurrenceId === occurrenceId
            ));
    }, [accountLifetime]);
    const pluginSections = React.useMemo(() => buildPluginSearchProviderSections({
        projection: pluginProjection.pluginUiProjection,
        scopedLaunchFacts: {
            serverId: scope.serverId,
            machineId: scope.machineId,
            interactionEnabled: pluginProjection.interactionEnabled,
        },
        accountLifetime,
        accountLifetimeRevision: pluginAccount.revision,
        isOccurrenceCurrent: pluginScopeIsCurrent,
        readCurrentUiContext: currentUiContextReader?.readCurrentUiContext,
        openSurface: pluginNavigationBinding?.openSurface,
        onCommitActivation: (activate) => { committedPluginActivationRef.current = activate; },
    }), [accountLifetime, currentUiContextReader, pluginAccount.revision, pluginNavigationBinding?.openSurface, pluginProjection, pluginScopeIsCurrent, scope.machineId, scope.serverId]);

    const accountIdByServerId = React.useMemo(() => new Map(
        [...credentialBindings].map(([serverId, binding]) => [serverId, binding.accountId]),
    ), [credentialBindings]);
    const scopeChoices = React.useMemo(() => buildUniversalSearchScopeChoices({
        accountIdByServerId,
        profiles,
        workspaces: workspaceRefs,
        sessions,
        readMachineTarget: readMachineControlTargetForSession,
    }), [accountIdByServerId, profiles, sessions, workspaceRefs]);
    const scopeKey = buildUniversalSearchScopeKeyFromSeed(scope);
    // The scope chip exists only when there is a choice to make. With one Home (and no workspace
    // scopes) it would restate the obvious, so Search shows no chip at all.
    const hasScopeChoice = scopeChoices.length > 1;
    const currentScopeProfile = profiles.find((profile) => areServerProfileIdentifiersEquivalent(profile.id, scope.serverId));
    const currentScopeLabel = scopeChoices.find((choice) => choice.key === scopeKey)?.label
        ?? (currentScopeProfile ? resolveHomeDisplayLabel(currentScopeProfile, currentScopeProfile.id) : null)
        ?? scope.rootPath
        ?? '';
    // The Home (or workspace) scope is a SelectionList filter: one chip beside the field that opens the
    // choices, the same chip every picker uses.
    const scopeFilters = React.useMemo<ReadonlyArray<SelectionListFilter> | undefined>(() => hasScopeChoice ? [{
        id: 'scope',
        label: t('universalSearch.scopeFilterLabel'),
        valueLabel: currentScopeLabel,
        icon: <Icon name="house" size={12} color={theme.colors.text.secondary} />,
        options: scopeChoices.map((choice) => ({ id: choice.key, label: choice.label })),
        selectedId: scopeKey,
        onChange: (choiceKey: string) => {
            const choice = scopeChoices.find((candidate) => candidate.key === choiceKey);
            if (!choice) return;
            setSelectedOptionId(null);
            setScope(choice.scope);
        },
        testID: 'universal-search:scope',
    }] : undefined, [currentScopeLabel, hasScopeChoice, scopeChoices, scopeKey, theme.colors.text.secondary]);

    const sections = React.useMemo(() => buildUniversalSearchSections({
        query,
        commands: props.commands,
        sessions: sessionEntities,
        sessionInventoryStatus,
        projects,
        searchSettingsPages,
        transcript,
        files,
        commits,
        pluginSections,
        onCommitResult: (result) => { committedResultRef.current = result; },
    }), [commits, files, pluginSections, projects, props.commands, query, searchSettingsPages, sessionEntities, sessionInventoryStatus, transcript]);
    const rootStep = React.useMemo<SelectionListStep>(() => ({
        id: 'universal-search',
        inputPlaceholder: t('commandPalette.placeholder'),
        emptyStateLabel: t('selectionList.emptyMatch'),
        sections,
        // Quiet key hints; SelectionList shows the footer only with a hardware keyboard.
        footerHints: [
            { id: 'move', label: '↑↓', description: t('commandPalette.hints.move') },
            { id: 'open', label: '↵', description: t('commandPalette.hints.open') },
            { id: 'close', label: 'esc', description: t('commandPalette.hints.close') },
        ],
    }), [sections]);

    const leaveTerminalScope = React.useCallback(() => {
        setSelectedOptionId(null);
        setTerminalScope(null);
    }, []);
    const terminalScopeChrome = useTerminalJumpScopeChrome(terminalJump !== null, leaveTerminalScope);
    const activateTerminalJump = React.useCallback((optionId: string, placement: 'bottom' | 'details') => {
        if (!terminalJump) return;
        setSelectedOptionId(optionId);
        void runUniversalSearchActivation({
            prepare: () => terminalJump.hasOption(optionId),
            dismiss: props.onRequestClose,
            activate: () => terminalJump.activate(optionId, placement),
            presentFailure: () => { Modal.alert(t('common.error'), t('errors.searchFailed')); },
        });
    }, [props.onRequestClose, terminalJump]);
    const handleTerminalJumpSelect = React.useCallback((optionId: string) => activateTerminalJump(optionId, 'bottom'), [activateTerminalJump]);
    const handleTerminalJumpDetails = React.useCallback((optionId: string) => activateTerminalJump(optionId, 'details'), [activateTerminalJump]);

    const isBuiltInTargetCurrent = React.useCallback((target: UniversalSearchResult['target']) => {
        const targetServerId = 'serverId' in target ? target.serverId : null;
        const targetAccountId = 'accountId' in target ? target.accountId : null;
        const targetBinding = targetServerId
            ? credentialBindings.get(resolveServerProfileScopeIdForIdentifier(targetServerId)) ?? null
            : null;
        return isUniversalSearchTargetCurrent({
            target,
            accountScope: targetServerId && profiles.some((profile) => areServerProfileIdentifiersEquivalent(profile.id, targetServerId))
                ? {
                    serverId: resolveServerProfileScopeIdForIdentifier(targetServerId),
                    accountId: targetAccountId ?? '',
                    current: targetAccountId !== null
                        && targetBinding !== null
                        && areServerProfileIdentifiersEquivalent(targetBinding.serverId, targetServerId)
                        && targetBinding.accountId === targetAccountId
                        && targetBinding.isCurrent(),
                }
                : null,
            workspaces: workspaceRefs,
            settingsPages: settingsById,
            resolveSessionWorkspaceTarget: resolveWorkspaceTargetForSession,
            isWorkspaceScopeReachable,
        });
    }, [credentialBindings, profiles, settingsById, workspaceRefs]);

    const readExactSessionForActivation = React.useCallback(async (target: Readonly<{
        serverId: string;
        accountId: string;
        sessionId: string;
    }>): Promise<Readonly<{ ok: boolean; visibleThroughSeq?: number }>> => {
        const binding = credentialBindings.get(
            resolveServerProfileScopeIdForIdentifier(target.serverId),
        ) ?? null;
        if (
            !binding
            || !binding.isCurrent()
            || binding.accountId !== target.accountId
            || !areServerProfileIdentifiersEquivalent(binding.serverId, target.serverId)
        ) return { ok: false };

        const controller = new AbortController();
        const retirement = binding.onRetire(() => controller.abort());
        let authority: Awaited<ReturnType<typeof captureMemorySearchSessionReadAuthority>> | null = null;
        try {
            authority = await captureMemorySearchSessionReadAuthority({
                serverId: target.serverId,
                accountId: target.accountId,
            });
            if (controller.signal.aborted || !binding.isCurrent()) return { ok: false };
            const read = await readMemorySearchSessionForServerScope({
                target: {
                    sessionKey: buildUniversalSearchScopeKey([
                        target.accountId,
                        target.serverId,
                        target.sessionId,
                    ]),
                    ...target,
                },
                authority,
                signal: controller.signal,
            });
            return read.ok && !controller.signal.aborted && binding.isCurrent()
                ? read
                : { ok: false };
        } catch {
            return { ok: false };
        } finally {
            retirement.dispose();
            await authority?.release();
        }
    }, [credentialBindings]);

    const handleSelect = React.useCallback((optionId: string, _option: SelectionListOption) => {
        const result = committedResultRef.current;
        const pluginActivation = committedPluginActivationRef.current;
        const command = result || pluginActivation ? null : findCommandForOptionId(props.commands, optionId);
        committedResultRef.current = null;
        committedPluginActivationRef.current = null;
        setSelectedOptionId(optionId);
        void runUniversalSearchActivation({
            prepare: () => result
                ? prepareUniversalSearchResult(result.target, {
                    isTargetCurrent: isBuiltInTargetCurrent,
                    readExactSession: readExactSessionForActivation,
                })
                : pluginActivation
                    ? accountLifetime?.isCurrent() === true
                    : command !== null,
            dismiss: props.onRequestClose,
            activate: async () => {
                if (result) {
                    const outcome = await activateUniversalSearchResult(result.target, {
                        navigateToSession,
                        push: (path) => { router.push(path as never); },
                        openProject,
                        isTargetCurrent: isBuiltInTargetCurrent,
                    });
                    return outcome.ok;
                }
                if (pluginActivation) {
                    const outcome = await pluginActivation() as PluginSearchActivationOutcome;
                    return outcome.ok;
                }
                if (command) {
                    await command.action();
                    return true;
                }
                return false;
            },
            presentFailure: () => { Modal.alert(t('common.error'), t('errors.searchFailed')); },
        });
    }, [isBuiltInTargetCurrent, navigateToSession, openProject, pluginScopeIsCurrent, props.commands, props.onRequestClose, readExactSessionForActivation, router]);

    const activeRootStep = terminalJump?.step ?? rootStep;
    const activeFilters = terminalJump ? terminalScopeChrome.filters : scopeFilters;
    const activeSelect = terminalJump ? handleTerminalJumpSelect : handleSelect;
    const listAccessibilityLabel = terminalJump ? t('terminalWorkspace.jump.title') : t('tools.names.search');
    if (Platform.OS !== 'web' && props.presentation === 'route') {
        return <UniversalSearchNativeHost rootStep={activeRootStep} query={query} onChangeQuery={setQuery} onSelect={activeSelect} onCommandSelect={terminalJump ? handleTerminalJumpDetails : undefined} onRequestClose={props.onRequestClose} selectedOptionId={selectedOptionId} listAccessibilityLabel={listAccessibilityLabel} filters={activeFilters} dynamicSectionCache={dynamicSectionCache} />;
    }
    return (
        <View style={styles.root} testID="universal-search-host">
            <SelectionList rootStep={activeRootStep} selectionMark="enter" inputValue={query} onChangeInputValue={setQuery} onSelect={activeSelect} onCommandSelect={terminalJump ? handleTerminalJumpDetails : undefined} onRequestClose={props.onRequestClose} selectedOptionId={selectedOptionId} listAccessibilityLabel={listAccessibilityLabel} filters={activeFilters} inputBehavior={terminalScopeChrome.inputBehavior} autoFocusInputOnWeb fillAvailableSpace dynamicSectionCache={dynamicSectionCache} />
        </View>
    );
}
