import { describe, expect, it } from 'vitest';
import { createWorkspaceState, reduceWorkspaceState } from './workspaceState';
import { applyWorkspaceTabIntents, collectWorkspaceTabIntents, reconcileWorkspaceSyncedTabs, emptyWorkspaceTabs } from './workspaceSyncedTabs';

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
});
