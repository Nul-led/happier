import { useAuth } from '@/auth/context/AuthContext';
import * as React from 'react';
import { Stack, usePathname, useSegments } from 'expo-router';
import { useIsTablet } from '@/utils/platform/responsive';
import { SidebarView } from './SidebarView';
import { CollapsedSidebarView } from './CollapsedSidebarView';
import { View, useWindowDimensions, Platform } from 'react-native';
import { useLocalSetting, useLocalSettingMutable } from '@/sync/domains/state/storage';
import { ResizableDockedPane, type ResizableDockedPaneCommitMeta } from '@/components/ui/panels/ResizableDockedPane';
import { resolveScaledPaneWidthPx } from '@/components/appShell/panes/layout/paneSizing';
import { StyleSheet } from 'react-native-unistyles';
import { resolveSidebarDockMaxWidthPx, SIDEBAR_COLLAPSED_WIDTH_PX, SIDEBAR_DOCK_MIN_WIDTH_PX } from './sidebarSizing';
import { isDesktopActivityOverlayWindowContext } from '@/activity/adapters/desktop/runtime/isDesktopActivityOverlayWindowContext';
import { isTerminalConnectWebPathname } from '@/utils/path/terminalConnectUrl';
import { useAppPaneContext } from '@/components/appShell/panes/AppPaneProvider';
import { resolvePaneFocusModeRouteScopeId } from '@/components/appShell/panes/focusMode/resolvePaneFocusModeRouteScopeId';
import { isDesktopHost } from '@/utils/platform/desktopHost';
import { DesktopMainContentDragSurface } from '@/components/navigation/desktopWindowChrome/DesktopMainContentDragSurface';
import { isPublicRouteForUnauthenticated } from '@/auth/routing/authRouting';
import { useOnboardingJourneySessionActive } from '@/components/onboarding/tour/state/journeySession';
import { InboxModelProvider } from '@/hooks/inbox/useInboxModel';

/**
 * Radius on the sidebar-facing side of the content sheet only. The window-facing edges stay
 * square so the sheet reads as flush to the window and never stacks its own curve on top of
 * the OS window's rounded corners.
 */
const CONTENT_SHEET_SEAM_RADIUS_PX = 16;

const stylesheet = StyleSheet.create((theme) => ({
    root: {
        flexDirection: 'row',
        minWidth: 0,
        minHeight: 0,
        flex: 1,
        position: 'relative',
    },
    canvas: {
        // The plane the content sheet lies on. Painted here so the sheet's rounded
        // sidebar-facing corners reveal the canvas rather than whatever is behind the app.
        backgroundColor: theme.colors.background.canvas,
    },
    content: {
        flex: 1,
        minWidth: 0,
        minHeight: 0,
    },
    contentSheet: {
        borderTopLeftRadius: CONTENT_SHEET_SEAM_RADIUS_PX,
        borderBottomLeftRadius: CONTENT_SHEET_SEAM_RADIUS_PX,
        overflow: 'hidden',
        ...(Platform.OS === 'web' ? {} : {
            borderLeftWidth: StyleSheet.hairlineWidth,
            borderLeftColor: theme.colors.border.default,
        }),
    },
    /**
     * The seam shadow. An inert overlay tracing the content sheet's exact footprint — same left
     * corners, transparent fill — whose only job is to cast the sheet's lift shadow leftward onto
     * the sidebar.
     *
     * It stays separate from the clipped content sheet so the shadow reaches the sidebar.
     * Its rounded shape keeps the cast aligned with the sheet's corners.
     */
    contentSheetSeamShadow: {
        position: 'absolute',
        top: 0,
        bottom: 0,
        right: 0,
        borderTopLeftRadius: CONTENT_SHEET_SEAM_RADIUS_PX,
        borderBottomLeftRadius: CONTENT_SHEET_SEAM_RADIUS_PX,
        zIndex: 2,
        boxShadow: theme.colors.shadowSeamCastBoxShadow,
    },
}));

function isPublicNonHomeRoute(segments: readonly string[]): boolean {
    const normalizedSegments = segments.filter((segment) => !(segment.startsWith('(') && segment.endsWith(')')));
    if (normalizedSegments.length === 0 || normalizedSegments[0] === 'index') {
        return false;
    }
    return isPublicRouteForUnauthenticated([...segments]);
}

export const SidebarNavigator = React.memo(() => {
    const styles = stylesheet;
    const auth = useAuth();
    const pathname = usePathname();
    const segments = useSegments();
    const isTablet = useIsTablet();
    const isDesktopOverlayWindow = isDesktopActivityOverlayWindowContext();
    const onboardingJourneyActive = useOnboardingJourneySessionActive();
    const { state: paneState, dispatch: dispatchPaneAction } = useAppPaneContext();
    // The onboarding journey host owns the whole viewport until its session ends
    // (visual spec v3 §5): the post-auth setup beats must never render beside the
    // live app sidebar. Reuse the route-based sidebar-bypass seam rather than
    // adding a parallel gate — this covers every authed path (in-session hinge,
    // reload re-latch, replay) on every platform.
    const bypassSidebar =
        onboardingJourneyActive
        || (Platform.OS === 'web'
            && (isTerminalConnectWebPathname(pathname) || isPublicNonHomeRoute(segments)));
    const showSidebar = auth.isAuthenticated && isTablet && !isDesktopOverlayWindow && !bypassSidebar;
    const { width: windowWidth } = useWindowDimensions();
    const sidebarCollapsed = useLocalSetting('sidebarCollapsed');
    const [, setSidebarCollapsed] = useLocalSettingMutable('sidebarCollapsed');
    const sidebarWidthPx = useLocalSetting('sidebarWidthPx');
    const sidebarWidthBasisPx = useLocalSetting('sidebarWidthBasisPx');
    const [, setSidebarWidthPx] = useLocalSettingMutable('sidebarWidthPx');
    const [, setSidebarWidthBasisPx] = useLocalSettingMutable('sidebarWidthBasisPx');
    const [dragSidebarWidthPx, setDragSidebarWidthPx] = React.useState<number | null>(null);
    const collapseTriggeredDuringDragRef = React.useRef(false);
    const focusedPaneScopeId = paneState.focusMode?.scopeId ?? null;
    const focusedPaneScope = focusedPaneScopeId ? paneState.scopes[focusedPaneScopeId] : undefined;
    const focusedPaneScopeHasFocusablePane = Boolean(focusedPaneScope?.right.isOpen || focusedPaneScope?.details.isOpen);
    const routePaneScopeId = React.useMemo(() => resolvePaneFocusModeRouteScopeId(pathname), [pathname]);
    const focusedPaneScopeMatchesRoute =
        focusedPaneScopeId != null
        && focusedPaneScopeId === routePaneScopeId
        && paneState.activeScopeId === focusedPaneScopeId
        && focusedPaneScopeHasFocusablePane;
    const paneFocusModeChromeActive = showSidebar && focusedPaneScopeMatchesRoute;

    const stopScrollEventPropagationOnWeb = React.useCallback((event: { stopPropagation?: () => void }) => {
        // Expo Router (Vaul/Radix) modals on web often install document-level scroll-lock listeners
        // that `preventDefault()` wheel/touch scroll, which breaks scrolling inside nested scroll views
        // (including the permanent sidebar). Stopping propagation here keeps scroll events
        // within the sidebar subtree so native scrolling works.
        if (Platform.OS !== 'web') return;
        if (typeof event?.stopPropagation === 'function') event.stopPropagation();
    }, []);

    const sidebarMaxWidthPx = React.useMemo(() => resolveSidebarDockMaxWidthPx(windowWidth), [windowWidth]);

    const effectiveSidebarWidthPx = React.useMemo(() => {
        return resolveScaledPaneWidthPx({
            preferredWidthPx: sidebarWidthPx,
            basisContainerWidthPx: sidebarWidthBasisPx,
            containerWidthPx: windowWidth,
            minPx: SIDEBAR_DOCK_MIN_WIDTH_PX,
            maxPx: sidebarMaxWidthPx,
        });
    }, [sidebarMaxWidthPx, sidebarWidthBasisPx, sidebarWidthPx, windowWidth]);

    const effectiveSidebarCollapsed = Boolean(sidebarCollapsed || paneFocusModeChromeActive);

    React.useEffect(() => {
        if (!focusedPaneScopeId) return;
        if (focusedPaneScopeMatchesRoute) return;
        dispatchPaneAction({ type: 'exitFocusMode', scopeId: focusedPaneScopeId });
    }, [dispatchPaneAction, focusedPaneScopeId, focusedPaneScopeMatchesRoute]);

    // Hidden chrome must not reserve any horizontal space.
    const sidebarWidth = React.useMemo(() => {
        if (!showSidebar) return 0;
        if (effectiveSidebarCollapsed) return SIDEBAR_COLLAPSED_WIDTH_PX;
        return dragSidebarWidthPx ?? effectiveSidebarWidthPx;
    }, [dragSidebarWidthPx, effectiveSidebarCollapsed, effectiveSidebarWidthPx, showSidebar]);

    const handleSidebarWidthDrag = React.useCallback((nextWidthPx: number | null, dragMeta?: ResizableDockedPaneCommitMeta | null) => {
        if (nextWidthPx == null) {
            collapseTriggeredDuringDragRef.current = false;
            setDragSidebarWidthPx(null);
            return;
        }

        const shouldCollapseToCompactView =
            Platform.OS === 'web'
            && !sidebarCollapsed
            && !collapseTriggeredDuringDragRef.current
            && nextWidthPx <= SIDEBAR_DOCK_MIN_WIDTH_PX
            && dragMeta?.exceededMinPx === true;

        if (shouldCollapseToCompactView) {
            collapseTriggeredDuringDragRef.current = true;
            setDragSidebarWidthPx(null);
            setSidebarCollapsed(true);
            return;
        }

        setDragSidebarWidthPx(nextWidthPx);
    }, [setSidebarCollapsed, sidebarCollapsed]);

    const handleSidebarWidthCommit = React.useCallback((nextWidthPx: number) => {
        collapseTriggeredDuringDragRef.current = false;
        setDragSidebarWidthPx(null);
        setSidebarWidthPx(nextWidthPx);
        setSidebarWidthBasisPx(windowWidth);
    }, [setSidebarWidthBasisPx, setSidebarWidthPx, windowWidth]);

    const stackNavigationOptions = React.useMemo(() => ({
        lazy: false,
        headerShown: false,
        ...(isDesktopOverlayWindow
            ? {
                contentStyle: {
                    backgroundColor: 'transparent',
                },
            }
            : null),
    }), [isDesktopOverlayWindow]);

    const handleExitFocusMode = React.useCallback(() => {
        dispatchPaneAction({ type: 'exitFocusMode' });
    }, [dispatchPaneAction]);

    const handleRequestExpand = React.useCallback(() => {
        if (paneFocusModeChromeActive) {
            dispatchPaneAction({ type: 'exitFocusMode' });
        }
        setSidebarCollapsed(false);
    }, [dispatchPaneAction, paneFocusModeChromeActive, setSidebarCollapsed]);

    const sidebarContent = effectiveSidebarCollapsed ? (
        <CollapsedSidebarView
            focusModeActive={paneFocusModeChromeActive}
            onExitFocusMode={handleExitFocusMode}
            onRequestExpand={handleRequestExpand}
        />
    ) : (
        <ResizableDockedPane
            widthPx={sidebarWidth}
            minWidthPx={SIDEBAR_DOCK_MIN_WIDTH_PX}
            maxWidthPx={sidebarMaxWidthPx}
            resizeEdge="right"
            onDragWidthPx={handleSidebarWidthDrag}
            onCommitWidthPx={handleSidebarWidthCommit}
        >
            <View
                style={{ flex: 1, flexShrink: 0, minHeight: 0 }}
                {...(Platform.OS === 'web'
                    ? { onWheel: stopScrollEventPropagationOnWeb, onTouchMove: stopScrollEventPropagationOnWeb }
                    : {})}
            >
                <SidebarView sidebarWidthPx={sidebarWidth} />
            </View>
        </ResizableDockedPane>
    );

    // Responsive chrome changes geometry, never the route navigator or its ancestry.
    return (
        <InboxModelProvider>
        <DesktopMainContentDragSurface
            enabled={showSidebar && Platform.OS === 'web' && isDesktopHost()}
            leftOffsetPx={sidebarWidth}
            style={[styles.root, showSidebar && styles.canvas]}
        >
            {showSidebar ? (
                <View key="sidebar" testID="navigation-sidebar" style={{ width: sidebarWidth, flexShrink: 0 }}>
                    {sidebarContent}
                </View>
            ) : null}
            <View key="route-content" style={[styles.content, showSidebar && styles.contentSheet]}>
                <Stack screenOptions={stackNavigationOptions} />
            </View>
            {Platform.OS === 'web' && showSidebar ? (
                <View
                    pointerEvents="none"
                    style={[styles.contentSheetSeamShadow, { left: sidebarWidth }]}
                />
            ) : null}
        </DesktopMainContentDragSurface>
        </InboxModelProvider>
    );
});
