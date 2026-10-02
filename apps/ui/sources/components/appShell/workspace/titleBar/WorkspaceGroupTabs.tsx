import * as React from 'react';
import { Platform, View, type LayoutChangeEvent } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

import { hrefForDestinationRef, resolveCurrentAppDestination, useDestinationInstanceTitles, type CompactAppDestination } from '@/components/appShell/destinations/compactAppDestinationCatalog';
import { DETAILS_TAB_STRIP_METRICS as M } from '@/components/appShell/panes/details/header/detailsTabHeaderMetrics';
import type { SplitCanvasDirection } from '@/components/appShell/splitCanvas/model/splitCanvasTypes';
import { IconButton } from '@/components/ui/buttons/IconButton';
import { DropdownMenu, type DropdownMenuItem } from '@/components/ui/forms/dropdown/DropdownMenu';
import { Icon, type IconName } from '@/components/ui/icons/Icon';
import { resolveTouchTargetFloorPx } from '@/components/ui/interactiveTargetSize';
import { DocumentTabStrip, DOCUMENT_TAB_BAR_METRICS as B, type DocumentTabItem } from '@/components/ui/navigation/DocumentTabStrip';
import type { PopoverAnchor } from '@/components/ui/popover';
import { resolvePointerMenuAnchor } from '@/components/ui/popover/resolvePointerMenuAnchor';
import { Text } from '@/components/ui/text/Text';
import { Typography } from '@/constants/Typography';
import { KeyboardShortcutLabelsContext } from '@/keyboard/shortcutLabels';
import { randomUUID } from '@/platform/randomUUID';
import { t } from '@/text';
import { toTestIdSafeValue } from '@/utils/ui/toTestIdSafeValue';
import type { WorkspaceNavigationContextValue } from '../WorkspaceNavigationContext';
import { createWorkspaceEmptyTab, type WorkspaceGroup } from '../workspaceState';
import { createWorkspaceSplit } from '../workspaceSplit';
import { decodeWorkspaceDragData, encodeWorkspaceDragData, resolveWorkspaceTabStripDrop, setWorkspaceTabDragActive } from '../workspaceDragData';
import { WebDropTargetView } from '@/components/workspaces/files/repositoryTree/WebDropTargetView';
import { useDestinationInstanceTabPresentations } from './useDestinationInstanceTabPresentations';

type WorkspaceDocumentTab = DocumentTabItem & Readonly<{ icon: IconName }>;
type MenuState = Readonly<{ tabId: string; anchor: PopoverAnchor | undefined }>;

/** Room the "+" (new tab) and the "+N" overflow keep beside the tabs, so tabs never push them out. */
const ACTION_SLOT_PX = 30;
const OVERFLOW_SLOT_PX = 44;
const PIN_SEPARATOR_PX = 11;

/**
 * Which unpinned tabs fit at their minimum width (workspace lab V). The open tab always stays, then
 * the most recently used; the rest wait behind "+N". Strip order is kept among the tabs that show.
 */
export function selectVisibleWorkspaceTabs(input: Readonly<{
    tabIds: readonly string[];
    activeTabId: string;
    mru: readonly string[];
    capacity: number;
}>): readonly string[] {
    if (input.tabIds.length <= input.capacity) return input.tabIds;
    const keep = new Set<string>();
    if (input.tabIds.includes(input.activeTabId)) keep.add(input.activeTabId);
    for (const id of input.mru) {
        if (keep.size >= Math.max(1, input.capacity)) break;
        if (input.tabIds.includes(id)) keep.add(id);
    }
    for (const id of input.tabIds) {
        if (keep.size >= Math.max(1, input.capacity)) break;
        keep.add(id);
    }
    return input.tabIds.filter((id) => keep.has(id));
}

/**
 * One pane's tabs, wherever the pane's tabs live: in the window's top strip over a top-row pane
 * (`bar`), or in the pane's own strip below the top row (`strip`). Both are the same tabs, menu and
 * overflow; only the height and the surface they sit on differ (workspace lab T/S).
 */
export function WorkspaceGroupTabs(props: Readonly<{
    workspace: WorkspaceNavigationContextValue;
    group: WorkspaceGroup;
    catalog: readonly CompactAppDestination[];
    focused: boolean;
    placement: 'bar' | 'strip';
    /** Room reserved at the trailing end for a control the caller adds (the bar's split button). */
    trailing?: React.ReactNode;
}>) {
    const styles = stylesheet;
    const { theme } = useUnistyles();
    const { workspace, group } = props;
    const safeGroup = toTestIdSafeValue(group.id);
    const shortcutLabels = React.useContext(KeyboardShortcutLabelsContext);
    const [widthPx, setWidthPx] = React.useState<number | null>(null);
    const [menu, setMenu] = React.useState<MenuState | null>(null);
    const [overflowOpen, setOverflowOpen] = React.useState(false);
    const tabHeightPx = props.placement === 'bar' ? B.tabHeightPx : M.tabHeightPx;

    const titleEntries = React.useMemo(() => group.tabIds.flatMap((id) => {
        const tab = workspace.state.tabs[id];
        return tab ? [{ key: id, ref: tab.target }] : [];
    }), [group.tabIds, workspace.state.tabs]);
    // The live instance title (a session's name, a file, a page); the title saved with the layout
    // stands in only while the instance cannot be named yet.
    const titleResolutionEntries = React.useMemo(() => overflowOpen
        ? [...titleEntries, ...workspace.state.recentlyClosed.map(entry => ({ key: `closed:${entry.tab.id}`, ref: entry.tab.target }))]
        : titleEntries, [overflowOpen, titleEntries, workspace.state.recentlyClosed]);
    const liveTitles = useDestinationInstanceTitles(props.catalog, titleResolutionEntries);
    const hasRecentlyClosed = workspace.state.recentlyClosed.length > 0;
    const tabs = React.useMemo(() => {
        const byId = new Map<string, WorkspaceDocumentTab>();
        for (const id of group.tabIds) {
            const tab = workspace.state.tabs[id];
            if (!tab) continue;
            const href = hrefForDestinationRef(props.catalog, tab.target);
            const destination = href ? resolveCurrentAppDestination(props.catalog, href) : null;
            byId.set(id, {
                key: tab.id,
                title: liveTitles.get(id) ?? workspace.state.fallbackTitlesByTabId[tab.id] ?? t('common.unavailable'),
                isPinned: tab.pinned, isPreview: tab.preview, canPin: !tab.pinned,
                icon: destination?.icon ?? 'file',
            });
        }
        return byId;
    }, [group.tabIds, liveTitles, props.catalog, workspace.state.fallbackTitlesByTabId, workspace.state.tabs]);

    const pinnedIds = group.tabIds.filter((id) => tabs.get(id)?.isPinned);
    const unpinnedIds = group.tabIds.filter((id) => tabs.has(id) && !tabs.get(id)?.isPinned);
    const capacity = React.useMemo(() => {
        if (widthPx === null) return unpinnedIds.length;
        const pinnedPx = pinnedIds.length * (tabHeightPx + B.stripGapPx) + (pinnedIds.length > 0 ? PIN_SEPARATOR_PX : 0);
        const room = widthPx - pinnedPx - ACTION_SLOT_PX - (hasRecentlyClosed ? OVERFLOW_SLOT_PX : 0);
        if (room >= unpinnedIds.length * (B.tabMinWidthPx + B.stripGapPx)) return unpinnedIds.length;
        return Math.max(1, Math.floor((room - (hasRecentlyClosed ? 0 : OVERFLOW_SLOT_PX)) / (B.tabMinWidthPx + B.stripGapPx)));
    }, [hasRecentlyClosed, pinnedIds.length, tabHeightPx, unpinnedIds.length, widthPx]);
    const visibleUnpinned = selectVisibleWorkspaceTabs({ tabIds: unpinnedIds, activeTabId: group.activeTabId, mru: group.mru, capacity });
    const hiddenCount = unpinnedIds.length - visibleUnpinned.length;
    const pinnedTabs = pinnedIds.flatMap((id) => tabs.get(id) ?? []);
    const visibleTabs = visibleUnpinned.flatMap((id) => tabs.get(id) ?? []);
    // Hidden tabs have no status mark; keep their live work updates out of the mounted strip.
    const visibleTabKeys = new Set([...pinnedIds, ...visibleUnpinned]);
    const livePresentations = useDestinationInstanceTabPresentations(titleEntries.filter(entry => visibleTabKeys.has(entry.key)));

    const onLayout = React.useCallback((event: LayoutChangeEvent) => {
        const next = Math.round(event.nativeEvent.layout.width);
        setWidthPx((current) => (current === next ? current : next));
    }, []);

    const split = React.useCallback((tabId: string, direction: SplitCanvasDirection) => {
        const measurement = workspace.canvasControlsRef?.current?.readSplitMeasurement(group.id, direction);
        if (!measurement) return;
        const action = createWorkspaceSplit(workspace.state, {
            groupId: group.id, tabId, direction, createId: randomUUID, ...measurement,
        });
        if (action) workspace.dispatch(action);
    }, [group.id, workspace]);

    const menuTab = menu ? workspace.state.tabs[menu.tabId] : undefined;
    const menuItems = React.useMemo((): readonly DropdownMenuItem[] => {
        if (!menuTab) return [];
        const glyph = (name: IconName) => <Icon name={name} size={16} color={theme.colors.text.secondary} />;
        const index = group.tabIds.indexOf(menuTab.id);
        const hasOthers = group.tabIds.some((id) => id !== menuTab.id && !workspace.state.tabs[id]?.pinned);
        const hasRight = group.tabIds.slice(index + 1).some((id) => !workspace.state.tabs[id]?.pinned);
        const multiplePanes = Object.keys(workspace.state.groups).length > 1;
        const maximized = workspace.state.maximizedGroupId === group.id;
        return [
            menuTab.pinned
                ? { id: 'unpin', testID: 'workspace-tab-menu-unpin', title: t('workspaceBar.unpinTab'), icon: glyph('push-pin-slash') }
                : { id: 'pin', testID: 'workspace-tab-menu-pin', title: t('workspaceBar.pinTab'), icon: glyph('push-pin') },
            { id: 'splitRight', testID: 'workspace-tab-menu-split-right', title: t('workspaceBar.splitRight'), icon: glyph('square-split-horizontal'), shortcut: shortcutLabels['workspace.splitRight'] },
            { id: 'splitDown', testID: 'workspace-tab-menu-split-down', title: t('workspaceBar.splitDown'), icon: glyph('square-split-vertical'), shortcut: shortcutLabels['workspace.splitDown'] },
            ...(multiplePanes ? [{
                id: 'maximize', testID: 'workspace-tab-menu-maximize',
                title: maximized ? t('workspaceBar.restorePane') : t('workspaceBar.maximizePane'),
                icon: glyph('arrows-out'), shortcut: shortcutLabels['workspace.toggleMaximize'],
            }] : []),
            { id: 'close', testID: 'workspace-tab-menu-close', title: t('workspaceBar.closeTab'), icon: glyph('x') },
            ...(hasRecentlyClosed ? [{ id: 'reopen', testID: 'workspace-tab-menu-reopen', title: t('workspaceTabs.reopenTab'), shortcut: shortcutLabels['workspace.tab.reopen'], icon: glyph('arrow-counter-clockwise') }] : []),
            ...(hasOthers ? [{ id: 'closeOthers', testID: 'workspace-tab-menu-close-others', title: t('workspaceBar.closeOtherTabs') }] : []),
            ...(hasRight ? [{ id: 'closeRight', testID: 'workspace-tab-menu-close-right', title: t('workspaceBar.closeTabsToRight') }] : []),
        ];
    }, [group.id, group.tabIds, hasRecentlyClosed, menuTab, shortcutLabels, theme.colors.text.secondary, workspace.state.groups,
        workspace.state.maximizedGroupId, workspace.state.tabs]);

    const selectMenu = React.useCallback((itemId: string) => {
        const tabId = menu?.tabId;
        setMenu(null);
        if (!tabId) return;
        switch (itemId) {
            case 'pin': workspace.dispatch({ type: 'setPinned', tabId, pinned: true }); break;
            case 'unpin': workspace.dispatch({ type: 'setPinned', tabId, pinned: false }); break;
            case 'splitRight': split(tabId, 'right'); break;
            case 'splitDown': split(tabId, 'down'); break;
            case 'maximize': workspace.dispatch({ type: 'toggleMaximize', groupId: group.id }); break;
            case 'close': workspace.closeTab(group.id, tabId); break;
            case 'reopen': workspace.dispatch({ type: 'reopenTab' }); break;
            case 'closeOthers':
                for (const id of group.tabIds) if (id !== tabId && !workspace.state.tabs[id]?.pinned) workspace.closeTab(group.id, id);
                break;
            case 'closeRight': {
                const index = group.tabIds.indexOf(tabId);
                for (const id of group.tabIds.slice(index + 1)) if (!workspace.state.tabs[id]?.pinned) workspace.closeTab(group.id, id);
                break;
            }
        }
    }, [group.id, group.tabIds, menu?.tabId, split, workspace]);

    const overflowItems = React.useMemo((): readonly DropdownMenuItem[] => [...group.tabIds.flatMap((id) => {
        const tab = tabs.get(id);
        return tab ? [{
            id, testID: `workspace-overflow-tab-${toTestIdSafeValue(id)}`, title: tab.title,
            icon: <Icon name={tab.icon} size={16} color={theme.colors.text.secondary} />,
            checked: id === group.activeTabId,
            ...(hasRecentlyClosed ? { category: t('workspaceBar.tabsLabel') } : {}),
        }] : [];
    }), ...workspace.state.recentlyClosed.map((entry, index) => ({
        id: `closed:${entry.tab.id}`, testID: `workspace-reopen-tab-${toTestIdSafeValue(entry.tab.id)}`,
        title: liveTitles.get(`closed:${entry.tab.id}`) ?? entry.fallbackTitle ?? t('common.unavailable'),
        category: t('workspaceTabs.recentlyClosed'),
        icon: <Icon name="arrow-counter-clockwise" size={16} color={theme.colors.text.secondary} />,
        ...(index === 0 ? { shortcut: shortcutLabels['workspace.tab.reopen'] } : {}),
    }))], [group.activeTabId, group.tabIds, hasRecentlyClosed, liveTitles, shortcutLabels, tabs, theme.colors.text.secondary, workspace.state.recentlyClosed]);

    // A tab dropped on a tab lands before it; on the strip's free space, at the end. A destination
    // dragged from a row opens here as a kept tab (workspace lab O/D).
    const drop = React.useCallback((payload: string, beforeTabId: string | null) => {
        setWorkspaceTabDragActive(false);
        const data = decodeWorkspaceDragData(payload);
        if (!data) return;
        if (data.kind === 'href') {
            workspace.openHref(data.href, { mode: 'newTab', groupId: group.id });
            return;
        }
        for (const action of resolveWorkspaceTabStripDrop(workspace.state, { tabId: data.tabId, groupId: group.id, beforeTabId })) {
            workspace.dispatch(action);
        }
    }, [group.id, workspace]);
    const stripDropProps = React.useMemo(() => ({
        onDragOver: (event: { preventDefault?: () => void }) => event.preventDefault?.(),
        onDrop: (event: { preventDefault?: () => void; dataTransfer?: { getData?: (type: string) => string } | null }) => {
            const payload = event.dataTransfer?.getData?.('text/plain') ?? '';
            if (!decodeWorkspaceDragData(payload)) return;
            event.preventDefault?.();
            drop(payload, null);
        },
    }), [drop]);

    const touchFloor = resolveTouchTargetFloorPx(Platform.OS);
    const actionSize = Math.max(props.placement === 'bar' ? 28 : M.actionSizePx, touchFloor ?? 0);
    const renderStrip = (items: readonly WorkspaceDocumentTab[]) => (
        <DocumentTabStrip
            variant="bar"
            barTabHeightPx={tabHeightPx}
            activeEmphasis={props.focused ? 'raised' : 'quiet'}
            tabs={items}
            activeTabKey={group.activeTabId}
            resolveTabPresentation={(tab) => livePresentations.get(tab.key)}
            accessibilityLabel={t('workspaceBar.tabsLabel')}
            onActivate={(tabId) => workspace.activateTab(group.id, tabId)}
            onPin={(tabId) => workspace.dispatch({ type: 'setPinned', tabId, pinned: true })}
            onUnpin={(tabId) => workspace.dispatch({ type: 'setPinned', tabId, pinned: false })}
            onClose={(tabId) => workspace.closeTab(group.id, tabId)}
            onTabMenu={(tabId, event) => setMenu({ tabId, anchor: resolvePointerMenuAnchor(event) })}
            tabDragPayload={(tabId) => {
                setWorkspaceTabDragActive(true);
                return encodeWorkspaceDragData({ kind: 'tab', tabId });
            }}
            onTabDragEnd={() => setWorkspaceTabDragActive(false)}
            onTabDrop={(beforeTabId, payload) => drop(payload, beforeTabId)}
            renderLeadingIcon={(tab, emphasized) => <Icon name={tab.icon} size={M.tabGlyphPx}
                color={emphasized ? theme.colors.text.primary : theme.colors.text.secondary} />}
            tabNativeId={(key) => `workspace-${safeGroup}-tab-${toTestIdSafeValue(key)}`}
            panelNativeId={(key) => `workspace-${safeGroup}-panel-${toTestIdSafeValue(key)}`}
            testIds={{ tab: (key) => `workspace-tab-${key}`, tabClose: (key) => `workspace-tab-close-${key}` }}
        />
    );

    return (
        <WebDropTargetView testID={`workspace-tabs-${safeGroup}`} style={styles.row} onLayout={onLayout} {...stripDropProps}>
            <View style={styles.tabs}>
                {renderStrip([...pinnedTabs, ...visibleTabs])}
            </View>
            {hiddenCount > 0 || hasRecentlyClosed ? (
                <DropdownMenu
                    open={overflowOpen}
                    onOpenChange={setOverflowOpen}
                    items={overflowItems}
                    onSelect={(tabId) => {
                        const closed = workspace.state.recentlyClosed.find(entry => `closed:${entry.tab.id}` === tabId);
                        if (closed) workspace.dispatch({ type: 'reopenTab', tabId: closed.tab.id });
                        else workspace.activateTab(group.id, tabId);
                    }}
                    search
                    searchPlaceholder={t('workspaceBar.searchTabs')}
                    matchTriggerWidth={false}
                    maxWidthCap={300}
                    placement="bottom"
                    popoverAnchorAlign="start"
                    trigger={({ toggle }) => (
                        <IconButton
                            testID={`workspace-overflow-${safeGroup}`}
                            variant="plain"
                            size={actionSize}
                            accessibilityLabel={hiddenCount > 0 ? t('workspaceBar.moreTabs', { count: hiddenCount }) : t('workspaceTabs.recentlyClosed')}
                            tooltip={hiddenCount > 0 ? t('workspaceBar.moreTabs', { count: hiddenCount }) : t('workspaceTabs.recentlyClosed')}
                            tooltipPlacement="bottom"
                            hasPopup="menu"
                            expanded={overflowOpen}
                            onPress={toggle}
                            icon={hiddenCount > 0 ? <Text style={styles.overflowCount}>{`+${hiddenCount}`}</Text> : <Icon name="dots-three" size={M.actionGlyphPx} color={theme.colors.text.secondary} />}
                        />
                    )}
                />
            ) : null}
            <IconButton
                testID={`workspace-new-tab-${safeGroup}`}
                variant="plain"
                size={actionSize}
                iconSize={M.actionGlyphPx}
                iconName="plus"
                accessibilityLabel={t('workspaceBar.newTab')}
                tooltip={t('workspaceBar.newTab')}
                tooltipPlacement="bottom"
                onPress={() => workspace.dispatch({ type: 'openTab', groupId: group.id, tab: createWorkspaceEmptyTab(randomUUID()) })}
            />
            <View style={styles.grow} />
            {props.trailing}
            {menu ? (
                <DropdownMenu
                    open
                    onOpenChange={(open) => { if (!open) setMenu(null); }}
                    items={menuItems}
                    onSelect={selectMenu}
                    search={false}
                    trigger={null}
                    popoverAnchor={menu.anchor}
                    matchTriggerWidth={false}
                    maxWidthCap={260}
                    placement="bottom"
                    popoverAnchorAlign="start"
                    allowEmptySelection
                />
            ) : null}
        </WebDropTargetView>
    );
}

const stylesheet = StyleSheet.create((theme) => ({
    row: {
        flex: 1,
        minWidth: 0,
        flexDirection: 'row',
        alignItems: 'center',
        gap: B.stripGapPx,
    },
    tabs: {
        flexShrink: 1,
        minWidth: 0,
        flexDirection: 'row',
    },
    grow: {
        flex: 1,
        minWidth: 8,
    },
    overflowCount: {
        ...M.tabLabel,
        ...Typography.default('semiBold'),
        color: theme.colors.text.secondary,
        fontVariant: ['tabular-nums'],
    },
}));
