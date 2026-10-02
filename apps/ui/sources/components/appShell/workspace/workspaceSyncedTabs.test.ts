import { describe, expect, it } from 'vitest';
import { createWorkspaceState, reduceWorkspaceState } from './workspaceState';
import { applyWorkspaceTabIntents, collectWorkspaceTabIntents, reconcileWorkspaceSyncedTabs, emptyWorkspaceTabs } from './workspaceSyncedTabs';
import { parseWorkspaceLayout, serializeWorkspaceLayout } from './workspacePersistence';

const tab = (id: string) => ({ id, target: { kind: 'session', params: { id, serverId: 'home' } }, pinned: false, preview: false });
const record = (...ids: string[]) => ({ v: 1 as const, tabsById: Object.fromEntries(ids.map(id => [id, tab(id)])), order: ids, pairs: [] });

describe('workspace synced tab intent owner', () => {
    it('rebases a close and a reorder without dropping a concurrent open or resurrecting a closed tab', () => {
        const winner = record('a', 'c', 'remote');
        const next = applyWorkspaceTabIntents(winner, [
            { type: 'close', tabId: 'a' }, { type: 'patch', tabId: 'b', pinned: true },
            { type: 'move', tabId: 'c', beforeId: 'remote' }, { type: 'open', tab: tab('local') },
        ]);
        expect(next.order).toEqual(['c', 'remote', 'local']);
        expect(next.tabsById.b).toBeUndefined();
        expect(Object.keys(next.tabsById).sort()).toEqual(['c', 'local', 'remote']);
        const paired = applyWorkspaceTabIntents(next, [{ type: 'pairs', pairs: [['c', 'c'], ['c', 'remote']] }]);
        expect(paired.pairs).toEqual([['c', 'remote']]);
    });

    it('preserves focus, geometry, local previews and reference identity for duplicate remote echoes', () => {
        let local = createWorkspaceState(tab('a'));
        local = reduceWorkspaceState(local, { type: 'openTab', groupId: 'group:1', tab: { ...tab('preview'), preview: true } });
        const root = local.root;
        const synced = reconcileWorkspaceSyncedTabs(local, record('a', 'remote'), () => 'blank');
        expect(synced.root).toBe(root);
        expect(synced.groups['group:1'].activeTabId).toBe('preview');
        expect(synced.tabs.preview).toBe(local.tabs.preview);
        expect(synced.groups['group:1'].tabIds).toEqual(['a', 'remote', 'preview']);
        expect(reconcileWorkspaceSyncedTabs(synced, record('a', 'remote'), () => 'blank')).toBe(synced);
    });

    it('publishes only intentional tab mutations and never focus, resize, preview or titles', () => {
        const before = createWorkspaceState(tab('a'));
        const preview = reduceWorkspaceState(before, { type: 'openTab', groupId: 'group:1', tab: { ...tab('p'), preview: true } });
        expect(collectWorkspaceTabIntents(before, preview)).toEqual([]);
        const next = reduceWorkspaceState(before, { type: 'openTab', groupId: 'group:1', tab: tab('b') });
        const intents = collectWorkspaceTabIntents(before, next);
        expect(applyWorkspaceTabIntents(emptyWorkspaceTabs(), intents).order).toEqual(['b']);
        expect(collectWorkspaceTabIntents(next, reduceWorkspaceState(next, { type: 'activateTab', groupId: 'group:1', tabId: 'a' }))).toEqual([]);
        expect(collectWorkspaceTabIntents(next, reduceWorkspaceState(next, { type: 'setFallbackTitle', tabId: 'b', title: 'Private name' }))).toEqual([]);
    });

    it.each(['preview', 'newTab'])('keeps a reordered local %s in its saved position after reload and a shared echo', kind => {
        let local = createWorkspaceState(tab('a'));
        local = reduceWorkspaceState(local, { type: 'openTab', groupId: 'group:1', tab: tab('b') });
        local = reduceWorkspaceState(local, { type: 'openTab', groupId: 'group:1', tab: {
            ...tab('local'), preview: kind === 'preview', target: kind === 'newTab' ? { kind: 'newTab', params: {} } : tab('local').target,
        } });
        const reordered = reduceWorkspaceState(local, { type: 'reorderTab', groupId: 'group:1', tabId: 'local', index: 1 });
        expect(collectWorkspaceTabIntents(local, reordered)).toEqual([]);
        const restored = parseWorkspaceLayout(serializeWorkspaceLayout(reordered));
        expect(restored).not.toBeNull();
        const echoed = reconcileWorkspaceSyncedTabs(restored!, record('a', 'b'), () => 'blank');
        expect(echoed.groups['group:1'].tabIds).toEqual(['a', 'local', 'b']);
        expect(echoed.groups['group:1'].activeTabId).toBe('local');
        expect(echoed.tabs.local).toEqual(reordered.tabs.local);
        expect(echoed).toBe(restored);
        const updated = reconcileWorkspaceSyncedTabs(echoed, record('b', 'a', 'remote'), () => 'blank');
        expect(updated.groups['group:1'].tabIds).toEqual(['b', 'local', 'a', 'remote']);
        expect(updated.groups['group:1'].activeTabId).toBe('local');
    });
});
