import type { WorkspaceState, WorkspaceTab } from './workspaceState';
import { collectSplitCanvasLeaves } from '../splitCanvas/model/splitCanvasTree';

export type WorkspacePhoneTab = Readonly<{
    id: string;
    panes: readonly WorkspaceTab[];
    activeTabId: string;
}>;

/** A phone view of the same destination instances; pairs carry membership only. */
export function projectWorkspacePhoneTabs(
    state: WorkspaceState,
    pairs: readonly (readonly string[])[] = state.tabPairs,
): readonly WorkspacePhoneTab[] {
    const orderedIds = collectSplitCanvasLeaves(state.root).flatMap((leaf) => state.groups[leaf.payload.groupId]?.tabIds ?? []);
    const liveIds = new Set(orderedIds);
    const membership = new Map<string, readonly string[]>();
    for (const pair of pairs) {
        const members = [...new Set(pair)].filter((id) => liveIds.has(id) && !membership.has(id));
        for (const id of members) membership.set(id, members);
    }
    const focusedTabId = state.groups[state.focusedGroupId]?.activeTabId;
    const emitted = new Set<string>();
    return orderedIds.flatMap((id) => {
        if (emitted.has(id)) return [];
        const memberIds = membership.get(id) ?? [id];
        const panes = memberIds.flatMap((member) => state.tabs[member] ? [state.tabs[member]] : []);
        for (const member of memberIds) emitted.add(member);
        if (panes.length === 0) return [];
        return [{ id: panes[0].id, panes,
            activeTabId: focusedTabId && memberIds.includes(focusedTabId) ? focusedTabId : panes[0].id }];
    });
}
