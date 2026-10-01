import * as React from 'react';
import { Stack, usePathname } from 'expo-router';
import { View, useWindowDimensions, Platform } from 'react-native';
import { useLocalSetting, useLocalSettingMutable } from '@/sync/domains/state/storage';
import { ResizableDockedPane, type ResizableDockedPaneCommitMeta } from '@/components/ui/panels/ResizableDockedPane';
import { resolveScaledPaneWidthPx } from '@/components/appShell/panes/layout/paneSizing';
import { StyleSheet } from 'react-native-unistyles';
import { resolveSidebarDockMaxWidthPx, SIDEBAR_DOCK_MIN_WIDTH_PX } from './sidebarSizing';
import { AppRail } from './appRail/AppRail';
import { AppShellColumn } from './appRail/AppShellColumn';
import { AppShellTitleStrip } from './appRail/AppShellTitleStrip';
import { AppShellPeekLayer, AppShellPeekProvider } from './appRail/AppShellPeek';
import { appShellColumnSurface } from './appRail/appShellColumnSurface';
import { APP_RAIL_WIDTH_PX } from './appRail/appRailMetrics';
import {
    resolveAppRailEntryColumn,
    type AppShellColumn as AppShellColumnModel,
    type AppShellShownColumn,
} from './appRail/appRailModel';
import { useAppShellLocation } from './appRail/useAppShellLocation';
import { AppShellColumnContext, type AppShellColumnState } from './appRail/appShellColumnContext';
import { isDesktopActivityOverlayWindowContext } from '@/activity/adapters/desktop/runtime/isDesktopActivityOverlayWindowContext';
import { useAppPaneContext } from '@/components/appShell/panes/AppPaneProvider';
import { resolvePaneFocusModeRouteScopeId } from '@/components/appShell/panes/focusMode/resolvePaneFocusModeRouteScopeId';
import { isDesktopHost } from '@/utils/platform/desktopHost';
import { DesktopMainContentDragSurface } from '@/components/navigation/desktopWindowChrome/DesktopMainContentDragSurface';
import { InboxSummaryProvider } from '@/hooks/inbox/useInboxSummary';
import { useOptionalWorkspaceNavigation } from '@/components/appShell/workspace/WorkspaceNavigationContext';
import { useWorkspaceShellEnabled } from '@/components/appShell/workspace/useWorkspaceShellEnabled';
import { WorkspaceShell } from '@/components/appShell/workspace/WorkspaceShell';
import { createWorkspaceBarGeometry, WorkspaceBarGeometryContext } from '@/components/appShell/workspace/titleBar/workspaceBarGeometry';
import { registerShellColumnActionOwner } from '@/sync/ops/actions/scopeActionFamily';

/**
 * The sheet that holds the column and the page lies on the window's canvas, inset from the window's
 * right and bottom edges with rounded corners, the rail and title strip around it (lab `xrail-R1`).
 */
const CONTENT_SHEET_RADIUS_PX = 12;
const CONTENT_SHEET_WINDOW_INSET_PX = 8;

const stylesheet = StyleSheet.create((theme) => ({
    root: {
        flexDirection: 'column',
        minWidth: 0,
        minHeight: 0,
        flex: 1,
        position: 'relative',
    },
    body: {
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
        flexDirection: 'row',
        marginRight: CONTENT_SHEET_WINDOW_INSET_PX,
        marginBottom: CONTENT_SHEET_WINDOW_INSET_PX,
        borderRadius: CONTENT_SHEET_RADIUS_PX,
        overflow: 'hidden',
        backgroundColor: theme.colors.surface.base,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: theme.colors.border.default,
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
        bottom: CONTENT_SHEET_WINDOW_INSET_PX,
        right: CONTENT_SHEET_WINDOW_INSET_PX,
        borderRadius: CONTENT_SHEET_RADIUS_PX,
        zIndex: 2,
        boxShadow: theme.colors.shadowSeamCastBoxShadow,
    },
}));

// Like the docked column, a peeked one keeps its wheel and touch scrolling from document scroll locks.
const stopPeekScrollPropagation = (event: { stopPropagation?: () => void }) => event.stopPropagation?.();
const PEEK_SCROLL_PROPS = Platform.OS === 'web'
    ? { onWheel: stopPeekScrollPropagation, onTouchMove: stopPeekScrollPropagation }
    : {};
const renderPeekColumn = (column: AppShellColumnModel) => (
    <View style={{ flex: 1, minHeight: 0 }} {...PEEK_SCROLL_PROPS}>
        <AppShellColumn column={column} />
    </View>
);

export const SidebarNavigator = React.memo(() => {
    const styles = stylesheet;
    const pathname = usePathname();
    const isDesktopOverlayWindow = isDesktopActivityOverlayWindowContext();
    const workspace = useOptionalWorkspaceNavigation();
    const { state: paneState, dispatch: dispatchPaneAction } = useAppPaneContext();
    // The onboarding journey host owns the whole viewport until its session ends
    // (visual spec v3 §5): the post-auth setup beats must never render beside the
    // live app sidebar. Reuse the route-based sidebar-bypass seam rather than
    // adding a parallel gate — this covers every authed path (in-session hinge,
    // reload re-latch, replay) on every platform.
    // The app shell (title strip, rail, the destination's column) stands around the routes on tablets
    // and desktops once someone is signed in (lab `xrail-R1`).
    const showSidebar = useWorkspaceShellEnabled();
    // The title strip carries the top-row panes' tabs; the panes report where they sit under it.
    const [workspaceBarGeometry] = React.useState(createWorkspaceBarGeometry);
    const { catalog, location } = useAppShellLocation();
    const column = location.column;
    const resolvePeekColumn = React.useCallback((destinationId: string): AppShellShownColumn | null => {
        const destination = catalog.find((candidate) => candidate.id === destinationId);
        return destination ? resolveAppRailEntryColumn(destination) : null;
    }, [catalog]);
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

    // The column shows when the open destination has one and the person has not hidden it; the rail
    // stays either way. Hidden chrome reserves no horizontal space.
    const columnShown = showSidebar && !effectiveSidebarCollapsed && column.kind !== 'none';
    const sidebarWidth = React.useMemo(() => {
        if (!columnShown) return 0;
        return dragSidebarWidthPx ?? effectiveSidebarWidthPx;
    }, [columnShown, dragSidebarWidthPx, effectiveSidebarWidthPx]);
    const shellLeftPx = showSidebar ? APP_RAIL_WIDTH_PX + sidebarWidth : 0;
    const appShellState = React.useMemo<AppShellColumnState>(
        () => ({ present: showSidebar, columnVisible: columnShown }),
        [columnShown, showSidebar],
    );

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

    const handleSetColumnVisible = React.useCallback((visible: boolean) => {
        if (visible && paneFocusModeChromeActive) dispatchPaneAction({ type: 'exitFocusMode' });
        setSidebarCollapsed(!visible);
    }, [dispatchPaneAction, paneFocusModeChromeActive, setSidebarCollapsed]);
    const handleToggleColumn = React.useCallback(() => handleSetColumnVisible(effectiveSidebarCollapsed),
        [effectiveSidebarCollapsed, handleSetColumnVisible]);
    const columnActionRef = React.useRef({ present: showSidebar, visible: columnShown,
        available: column.kind !== 'none', setVisible: handleSetColumnVisible });
    React.useLayoutEffect(() => {
        columnActionRef.current = { present: showSidebar, visible: columnShown,
            available: column.kind !== 'none', setVisible: handleSetColumnVisible };
    });
    React.useEffect(() => registerShellColumnActionOwner(() => columnActionRef.current), []);

    const columnContent = (
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
                <AppShellColumn column={column} />
            </View>
        </ResizableDockedPane>
    );

    // Responsive chrome changes geometry, never the route navigator or its ancestry.
    return (
        <AppShellColumnContext.Provider value={appShellState}>
        <WorkspaceBarGeometryContext.Provider value={showSidebar ? workspaceBarGeometry : null}>
        <AppShellPeekProvider enabled={showSidebar} currentId={column.kind === 'none' ? null : location.railEntryId} columnShown={columnShown}>
        <InboxSummaryProvider>
        <DesktopMainContentDragSurface
            enabled={showSidebar && Platform.OS === 'web' && isDesktopHost()}
            leftOffsetPx={shellLeftPx}
            style={[styles.root, showSidebar && styles.canvas]}
        >
            {showSidebar ? (
                <AppShellTitleStrip
                    key="title-strip"
                    columnVisible={columnShown}
                    columnToggleAvailable={column.kind !== 'none'}
                    onToggleColumn={handleToggleColumn}
                    navigation={workspace?.active ? workspace : undefined}
                    workspaceCatalog={workspace?.active ? catalog : undefined}
                />
            ) : null}
            <View key="shell-body" style={styles.body}>
                {showSidebar ? <AppRail key="rail" /> : null}
                {/* The sheet holds the destination's column and the page (lab `xrail-R1`); the rail and
                    title strip sit on the window's canvas around it. */}
                <View key="sheet" style={[styles.content, showSidebar && styles.contentSheet]}>
                    {columnShown ? (
                        <View key="column" testID="navigation-sidebar" style={[appShellColumnSurface.column, { width: sidebarWidth }]}>
                            {columnContent}
                        </View>
                    ) : null}
                    <View key="route-content" style={styles.content}>
                        <View style={[styles.content, workspace?.active && { display: 'none' }]}>
                            <Stack screenOptions={stackNavigationOptions} />
                        </View>
                        {workspace?.active ? <WorkspaceShell catalog={catalog} /> : null}
                    </View>
                    {/* A destination's column peeked from the rail, in the column's own place and width. */}
                    {showSidebar ? (
                        <AppShellPeekLayer
                            key="column-peek"
                            widthPx={columnShown ? sidebarWidth : effectiveSidebarWidthPx}
                            resolveColumn={resolvePeekColumn}
                            renderColumn={renderPeekColumn}
                        />
                    ) : null}
                </View>
                {Platform.OS === 'web' && showSidebar ? (
                    <View
                        pointerEvents="none"
                        style={[styles.contentSheetSeamShadow, { left: APP_RAIL_WIDTH_PX }]}
                    />
                ) : null}
            </View>
        </DesktopMainContentDragSurface>
        </InboxSummaryProvider>
        </AppShellPeekProvider>
        </WorkspaceBarGeometryContext.Provider>
        </AppShellColumnContext.Provider>
    );
});
