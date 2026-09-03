import * as React from 'react';
import { Platform, View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';
import { useRouter } from 'expo-router';

import type { MemorySearchHitV1 } from '@happier-dev/protocol';
import { normalizeMemorySearchSessionId } from '@/sync/domains/memory/applyMemorySearchSessionEligibility';

import { useAppShellPluginUiProjection } from '@/components/appShell/plugins/AppShellPluginUiProjection';
import { useOptionalCurrentUiContextReader } from '@/components/appShell/currentUiContext/CurrentUiContextProvider';
import { usePluginSurfaceDestinationNavigationBinding } from '@/components/plugins/surfaces/pluginSurfaceDestinationNavigation';
import type { Command } from '@/components/appShell/commandPalette/types';
import { Modal } from '@/modal';
import { useNavigateToSession } from '@/hooks/session/useNavigateToSession';
import { useResolvedSettingsPageCatalog } from '@/components/settings/catalog/runtime/useResolvedSettingsPageCatalog';
import type { ResolvedSettingsPageNode } from '@/components/settings/catalog/types';
import {
    SelectionList,
    createDefaultDynamicSectionCache,
    type SelectionListDynamicSectionCache,
    type SelectionListOption,
    type SelectionListStep,
} from '@/components/ui/selectionList';
import { useAllSessions } from '@/sync/store/hooks';
import { useSetting } from '@/sync/domains/state/storage';
import { captureActiveServerAccountScopeLifetime } from '@/sync/domains/scope/activeServerAccountScope';
import {
    useServerCredentialAccountScopes,
    type ServerCredentialAccountScopeBinding,
} from '@/sync/domains/scope/useServerCredentialAccountScopes';
import { searchDaemonMemory } from '@/sync/domains/memory/searchDaemonMemory';
import { searchHomeMemory } from '@/sync/domains/memory/searchHomeMemory';
import { useMemorySearchProvider } from '@/sync/domains/memory/useMemorySearchProvider';
import {
    hasLocalMemorySearchSessionForServerScope,
    hydrateMemorySearchSessionTargets,
    readMemorySearchSessionForServerScope,
} from '@/sync/domains/memory/hydrateMemorySearchSessionTargets';
import { searchWorkspaceFiles } from '@/sync/domains/workspaces/files/workspaceFileSearch';
import { searchWorkspaceCommits } from '@/scm/search/searchWorkspaceCommits';
import { readMachineControlTargetForSession } from '@/sync/ops/sessionMachineTarget';
import { resolveWorkspaceTargetForSession } from '@/sync/domains/session/resolveWorkspaceTargetForSession';
import { findWorkspaceRefByScope } from '@/sync/domains/workspaces/workspaceRefs';
import { isWorkspaceScopeReachable } from '@/sync/domains/workspaces/workspaceReachability';
import { getSessionName } from '@/utils/sessions/sessionUtils';
import { t } from '@/text';

import { activateUniversalSearchResult } from './activateUniversalSearchResult';
import {
    buildUniversalSearchSections,
    findCommandForOptionId,
    type UniversalSearchProjectEntity,
    type UniversalSearchSessionEntity,
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
import { buildUniversalSearchWorkspaceFileResults } from './workspaceFileSearchResults';
import { useOpenProject } from '@/components/projects/useOpenProject';
import { useServerProfilesGeneration } from '@/hooks/server/useServerProfilesGeneration';
import { listServerProfiles } from '@/sync/domains/server/serverProfiles';
import type { UniversalSearchScopeSeed } from './UniversalSearchRuntimeContext';
import {
    buildUniversalSearchScopeChoices,
    buildUniversalSearchScopeKeyFromSeed,
} from './universalSearchScope';

const styles = StyleSheet.create(() => ({ root: { flex: 1, minHeight: 0, width: '100%' } }));

type PendingActivation = () => Promise<unknown>;

function useUniversalSearchDynamicCache(
    scope: UniversalSearchScopeSeed,
    credentialBinding: ServerCredentialAccountScopeBinding | null,
): SelectionListDynamicSectionCache {
    const key = `${scope.serverId ?? ''}\u0000${scope.accountId ?? ''}\u0000${credentialBinding?.revision ?? -1}`;
    const cache = React.useMemo(() => createDefaultDynamicSectionCache(), [key]);
    React.useEffect(() => {
        const retirement = credentialBinding?.onRetire(() => cache.clear()) ?? null;
        return () => {
            retirement?.dispose();
            cache.clear();
        };
    }, [cache, credentialBinding, key]);
    return cache;
}

function settingsPageById(nodes: readonly ResolvedSettingsPageNode[]): ReadonlyMap<string, ResolvedSettingsPageNode> {
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

function memoryHitResult(hit: MemorySearchHitV1, serverId: string | null, title: string): UniversalSearchResult {
    const sessionId = normalizeMemorySearchSessionId(hit.sessionId);
    return {
        id: `${sessionId}:${hit.seqFrom}:${hit.seqTo}`,
        scopeKey: buildUniversalSearchScopeKey([serverId, sessionId, hit.seqFrom, hit.seqTo]),
        sourceId: UNIVERSAL_SEARCH_SOURCE_IDS.transcript,
        kind: 'message',
        title,
        subtitle: hit.summary,
        target: { kind: 'session', serverId, sessionId, seq: hit.seqFrom },
    };
}

export type UniversalSearchControllerProps = Readonly<{
    commands: readonly Command[];
    initialQuery?: string;
    activeSessionId?: string | null;
    initialScope?: UniversalSearchScopeSeed;
    presentation: 'modal' | 'route';
    onRequestClose(): void;
}>;

export function UniversalSearchController(props: UniversalSearchControllerProps): React.ReactElement {
    const [scope, setScope] = React.useState<UniversalSearchScopeSeed>(() => ({
        accountId: props.initialScope ? props.initialScope.accountId : captureActiveServerAccountScopeLifetime()?.scope.accountId ?? null,
        serverId: props.initialScope ? props.initialScope.serverId : captureActiveServerAccountScopeLifetime()?.scope.serverId ?? null,
        sessionId: props.initialScope ? props.initialScope.sessionId : props.activeSessionId ?? null,
        machineId: props.initialScope ? props.initialScope.machineId : null,
        rootPath: props.initialScope ? props.initialScope.rootPath : null,
    }));
    const [query, setQuery] = React.useState(() => props.initialQuery?.trim() ?? '');
    const [selectedOptionId, setSelectedOptionId] = React.useState<string | null>(null);
    const committedResultRef = React.useRef<UniversalSearchResult | null>(null);
    const committedPluginActivationRef = React.useRef<PendingActivation | null>(null);
    const committedScopeRef = React.useRef<UniversalSearchScopeSeed | null>(null);
    const profilesGeneration = useServerProfilesGeneration();
    const profiles = React.useMemo(() => listServerProfiles(), [profilesGeneration]);
    const credentialBindings = useServerCredentialAccountScopes(profiles.map((profile) => profile.id));
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
    const memoryProvider = useMemorySearchProvider({ serverId: scope.serverId, machineId: scope.machineId });
    const homeCredentialRevision = selectedCredentialBinding?.revision ?? -1;
    const dynamicSectionCache = useUniversalSearchDynamicCache(scope, selectedCredentialBinding);
    const navigateToSession = useNavigateToSession();
    const router = useRouter();
    const openProject = useOpenProject();
    const settingsCatalog = useResolvedSettingsPageCatalog();
    const sessions = useAllSessions();
    const workspaceRefs = useSetting('workspaceRefsV1');
    const pluginProjection = useAppShellPluginUiProjection();
    const currentUiContextReader = useOptionalCurrentUiContextReader();
    const pluginNavigationBinding = usePluginSurfaceDestinationNavigationBinding();

    const sessionEntities = React.useMemo<readonly UniversalSearchSessionEntity[]>(() => sessions
        .filter((session) => !scope.serverId || session.serverId === scope.serverId)
        .slice()
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .map((session) => ({
            sessionId: session.id,
            serverId: session.serverId ?? null,
            title: getSessionName(session),
            subtitle: session.metadata?.path || undefined,
            updatedAt: session.updatedAt,
        })), [scope.serverId, sessions]);
    const sessionNameByTarget = React.useMemo(
        () => new Map(sessionEntities.map((session) => [
            buildUniversalSearchSessionTitleKey(session.serverId, session.sessionId),
            session.title,
        ])),
        [sessionEntities],
    );
    const projects = React.useMemo<readonly UniversalSearchProjectEntity[]>(() => workspaceRefs
        .filter((workspace) => !scope.serverId || workspace.serverId === scope.serverId)
        .slice()
        .sort((a, b) => (b.lastOpenedAtMs ?? b.createdAtMs) - (a.lastOpenedAtMs ?? a.createdAtMs))
        .map((workspace) => ({
            workspaceRefId: workspace.id,
            serverId: workspace.serverId,
            machineId: workspace.machineId,
            rootPath: workspace.rootPath,
            title: workspace.label?.trim() || workspace.rootPath.split(/[\\/]/).filter(Boolean).pop() || workspace.rootPath,
            subtitle: workspace.rootPath,
            lastOpenedAtMs: workspace.lastOpenedAtMs ?? workspace.createdAtMs,
        })), [scope.serverId, workspaceRefs]);

    const settingsById = React.useMemo(() => settingsPageById(settingsCatalog.tree), [settingsCatalog.tree]);
    const searchSettingsPages = React.useCallback((value: string) => settingsCatalog.search(value).flatMap((match) => {
        const page = settingsById.get(match.id);
        return page ? [{ id: page.id, route: match.route, title: page.title ?? String(page.titleKey ?? page.id), ...(page.subtitle ? { subtitle: page.subtitle } : {}) }] : [];
    }), [settingsById, settingsCatalog]);

    const transcript = React.useMemo<UniversalSearchSource>(() => {
        if (scope.serverId && !selectedCredentialIsCurrent) return { status: 'absent' };
        const unavailableReason = memoryProvider.unavailableReason;
        if (!memoryProvider.provider) return { status: 'absent' };
        const resolverKey = memoryProvider.provider === 'home'
            ? `home:${scope.accountId ?? ''}:${memoryProvider.homeServerId ?? ''}:${memoryProvider.homeReadiness ?? 'unknown'}:${homeCredentialRevision}`
            : `daemon:${scope.accountId ?? ''}:${memoryProvider.daemonTarget?.serverId ?? ''}:${memoryProvider.daemonTarget?.machineId ?? ''}`;
        if (!memoryProvider.queryAvailable) {
            return {
                status: 'unavailable',
                resolverKey,
                hint: unavailableReason === 'home_indexing'
                    ? t('memorySearchSettings.status.indexing')
                    : t('memorySearchSettings.status.unavailableLight'),
            };
        }
        return {
            status: 'ready',
            resolverKey,
            ...(memoryProvider.provider === 'daemon'
                ? { resultHint: t('memorySearchSettings.budgets.groupFooter') }
                : {}),
            resolve: async (value, signal) => {
                const response = memoryProvider.provider === 'home'
                    ? await searchHomeMemory({ serverId: memoryProvider.homeServerId!, accountId: scope.accountId ?? '', query: value, scope: { type: 'global' }, mode: 'auto', maxResults: 20, signal })
                    : await searchDaemonMemory({ serverId: memoryProvider.daemonTarget!.serverId, machineId: memoryProvider.daemonTarget!.machineId, query: value, scope: { type: 'global' }, mode: 'auto', maxResults: 20, signal });
                if (!response.ok) throw new Error(response.error);
                const serverId = memoryProvider.provider === 'home'
                    ? memoryProvider.homeServerId
                    : memoryProvider.daemonTarget?.serverId ?? null;
                if (!serverId) return [];
                const targetBySessionId = new Map<string, {
                    sessionKey: string;
                    serverId: string;
                    sessionId: string;
                }>();
                const normalizedHits = response.hits.flatMap((hit) => {
                    const sessionId = normalizeMemorySearchSessionId(hit.sessionId);
                    return sessionId ? [{ ...hit, sessionId }] : [];
                });
                for (const hit of normalizedHits) {
                    const sessionId = hit.sessionId;
                    if (!sessionId || targetBySessionId.has(sessionId)) continue;
                    targetBySessionId.set(sessionId, {
                        sessionKey: buildUniversalSearchSessionTitleKey(serverId, sessionId),
                        serverId,
                        sessionId,
                    });
                }
                const authorizedTargets = await hydrateMemorySearchSessionTargets({
                    targets: [...targetBySessionId.values()],
                    hasLocalSession: hasLocalMemorySearchSessionForServerScope,
                    readSessionForServerScope: readMemorySearchSessionForServerScope,
                    signal,
                });
                if (signal.aborted) return [];
                const authorizedSessionIds = new Set(authorizedTargets.map((target) => target.sessionId));
                return normalizedHits.flatMap((hit) => authorizedSessionIds.has(hit.sessionId)
                    ? [memoryHitResult(
                        hit,
                        serverId,
                        sessionNameByTarget.get(buildUniversalSearchSessionTitleKey(
                            serverId,
                            hit.sessionId,
                        )) ?? hit.summary,
                    )]
                    : []);
            },
        };
    }, [homeCredentialRevision, memoryProvider, scope.accountId, scope.serverId, selectedCredentialIsCurrent, sessionNameByTarget]);

    const activeSession = React.useMemo(
        () => sessions.find((session) => session.id === scope.sessionId && (!scope.serverId || session.serverId === scope.serverId)) ?? null,
        [scope.serverId, scope.sessionId, sessions],
    );
    const workspaceScope = React.useMemo(() => {
        if (scope.serverId && scope.machineId && scope.rootPath) {
            return { serverId: scope.serverId, machineId: scope.machineId, rootPath: scope.rootPath };
        }
        if (!activeSession) return null;
        const target = readMachineControlTargetForSession(activeSession.id);
        const serverId = activeSession.serverId?.trim();
        if (!target || !serverId || !target.machineId || !target.basePath) return null;
        return { serverId, machineId: target.machineId, rootPath: target.basePath };
    }, [activeSession, scope.machineId, scope.rootPath, scope.serverId]);
    const workspaceResolverKey = workspaceScope
        ? `${workspaceScope.serverId}:${workspaceScope.machineId}:${workspaceScope.rootPath}`
        : '';
    const workspaceRef = React.useMemo(
        () => workspaceScope ? findWorkspaceRefByScope(workspaceRefs, workspaceScope) : null,
        [workspaceRefs, workspaceScope],
    );
    const workspaceActivationAvailable = Boolean(activeSession || workspaceRef);
    const workspaceSearchAvailable = workspaceActivationAvailable && selectedCredentialIsCurrent;
    const files = React.useMemo<UniversalSearchSource>(() => workspaceScope && workspaceSearchAvailable && selectedCredentialBinding ? ({
        status: 'ready',
        resolverKey: workspaceResolverKey,
        resolve: async (value, signal) => buildUniversalSearchWorkspaceFileResults({
            files: await searchWorkspaceFiles({
                scope: workspaceScope,
                query: value,
                limit: 20,
                resultType: 'file',
                accountLifetime: selectedCredentialBinding,
                signal,
            }),
            scope: workspaceScope,
            workspaceRefId: workspaceRef?.id ?? null,
            sessionId: activeSession?.id ?? null,
        }),
    }) : ({ status: 'absent' }), [activeSession?.id, selectedCredentialBinding, workspaceRef?.id, workspaceResolverKey, workspaceScope, workspaceSearchAvailable]);
    const commits = React.useMemo<UniversalSearchSource>(() => workspaceScope && workspaceSearchAvailable ? ({
        status: 'ready',
        resolverKey: workspaceResolverKey,
        resolve: async (value, signal) => {
            const outcome = await searchWorkspaceCommits({ scope: workspaceScope, query: value, limit: 20, signal });
            if (outcome.status === 'unavailable') throw new Error(outcome.message ?? outcome.reason);
            if (outcome.status === 'recentOnly') {
                return {
                    results: [],
                    emptyHint: t('universalSearch.commitsUpdateRequired'),
                };
            }
            return outcome.entries.map((entry) => ({
                id: entry.sha,
                scopeKey: buildUniversalSearchScopeKey([workspaceScope.serverId, workspaceScope.machineId, workspaceScope.rootPath]),
                sourceId: UNIVERSAL_SEARCH_SOURCE_IDS.commits,
                kind: 'workspaceCommit',
                title: entry.subject,
                subtitle: `${entry.shortSha} · ${entry.authorName}`,
                target: { kind: 'workspaceCommit', scope: workspaceScope, sha: entry.sha, workspaceRefId: workspaceRef?.id ?? null, sessionId: activeSession?.id ?? null, serverId: workspaceScope.serverId },
            }));
        },
    }) : ({ status: 'absent' }), [activeSession?.id, workspaceRef?.id, workspaceResolverKey, workspaceScope, workspaceSearchAvailable]);

    const accountLifetime = captureActiveServerAccountScopeLifetime();
    const accountScopeKey = accountLifetime
        ? `${accountLifetime.scope.serverId}\u0000${accountLifetime.scope.accountId}`
        : 'no-account';
    const currentPluginGenerationRef = React.useRef<number | null>(
        pluginProjection.pluginUiProjection?.generation ?? null,
    );
    currentPluginGenerationRef.current = pluginProjection.pluginUiProjection?.generation ?? null;
    const admittedPluginGeneration = pluginProjection.pluginUiProjection?.generation ?? null;
    const pluginScopeIsCurrent = React.useCallback(() => {
        const current = captureActiveServerAccountScopeLifetime();
        return current !== null
            && current.isCurrent()
            && `${current.scope.serverId}\u0000${current.scope.accountId}` === accountScopeKey
            && admittedPluginGeneration !== null
            && currentPluginGenerationRef.current === admittedPluginGeneration;
    }, [accountScopeKey, admittedPluginGeneration]);
    const pluginSections = React.useMemo(() => buildPluginSearchProviderSections({
        projection: pluginProjection.pluginUiProjection,
        scopedLaunchFacts: {
            serverId: pluginProjection.serverId,
            machineId: pluginProjection.machineId,
            generation: pluginProjection.pluginUiProjection?.generation ?? null,
            interactionEnabled: pluginProjection.interactionEnabled,
        },
        scopeIsCurrent: accountLifetime ? pluginScopeIsCurrent : undefined,
        readCurrentUiContext: currentUiContextReader?.readCurrentUiContext,
        openSurface: pluginNavigationBinding?.openSurface,
        onCommitActivation: (activate) => { committedPluginActivationRef.current = activate; },
    }), [accountScopeKey, currentUiContextReader, pluginNavigationBinding?.openSurface, pluginProjection, pluginScopeIsCurrent]);

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
    const currentScopeLabel = scopeChoices.find((choice) => choice.key === scopeKey)?.label
        ?? profiles.find((profile) => profile.id === scope.serverId)?.name
        ?? scope.rootPath
        ?? '';
    const scopeSection = React.useMemo(() => scopeChoices.length > 1 ? [{
        kind: 'dynamic' as const,
        id: 'scope',
        resolverKey: `scope|${scopeKey}`,
        debounceMs: 0,
        loadingSkeletonRows: 0,
        resultFiltering: 'provider' as const,
        showSkeletonsOnFirstLoad: true,
        resultTransition: 'none' as const,
        resolve: async () => ({
            options: [{
                id: `scope:${scopeKey}`,
                label: currentScopeLabel,
                openStep: {
                    id: `scope-picker:${scopeKey}`,
                    sections: [{
                        kind: 'static' as const,
                        id: 'scope-options',
                        options: scopeChoices.map((choice) => ({
                            id: `scope-option:${choice.key}`,
                            label: choice.label,
                            onSelect: () => { committedScopeRef.current = choice.scope; },
                        })),
                    }],
                },
            }],
        }),
    }] : [], [currentScopeLabel, scopeChoices, scopeKey]);

    const sections = React.useMemo(() => buildUniversalSearchSections({
        query,
        commands: props.commands,
        sessions: sessionEntities,
        projects,
        searchSettingsPages,
        transcript,
        files,
        commits,
        pluginSections: [...scopeSection, ...pluginSections],
        onCommitResult: (result) => { committedResultRef.current = result; },
    }), [commits, files, pluginSections, projects, props.commands, query, scopeSection, searchSettingsPages, sessionEntities, transcript]);
    const rootStep = React.useMemo<SelectionListStep>(() => ({
        id: 'universal-search',
        inputPlaceholder: t('commandPalette.placeholder'),
        emptyStateLabel: t('commandPalette.noCommandsFound'),
        sections,
    }), [sections]);

    const isBuiltInTargetCurrent = React.useCallback((target: UniversalSearchResult['target']) => {
        const targetServerId = 'serverId' in target ? target.serverId : null;
        return isUniversalSearchTargetCurrent({
            target,
            accountScope: targetServerId && profiles.some((profile) => profile.id === targetServerId)
                ? {
                    serverId: targetServerId,
                    current: selectedCredentialBinding?.serverId === targetServerId
                        && selectedCredentialBinding.accountId === scope.accountId
                        && selectedCredentialBinding.isCurrent(),
                }
                : null,
            workspaces: workspaceRefs,
            settingsPages: settingsById,
            resolveSessionWorkspaceTarget: resolveWorkspaceTargetForSession,
            isWorkspaceScopeReachable,
        });
    }, [profiles, scope.accountId, selectedCredentialBinding, settingsById, workspaceRefs]);

    const handleSelect = React.useCallback((optionId: string, _option: SelectionListOption) => {
        const nextScope = committedScopeRef.current;
        committedScopeRef.current = null;
        if (nextScope) {
            committedResultRef.current = null;
            committedPluginActivationRef.current = null;
            setSelectedOptionId(null);
            setScope(nextScope);
            return;
        }
        const result = committedResultRef.current;
        const pluginActivation = committedPluginActivationRef.current;
        const command = result || pluginActivation ? null : findCommandForOptionId(props.commands, optionId);
        committedResultRef.current = null;
        committedPluginActivationRef.current = null;
        setSelectedOptionId(optionId);
        void runUniversalSearchActivation({
            prepare: () => result ? isBuiltInTargetCurrent(result.target) : pluginActivation ? pluginScopeIsCurrent() : true,
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
            presentFailure: () => { Modal.alert(t('common.error'), t('commandPalette.activationFailed')); },
        });
    }, [isBuiltInTargetCurrent, navigateToSession, openProject, pluginScopeIsCurrent, props.commands, props.onRequestClose, router]);

    if (Platform.OS !== 'web' && props.presentation === 'route') {
        return <UniversalSearchNativeHost rootStep={rootStep} query={query} onChangeQuery={setQuery} onSelect={handleSelect} onRequestClose={props.onRequestClose} selectedOptionId={selectedOptionId} listAccessibilityLabel={t('tools.names.search')} dynamicSectionCache={dynamicSectionCache} />;
    }
    return (
        <View style={styles.root} testID="universal-search-host">
            <SelectionList rootStep={rootStep} inputValue={query} onChangeInputValue={setQuery} onSelect={handleSelect} onRequestClose={props.onRequestClose} selectedOptionId={selectedOptionId} listAccessibilityLabel={t('tools.names.search')} autoFocusInputOnWeb fillAvailableSpace dynamicSectionCache={dynamicSectionCache} />
        </View>
    );
}
