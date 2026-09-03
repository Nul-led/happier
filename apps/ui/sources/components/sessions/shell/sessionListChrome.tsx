import React from 'react';
import { View, Pressable, Platform, Image as ReactNativeImage, type StyleProp, type ViewProps, type ViewStyle } from 'react-native';
import { useFeatureEnabled } from '@/hooks/server/useFeatureEnabled';
import { useLocalSettingMutable, useSettingMutable } from '@/sync/domains/state/storage';
import { useUnistyles } from 'react-native-unistyles';
import { RecoveryKeyReminderBanner } from '@/components/account/RecoveryKeyReminderBanner';
import { UpdateBanner } from '@/components/ui/feedback/UpdateBanner';
import { DropdownMenu, type DropdownMenuItem } from '@/components/ui/forms/dropdown/DropdownMenu';
import { Text } from '@/components/ui/text/Text';
import { Eyebrow } from '@/components/ui/text/Eyebrow';
import { TabBadge } from '@/components/ui/navigation/tabBadge/TabBadge';
import { t } from '@/text';
import type { SessionListIndexItem } from '@/sync/domains/sessionList/sessionListIndex';
import {
    resolveDurableWorkspaceRefForSessionListHeader,
    type SessionFolderV1,
    type SessionFolderWorkspaceRefV1,
} from '@/sync/domains/session/folders';

import { sessionListStyles } from './sessionListStyles';
import { resolveProjectGroupHeaderMenuItems } from './resolveProjectGroupHeaderMenuItems';
import { resolveSessionsListHeaderMenuItems } from './resolveSessionsListHeaderMenuItems';
import type { RegisterSessionFolderDropTarget } from './useSessionListViewState';
import { useWorkspaceFavicon } from './useWorkspaceFavicon';
import { resolveWorkspaceRootTreeRowId } from './drop-resolution/treeRowId';
import { Icon } from '@/components/ui/icons/Icon';
import { resolveMinimumInteractiveTargetSize } from '@/components/ui/interactiveTargetSize';

const ORDERING_MENU_IDS = {
    custom: 'custom',
    created: 'created',
    updated: 'updated',
    activeGroupingProject: 'activeGroupingProject',
    activeGroupingDate: 'activeGroupingDate',
    inactiveGroupingProject: 'inactiveGroupingProject',
    inactiveGroupingDate: 'inactiveGroupingDate',
    sectionModeActivity: 'sectionModeActivity',
    sectionModeSingle: 'sectionModeSingle',
    hideInactiveSessions: 'hideInactiveSessions',
    sessionFolderViewModeTree: 'sessionFolderViewModeTree',
    sessionListFolderSortModeFoldersFirst: 'sessionListFolderSortModeFoldersFirst',
    sessionListFolderSortModeMixed: 'sessionListFolderSortModeMixed',
    sessionListStorageFilterAll: 'sessionListStorageFilterAll',
    sessionListStorageFilterPersisted: 'sessionListStorageFilterPersisted',
    sessionListStorageFilterDirect: 'sessionListStorageFilterDirect',
} as const;
const HEADER_ACTION_TARGET_SIZE = resolveMinimumInteractiveTargetSize(Platform.OS);
const HEADER_ACTION_TARGET_STYLE = {
    minWidth: HEADER_ACTION_TARGET_SIZE,
    minHeight: HEADER_ACTION_TARGET_SIZE,
};


export function stopPressEventPropagation(event: unknown): void {
    if (!event || typeof event !== 'object' || !('stopPropagation' in event)) {
        return;
    }
    const stopPropagation = (event as { stopPropagation?: () => void }).stopPropagation;
    if (typeof stopPropagation === 'function') {
        (event as { stopPropagation: () => void }).stopPropagation();
    }
}


type MeasuredSessionFolderDropTarget = Readonly<
    | {
        type: 'folder';
        folderId: string;
        workspace: SessionFolderWorkspaceRefV1;
        serverId: string | null;
    }
    | {
        type: 'workspace-root';
        workspace: SessionFolderWorkspaceRefV1;
        serverId: string | null;
    }
>;

function useMeasuredDropTargetRegistration(params: Readonly<{
    id: string | null;
    target: MeasuredSessionFolderDropTarget | null;
    onRegister?: RegisterSessionFolderDropTarget;
}>) {
    const ref = React.useRef<View>(null);
    const cleanupRef = React.useRef<(() => void) | null>(null);
    const clearRegistration = React.useCallback(() => {
        cleanupRef.current?.();
        cleanupRef.current = null;
    }, []);
    React.useEffect(() => clearRegistration, [clearRegistration]);
    const onLayout = React.useCallback((event?: { nativeEvent?: { layout?: { x: number; y: number; width: number; height: number } } }) => {
        clearRegistration();
        if (!params.id || !params.target || !params.onRegister) return;
        const node = ref.current as unknown as {
            measureInWindow?: (callback: (x: number, y: number, width: number, height: number) => void) => void;
        } | null;
        const targetId = params.id;
        const target = params.target;
        const register = (x: number, y: number, width: number, height: number) => {
            if (!targetId || !target) return;
            cleanupRef.current = params.onRegister?.(target.type === 'folder' ? {
                type: 'folder',
                folderId: target.folderId,
                workspace: target.workspace,
                serverId: target.serverId,
                id: targetId,
                bounds: { x, y, width, height },
            } : {
                type: 'workspace-root',
                workspace: target.workspace,
                serverId: target.serverId,
                id: targetId,
                bounds: { x, y, width, height },
            }) ?? null;
        };
        if (typeof node?.measureInWindow === 'function') {
            node.measureInWindow(register);
            return;
        }
        const fallback = event?.nativeEvent?.layout;
        if (fallback) {
            register(fallback.x, fallback.y, fallback.width, fallback.height);
        }
    }, [clearRegistration, params.id, params.onRegister, params.target]);
    return { ref, onLayout };
}

export const SessionListOrderingMenuButton = React.memo(function SessionListOrderingMenuButton(props: Readonly<{
    placement?: 'top' | 'bottom' | 'left' | 'right';
    onMenuOpenChange?: (open: boolean) => void;
}>) {
    const styles = sessionListStyles;
    const { theme } = useUnistyles();
    const [orderingMode, setOrderingMode] = useSettingMutable('sessionListOrderingModeV1');
    const [sessionListSectionModeV1, setSessionListSectionModeV1] = useSettingMutable('sessionListSectionModeV1');
    const [sessionListActiveGroupingV1, setSessionListActiveGroupingV1] = useSettingMutable('sessionListActiveGroupingV1');
    const [sessionListInactiveGroupingV1, setSessionListInactiveGroupingV1] = useSettingMutable('sessionListInactiveGroupingV1');
    const [hideInactiveSessions, setHideInactiveSessions] = useSettingMutable('hideInactiveSessions');
    const [sessionFolderViewModeV1, setSessionFolderViewModeV1] = useSettingMutable('sessionFolderViewModeV1');
    const [sessionListFolderSortModeV1, setSessionListFolderSortModeV1] = useSettingMutable('sessionListFolderSortModeV1');
    const [sessionsListStorageFilter, setSessionsListStorageFilter] = useLocalSettingMutable('sessionsListStorageFilter');
    const sessionFoldersFeatureEnabled = useFeatureEnabled('sessions.folders');
    const externalSessionsEnabled = useFeatureEnabled('sessions.direct');
    const [menuOpen, setMenuOpen] = React.useState(false);
    const actionIconColor = theme.colors.text.secondary;
    const sectionMode = sessionListSectionModeV1 === 'single' ? 'single' : 'activity';
    const activeGrouping = sessionListActiveGroupingV1 === 'date' ? 'date' : 'project';
    const inactiveGrouping = sessionListInactiveGroupingV1 === 'date' ? 'date' : 'project';
    const isHideInactiveSessionsEnabled = hideInactiveSessions === true;
    const hasActiveStorageFilter = externalSessionsEnabled && sessionsListStorageFilter !== 'all';

    const menuItems = resolveSessionsListHeaderMenuItems({
        orderingMode,
        sectionMode,
        activeGrouping,
        inactiveGrouping,
        isHideInactiveSessionsEnabled,
        showFolderViewMode: sessionFoldersFeatureEnabled,
        folderViewMode: sessionFolderViewModeV1 === 'tree' ? 'tree' : 'off',
        folderSortMode: sessionListFolderSortModeV1 === 'mixed' ? 'mixed' : 'foldersFirst',
        showStorageFilter: externalSessionsEnabled,
        storageFilter: sessionsListStorageFilter,
        actionIconColor,
    });

    const handleMenuSelect = React.useCallback((itemId: string) => {
        if (itemId === ORDERING_MENU_IDS.custom
            || itemId === ORDERING_MENU_IDS.created
            || itemId === ORDERING_MENU_IDS.updated
        ) {
            setOrderingMode(itemId);
            setMenuOpen(false);
            return;
        }
        if (itemId === ORDERING_MENU_IDS.activeGroupingProject) {
            setSessionListActiveGroupingV1('project');
            return;
        }
        if (itemId === ORDERING_MENU_IDS.activeGroupingDate) {
            setSessionListActiveGroupingV1('date');
            return;
        }
        if (itemId === ORDERING_MENU_IDS.inactiveGroupingProject) {
            setSessionListInactiveGroupingV1('project');
            return;
        }
        if (itemId === ORDERING_MENU_IDS.inactiveGroupingDate) {
            setSessionListInactiveGroupingV1('date');
            return;
        }
        if (itemId === ORDERING_MENU_IDS.sectionModeActivity) {
            setSessionListSectionModeV1('activity');
            return;
        }
        if (itemId === ORDERING_MENU_IDS.sectionModeSingle) {
            setSessionListSectionModeV1('single');
            return;
        }
        if (itemId === ORDERING_MENU_IDS.hideInactiveSessions) {
            setHideInactiveSessions(!isHideInactiveSessionsEnabled);
        }
        if (externalSessionsEnabled && itemId === ORDERING_MENU_IDS.sessionListStorageFilterAll) {
            setSessionsListStorageFilter('all');
        }
        if (externalSessionsEnabled && itemId === ORDERING_MENU_IDS.sessionListStorageFilterPersisted) {
            setSessionsListStorageFilter('persisted');
        }
        if (externalSessionsEnabled && itemId === ORDERING_MENU_IDS.sessionListStorageFilterDirect) {
            setSessionsListStorageFilter('direct');
        }
        if (sessionFoldersFeatureEnabled && itemId === ORDERING_MENU_IDS.sessionFolderViewModeTree) {
            setSessionFolderViewModeV1(sessionFolderViewModeV1 === 'tree' ? 'off' : 'tree');
        }
        if (sessionFoldersFeatureEnabled && itemId === ORDERING_MENU_IDS.sessionListFolderSortModeFoldersFirst) {
            setSessionListFolderSortModeV1('foldersFirst');
        }
        if (
            sessionFoldersFeatureEnabled
            && itemId === ORDERING_MENU_IDS.sessionListFolderSortModeMixed
            && orderingMode === 'custom'
        ) {
            setSessionListFolderSortModeV1('mixed');
        }
        setMenuOpen(false);
    }, [
        isHideInactiveSessionsEnabled,
        setHideInactiveSessions,
        setOrderingMode,
        setSessionListActiveGroupingV1,
        setSessionListInactiveGroupingV1,
        setSessionListSectionModeV1,
        sessionFoldersFeatureEnabled,
        sessionFolderViewModeV1,
        setSessionFolderViewModeV1,
        setSessionListFolderSortModeV1,
        orderingMode,
        externalSessionsEnabled,
        setSessionsListStorageFilter,
    ]);

    return (
        <DropdownMenu
            open={menuOpen}
            onOpenChange={(open) => {
                setMenuOpen(open);
                props.onMenuOpenChange?.(open);
            }}
            items={menuItems}
            onSelect={handleMenuSelect}
            selectedId={orderingMode}
            variant="slim"
            search={false}
            showCategoryTitles={true}
            matchTriggerWidth={false}
            maxWidthCap={220}
            popoverPortalWebTarget="body"
            placement={props.placement ?? 'bottom'}
            popoverAnchorAlign="end"
            trigger={({ toggle }) => (
                <Pressable
                    testID="session-list-ordering-menu-trigger"
                    style={[styles.headerActionButton, HEADER_ACTION_TARGET_STYLE]}
                    onPress={(event) => {
                        stopPressEventPropagation(event);
                        toggle();
                    }}
                    accessibilityRole="button"
                    accessibilityLabel={t('settingsSession.sessionList.orderingTitle')}
                    accessibilityState={{ selected: hasActiveStorageFilter }}
                >
                    <View>
                        <Icon name="funnel-simple" size={16} color={actionIconColor} />
                        {hasActiveStorageFilter ? (
                            <TabBadge
                                variant="dot"
                                testID="session-list-active-filter-indicator"
                                style={styles.headerActiveFilterBadge}
                            />
                        ) : null}
                    </View>
                </Pressable>
            )}
        />
    );
});

export const SessionsListHeader = React.memo(function SessionsListHeader() {
    const styles = sessionListStyles;

    return (
        <View style={styles.listHeaderSection}>
            <RecoveryKeyReminderBanner />
            <UpdateBanner />
        </View>
    );
});

export const SessionFolderFocusBreadcrumbs = React.memo(function SessionFolderFocusBreadcrumbs(props: Readonly<{
    breadcrumbs: ReadonlyArray<SessionFolderV1>;
    onClear: () => void;
    onSelectFolder: (folderId: string) => void;
    rootTitle?: string | null;
}>) {
    const styles = sessionListStyles;
    const { theme } = useUnistyles();
    if (props.breadcrumbs.length === 0) return null;
    return (
        <View style={styles.groupHeaderSection} testID="session-folder-focused-breadcrumbs">
            <View style={styles.headerLabelRow}>
                <Pressable
                    testID="session-folder-breadcrumb-root"
                    onPress={props.onClear}
                    accessibilityRole="button"
                    accessibilityLabel={props.rootTitle ?? t('sessionsList.workspaceRoot')}
                    hitSlop={8}
                >
                    <Text style={styles.groupHeaderSubtitle}>{props.rootTitle ?? t('sessionsList.workspaceRoot')}</Text>
                </Pressable>
                {props.breadcrumbs.map((breadcrumb) => (
                    <React.Fragment key={breadcrumb.id}>
                        <Icon name="caret-right" size={14} color={theme.colors.text.tertiary} />
                        <Pressable
                            testID={`session-folder-breadcrumb-folder-${breadcrumb.id}`}
                            onPress={() => props.onSelectFolder(breadcrumb.id)}
                            accessibilityRole="button"
                            accessibilityLabel={breadcrumb.name}
                            hitSlop={8}
                        >
                            <Text style={styles.groupHeaderSubtitle}>{breadcrumb.name}</Text>
                        </Pressable>
                    </React.Fragment>
                ))}
            </View>
        </View>
    );
});

export const ProjectGroupHeader = React.memo(function ProjectGroupHeader(props: Readonly<{
    item: Extract<SessionListIndexItem, { type: 'header' }>;
    hasMultipleMachines: boolean;
    displayTitle: string;
    hasCustomLabel: boolean;
    canOpenProject: boolean;
    workspaceFaviconsEnabled?: boolean;
    workspaceMachineSubtitlesEnabled?: boolean;
    onOpenProject: () => void;
    onCreateSession: () => void;
    onAddFolder: () => void;
    onRename: () => void;
    onReset: () => void;
    collapsed: boolean;
    onToggleCollapse: () => void;
    onRegisterDropTarget?: RegisterSessionFolderDropTarget;
}>) {
    const styles = sessionListStyles;
    const { theme } = useUnistyles();
    const { item, hasMultipleMachines, displayTitle, hasCustomLabel, canOpenProject, workspaceFaviconsEnabled = false, workspaceMachineSubtitlesEnabled = true, onOpenProject, onCreateSession, onAddFolder, onRename, onReset, collapsed, onToggleCollapse } = props;
    const [isRowHovered, setIsRowHovered] = React.useState(false);
    const [isActionsHovered, setIsActionsHovered] = React.useState(false);
    const [menuOpen, setMenuOpen] = React.useState(false);
    const isWeb = Platform.OS === 'web';
    const sessionFoldersFeatureEnabled = useFeatureEnabled('sessions.folders');
    const showHoverActions = !isWeb || isRowHovered || isActionsHovered || menuOpen;
    const showChevron = !isWeb || collapsed || showHoverActions;
    const menuEnabled = Boolean(item.workspaceScopeHint);
    const reorderHandleKey = item.groupKey ?? item.workspaceKey ?? '';
    const actionIconColor = theme.colors.text.secondary;
    const canCreateSession = Boolean(item.workspaceScopeHint);
    const favicon = useWorkspaceFavicon({
        enabled: workspaceFaviconsEnabled,
        serverId: item.workspaceScopeHint?.serverId ?? item.serverId ?? null,
        machineId: item.workspaceScopeHint?.machineId ?? null,
        workspacePath: item.workspaceScopeHint?.rootPath ?? null,
    });
    const workspace = React.useMemo(() => resolveDurableWorkspaceRefForSessionListHeader(item), [item]);
    const dropTarget = React.useMemo(() => {
        if (!workspace) return null;
        return {
            type: 'workspace-root' as const,
            workspace,
            serverId: item.serverId ?? workspace.serverId ?? null,
        };
    }, [item.serverId, workspace]);
    const workspaceRootRowId = resolveWorkspaceRootTreeRowId(item, displayTitle);
    const headerTestId = `session-list-project-header:${item.groupKey ?? item.title}`;
    const dropRegistration = useMeasuredDropTargetRegistration({
        id: dropTarget ? workspaceRootRowId : null,
        target: dropTarget,
        onRegister: props.onRegisterDropTarget,
    });

    const menuItems = resolveProjectGroupHeaderMenuItems({
        menuEnabled: Boolean(item.workspaceScopeHint),
        canOpenProject,
        canAddFolder: sessionFoldersFeatureEnabled,
        hasCustomLabel,
        actionIconColor,
    });

    const chevronColor = theme.colors.text.secondary;
    return (
        <View style={styles.groupHeaderSection}>
            <View
                ref={dropRegistration.ref}
                testID={headerTestId}
                style={styles.groupHeaderRow}
                onLayout={dropRegistration.onLayout}
                onPointerEnter={isWeb ? () => setIsRowHovered(true) : undefined}
                onPointerLeave={isWeb ? () => setIsRowHovered(false) : undefined}
            >
                <Pressable
                    style={styles.groupHeaderContent}
                    onPress={onToggleCollapse}
                    onHoverIn={isWeb ? () => setIsRowHovered(true) : undefined}
                    onHoverOut={isWeb ? () => setIsRowHovered(false) : undefined}
                    accessibilityRole="button"
                    accessibilityLabel={displayTitle}
                >
                    <View style={styles.groupHeaderTitleRow}>
                        {favicon ? (
                            <View testID="session-list-workspace-favicon" style={styles.groupHeaderFaviconFrame}>
                                <ReactNativeImage
                                    source={{ uri: favicon.uri }}
                                    style={styles.groupHeaderFavicon}
                                    resizeMode="cover"
                                    accessibilityIgnoresInvertColors
                                />
                            </View>
                        ) : null}
                        <Eyebrow style={styles.groupHeaderTitle} numberOfLines={1}>{displayTitle}</Eyebrow>
                        <View
                            style={styles.groupHeaderInlineActions}
                            onPointerEnter={isWeb ? () => setIsActionsHovered(true) : undefined}
                            onPointerLeave={isWeb ? () => setIsActionsHovered(false) : undefined}
                        >
                            <View
                                style={[
                                    styles.groupHeaderChevron,
                                    isWeb && !showChevron ? styles.webHoverHiddenChevron : styles.webHoverVisibleChevron,
                                ]}
                            >
                                <Icon
                                    name={collapsed ? 'caret-right' : 'caret-down'}
                                    size={14}
                                    color={chevronColor}
                                />
                            </View>
                        </View>
                    </View>
                    {workspaceMachineSubtitlesEnabled && hasMultipleMachines && item.subtitle ? (
                        <Text style={styles.groupHeaderSubtitle}>{item.subtitle}</Text>
                    ) : null}
                </Pressable>
                <View style={styles.groupHeaderTrailingActions}>
                    {showHoverActions && reorderHandleKey ? (
                        <Pressable
                            style={styles.groupHeaderActionButton}
                            testID={`session-workspace-reorder-handle:${reorderHandleKey}`}
                            onPress={(event) => {
                                stopPressEventPropagation(event);
                            }}
                            onHoverIn={isWeb ? () => setIsActionsHovered(true) : undefined}
                            onHoverOut={isWeb ? () => setIsActionsHovered(false) : undefined}
                            accessible={false}
                            hitSlop={8}
                        >
                            <Icon
                                name="list"
                                size={14}
                                color={actionIconColor}
                                style={[
                                    styles.folderHeaderDragHandleIcon,
                                    showHoverActions ? styles.folderHeaderDragHandleIconActive : null,
                                ]}
                            />
                        </Pressable>
                    ) : null}
                    {showHoverActions && menuEnabled ? (
                        <DropdownMenu
                            open={menuOpen}
                            onOpenChange={setMenuOpen}
                            items={menuItems}
                            onSelect={(itemId) => {
                                if (itemId === 'openProject') {
                                    onOpenProject();
                                } else if (itemId === 'addFolder') {
                                    onAddFolder();
                                } else if (itemId === 'rename') {
                                    onRename();
                                } else if (itemId === 'reset') {
                                    onReset();
                                }
                            }}
                            placement="bottom"
                            popoverAnchorAlign="end"
                            variant="slim"
                            matchTriggerWidth={false}
                            maxWidthCap={220}
                            showCategoryTitles={false}
                            popoverPortalWebTarget="body"
                            trigger={({ toggle }) => (
                                <Pressable
                                    style={styles.groupHeaderActionButton}
                                    onPress={(event) => {
                                        stopPressEventPropagation(event);
                                        toggle();
                                    }}
                                    onHoverIn={isWeb ? () => setIsActionsHovered(true) : undefined}
                                    onHoverOut={isWeb ? () => setIsActionsHovered(false) : undefined}
                                    accessibilityRole="button"
                                    accessibilityLabel={t('common.moreActions')}
                                    hitSlop={8}
                                >
                                    <Icon name="dots-three" size={14} color={actionIconColor} />
                                </Pressable>
                            )}
                        />
                    ) : null}
                    {canCreateSession ? (
                        <Pressable
                            style={styles.groupHeaderActionButton}
                            onPress={(event) => {
                                stopPressEventPropagation(event);
                                onCreateSession();
                            }}
                            accessibilityRole="button"
                            accessibilityLabel={t('machine.launchNewSessionInDirectory')}
                            hitSlop={8}
                        >
                            <Icon name="plus" size={14} color={actionIconColor} />
                        </Pressable>
                    ) : null}
                </View>
            </View>
        </View>
    );
});

export const CollapsibleSectionHeader = React.memo(function CollapsibleSectionHeader(props: Readonly<{
    title: string;
    collapsed: boolean;
    onPress: () => void;
    isPrimaryHeader?: boolean;
    testID?: string;
    rootMeasurement?: Readonly<{
        active: boolean;
        ref: React.Ref<View>;
        onLayout: NonNullable<ViewProps['onLayout']>;
        style?: StyleProp<ViewStyle>;
    }>;
}>) {
    const styles = sessionListStyles;
    const { theme } = useUnistyles();
    const isWeb = Platform.OS === 'web';
    const [isHovered, setIsHovered] = React.useState(false);
    const headerChevronColor = theme.colors.text.secondary;
    const isPrimaryHeader = props.isPrimaryHeader === true;
    const showChevron = !isWeb || props.collapsed || isHovered;
    return (
        <Pressable
            ref={props.rootMeasurement?.ref}
            collapsable={props.rootMeasurement?.active ? false : undefined}
            style={[
                isPrimaryHeader ? styles.headerSection : styles.groupHeaderSection,
                props.rootMeasurement?.style,
            ]}
            onPress={props.onPress}
            testID={props.testID}
            onLayout={props.rootMeasurement?.onLayout}
            onHoverIn={isWeb ? () => setIsHovered(true) : undefined}
            onHoverOut={isWeb ? () => setIsHovered(false) : undefined}
        >
            <View style={styles.headerRow}>
                <View style={styles.headerLabelRow}>
                    <Eyebrow style={isPrimaryHeader ? styles.headerText : styles.groupHeaderTitle}>{props.title}</Eyebrow>
                    <View
                        style={[
                            styles.headerChevron,
                            isWeb && !showChevron ? styles.webHoverHiddenChevron : styles.webHoverVisibleChevron,
                        ]}
                    >
                        <Icon
                            name={props.collapsed ? 'caret-right' : 'caret-down'}
                            size={14}
                            color={headerChevronColor}
                        />
                    </View>
                </View>
            </View>
        </Pressable>
    );
});

export const FolderGroupHeader = React.memo(function FolderGroupHeader(props: Readonly<{
    title: string;
    depth: number;
    collapsed: boolean;
    onPress: () => void;
    onToggleCollapse: () => void;
    onNewSession: () => void;
    onAddSubfolder: () => void | Promise<void>;
    onRename: () => void | Promise<void>;
    onDelete: () => void | Promise<void>;
    onMove?: () => void;
    onMoveToWorkspaceRoot?: () => void;
    onMoveUp?: () => void;
    onMoveDown?: () => void;
    item: Extract<SessionListIndexItem, { type: 'header' }>;
    onRegisterDropTarget?: RegisterSessionFolderDropTarget;
    disabled?: boolean;
}>) {
    const styles = sessionListStyles;
    const { theme } = useUnistyles();
    const [isHovered, setIsHovered] = React.useState(false);
    const [isActionsHovered, setIsActionsHovered] = React.useState(false);
    const [menuOpen, setMenuOpen] = React.useState(false);
    const isWeb = Platform.OS === 'web';
    const normalizedDepth = Math.min(Math.max(Math.trunc(props.depth), 0), 3);
    const indentation = 20 + normalizedDepth * 12;
    const displayLocked = props.item.displayState?.status === 'locked';
    const displayTitle = displayLocked ? t('common.unavailable') : props.title;
    const actionsDisabled = props.disabled || displayLocked;
    const iconColor = actionsDisabled ? theme.colors.text.tertiary : theme.colors.text.secondary;
    const showActions = !isWeb || isHovered || isActionsHovered || menuOpen;
    const dropTarget = React.useMemo(() => {
        if (!props.item.workspace || !props.item.folderId) return null;
        return {
            type: 'folder' as const,
            folderId: props.item.folderId,
            workspace: props.item.workspace,
            serverId: props.item.serverId ?? props.item.workspace.serverId ?? null,
        };
    }, [props.item.folderId, props.item.serverId, props.item.workspace]);
    const dropRegistration = useMeasuredDropTargetRegistration({
        id: dropTarget ? `folder:${dropTarget.folderId}` : null,
        target: dropTarget,
        onRegister: props.onRegisterDropTarget,
    });
    const menuItems = React.useMemo((): DropdownMenuItem[] => {
        const items: DropdownMenuItem[] = [{
            id: 'new-session',
            title: t('sessionsList.newSessionInFolder'),
            icon: <Icon name="plus-circle" size={16} color={iconColor} />,
            disabled: actionsDisabled,
        },
        {
            id: 'add-subfolder',
            title: t('sessionsList.addSubfolder'),
            icon: <Icon name="folder-open" size={16} color={iconColor} />,
            disabled: actionsDisabled,
        }];
        if (typeof props.onMove === 'function') {
            items.push({
                id: 'move',
                title: t('sessionsList.moveToFolder'),
                icon: <Icon name="arrows-out-cardinal" size={16} color={iconColor} />,
                disabled: actionsDisabled,
            });
        }
        items.push({
            id: 'rename',
            title: t('sessionsList.renameFolder'),
            icon: <Icon name="pencil" size={16} color={iconColor} />,
            disabled: actionsDisabled,
        },
        {
            id: 'delete',
            title: t('sessionsList.deleteFolder'),
            icon: <Icon name="trash" size={16} color={iconColor} />,
            disabled: actionsDisabled,
        });
        return items;
    }, [actionsDisabled, iconColor, props.onMove]);
    const handleMenuSelect = React.useCallback(async (itemId: string) => {
        if (actionsDisabled) return;
        if (itemId === 'new-session') {
            props.onNewSession();
        } else if (itemId === 'add-subfolder') {
            await props.onAddSubfolder();
        } else if (itemId === 'move') {
            props.onMove?.();
        } else if (itemId === 'rename') {
            await props.onRename();
        } else if (itemId === 'delete') {
            await props.onDelete();
        }
    }, [actionsDisabled, props]);
    const folderAccessibilityActions = React.useMemo(() => {
        const actions: Array<{ name: string; label: string }> = [];
        if (typeof props.onMoveUp === 'function') {
            actions.push({ name: 'moveUp', label: t('common.moveUp') });
        }
        if (typeof props.onMoveDown === 'function') {
            actions.push({ name: 'moveDown', label: t('common.moveDown') });
        }
        if (typeof props.onMove === 'function') {
            actions.push({ name: 'moveToFolder', label: t('sessionsList.moveToFolder') });
        }
        if (typeof props.onMoveToWorkspaceRoot === 'function') {
            actions.push({ name: 'moveToWorkspaceRoot', label: t('sessionsList.moveToWorkspaceRoot') });
        }
        return actions;
    }, [props.onMove, props.onMoveDown, props.onMoveToWorkspaceRoot, props.onMoveUp]);
    const handleFolderAccessibilityAction = React.useCallback((event: { nativeEvent?: { actionName?: string } }) => {
        if (actionsDisabled) return;
        switch (event.nativeEvent?.actionName) {
            case 'moveUp':
                props.onMoveUp?.();
                break;
            case 'moveDown':
                props.onMoveDown?.();
                break;
            case 'moveToFolder':
                props.onMove?.();
                break;
            case 'moveToWorkspaceRoot':
                props.onMoveToWorkspaceRoot?.();
                break;
            default:
                break;
        }
    }, [actionsDisabled, props]);
    const headerTestId = `session-folder-header-${props.item.folderId ?? props.title}`;
    return (
        <View
            ref={dropRegistration.ref}
            style={styles.folderHeaderSection}
            onLayout={dropRegistration.onLayout}
            onPointerEnter={isWeb ? () => setIsHovered(true) : undefined}
            onPointerLeave={isWeb ? () => setIsHovered(false) : undefined}
        >
            <View
                testID={headerTestId}
                style={[
                    styles.folderHeaderRow,
                    { paddingLeft: indentation },
                ]}
            >
                <Pressable
                    testID={`session-folder-collapse-${props.item.folderId ?? props.title}`}
                    style={styles.groupHeaderActionButton}
                    onPress={(event) => {
                        stopPressEventPropagation(event);
                        props.onToggleCollapse();
                    }}
                    accessibilityRole="button"
                    accessibilityLabel={props.collapsed ? t('common.expand') : t('common.collapse')}
                    hitSlop={8}
                >
                    <Icon
                        name={props.collapsed ? 'caret-right' : 'caret-down'}
                        size={14}
                        color={iconColor}
                    />
                </Pressable>
                <Pressable
                    testID={`${headerTestId}-focus`}
                    style={styles.headerLabelRow}
                    onPress={actionsDisabled ? undefined : props.onPress}
                    accessibilityRole="button"
                    accessibilityLabel={displayTitle}
                    accessibilityActions={folderAccessibilityActions}
                    onAccessibilityAction={folderAccessibilityActions.length > 0 ? handleFolderAccessibilityAction : undefined}
                    disabled={actionsDisabled}
                >
                    <Icon name="folder" size={14} color={iconColor} />
                    <Eyebrow style={styles.groupHeaderTitle} numberOfLines={1}>{displayTitle}</Eyebrow>
                </Pressable>
                <View
                    testID={`session-folder-reorder-handle-${props.item.folderId ?? props.title}`}
                    style={[
                        styles.groupHeaderActionButton,
                        showActions ? styles.webHoverVisibleChevron : styles.webHoverHiddenChevron,
                    ]}
                    pointerEvents="none"
                >
                    <Icon
                        name="list"
                        size={14}
                        color={iconColor}
                        style={[
                            styles.folderHeaderDragHandleIcon,
                            showActions ? styles.folderHeaderDragHandleIconActive : null,
                        ]}
                    />
                </View>
                <View
                    onPointerEnter={isWeb ? () => setIsActionsHovered(true) : undefined}
                    onPointerLeave={isWeb ? () => setIsActionsHovered(false) : undefined}
                >
                    <DropdownMenu
                        open={menuOpen}
                        onOpenChange={setMenuOpen}
                        items={menuItems}
                        onSelect={handleMenuSelect}
                        placement="left"
                        variant="slim"
                        matchTriggerWidth={false}
                        maxWidthCap={240}
                        showCategoryTitles={false}
                        popoverPortalWebTarget="body"
                        trigger={({ toggle }) => (
                            <Pressable
                                testID={`session-folder-menu-trigger-${props.item.folderId ?? props.title}`}
                                style={[
                                    styles.groupHeaderActionButton,
                                    isWeb && !showActions ? styles.webHoverHiddenChevron : styles.webHoverVisibleChevron,
                                ]}
                                onPress={(event) => {
                                    stopPressEventPropagation(event);
                                    toggle();
                                }}
                                onHoverIn={isWeb ? () => setIsActionsHovered(true) : undefined}
                                onHoverOut={isWeb ? () => setIsActionsHovered(false) : undefined}
                                accessibilityRole="button"
                                accessibilityLabel={t('common.moreActions')}
                                hitSlop={8}
                            >
                                <Icon name="dots-three" size={14} color={iconColor} />
                            </Pressable>
                        )}
                    />
                </View>
            </View>
        </View>
    );
});
