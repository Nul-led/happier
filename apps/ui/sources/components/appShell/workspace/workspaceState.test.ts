import { describe, expect, it, vi } from 'vitest';

import { collectSplitCanvasLeafIds } from '../splitCanvas/model/splitCanvasSelectors';
import { createWorkspaceState, reduceWorkspaceState } from './workspaceState';
import type { WorkspaceTab } from './workspaceState';
import { parseWorkspaceLayout, serializeWorkspaceLayout, readScopedWorkspaceLayout, writeScopedWorkspaceLayout, workspaceLayoutScopeKey } from './workspacePersistence';

const tab = (id: string, kind = 'session', preview = false): WorkspaceTab => {
    const params: Record<string, string> = kind === 'session' ? { id, serverId: 'home-a' } : {};
    return { id, target: { kind, params }, pinned: !preview, preview };
};

describe('workspace state', () => {
    it('keeps portable split membership across focus, local restore and closing one member', () => {
        let state = createWorkspaceState(tab('a'));
        state = reduceWorkspaceState(state, { type: 'openTab', groupId: 'group:1', tab: tab('b') });
        state = reduceWorkspaceState(state, {
            type: 'splitTab', tabId: 'b', sourceGroupId: 'group:1', targetGroupId: 'group:1',
            newGroupId: 'group:2', axis: 'row', placement: 'after',
            availableSizePx: 1000, minimumFirstSizePx: 320, minimumSecondSizePx: 320,
        });
        expect(state.tabPairs).toEqual([['a', 'b']]);
        const membership = state.tabPairs;
        state = reduceWorkspaceState(state, { type: 'openTab', groupId: 'group:1', tab: tab('c') });
        expect(state.tabPairs).toBe(membership);
        state = reduceWorkspaceState(state, { type: 'activateTab', groupId: 'group:1', tabId: 'a' });
        expect(state.tabPairs).toBe(membership);
        const restored = parseWorkspaceLayout(JSON.parse(JSON.stringify(serializeWorkspaceLayout(state))))!;
        expect(restored.tabPairs).toEqual([['a', 'b']]);
        const closed = reduceWorkspaceState(restored, { type: 'closeTab', groupId: 'group:2', tabId: 'b',
            newTab: { id: 'blank', target: { kind: 'newTab', params: {} }, pinned: false, preview: false } });
        expect(closed.tabPairs).toEqual([]);
    });
    it('promotes a preview to an intentional tab without pinning it or disturbing its group', () => {
        const state = createWorkspaceState(tab('preview', 'session', true));
        const promoted = reduceWorkspaceState(state, { type: 'promoteTab', tabId: 'preview' });
        expect(promoted.tabs.preview).toMatchObject({ id: 'preview', pinned: false, preview: false });
        expect(promoted.groups).toBe(state.groups);
        expect(promoted.root).toBe(state.root);
        expect(reduceWorkspaceState(promoted, { type: 'promoteTab', tabId: 'preview' })).toBe(promoted);
        expect(reduceWorkspaceState(promoted, { type: 'promoteTab', tabId: 'missing' })).toBe(promoted);
    });

    it('unpins an intentional tab without replacing the preview or changing the focused destination', () => {
        let state = createWorkspaceState(tab('a'));
        state = reduceWorkspaceState(state, { type: 'openTab', groupId: 'group:1', tab: tab('preview', 'settings', true) });
        const group = state.groups['group:1'];
        const unpinned = reduceWorkspaceState(state, { type: 'setPinned', tabId: 'a', pinned: false });
        expect(unpinned.tabs.a).toMatchObject({ pinned: false, preview: false });
        expect(unpinned.tabs.preview).toBe(state.tabs.preview);
        expect(unpinned.groups['group:1']).toBe(group);
        expect(reduceWorkspaceState(unpinned, { type: 'setPinned', tabId: 'a', pinned: false })).toBe(unpinned);
        const promoted = reduceWorkspaceState(unpinned, { type: 'setPinned', tabId: 'preview', pinned: true });
        expect(promoted.tabs.preview).toMatchObject({ pinned: true, preview: false });
        expect(promoted.groups['group:1']).toBe(group);
    });

    it('reorders a tab without changing focus, recency, pinning or preview disposition', () => {
        let state = createWorkspaceState(tab('a'));
        state = reduceWorkspaceState(state, { type: 'openTab', groupId: 'group:1', tab: tab('b') });
        state = reduceWorkspaceState(state, { type: 'openTab', groupId: 'group:1', tab: tab('c', 'settings', true) });
        state = reduceWorkspaceState(state, { type: 'activateTab', groupId: 'group:1', tabId: 'b' });
        const before = state;
        const reordered = reduceWorkspaceState(state, { type: 'reorderTab', groupId: 'group:1', tabId: 'c', index: 0 });
        expect(reordered.groups['group:1'].tabIds).toEqual(['c', 'a', 'b']);
        expect(reordered.groups['group:1'].activeTabId).toBe('b');
        expect(reordered.groups['group:1'].mru).toBe(before.groups['group:1'].mru);
        expect(reordered.tabs).toBe(before.tabs);
        expect(reordered.root).toBe(before.root);
        expect(reordered.focusedGroupId).toBe(before.focusedGroupId);
        expect(parseWorkspaceLayout(serializeWorkspaceLayout(reordered))).toEqual(reordered);
        expect(reduceWorkspaceState(reordered, { type: 'reorderTab', groupId: 'group:1', tabId: 'c', index: 0 })).toBe(reordered);
        for (const index of [-1, 3, 0.5]) {
            expect(reduceWorkspaceState(reordered, { type: 'reorderTab', groupId: 'group:1', tabId: 'c', index })).toBe(reordered);
        }
        expect(reduceWorkspaceState(reordered, { type: 'reorderTab', groupId: 'missing', tabId: 'c', index: 0 })).toBe(reordered);
        expect(reduceWorkspaceState(reordered, { type: 'reorderTab', groupId: 'group:1', tabId: 'missing', index: 0 })).toBe(reordered);
        expect(reduceWorkspaceState(reordered, { type: 'reorderTab', groupId: 'group:1', tabId: 'c', index: 2 }).groups['group:1'].tabIds).toEqual(['a', 'b', 'c']);
    });

    it('splits a saved layout after reload without reusing a divider identity', async () => {
        let saved = createWorkspaceState(tab('a'));
        saved = reduceWorkspaceState(saved, { type: 'openTab', groupId: 'group:1', tab: tab('b') });
        saved = reduceWorkspaceState(saved, {
            type: 'splitTab', tabId: 'b', sourceGroupId: 'group:1', targetGroupId: 'group:1',
            newGroupId: 'group:2', axis: 'row', placement: 'after',
            availableSizePx: 1000, minimumFirstSizePx: 320, minimumSecondSizePx: 320,
        });
        // A persisted identity survives a fresh geometry module, unlike its process counter.
        saved = { ...saved, root: { ...saved.root!, id: 'split:1' } };
        vi.resetModules();
        const { reduceWorkspaceState: reduceReloaded } = await import('./workspaceState');
        let restored = parseWorkspaceLayout(JSON.parse(JSON.stringify(serializeWorkspaceLayout(saved))))!;
        expect(restored).not.toBeNull();
        restored = reduceReloaded(restored, { type: 'openTab', groupId: 'group:2', tab: tab('c') });
        restored = reduceReloaded(restored, {
            type: 'splitTab', tabId: 'c', sourceGroupId: 'group:2', targetGroupId: 'group:2',
            newGroupId: 'group:3', axis: 'column', placement: 'after',
            availableSizePx: 900, minimumFirstSizePx: 260, minimumSecondSizePx: 260,
        });
        if (restored.root?.kind !== 'split' || restored.root.second.kind !== 'split') throw new Error('Expected nested split');
        const nestedId = restored.root.second.id;
        expect(nestedId).not.toBe(restored.root.id);
        restored = reduceReloaded(restored, { type: 'resize', splitId: nestedId, ratio: 0.6,
            availableSizePx: 900, minimumFirstSizePx: 260, minimumSecondSizePx: 260 });
        restored = reduceReloaded(restored, { type: 'resize', splitId: 'split:1', ratio: 0.65,
            availableSizePx: 1000, minimumFirstSizePx: 320, minimumSecondSizePx: 320 });
        expect(restored.root).toMatchObject({ id: 'split:1', ratio: 0.65, second: { id: nestedId, ratio: 0.6 } });
        expect(parseWorkspaceLayout(JSON.parse(JSON.stringify(serializeWorkspaceLayout(restored))))).toEqual(restored);
    });

    it('shows the restored group when activation changes focus from a maximized group', () => {
        let state = createWorkspaceState(tab('a'));
        state = reduceWorkspaceState(state, { type: 'openTab', groupId: 'group:1', tab: tab('b') });
        state = reduceWorkspaceState(state, {
            type: 'splitTab', tabId: 'b', sourceGroupId: 'group:1', targetGroupId: 'group:1',
            newGroupId: 'group:2', axis: 'row', placement: 'after',
            availableSizePx: 1000, minimumFirstSizePx: 320, minimumSecondSizePx: 320,
        });
        state = reduceWorkspaceState(state, { type: 'toggleMaximize', groupId: 'group:2' });
        const restored = reduceWorkspaceState(state, { type: 'activateTab', groupId: 'group:1', tabId: 'a' });
        expect(restored.focusedGroupId).toBe('group:1');
        expect(restored.groups['group:1']?.activeTabId).toBe('a');
        expect(restored.maximizedGroupId).toBeNull();
    });

    it('splits a tab into nested real canvas groups, moves it, resizes, collapses and restores', () => {
        let state = createWorkspaceState(tab('a'));
        state = reduceWorkspaceState(state, { type: 'openTab', groupId: 'group:1', tab: tab('b') });
        state = reduceWorkspaceState(state, {
            type: 'splitTab', tabId: 'b', sourceGroupId: 'group:1', targetGroupId: 'group:1',
            newGroupId: 'group:2', axis: 'row', placement: 'after',
            availableSizePx: 1000, minimumFirstSizePx: 320, minimumSecondSizePx: 320,
        });
        state = reduceWorkspaceState(state, { type: 'openTab', groupId: 'group:2', tab: tab('c') });
        state = reduceWorkspaceState(state, {
            type: 'splitTab', tabId: 'c', sourceGroupId: 'group:2', targetGroupId: 'group:2',
            newGroupId: 'group:3', axis: 'column', placement: 'after',
            availableSizePx: 900, minimumFirstSizePx: 260, minimumSecondSizePx: 260,
        });
        expect(collectSplitCanvasLeafIds({ root: state.root })).toEqual(['group:1', 'group:2', 'group:3']);

        const splitId = state.root?.id;
        state = reduceWorkspaceState(state, {
            type: 'resize', splitId: splitId!, ratio: 0.6,
            availableSizePx: 1000, minimumFirstSizePx: 320, minimumSecondSizePx: 320,
        });
        state = reduceWorkspaceState(state, { type: 'moveTab', tabId: 'b', sourceGroupId: 'group:2', targetGroupId: 'group:3' });
        expect(state.groups['group:2']).toBeUndefined();
        expect(state.groups['group:3']?.tabIds).toEqual(['c', 'b']);
        expect(state.root).toMatchObject({ kind: 'split', ratio: 0.6 });

        state = reduceWorkspaceState(state, { type: 'closeTab', tabId: 'b', groupId: 'group:3', newTab: tab('new', 'newTab') });
        const restored = parseWorkspaceLayout(serializeWorkspaceLayout(state));
        expect(restored).toEqual(state);
        expect(restored?.groups['group:3']?.activeTabId).toBe('c');
    });

    it('replaces only the focused group preview, uses MRU on close, and keeps unknown targets after restore', () => {
        let state = createWorkspaceState(tab('a'));
        state = reduceWorkspaceState(state, { type: 'openTab', groupId: 'group:1', tab: tab('b') });
        state = reduceWorkspaceState(state, { type: 'openTab', groupId: 'group:1', tab: tab('c') });
        state = reduceWorkspaceState(state, { type: 'activateTab', groupId: 'group:1', tabId: 'b' });
        state = reduceWorkspaceState(state, { type: 'openTab', groupId: 'group:1', tab: tab('missing', 'removed:plugin', true), fallbackTitle: 'Old plugin page' });
        state = reduceWorkspaceState(state, { type: 'openTab', groupId: 'group:1', tab: tab('preview', 'settings', true) });
        expect(state.tabs.missing).toBeUndefined();
        expect(state.groups['group:1']?.tabIds).toEqual(['a', 'b', 'c', 'preview']);
        state = reduceWorkspaceState(state, { type: 'closeTab', groupId: 'group:1', tabId: 'preview', newTab: tab('new', 'newTab') });
        expect(state.groups['group:1']?.activeTabId).toBe('b');

        state = reduceWorkspaceState(state, { type: 'openTab', groupId: 'group:1', tab: tab('missing', 'removed:plugin', true), fallbackTitle: 'Old plugin page' });
        const restored = parseWorkspaceLayout(serializeWorkspaceLayout(state));
        expect(restored?.tabs.missing?.target.kind).toBe('removed:plugin');
        expect(restored?.fallbackTitlesByTabId.missing).toBe('Old plugin page');
    });

    it('rejects malformed membership and tree references instead of restoring a partial layout', () => {
        const snapshot = serializeWorkspaceLayout(createWorkspaceState(tab('a')));
        expect(parseWorkspaceLayout({ ...snapshot, groups: { 'group:1': { ...snapshot.groups['group:1'], tabIds: ['missing'] } } })).toBeNull();
        expect(parseWorkspaceLayout({ ...snapshot, root: { kind: 'leaf', id: 'wrong', leafKind: 'workspace-group', payload: { groupId: 'wrong' } } })).toBeNull();
        expect(parseWorkspaceLayout({ ...snapshot, tabPairs: null })).toBeNull();
        expect(parseWorkspaceLayout({ ...snapshot, tabPairs: undefined })).toBeNull();
        expect(parseWorkspaceLayout({ ...snapshot, tabPairs: [['a', 'missing']] })).toBeNull();
    });

    it('refuses an undersized split and turns the last closed tab into a new-tab target', () => {
        const initial = createWorkspaceState(tab('a'));
        const refused = reduceWorkspaceState(initial, {
            type: 'splitTab', tabId: 'a', sourceGroupId: 'group:1', targetGroupId: 'group:1',
            newGroupId: 'group:2', axis: 'row', placement: 'after', newTabForSource: tab('source-new', 'newTab'),
            availableSizePx: 500, minimumFirstSizePx: 320, minimumSecondSizePx: 320,
        });
        expect(refused).toBe(initial);

        const closed = reduceWorkspaceState(initial, { type: 'closeTab', groupId: 'group:1', tabId: 'a', newTab: tab('new', 'newTab') });
        expect(closed.groups['group:1']?.tabIds).toEqual(['new']);
        expect(closed.tabs.a).toBeUndefined();
        expect(closed.tabs.new?.target.kind).toBe('newTab');
    });

    it('keeps each account and window layout isolated and treats a damaged snapshot as empty', () => {
        const one = workspaceLayoutScopeKey({ serverId: 'home', accountId: 'alice', windowId: 'window-a' });
        const two = workspaceLayoutScopeKey({ serverId: 'home', accountId: 'alice', windowId: 'window-b' });
        const otherAccount = workspaceLayoutScopeKey({ serverId: 'home', accountId: 'bob', windowId: 'window-a' });
        const state = createWorkspaceState(tab('a'));
        const layouts = writeScopedWorkspaceLayout({}, one, state);
        expect(readScopedWorkspaceLayout(layouts, one)).toEqual(state);
        expect(readScopedWorkspaceLayout(layouts, two)).toBeNull();
        expect(readScopedWorkspaceLayout(layouts, otherAccount)).toBeNull();
        expect(readScopedWorkspaceLayout({ [one]: { v: 1, tabs: {} } }, one)).toBeNull();
    });
});
