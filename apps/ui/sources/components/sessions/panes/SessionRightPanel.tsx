import { parseSessionPaneScopeId } from './sessionPaneScopeId';
import { useSessionCollaborationDestinationAdmitted } from '@/hooks/session/useSessionCollaborationAvailability';
import { normalizeSessionAddress, sessionAddressKey } from '@/sync/domains/session/sessionAddress';
import * as React from 'react';
import { Platform, Pressable, View } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import type { PluginUiDestinationReferenceV1 } from '@happier-dev/protocol/plugins/ui';

import { useChromeSafeAreaInsets } from '@/components/ui/layout/useChromeSafeAreaInsets';
import { resolvePluginUiRuntimeFormFactor } from '@/components/appShell/panes/layout/resolveMultiPaneDeviceType';
import { useAppPaneScope } from '@/components/appShell/panes/hooks/useAppPaneScope';
import { RightSidebarIconTabBar } from '@/components/appShell/rightSidebar/RightSidebarIconTabBar';
import {
    resolveSessionRightSidebarTabs,
    resolveRightSidebarTabSelection,
} from '@/components/appShell/rightSidebar/rightSidebarTabRegistry';
import type { RightSidebarPluginTabDefinition } from '@/components/appShell/rightSidebar/rightSidebarBuiltinTabs';
import { PluginSurfacePlacementHost } from '@/components/plugins/surfaces';
import type { BoundPluginSurfaceBinding } from '@/components/plugins/surfaces/boundPluginSurfaceController';
import {
    PluginSurfacePaneLaunchScope,
    stagePluginSurfacePaneLaunch,
    usePluginSurfaceDestinationNavigationBinding,
    usePluginSurfaceDestinationNavigationBindingForScope,
    useRegisterPluginSurfaceDestinationNavigationOwner,
    usePluginSurfacePaneLaunch,
    usePluginSurfacePaneLaunchScope,
} from '@/components/plugins/surfaces/pluginSurfaceDestinationNavigation';
import { PluginReactNativeUnavailable } from '@/components/plugins/reactNative/PluginReactNativeUnavailable';
import { PaneLoadingFallback } from '@/components/ui/panels/PaneLoadingFallback';
import { RetainedPanelSurface } from '@/components/ui/panels/RetainedPanelSurface';
import { SessionRightPanelAgentsView } from '@/components/sessions/panes/agents/SessionRightPanelAgentsView';
import { SessionBoardPane } from '@/components/sessions/board/SessionBoardPane';
import { SessionTranscriptNavigationPane } from '@/components/sessions/panes/SessionTranscriptNavigationPane';
import { getPreferredLanguage, t } from '@/text';
import { resolveOptionalSessionScreenTestId, useSessionScreenTestIdsEnabled } from '../shell/sessionScreenTestIds';
import { SessionRightPanelBrowserView } from './browser/SessionRightPanelBrowserView';
import { SessionRightPanelServicesView } from './services/SessionRightPanelServicesView';
import { SessionBrowseFilesSurface } from './surfaces/SessionBrowseFilesSurface';
import { SessionGitSurface } from './surfaces/SessionGitSurface';
import { SessionTerminalSurface } from './surfaces/SessionTerminalSurface';
import { useSessionFileDetailsOpener } from './useSessionFileDetailsOpener';
import { useSessionTerminalAvailability } from '@/components/sessions/terminal/useSessionTerminalAvailability';
import { useSessionBoardFeatureEnabled } from '@/components/sessions/board/useSessionBoardFeatureEnabled';
import { SafeIonicons } from '@/components/ui/icons/SafeIonicons';
import { useServicesOpenInBrowser } from '@/components/sessions/localServices/useServicesOpenInBrowser';
import {
    selectPluginDestinationSurfacePlacements,
    selectPluginRightSidebarTabPlacements,
} from '@/sync/domains/plugins/ui/surfacePlacementSelectors';
import { Icon } from '@/components/ui/icons/Icon';
import {
    useSessionAddressForSessionId,
    useSessionPluginRuntime,
    type SessionPaneSurfaceScope,
} from '@/components/sessions/plugins/useSessionPluginRuntime';
import { useDeviceType } from '@/utils/platform/responsive';
import { createPluginLocalizedTextResolver } from '@/sync/domains/plugins/ui/i18n';
import { createSessionBoardDetailsTab } from './details/sessionDetailsTabBuilders';
import { useSessionViewShellSession } from '@/components/sessions/shell/sessionViewStableSession';
import type { SessionBoardPrimaryMountResolver } from '@/sync/domains/session/board';
import { useMountedSessionBoardController } from '@/components/sessions/board/SessionBoardControllerProvider';

const SessionCollaborationSurface = React.lazy(() => import('@/components/sessions/collaboration/SessionCollaborationSurface').then((module) => ({ default: module.SessionCollaborationSurface })));

export type SessionRightPanelProps = Readonly<{
    sessionId: string;
    scopeId: string;
    /** Exact AppPane target/projection facts when this panel is driver-rendered. */
    paneSurfaceScope?: SessionPaneSurfaceScope;
    presentation?: 'pane' | 'screen';
    /**
     * Optional override for the close action. Used by fullscreen/mobile routes that render the
     * same surface as the desktop right pane but need to navigate back in the router stack.
     */
    onRequestClose?: () => void;
    /** One executable-mount decision derived by the enclosing Session shell. */
    resolveBoardPrimaryHost?: SessionBoardPrimaryMountResolver;
}>;

const NO_BOARD_PRIMARY_MOUNT: SessionBoardPrimaryMountResolver = () => null;

type RightTabId = string;

const EMPTY_PLUGIN_DESTINATION: PluginUiDestinationReferenceV1 = Object.freeze({
    pluginId: '',
    localId: '',
});

const stylesheet = StyleSheet.create((theme) => ({
    container: {
        flex: 1,
        backgroundColor: theme.colors.surface.base,
        minHeight: 0,
        minWidth: 0,
        borderTopWidth: Platform.select({ ios: 0.33, default: 1 }),
        borderTopColor: theme.colors.border.default,
    },
    header: {
        paddingHorizontal: 12,
        paddingTop: 10,
        paddingBottom: 8,
        borderBottomWidth: Platform.select({ ios: 0.33, default: 1 }),
        borderBottomColor: theme.colors.border.default,
        backgroundColor: theme.colors.surface.inset,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
    },
    tabBarContainer: {
        flex: 1,
        alignItems: 'center',
    },
    closeButton: {
        width: 34,
        height: 34,
        borderRadius: 10,
        alignItems: 'center',
        justifyContent: 'center',
        borderWidth: 1,
        borderColor: theme.colors.border.default,
        backgroundColor: theme.colors.surface.base,
    },
    body: {
        flex: 1,
        minHeight: 0,
        minWidth: 0,
    },
}));

/**
 * Desktop AppPane and standalone fullscreen routes share the same generic
 * handoff owner when nested. A standalone route establishes that owner at its
 * own boundary instead of creating a Session-local launch store.
 */
export const SessionRightPanel = React.memo((props: SessionRightPanelProps) => {
    const inheritedPaneLaunchScope = usePluginSurfacePaneLaunchScope();
    return inheritedPaneLaunchScope
        ? <SessionRightPanelContent {...props} />
        : (
            <PluginSurfacePaneLaunchScope>
                <SessionRightPanelContent {...props} />
            </PluginSurfacePaneLaunchScope>
        );
});

const SessionRightPanelContent = React.memo((props: SessionRightPanelProps) => {
    const styles = stylesheet;
    const { theme } = useUnistyles();
    const insets = useChromeSafeAreaInsets();
    const deviceType = useDeviceType();
    const pane = useAppPaneScope(props.scopeId);
    const scopeState = pane.scopeState;
    const headerPaddingTop = 10;
    const { sidebarTabAvailable: terminalTabAvailable } = useSessionTerminalAvailability(props.paneSurfaceScope?.serverId ?? parseSessionPaneScopeId(props.scopeId)?.address?.serverId);
    // The Board tab is decided by the EXACT Session's Home, carried by the route
    // or pane scope — never by the ambient preferred/main Home selection.
    const boardFeatureServerId = props.paneSurfaceScope?.serverId
        ?? parseSessionPaneScopeId(props.scopeId)?.address?.serverId
        ?? null;
    const boardFeatureEnabled = useSessionBoardFeatureEnabled(boardFeatureServerId);
    const sessionScreenTestIdsEnabled = useSessionScreenTestIdsEnabled();
    const closeButtonAtStart = props.presentation === 'screen' && Platform.OS !== 'web';
    const headerSafeAreaTop = closeButtonAtStart ? 0 : insets.top;
    const sessionAddress = useSessionAddressForSessionId(
        props.sessionId,
        props.paneSurfaceScope?.serverId ?? parseSessionPaneScopeId(props.scopeId)?.address?.serverId,
    );
    const collaborationAddress = props.paneSurfaceScope
        ? props.paneSurfaceScope.sessionId === props.sessionId
            ? normalizeSessionAddress(props.paneSurfaceScope.serverId, props.sessionId)
            : null
        : sessionAddress;
    const mountedBoard = useMountedSessionBoardController(collaborationAddress);
    const collaborationAdmitted = useSessionCollaborationDestinationAdmitted(collaborationAddress?.serverId ?? '');
    const sessionSharingAvailable = collaborationAddress !== null && collaborationAdmitted;
    const pluginRuntime = useSessionPluginRuntime({
        address: sessionAddress,
        paneSurfaceScope: props.paneSurfaceScope,
    });
    const session = useSessionViewShellSession(props.sessionId, pluginRuntime.serverId);
    const runtimeAdmission = React.useMemo(() => Object.freeze({
        platform: pluginRuntime.platform,
        formFactor: resolvePluginUiRuntimeFormFactor({ deviceType }),
    }), [deviceType, pluginRuntime.platform]);
    const pluginRightSidebarPlacements = React.useMemo(() => (
        pluginRuntime.pluginUiProjection
            ? selectPluginRightSidebarTabPlacements(pluginRuntime.pluginUiProjection, 'session')
            : []
    ), [pluginRuntime.pluginUiProjection]);
    const pluginLocale = getPreferredLanguage();
    const localizePluginText = React.useMemo(
        () => createPluginLocalizedTextResolver({
            projection: pluginRuntime.pluginUiProjection,
            locale: pluginLocale,
        }),
        [pluginLocale, pluginRuntime.pluginUiProjection],
    );
    const rightPanelTabs = React.useMemo(() => resolveSessionRightSidebarTabs({
        sessionSharingAvailable,
        terminalTabAvailable,
        boardFeatureEnabled,
        presentation: props.presentation === 'screen' ? 'mobile' : 'desktop',
        pluginPlacements: pluginRightSidebarPlacements,
        projectionGeneration: pluginRuntime.pluginUiProjection?.generation ?? null,
        runtimeAdmission,
        localize: localizePluginText,
    }), [
        sessionSharingAvailable,
        boardFeatureEnabled,
        localizePluginText,
        pluginRuntime.pluginUiProjection?.generation,
        pluginRightSidebarPlacements,
        props.presentation,
        runtimeAdmission,
        terminalTabAvailable,
    ]);
    const rightTabSelection = React.useMemo(() => resolveRightSidebarTabSelection<RightTabId>({
        activeTabId: scopeState?.right.activeTabId,
        selectedDestination: scopeState?.right.selectedDestination,
        tabs: rightPanelTabs,
        projectionPhase: pluginRuntime.phase,
    }), [
        pluginRuntime.phase,
        rightPanelTabs,
        scopeState?.right.activeTabId,
        scopeState?.right.selectedDestination,
    ]);
    const activeTab = rightTabSelection.kind === 'available'
        ? rightTabSelection.tab.id
        : null;
    const resolveBoardPrimaryHost = props.resolveBoardPrimaryHost ?? NO_BOARD_PRIMARY_MOUNT;
    const callerHostedHtmlRuntime = mountedBoard?.callerHostedHtmlRuntime ?? null;
    const activePluginPlacement = rightTabSelection.kind === 'available'
        && rightTabSelection.tab.owner === 'plugin'
        ? rightTabSelection.tab.placement
        : null;
    const activeInstanceKey = scopeState?.right.selectedDestination?.kind === 'plugin'
        ? scopeState.right.selectedDestination.instanceKey
        : undefined;
    const paneLaunchScope = usePluginSurfacePaneLaunchScope();
    if (!paneLaunchScope) {
        // The wrapper above always supplies the scope. Do not create an
        // unbound Session-local input owner if that invariant is broken.
        return null;
    }
    const { accountLifetime, store: paneLaunchStore } = paneLaunchScope;
    const scopedLaunchFacts = React.useMemo(() => Object.freeze({
        serverId: pluginRuntime.serverId ?? null,
        machineId: pluginRuntime.machineId ?? null,
        generation: pluginRuntime.pluginUiProjection?.generation ?? null,
        interactionEnabled: pluginRuntime.phase === 'current'
            && pluginRuntime.interactionEnabled === true,
    }), [
        pluginRuntime.interactionEnabled,
        pluginRuntime.phase,
        pluginRuntime.machineId,
        pluginRuntime.pluginUiProjection?.generation,
        pluginRuntime.serverId,
    ]);
    const activePaneLaunch = usePluginSurfacePaneLaunch({
        store: paneLaunchStore,
        placement: activePluginPlacement,
        targetKind: 'session',
        container: 'rightSidebarTab',
        accountLifetime,
        scopedLaunchFacts,
        destination: activePluginPlacement?.binding.destination ?? EMPTY_PLUGIN_DESTINATION,
        ...(activeInstanceKey === undefined ? {} : { instanceKey: activeInstanceKey }),
    });

    const setActiveTab = React.useCallback((tabId: RightTabId) => {
        const tab = rightPanelTabs.find((candidate) => candidate.id === tabId) ?? null;
        if (!tab || tab.disabledReason) {
            return;
        }
        if (tab.owner === 'plugin') {
            pane.selectRightDestination({
                kind: 'plugin',
                destination: tab.placement.binding.destination,
            });
            paneLaunchStore.retire();
            return;
        }
        pane.openRight({ tabId });
        paneLaunchStore.retire();
    }, [pane, paneLaunchStore, rightPanelTabs]);

    const openRightSidebarTab = React.useCallback((resolution: Parameters<typeof stagePluginSurfacePaneLaunch>[0]['resolution']) => {
        if (!stagePluginSurfacePaneLaunch({ store: paneLaunchStore, resolution })) {
            return { ok: false as const, code: 'unavailable' as const, reason: 'plugin_surface_open_origin_unavailable' };
        }
        pane.selectRightDestination({
            kind: 'plugin',
            destination: resolution.placement.binding.destination,
            ...(resolution.request.instanceKey === undefined ? {} : { instanceKey: resolution.request.instanceKey }),
        });
        return { ok: true as const };
    }, [pane, paneLaunchStore]);
    const targetNavigationBinding = usePluginSurfaceDestinationNavigationBinding();
    const fallbackNavigationBinding = usePluginSurfaceDestinationNavigationBindingForScope({
        placements: pluginRuntime.pluginUiProjection
            ? selectPluginDestinationSurfacePlacements(pluginRuntime.pluginUiProjection)
            : [],
        targetKind: 'session',
        accountLifetime,
        scopedLaunchFacts,
        runtimeAdmission,
    });
    const navigationBinding = targetNavigationBinding ?? fallbackNavigationBinding;
    const sidebarOwner = React.useMemo(() => ({
        container: 'rightSidebarTab' as const,
        handler: openRightSidebarTab,
    }), [openRightSidebarTab]);
    // The session shell remains the target-scope right-sidebar owner while it
    // is mounted, including before this pane is selected. A standalone screen
    // has no shell binding, so it registers this incumbent owner against its
    // own fallback binding instead. Registering both would make ownership
    // ambiguous once the sidebar mounts.
    useRegisterPluginSurfaceDestinationNavigationOwner(
        targetNavigationBinding ? null : sidebarOwner,
        navigationBinding,
    );
    const openSurface = navigationBinding.openSurface;
    const pluginBinding = React.useMemo<BoundPluginSurfaceBinding>(() => ({ openSurface }), [openSurface]);

    const closeNavigationPane = props.onRequestClose ?? pane.closeRight;
    // On `screen` presentation this panel IS a route of its own and the transcript lives on
    // another one, so a navigation jump has to bring the transcript back before it can land.
    // Beside a mounted transcript (the desktop pane) there is nothing to reveal, and closing
    // the pane on every jump would throw the reader's navigation list away.
    const revealTranscriptForNavigationJump = props.presentation === 'screen'
        ? closeNavigationPane
        : undefined;

    const { openFileInDetails, openFileInDetailsPinned } = useSessionFileDetailsOpener(props.scopeId);
    const availableTabIds = React.useMemo(() => new Set(rightPanelTabs.map((tab) => tab.id)), [rightPanelTabs]);
    const openBoardItemInDetails = React.useCallback((itemId: string) => {
        pane.openDetailsTab(createSessionBoardDetailsTab({ kind: 'item', itemId }), { intent: 'pinned' });
    }, [pane]);
    const openBoardInDetails = React.useCallback(() => {
        pane.openDetailsTab(createSessionBoardDetailsTab(), { intent: 'pinned' });
    }, [pane]);

    const openServiceInBrowser = useServicesOpenInBrowser({
        scopeId: props.scopeId,
        scope: 'sessionDetails',
        machineId: pluginRuntime.machineId,
        serverId: pluginRuntime.serverId,
        sessionId: props.sessionId,
    });

    const closeButton = (
        <Pressable
            testID={resolveOptionalSessionScreenTestId(sessionScreenTestIdsEnabled, 'session-rightpanel-close')}
            onPress={props.onRequestClose ?? pane.closeRight}
            style={closeButtonAtStart ? undefined : styles.closeButton}
            hitSlop={closeButtonAtStart ? 15 : undefined}
            accessibilityRole="button"
            accessibilityLabel={closeButtonAtStart ? t('common.back') : t('common.close')}
        >
            {closeButtonAtStart ? (
                <Icon
                    name={Platform.OS === 'ios' ? 'caret-left' : 'arrow-left'}
                    size={24}
                    color={theme.colors.chrome.header.foreground}
                />
            ) : (
                <Icon name="x" size={16} color={theme.colors.text.secondary} />
            )}
        </Pressable>
    );

    return (
        <View testID="session-right-panel-root" style={styles.container}>
            <View style={[styles.header, { paddingTop: headerPaddingTop + headerSafeAreaTop }]}>
                {closeButtonAtStart ? closeButton : null}
                <View style={styles.tabBarContainer}>
                    <RightSidebarIconTabBar
                        tabs={rightPanelTabs}
                        activeTabId={activeTab ?? ''}
                        onSelectTab={setActiveTab}
                        testIDPrefix={resolveOptionalSessionScreenTestId(sessionScreenTestIdsEnabled, 'session-rightpanel-tab') ?? undefined}
                    />
                </View>
                {closeButtonAtStart ? null : closeButton}
            </View>
            <View style={styles.body}>
                {rightTabSelection.kind === 'unresolved' ? (
                    <PaneLoadingFallback color={theme.colors.text.secondary} />
                ) : rightTabSelection.kind === 'unavailable' ? (
                    <PluginReactNativeUnavailable diagnostics={[rightTabSelection.reason]} />
                ) : (
                    <View style={{ flex: 1, minHeight: 0, minWidth: 0, position: 'relative' }}>
                        <RetainedPanelSurface
                            isActive={activeTab === 'git'}
                            mode="absolute-overlay"
                            testID={resolveOptionalSessionScreenTestId(sessionScreenTestIdsEnabled, 'session-rightpanel-surface-git')}
                        >
                            <React.Suspense fallback={<PaneLoadingFallback color={theme.colors.text.secondary} />}>
                                <SessionGitSurface sessionId={props.sessionId} scopeId={props.scopeId} serverId={props.paneSurfaceScope?.serverId ?? parseSessionPaneScopeId(props.scopeId)?.address?.serverId} />
                            </React.Suspense>
                        </RetainedPanelSurface>
                        <RetainedPanelSurface
                            isActive={activeTab === 'files'}
                            mode="absolute-overlay"
                            testID={resolveOptionalSessionScreenTestId(sessionScreenTestIdsEnabled, 'session-rightpanel-surface-files')}
                        >
                            <React.Suspense fallback={<PaneLoadingFallback color={theme.colors.text.secondary} />}>
                                <SessionBrowseFilesSurface
                                    scopeId={props.scopeId}
                                    sessionId={props.sessionId}
                                    serverId={props.paneSurfaceScope?.serverId ?? parseSessionPaneScopeId(props.scopeId)?.address?.serverId}
                                    onOpenFile={openFileInDetails}
                                    onOpenFilePinned={openFileInDetailsPinned}
                                />
                            </React.Suspense>
                        </RetainedPanelSurface>
                        <RetainedPanelSurface
                            isActive={activeTab === 'agents'}
                            mode="absolute-overlay"
                            testID={resolveOptionalSessionScreenTestId(sessionScreenTestIdsEnabled, 'session-rightpanel-surface-agents')}
                        >
                            <React.Suspense fallback={<PaneLoadingFallback color={theme.colors.text.secondary} />}>
                                <SessionRightPanelAgentsView
                                    sessionId={props.sessionId}
                                    scopeId={props.scopeId}
                                    serverId={props.paneSurfaceScope?.serverId ?? parseSessionPaneScopeId(props.scopeId)?.address?.serverId}
                                />
                            </React.Suspense>
                        </RetainedPanelSurface>
                        <RetainedPanelSurface
                            isActive={activeTab === 'navigation'}
                            mode="absolute-overlay"
                            testID={resolveOptionalSessionScreenTestId(sessionScreenTestIdsEnabled, 'session-rightpanel-surface-navigation')}
                        >
                            <SessionTranscriptNavigationPane
                                onRequestClose={closeNavigationPane}
                                onRevealTranscript={revealTranscriptForNavigationJump}
                                sessionId={props.sessionId}
                                testIDPrefix="session-transcript-navigation"
                            />
                        </RetainedPanelSurface>
                        {availableTabIds.has('collaboration') && collaborationAddress ? (
                            <RetainedPanelSurface
                                isActive={activeTab === 'collaboration'}
                                mode="absolute-overlay"
                                testID={resolveOptionalSessionScreenTestId(sessionScreenTestIdsEnabled, 'session-rightpanel-surface-collaboration')}
                            >
                                <React.Suspense fallback={<PaneLoadingFallback color={theme.colors.text.secondary} />}>
                                    <SessionCollaborationSurface
                                        key={sessionAddressKey(collaborationAddress)}
                                        target={collaborationAddress}
                                    />
                                </React.Suspense>
                            </RetainedPanelSurface>
                        ) : null}
                        {availableTabIds.has('board') && session && (
                            <RetainedPanelSurface
                                isActive={activeTab === 'board'}
                                mode="absolute-overlay"
                                testID={resolveOptionalSessionScreenTestId(sessionScreenTestIdsEnabled, 'session-rightpanel-surface-board')}
                            >
                                <React.Suspense fallback={<PaneLoadingFallback color={theme.colors.text.secondary} />}>
                                    <SessionBoardPane
                                        sessionId={props.sessionId}
                                        session={session}
                                        serverId={pluginRuntime.serverId}
                                        host="sidebar"
                                        resolvePrimaryHost={resolveBoardPrimaryHost}
                                        density="compact"
                                        layout="single"
                                        interaction="navigation"
                                        onOpenItemHere={openBoardItemInDetails}
                                        onOpenBoardDetails={openBoardInDetails}
                                        pluginRuntime={pluginRuntime}
                                        {...(callerHostedHtmlRuntime ? { callerHostedHtmlRuntime } : {})}
                                    />
                                </React.Suspense>
                            </RetainedPanelSurface>
                        )}
                        {availableTabIds.has('terminal') && (
                            <RetainedPanelSurface
                                isActive={activeTab === 'terminal'}
                                mode="absolute-overlay"
                                testID={resolveOptionalSessionScreenTestId(sessionScreenTestIdsEnabled, 'session-rightpanel-surface-terminal')}
                            >
                                <React.Suspense fallback={<PaneLoadingFallback color={theme.colors.text.secondary} />}>
                                    <SessionTerminalSurface sessionId={props.sessionId} scopeId={props.scopeId} />
                                </React.Suspense>
                            </RetainedPanelSurface>
                        )}
                        {availableTabIds.has('browser') && (
                            <RetainedPanelSurface
                                isActive={activeTab === 'browser'}
                                mode="absolute-overlay"
                                testID={resolveOptionalSessionScreenTestId(sessionScreenTestIdsEnabled, 'session-rightpanel-surface-browser')}
                            >
                                <React.Suspense fallback={<PaneLoadingFallback color={theme.colors.text.secondary} />}>
                                    <SessionRightPanelBrowserView
                                        sessionId={props.sessionId}
                                        pluginProjection={pluginRuntime}
                                    />
                                </React.Suspense>
                            </RetainedPanelSurface>
                        )}
                        {availableTabIds.has('services') && (
                            <RetainedPanelSurface
                                isActive={activeTab === 'services'}
                                mode="absolute-overlay"
                                testID={resolveOptionalSessionScreenTestId(sessionScreenTestIdsEnabled, 'session-rightpanel-surface-services')}
                            >
                                <React.Suspense fallback={<PaneLoadingFallback color={theme.colors.text.secondary} />}>
                                    <SessionRightPanelServicesView
                                        sessionId={props.sessionId}
                                        pluginUiProjection={pluginRuntime.pluginUiProjection}
                                        projectionInteractionEnabled={pluginRuntime.phase === 'current'
                                            && pluginRuntime.interactionEnabled === true}
                                        platform={pluginRuntime.platform}
                                        machineId={pluginRuntime.machineId}
                                        serverId={pluginRuntime.serverId}
                                        onOpenServiceInBrowser={openServiceInBrowser}
                                    />
                                </React.Suspense>
                            </RetainedPanelSurface>
                        )}
                        {rightPanelTabs
                            .filter((tab): tab is RightSidebarPluginTabDefinition => tab.owner === 'plugin')
                            .map((tab) => tab.disabledReason ? null : (
                                <RetainedPanelSurface
                                    key={tab.retentionKey}
                                    isActive={activeTab === tab.id}
                                    mode="absolute-overlay"
                                    testID={resolveOptionalSessionScreenTestId(sessionScreenTestIdsEnabled, `session-rightpanel-surface-${tab.id}`)}
                                >
                                    <React.Suspense fallback={<PaneLoadingFallback color={theme.colors.text.secondary} />}>
                                        <PluginSurfacePlacementHost
                                            placement={tab.placement}
                                            machineId={pluginRuntime.machineId}
                                            serverId={pluginRuntime.serverId}
                                            sessionId={props.sessionId}
                                            pluginUiProjection={pluginRuntime.pluginUiProjection}
                                            projectionInteractionEnabled={pluginRuntime.phase === 'current'
                                                && pluginRuntime.interactionEnabled === true}
                                            platform={pluginRuntime.platform}
                                            binding={activeTab === tab.id ? pluginBinding : undefined}
                                            launchInput={activeTab === tab.id ? activePaneLaunch?.input : undefined}
                                            mountInstanceKey={activeTab === tab.id ? activeInstanceKey : undefined}
                                        />
                                    </React.Suspense>
                                </RetainedPanelSurface>
                            ))}
                    </View>
                )}
            </View>
        </View>
    );
});
