import React, { useCallback, useMemo } from 'react';
import { Platform } from 'react-native';
import { useGlobalSearchParams, useRouter, useSegments } from 'expo-router';
import { buildQualifiedPluginContributionKey } from '@happier-dev/protocol';
import { Modal } from '@/modal';
import { UniversalSearchModal, type UniversalSearchModalProps } from '@/components/appShell/search/UniversalSearchModal';
import {
    UniversalSearchRuntimeProvider,
    resolveUniversalSearchInvocationScope,
    type UniversalSearchRuntime,
    type UniversalSearchScopeSeed,
} from '@/components/appShell/search/UniversalSearchRuntimeContext';
import { storage } from '@/sync/domains/state/storage';
import { useShallow } from 'zustand/react/shallow';
import { useNavigateToSession } from '@/hooks/session/useNavigateToSession';
import { buildScopedSessionRouteHref } from '@/hooks/session/sessionRouteServerScope';
import { useFeatureEnabled } from '@/hooks/server/useFeatureEnabled';
import { createDefaultActionExecutor } from '@/sync/ops/actions/defaultActionExecutor';
import { resolvePreferredServerIdForSessionId } from '@/sync/runtime/orchestration/serverScopedRpc/resolvePreferredServerIdForSessionId';
import { resetDesktopActivityOverlayPosition } from '@/activity/adapters/desktop/runtime/desktopActivityOverlayBridge';
import { requestCodexPetRefresh } from '@/components/settings/pets/petSettingsCommandEvents';
import {
    type CompactAppDestination,
    SEARCH_DESTINATION_ID,
    useCompactAppDestinations,
} from '@/components/appShell/destinations/compactAppDestinationCatalog';
import {
    useAppShellPluginUiProjection,
} from '@/components/appShell/plugins/AppShellPluginUiProjection';
import {
    createPluginUiProjectedActionResolver,
    normalizePluginUiProjection,
} from '@/sync/domains/plugins/ui/projection';
import { readPluginUiContributionOrigin } from '@/sync/domains/plugins/ui/projectionUnion';
import { resolveServerProfileScopeIdForIdentifier } from '@/sync/domains/server/serverProfiles';
import {
    createPluginContributedActionController,
    type PluginContributedActionCurrentSnapshot,
} from '@/components/plugins/actions/pluginContributedActionController';
import {
    usePluginUiClientExecutableRegistrationRevision,
} from '@/components/plugins/reactNative/clientExecutableContributions';
import { usePluginAppPageCatalogActivationHandler } from '@/components/appShell/plugins/pluginAppPageNavigation';
import { useSessionMachineControlTarget } from '@/components/sessions/model/useSessionMachineTarget';
import { readMachineControlTargetForSession } from '@/sync/ops/sessionMachineTarget';
import { useDaemonMergedProjectionInputs } from '@/agents/backendCatalog/useDaemonMergedProjectionInputs';
import { captureActiveServerAccountScopeLifetime } from '@/sync/domains/scope/activeServerAccountScope';
import { useApplyLocalSettings, useApplySettings } from '@/sync/store/settingsWriters';
import { fireAndForget } from '@/utils/system/fireAndForget';
import { isDesktopHost } from '@/utils/platform/desktopHost';
import { buildCommandPaletteCommands, type PetCommandControls } from './buildCommandPaletteCommands';
import { KeyboardShortcutProvider, buildKeyboardShortcutLabels, resolveKeyboardPlatform, type KeyboardShortcutHandlers } from '@/keyboard';
import { useOptionalCurrentUiContextReader } from '@/components/appShell/currentUiContext/CurrentUiContextProvider';
import { usePluginSurfaceDestinationNavigationBinding } from '@/components/plugins/surfaces/pluginSurfaceDestinationNavigation';
import { normalizeSessionId } from '@/sync/domains/session/normalizeSessionId';
import { projectParameterFreeRoute } from '@/track/parameterFreeRouteProjection';
import { useResolveNewSessionOrdinaryEntryRoute } from '@/components/sessions/new/navigation/newSessionOrdinaryEntryRoute';
import { UNIVERSAL_SEARCH_ROUTE } from '@/components/appShell/search/universalSearchRoutePresentation';

export function readActiveSessionIdFromRoute(
    segments: readonly string[],
    routeId: string | readonly string[] | undefined,
): string | null {
    const route = projectParameterFreeRoute(segments);
    if (route.segments[0] !== 'session' || route.segments[1] !== ':id') return null;
    const sessionId = normalizeSessionId(routeId);
    if (!sessionId || projectParameterFreeRoute([sessionId]).segments[0] === ':id') return null;
    return sessionId;
}

/**
 * The root palette has an exact machine only when either the current Session
 * supplies one or the app scope has a single eligible machine. A Session route
 * never falls back to an unrelated app-scoped machine; doing so would turn a
 * contextual Action into a second execution target selector.
 */
function useCommandPalettePluginActionPresentation(activeSessionId: string | null) {
    const appShellProjection = useAppShellPluginUiProjection();
    const currentUiContextReader = useOptionalCurrentUiContextReader();
    const destinationNavigation = usePluginSurfaceDestinationNavigationBinding();
    const clientExecutableRegistrationRevision = usePluginUiClientExecutableRegistrationRevision();
    const sessionMachineTarget = useSessionMachineControlTarget(activeSessionId ?? '');
    const scope = activeSessionId ? 'session' as const : 'global' as const;
    const machineId = activeSessionId
        ? sessionMachineTarget?.machineId ?? null
        : appShellProjection.machineId;
    const serverId = activeSessionId
        ? resolvePreferredServerIdForSessionId(activeSessionId) ?? null
        : appShellProjection.serverId;
    const projection = useDaemonMergedProjectionInputs({
        machineId,
        serverId,
        enabled: machineId !== null,
        staleMs: 60_000,
    });
    const accountLifetime = captureActiveServerAccountScopeLifetime();
    const appShellProjectionRef = React.useRef(appShellProjection);
    appShellProjectionRef.current = appShellProjection;
    const snapshotRef = React.useRef<PluginContributedActionCurrentSnapshot | null>(null);
    // This scope follows authority identity, not catalog metadata. The shared
    // controller re-resolves metadata/availability at open time, while a
    // target, Account, or generation transition retires any live form/action.
    const actionScope = React.useMemo(() => new AbortController(), [
        activeSessionId,
        accountLifetime,
        machineId,
        projection.inputs?.pluginProjectionV2?.generation,
        projection.phase,
        serverId,
    ]);
    React.useEffect(() => () => actionScope.abort(), [actionScope]);
    const snapshot = React.useMemo<PluginContributedActionCurrentSnapshot | null>(() => {
        const inputs = projection.inputs;
        const generation = inputs?.pluginProjectionV2?.generation;
        if (
            machineId === null
            || projection.phase !== 'ready'
            || !inputs
            || generation === null
            || generation === undefined
        ) {
            return null;
        }
        let current!: PluginContributedActionCurrentSnapshot;
        current = {
            pluginProjectionById: inputs.pluginProjectionById,
            pluginUiProjection: normalizePluginUiProjection(inputs.pluginProjectionV2 ?? null),
            resolveContributedAction: createPluginUiProjectedActionResolver(
                inputs.pluginProjectionV2?.actionsById,
            ),
            host: {
                machineId,
                serverId,
                expectedGeneration: generation,
                ...(activeSessionId ? { sessionId: activeSessionId } : {}),
                signal: actionScope.signal,
                accountLifetime,
                ...(destinationNavigation ? { openSurface: destinationNavigation.openSurface } : {}),
                ...(currentUiContextReader
                    ? { readCurrentUiContext: currentUiContextReader.readCurrentUiContext }
                    : {}),
                isCurrent: () => (
                    snapshotRef.current === current
                    && actionScope.signal.aborted === false
                    && accountLifetime?.isCurrent() !== false
                ),
                // The app palette consumes an Action only from its selected
                // app-scope origin. A Session palette already has its exact
                // Session machine/currentness owner and must not acquire a
                // second app-scope selection gate.
                ...(activeSessionId ? {} : {
                    isActionCurrent: (identity: Readonly<{ pluginId: string; localId: string }>) => {
                        const projectedAction = appShellProjectionRef.current.pluginUiProjection?.actionsById[
                            buildQualifiedPluginContributionKey(identity)
                        ];
                        const origin = readPluginUiContributionOrigin(projectedAction);
                        return origin?.machineId === machineId
                            && origin.serverId === serverId
                            && origin.generation !== null
                            && String(origin.generation) === String(generation)
                            && origin.interactionEnabled === true
                            && origin.phase === 'current'
                            && origin.executionOrigin?.materializationRef.pluginId === identity.pluginId
                            && origin.executionOrigin.materializationRef.machineId === machineId;
                    },
                }),
            },
        };
        return current;
    }, [
        accountLifetime,
        actionScope,
        activeSessionId,
        currentUiContextReader,
        destinationNavigation,
        machineId,
        projection.inputs,
        projection.phase,
        serverId,
    ]);
    snapshotRef.current = snapshot;
    const controller = React.useMemo(() => createPluginContributedActionController({
        resolveCurrent: () => snapshotRef.current,
    }), [clientExecutableRegistrationRevision]);

    return React.useMemo(() => (
        snapshot
            ? { controller, scope, signal: actionScope.signal }
            : undefined
    ), [actionScope.signal, controller, scope, snapshot]);
}

export function CommandPaletteProvider({ children }: { children: React.ReactNode }) {
    return <WebCommandPaletteProvider>{children}</WebCommandPaletteProvider>;
}

function WebCommandPaletteProvider({ children }: { children: React.ReactNode }) {
    const router = useRouter();
    const resolveNewSessionOrdinaryEntryRoute = useResolveNewSessionOrdinaryEntryRoute();
    const {
        sessionsById,
        commandPaletteEnabled,
        keyboardSingleKeyShortcutsEnabled,
        keyboardShortcutDisabledCommandIdsV1,
        keyboardShortcutOverridesV1,
    } = storage(useShallow((state) => ({
        sessionsById: state.sessions,
        commandPaletteEnabled: state.settings.commandPaletteEnabled,
        keyboardSingleKeyShortcutsEnabled: state.settings.keyboardSingleKeyShortcutsEnabled,
        keyboardShortcutDisabledCommandIdsV1: state.settings.keyboardShortcutDisabledCommandIdsV1,
        keyboardShortcutOverridesV1: state.settings.keyboardShortcutOverridesV1,
    })));
    const navigateToSession = useNavigateToSession();
    const segments = useSegments();
    const routeParams = useGlobalSearchParams<{
        id?: string | string[];
        sessionId?: string | string[];
        serverId?: string | string[];
    }>();
    const activeSessionId = useMemo(
        () => readActiveSessionIdFromRoute(segments, routeParams.id),
        [routeParams.id, segments],
    );
    const universalSearchRouteActive = useMemo(
        () => projectParameterFreeRoute(segments).segments[0] === 'search',
        [segments],
    );
    const commandContextSessionId = universalSearchRouteActive
        ? normalizeSessionId(routeParams.sessionId)
        : activeSessionId;
    const commandContextServerId = normalizeSessionId(routeParams.serverId);
    const universalSearchRouteOpenRequestedRef = React.useRef(universalSearchRouteActive);
    React.useEffect(() => {
        if (!universalSearchRouteActive) {
            universalSearchRouteOpenRequestedRef.current = false;
        }
    }, [universalSearchRouteActive]);
    const pluginActionPresentation = useCommandPalettePluginActionPresentation(commandContextSessionId);
    const executionRunsEnabled = useFeatureEnabled('execution.runs');
    const voiceEnabled = useFeatureEnabled('voice');
    const petsCompanionEnabled = useFeatureEnabled('pets.companion');
    const browseExistingSessionsEnabled = useFeatureEnabled('sessions.direct');
    const compactAppDestinations = useCompactAppDestinations({ browseExistingSessionsEnabled });
    const activatePluginAppPage = usePluginAppPageCatalogActivationHandler();
    const activateCompactAppDestination = useCallback((destination: CompactAppDestination) => {
        if (
            destination.kind === 'plugin'
            && destination.container === 'appPage'
            && destination.availability === 'available'
        ) {
            activatePluginAppPage(destination);
            return;
        }
        // Unavailable pages retain the existing route-owned tombstone; all
        // other compact entries have no launch-input lifecycle to stage.
        router.push(destination.routePath as Parameters<typeof router.push>[0]);
    }, [activatePluginAppPage, router]);
    const applySettings = useApplySettings();
    const applyLocalSettings = useApplyLocalSettings();
    const keyboardPlatform = useMemo(resolveKeyboardPlatform, []);
    const labelHandlers = useMemo<KeyboardShortcutHandlers>(
        () => ({
            'session.new': () => undefined,
            'settings.open': () => undefined,
            ...(commandPaletteEnabled ? { 'commandPalette.open': () => undefined } : {}),
        }),
        [commandPaletteEnabled],
    );
    const shortcutLabels = useMemo(
        () => buildKeyboardShortcutLabels(keyboardPlatform, Platform.OS === 'web' ? 'web' : 'native', {
            disabledCommandIds: keyboardShortcutDisabledCommandIdsV1 ?? [],
            overrides: keyboardShortcutOverridesV1 ?? {},
            singleKeyShortcutsEnabled: keyboardSingleKeyShortcutsEnabled === true,
            handlers: labelHandlers,
            context: {
                isEditableTarget: false,
                isComposing: false,
            },
        }),
        [
            keyboardPlatform,
            keyboardShortcutDisabledCommandIdsV1,
            keyboardShortcutOverridesV1,
            keyboardSingleKeyShortcutsEnabled,
            labelHandlers,
        ],
    );
    const actionExecutor = useMemo(
        () => createDefaultActionExecutor({
            resolveServerIdForSessionId: (sessionId) => resolvePreferredServerIdForSessionId(sessionId) ?? null,
            openSession: (sessionId, options) => {
                router.push(buildScopedSessionRouteHref({
                    sessionId,
                    serverId: options?.serverId,
                }) as any);
            },
        }),
        [router],
    );
    const petControls = useMemo<PetCommandControls>(() => {
        const desktop = isDesktopHost();
        const surface = desktop ? 'desktopOverlay' : Platform.OS === 'web' ? 'appShell' : 'none';
        return {
            surface,
            wake: () => {
                applySettings({ petsEnabled: true });
                applyLocalSettings(desktop
                    ? {
                        petsEnabledOverride: 'enabled',
                        desktopPetOverlayEnabledOverride: 'enabled',
                        desktopOverlayEnabled: true,
                        desktopOverlayVisibilityMode: 'always_when_enabled',
                    }
                    : { petsEnabledOverride: 'enabled' });
            },
            tuck: () => {
                applyLocalSettings(desktop
                    ? {
                        desktopPetOverlayEnabledOverride: 'disabled',
                        desktopOverlayEnabled: false,
                    }
                    : { petsEnabledOverride: 'disabled' });
            },
            resetPosition: desktop
                ? () => {
                    applyLocalSettings({
                        desktopOverlayPlacementMode: 'anchored',
                        desktopOverlayAnchor: 'top_center',
                        desktopOverlayOffsetX: 0,
                        desktopOverlayOffsetY: 0,
                    });
                    fireAndForget(resetDesktopActivityOverlayPosition(), {
                        tag: 'CommandPaletteProvider.resetDesktopActivityOverlayPosition',
                    });
                }
                : undefined,
            refreshCodexPets: () => {
                router.push('/settings/pets' as any);
                requestCodexPetRefresh();
            },
        };
    }, [applyLocalSettings, applySettings, router]);

    const openNewSession = useCallback(() => {
        const { draftId, draftOrigin } = resolveNewSessionOrdinaryEntryRoute();
        router.push({ pathname: '/new', params: { draftId, draftOrigin } });
    }, [resolveNewSessionOrdinaryEntryRoute, router]);

    const buildCommands = useCallback((requestedActiveSessionId: string | null = commandContextSessionId, requestedScope?: UniversalSearchScopeSeed) => {
        // The contributed Action presentation is captured for the rendered
        // route's exact Session. An imperative opener may target another Home
        // or Session, so never attach the ambient Session's Actions to that
        // command inventory. The Search provider catalog still supplies
        // exact-target plugin entities for the requested scope.
        const ambientSession = requestedActiveSessionId
            ? (storage.getState().sessions as Record<string, { serverId?: string; accountId?: string } | undefined>)[requestedActiveSessionId]
            : null;
        const exactSessionContext = requestedScope && requestedActiveSessionId
            ? resolveServerProfileScopeIdForIdentifier(ambientSession?.serverId ?? null)
                === resolveServerProfileScopeIdForIdentifier(requestedScope.serverId)
                && (requestedScope.accountId === null || ambientSession?.accountId === requestedScope.accountId)
            : requestedActiveSessionId === commandContextSessionId;
        const scopedPluginActionPresentation = exactSessionContext
            ? pluginActionPresentation
            : null;
        return buildCommandPaletteCommands({
            sessionsById: storage.getState().sessions,
            isDev: __DEV__ === true,
            activeSessionId: requestedActiveSessionId,
            activeSessionServerId: requestedScope?.serverId
                ?? (requestedActiveSessionId === commandContextSessionId ? commandContextServerId : null),
            features: { executionRunsEnabled, voiceEnabled, petsCompanionEnabled },
            shortcutLabels,
            petControls,
            ...(scopedPluginActionPresentation ? { pluginActionPresentation: scopedPluginActionPresentation } : {}),
            compactAppDestinations: compactAppDestinations.filter((destination) => destination.id !== SEARCH_DESTINATION_ID),
            onActivateCompactAppDestination: activateCompactAppDestination,
            nav: {
                push: (path) => router.push(path as any),
                openNewSession,
                navigateToSession,
            },
            actions: {
                execute: (actionId, parameters, ctx) => actionExecutor.execute(actionId as any, parameters, ctx),
            },
            alert: async (title, message) => {
                await Modal.alertAsync(title, message);
            },
        });
    }, [sessionsById, commandContextSessionId, commandContextServerId, executionRunsEnabled, voiceEnabled, petsCompanionEnabled, compactAppDestinations, activateCompactAppDestination, shortcutLabels, petControls, pluginActionPresentation, router, openNewSession, navigateToSession, actionExecutor]);

    const openUniversalSearchModalRef = React.useRef<Readonly<{
        id: string;
        activeSessionId: string | null;
        scope: UniversalSearchScopeSeed;
    }> | null>(null);
    React.useEffect(() => {
        const openModal = openUniversalSearchModalRef.current;
        if (!openModal) return;
        Modal.update<UniversalSearchModalProps>(openModal.id, {
            commands: buildCommands(openModal.activeSessionId, openModal.scope),
        });
    }, [buildCommands]);

    const showCommandPalette = useCallback((initialQuery?: string, requestedScope?: UniversalSearchScopeSeed) => {
        const activeAccountScope = captureActiveServerAccountScopeLifetime()?.scope;
        const activeSession = activeSessionId
            ? (storage.getState().sessions as Record<string, { serverId?: string } | undefined>)[activeSessionId]
            : null;
        const activeMachineTarget = activeSessionId ? readMachineControlTargetForSession(activeSessionId) : null;
        const invocationScope = resolveUniversalSearchInvocationScope({
            requestedScope,
            ambientScope: {
                accountId: activeAccountScope?.accountId ?? null,
                serverId: activeSession?.serverId ?? activeAccountScope?.serverId ?? null,
                sessionId: activeSessionId,
                machineId: activeMachineTarget?.machineId ?? null,
                rootPath: activeMachineTarget?.basePath ?? null,
            },
        });
        if (Platform.OS !== 'web') {
            if (universalSearchRouteActive || universalSearchRouteOpenRequestedRef.current) return;
            universalSearchRouteOpenRequestedRef.current = true;
            router.push({
                pathname: UNIVERSAL_SEARCH_ROUTE,
                params: {
                    ...(initialQuery?.trim() ? { q: initialQuery.trim() } : {}),
                    ...(invocationScope.sessionId ? { sessionId: invocationScope.sessionId } : {}),
                    ...(invocationScope.accountId ? { accountId: invocationScope.accountId } : {}),
                    ...(invocationScope.serverId ? { serverId: invocationScope.serverId } : {}),
                    ...(invocationScope.machineId ? { machineId: invocationScope.machineId } : {}),
                    ...(invocationScope.rootPath ? { rootPath: invocationScope.rootPath } : {}),
                },
            } as never);
            return;
        }
        if (openUniversalSearchModalRef.current) return;
        let modalId = '';
        modalId = Modal.show({
            component: UniversalSearchModal,
            webPlacement: 'top',
            onRequestClose: () => {
                if (openUniversalSearchModalRef.current?.id === modalId) {
                    openUniversalSearchModalRef.current = null;
                }
            },
            props: {
                commands: buildCommands(invocationScope.sessionId, invocationScope),
                ...(initialQuery?.trim() ? { initialQuery: initialQuery.trim() } : {}),
                ...(invocationScope.sessionId ? { activeSessionId: invocationScope.sessionId } : {}),
                initialScope: invocationScope,
            },
        });
        openUniversalSearchModalRef.current = {
            id: modalId,
            activeSessionId: invocationScope.sessionId,
            scope: invocationScope,
        };
    }, [activeSessionId, buildCommands, router, universalSearchRouteActive]);

    const universalSearchRuntime = useMemo<UniversalSearchRuntime>(() => ({
        open: showCommandPalette,
        buildCommands,
    }), [buildCommands, showCommandPalette]);

    const keyboardHandlers = useMemo<KeyboardShortcutHandlers>(
        () => ({
            ...(commandPaletteEnabled ? { 'commandPalette.open': showCommandPalette } : {}),
            'session.new': openNewSession,
            'settings.open': () => {
                router.push('/settings' as any);
            },
        }),
        [commandPaletteEnabled, openNewSession, router, showCommandPalette],
    );
    const keyboardEnabledWhenDisabledCommandIds = useMemo(
        () => commandPaletteEnabled ? ['commandPalette.open'] as const : [],
        [commandPaletteEnabled],
    );
    return (
        <UniversalSearchRuntimeProvider value={universalSearchRuntime}>
            <KeyboardShortcutProvider
                handlers={keyboardHandlers}
                enabledWhenDisabledCommandIds={keyboardEnabledWhenDisabledCommandIds}
            >
                {children}
            </KeyboardShortcutProvider>
        </UniversalSearchRuntimeProvider>
    );
}
