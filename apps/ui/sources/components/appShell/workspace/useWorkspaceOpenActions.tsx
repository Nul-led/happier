import * as React from 'react';
import { useUnistyles } from 'react-native-unistyles';

import type { DropdownMenuItem } from '@/components/ui/forms/dropdown/DropdownMenu';
import { Icon } from '@/components/ui/icons/Icon';
import { t } from '@/text';
import { useOptionalWorkspaceNavigation, type WorkspaceNavigationContextValue } from './WorkspaceNavigationContext';
import { WORKSPACE_VIEW_MINIMUM } from './workspaceSplit';
import type { WorkspaceOpenOptions } from './workspaceNavigationAdapter';

export const WORKSPACE_OPEN_IN_NEW_TAB_ID = 'workspace.open.newTab';
export const WORKSPACE_OPEN_TO_RIGHT_ID = 'workspace.open.right';
export const WORKSPACE_OPEN_BELOW_ID = 'workspace.open.below';

export type WorkspaceOpenMode = 'newTab' | 'splitRight' | 'splitDown';

/**
 * Opens `href` in the workspace as a kept tab (never the preview), or beside the focused pane — the
 * split admitted by that pane's measured size like every other split. False when the workspace is
 * not the navigation owner here or the destination/split cannot open.
 */
export function openInWorkspace(workspace: WorkspaceNavigationContextValue | null, href: string, mode: WorkspaceOpenMode,
    groupId?: string): boolean {
    if (!workspace?.active) return false;
    if (mode === 'newTab') return workspace.openHref(href, { mode: 'newTab', ...(groupId ? { groupId } : {}) });
    const direction = mode === 'splitRight' ? 'right' : 'down';
    const measurement = workspace.canvasControlsRef?.current?.readSplitMeasurement(workspace.state.focusedGroupId, direction);
    if (!measurement) return false;
    const options: WorkspaceOpenOptions = {
        mode,
        availableSizePx: measurement.availableSizePx,
        minimumFirstSizePx: measurement.minimumExistingSizePx,
        minimumSecondSizePx: direction === 'right' ? WORKSPACE_VIEW_MINIMUM.width : WORKSPACE_VIEW_MINIMUM.height,
    };
    return workspace.openHref(href, options);
}

/**
 * The open mode a pointer gesture asks for on a row that opens a destination (workspace lab O):
 * ⌘/Ctrl-click and a middle click keep the page as a new tab; ⌥-click opens it to the right. A plain
 * click returns null and follows the row's own navigation (the focused pane's preview tab).
 */
export function resolveWorkspaceOpenModeFromPointer(event: unknown): WorkspaceOpenMode | null {
    if (!event || typeof event !== 'object') return null;
    const source = event as { metaKey?: unknown; ctrlKey?: unknown; altKey?: unknown; button?: unknown;
        nativeEvent?: { metaKey?: unknown; ctrlKey?: unknown; altKey?: unknown; button?: unknown } };
    const read = (key: 'metaKey' | 'ctrlKey' | 'altKey' | 'button') => source[key] ?? source.nativeEvent?.[key];
    if (read('button') === 1 || read('metaKey') === true || read('ctrlKey') === true) return 'newTab';
    if (read('altKey') === true) return 'splitRight';
    return null;
}

/**
 * "Open in new tab / to the right / below" for a row that opens `href`: the menu items and their
 * handler, from the one workspace owner. Empty when the workspace does not own navigation here (a
 * phone), so a row's menu never offers what cannot happen.
 */
export function useWorkspaceOpenActions(href: string | null): Readonly<{
    items: readonly DropdownMenuItem[];
    select: (itemId: string) => boolean;
    open: (mode: WorkspaceOpenMode) => boolean;
}> {
    const workspace = useOptionalWorkspaceNavigation();
    const { theme } = useUnistyles();
    const active = workspace?.active === true && href !== null;
    const workspaceRef = React.useRef(workspace);
    workspaceRef.current = workspace;
    const open = React.useCallback((mode: WorkspaceOpenMode) => (href ? openInWorkspace(workspaceRef.current, href, mode) : false), [href]);
    const items = React.useMemo((): readonly DropdownMenuItem[] => (active ? [
        { id: WORKSPACE_OPEN_IN_NEW_TAB_ID, testID: 'workspace-open-new-tab', title: t('workspaceBar.openInNewTab'),
            icon: <Icon name="plus" size={16} color={theme.colors.text.secondary} /> },
        { id: WORKSPACE_OPEN_TO_RIGHT_ID, testID: 'workspace-open-right', title: t('workspaceBar.openToRight'),
            icon: <Icon name="square-split-horizontal" size={16} color={theme.colors.text.secondary} /> },
        { id: WORKSPACE_OPEN_BELOW_ID, testID: 'workspace-open-below', title: t('workspaceBar.openBelow'),
            icon: <Icon name="square-split-vertical" size={16} color={theme.colors.text.secondary} /> },
    ] : []), [active, theme.colors.text.secondary]);
    const select = React.useCallback((itemId: string) => {
        switch (itemId) {
            case WORKSPACE_OPEN_IN_NEW_TAB_ID: open('newTab'); return true;
            case WORKSPACE_OPEN_TO_RIGHT_ID: open('splitRight'); return true;
            case WORKSPACE_OPEN_BELOW_ID: open('splitDown'); return true;
            default: return false;
        }
    }, [open]);
    return React.useMemo(() => ({ items, select, open }), [items, open, select]);
}
