import * as React from 'react';
import type { SplitCanvasDropTarget } from '../splitCanvas/model/splitCanvasTypes';
import { reduceWorkspaceState, type WorkspaceAction, type WorkspaceState } from './workspaceState';
import { createWorkspaceSplit } from './workspaceSplit';

const PREFIX = 'happier-workspace:';

let tabDragActive = false;
const tabDragListeners = new Set<() => void>();

/**
 * Whether a workspace tab is being dragged right now. The panes offer their drop zones only then, so
 * dragging anything else over the window (a file from the desktop onto a composer) never shows them.
 */
export function setWorkspaceTabDragActive(active: boolean): void {
    if (tabDragActive === active) return;
    tabDragActive = active;
    for (const listener of [...tabDragListeners]) listener();
}

export function useWorkspaceTabDragActive(): boolean {
    return React.useSyncExternalStore(
        (listener) => { tabDragListeners.add(listener); return () => { tabDragListeners.delete(listener); }; },
        () => tabDragActive,
        () => false,
    );
}

/** What a drag carries onto the workspace: an open tab, or a destination a row opens. */
export type WorkspaceDragData =
    | Readonly<{ kind: 'tab'; tabId: string }>
    | Readonly<{ kind: 'href'; href: string }>;

/** The drag payload (`text/plain`), so a drop on any workspace surface reads one format. */
export function encodeWorkspaceDragData(data: WorkspaceDragData): string {
    return PREFIX + JSON.stringify(data);
}

export function decodeWorkspaceDragData(payload: string | null | undefined): WorkspaceDragData | null {
    if (typeof payload !== 'string' || !payload.startsWith(PREFIX)) return null;
    try {
        const value = JSON.parse(payload.slice(PREFIX.length)) as Partial<Record<string, unknown>>;
        if (value.kind === 'tab' && typeof value.tabId === 'string' && value.tabId) return { kind: 'tab', tabId: value.tabId };
        if (value.kind === 'href' && typeof value.href === 'string' && value.href.startsWith('/')) return { kind: 'href', href: value.href };
    } catch {
        return null;
    }
    return null;
}

/**
 * The state change for a tab dropped in a strip: before `beforeTabId` (or at the end) of `groupId`.
 * Within its own pane the tab is reordered; from another pane it moves there and then takes its place.
 */
export function resolveWorkspaceTabStripDrop(state: WorkspaceState, input: Readonly<{
    tabId: string;
    groupId: string;
    beforeTabId: string | null;
}>): readonly WorkspaceAction[] {
    const target = state.groups[input.groupId];
    const source = Object.values(state.groups).find((group) => group.tabIds.includes(input.tabId));
    if (!target || !source || input.tabId === input.beforeTabId) return [];
    const actions: WorkspaceAction[] = [];
    let current = state;
    if (source.id !== target.id) {
        const move: WorkspaceAction = { type: 'moveTab', tabId: input.tabId, sourceGroupId: source.id, targetGroupId: target.id };
        current = reduceWorkspaceState(current, move);
        if (current === state) return [];
        actions.push(move);
    }
    // The order the pane has once the tab is in it (a move can replace the pane's preview tab).
    const targetIds = current.groups[target.id]?.tabIds ?? [];
    const without = targetIds.filter((id) => id !== input.tabId);
    const before = input.beforeTabId === null ? -1 : without.indexOf(input.beforeTabId);
    const index = before < 0 ? without.length : before;
    if (targetIds.indexOf(input.tabId) !== index) actions.push({ type: 'reorderTab', groupId: target.id, tabId: input.tabId, index });
    return actions;
}

/**
 * The state change for a tab dropped on a pane (workspace lab D): the centre moves it into that pane;
 * an edge splits that pane and the tab becomes the new pane, admitted by the measured size like every
 * other split.
 */
export function resolveWorkspaceTabCanvasDrop(state: WorkspaceState, input: Readonly<{
    tabId: string;
    target: SplitCanvasDropTarget;
    availableSizePx?: number;
    minimumExistingSizePx?: number;
    createId: () => string;
}>): WorkspaceAction | null {
    const source = Object.values(state.groups).find((group) => group.tabIds.includes(input.tabId));
    if (!source || !state.groups[input.target.leafId]) return null;
    if (input.target.placement === 'center') {
        return source.id === input.target.leafId ? null
            : { type: 'moveTab', tabId: input.tabId, sourceGroupId: source.id, targetGroupId: input.target.leafId };
    }
    if (input.availableSizePx === undefined || input.minimumExistingSizePx === undefined) return null;
    return createWorkspaceSplit(state, {
        groupId: input.target.leafId, tabId: input.tabId, direction: input.target.placement,
        availableSizePx: input.availableSizePx, minimumExistingSizePx: input.minimumExistingSizePx, createId: input.createId,
    });
}
