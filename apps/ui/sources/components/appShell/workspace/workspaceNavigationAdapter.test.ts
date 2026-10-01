import { describe, expect, it } from 'vitest';
import { resolveCompactAppDestinations } from '../destinations/compactAppDestinationCatalog';
import { createWorkspaceState, reduceWorkspaceState } from './workspaceState';
import { createWorkspaceNavigationAdapter } from './workspaceNavigationAdapter';
import { installPanelCommonModuleMocks } from '@/components/ui/panels/panelTestHelpers';

installPanelCommonModuleMocks();

function harness(pages: Parameters<typeof resolveCompactAppDestinations>[0]['pages'] = []) {
    let state = createWorkspaceState({ id: 'A', target: { kind: 'session', params: { id: 'A1', serverId: 'home-a' } }, pinned: false, preview: false });
    const catalog = resolveCompactAppDestinations({ builtins: { externalSessions: false, inbox: true, workflows: true, friends: false }, pages });
    const commits: Array<{ href: string; entry: { tabId: string; groupId: string; target: typeof state.tabs.A.target }; replace: boolean }> = [];
    let id = 0;
    const adapter = createWorkspaceNavigationAdapter({
        getState: () => state, getCatalog: () => catalog,
        dispatch: (action) => { state = reduceWorkspaceState(state, action); },
        transport: { commit: (href, entry, replace) => { commits.push({ href, entry, replace }); } },
        createId: () => `generated:${++id}`, onChange: () => {},
    });
    const active = () => state.tabs[state.groups[state.focusedGroupId].activeTabId];
    return { adapter, commits, active, state: () => state };
}

describe('workspace navigation adapter', () => {
    it('promotes an existing preview through new-tab intent without duplicating its identity or pinning it', () => {
        const h = harness();
        h.adapter.openHref('/session/B1?serverId=home-b');
        const previewId = h.active().id;
        expect(h.active().preview).toBe(true);
        h.adapter.openHref('/session/B1?serverId=home-b', { mode: 'newTab' });
        expect(h.active().id).toBe(previewId);
        expect(h.active()).toMatchObject({ pinned: false, preview: false });
        expect(Object.values(h.state().tabs).filter((tab) => tab.target.params.id === 'B1')).toHaveLength(1);
        h.adapter.openHref('/session/C1?serverId=home-c');
        const explicitId = h.active().id;
        h.adapter.openHref('/session/C1?serverId=home-c', { tabId: explicitId, mode: 'newTab' });
        expect(h.active()).toMatchObject({ id: explicitId, pinned: false, preview: false });
        h.adapter.openHref('/session/D1?serverId=home-d');
        expect(h.state().tabs[previewId].target.params.id).toBe('B1');
        expect(h.state().tabs[explicitId].target.params.id).toBe('C1');
        h.adapter.openHref('/session/B1?serverId=home-b', { mode: 'newTab' });
        expect(h.active().id).not.toBe(previewId);
        expect(Object.values(h.state().tabs).filter((tab) => tab.target.params.id === 'B1')).toHaveLength(2);
    });

    it.each([false, true])('restores a singleton into its existing visible group after the historical tab was closed: %s', (closed) => {
        const h = harness([{
            id: 'plugin:acme.notes:notes', pluginId: 'acme.notes', descriptorId: 'notes', localId: 'notes',
            label: 'Notes', icon: 'note', order: 40, disabledReason: null,
            placement: {} as NonNullable<Parameters<typeof resolveCompactAppDestinations>[0]['pages'][number]>['placement'],
            routePath: '/plugins/acme.notes/notes',
        }]);
        h.adapter.initialize('/session/A1?serverId=home-a');
        h.adapter.openHref('/plugins/acme.notes/notes/first');
        h.adapter.openHref('/plugins/acme.notes/notes/first', { mode: 'newTab' });
        expect(h.active().preview).toBe(false);
        const historicalTabId = h.active().id;
        h.adapter.openHref('/session/A2?serverId=home-a', { tabId: historicalTabId });
        if (closed) h.adapter.closeTab('group:1', historicalTabId);
        h.adapter.openHref('/session/B1?serverId=home-b', { mode: 'splitRight',
            availableSizePx: 1000, minimumFirstSizePx: 320, minimumSecondSizePx: 320 });
        h.adapter.openHref('/plugins/acme.notes/notes/second', { mode: 'newTab' });
        const liveTabId = h.active().id;
        const liveGroupId = h.state().focusedGroupId;
        while (h.adapter.history.index > 1) h.adapter.step(-1);
        expect(h.active()).toMatchObject({ id: liveTabId, target: { params: { subPath: 'first' } } });
        expect(h.state().focusedGroupId).toBe(liveGroupId);
        expect(Object.values(h.state().tabs).filter((tab) => tab.target.kind === 'plugin:acme.notes:notes')).toHaveLength(1);
        expect(Object.keys(h.state().groups)).toHaveLength(2);
        expect(h.commits.at(-1)?.entry.tabId).toBe(liveTabId);
        h.adapter.step(1);
        expect(h.active().target.params.id).toBe('A2');
        expect(h.state().focusedGroupId).toBe('group:1');
    });

    it('rejects an explicit missing tab without opening a different tab', () => {
        const h = harness();
        h.adapter.initialize('/session/A1?serverId=home-a');
        const before = h.state();
        expect(h.adapter.openHref('/session/B1?serverId=home-b', { tabId: 'missing' })).toBe(false);
        expect(h.state()).toBe(before);
        expect(h.adapter.history.entries).toHaveLength(1);
    });
    it('updates background params without stealing focus or overwriting the focused URL', () => {
        const h = harness();
        h.adapter.initialize('/session/A1?serverId=home-a');
        h.adapter.openHref('/session/B1?serverId=home-b', { mode: 'newTab' });
        const visits = h.commits.length;
        h.adapter.setParams('A', { right: 'files', unused: undefined });
        expect(h.active().target.params.id).toBe('B1');
        expect(h.state().tabs.A.target.params).toEqual({ id: 'A1', serverId: 'home-a', right: 'files' });
        expect(h.commits).toHaveLength(visits);
        h.adapter.activateTab('group:1', 'A');
        h.adapter.setParams('A', { right: undefined, anchor: 'line-2' });
        expect(h.commits.at(-1)).toMatchObject({ href: '/session/A1?serverId=home-a#line-2', replace: true });
    });

    it('keeps plugin app pages singleton across reopen, new-tab and split intents', () => {
        const h = harness([{
            id: 'plugin:acme.notes:notes', pluginId: 'acme.notes', descriptorId: 'notes', localId: 'notes',
            label: 'Notes', icon: 'note', order: 40, disabledReason: null,
            placement: {} as NonNullable<Parameters<typeof resolveCompactAppDestinations>[0]['pages'][number]>['placement'],
            routePath: '/plugins/acme.notes/notes',
        }]);
        h.adapter.initialize('/session/A1?serverId=home-a');
        h.adapter.openHref('/plugins/acme.notes/notes/first', { mode: 'newTab' });
        const pluginTabId = h.active().id;
        h.adapter.openHref('/session/A1?serverId=home-a');
        h.adapter.openHref('/plugins/acme.notes/notes/second', { mode: 'splitRight',
            availableSizePx: 1000, minimumFirstSizePx: 320, minimumSecondSizePx: 320 });
        expect(h.active().id).toBe(pluginTabId);
        expect(h.active().target.params.subPath).toBe('second');
        expect(Object.values(h.state().tabs).filter((tab) => tab.target.kind === 'plugin:acme.notes:notes')).toHaveLength(1);
        expect(Object.keys(h.state().groups)).toHaveLength(1);
        h.adapter.openHref('/plugins/acme.notes/notes/third', { tabId: 'A' });
        expect(h.active().id).toBe(pluginTabId);
        expect(h.state().tabs.A.target.kind).toBe('session');
        expect(Object.values(h.state().tabs).filter((tab) => tab.target.kind === 'plugin:acme.notes:notes')).toHaveLength(1);
    });
    it('does not traverse beyond the known global history', () => {
        const h = harness();
        h.adapter.initialize('/session/A1?serverId=home-a');
        h.adapter.step(-1);
        expect(h.adapter.history.index).toBe(0);
        expect(h.commits).toHaveLength(1);
    });
    it('projects one history including tab switches and restores A2/A1/A2/B1', () => {
        const h = harness();
        h.adapter.initialize('/session/A1?serverId=home-a');
        h.adapter.openHref('/session/A2?serverId=home-a', { tabId: 'A' });
        h.adapter.openHref('/session/B1?serverId=home-b', { mode: 'newTab' });
        for (const [direction, id, serverId] of [[-1, 'A2', 'home-a'], [-1, 'A1', 'home-a'], [1, 'A2', 'home-a'], [1, 'B1', 'home-b']] as const) {
            h.adapter.step(direction);
            expect(h.active().target.params).toEqual({ id, serverId });
            expect(h.commits.at(-1)?.href).toBe(`/session/${id}?serverId=${serverId}`);
        }
        expect(h.adapter.history.entries.map((entry) => entry.target.params.id)).toEqual(['A1', 'A2', 'B1']);
    });

    it('reopens closed history tabs as previews and applies a reload URL after restored layout', () => {
        const h = harness();
        h.adapter.initialize('/session/A1?serverId=home-a');
        h.adapter.openHref('/settings/appearance', { mode: 'newTab' });
        h.adapter.closeTab('group:1', 'A');
        h.adapter.step(-1);
        expect(h.active()).toMatchObject({ id: 'A', preview: true, target: { params: { id: 'A1', serverId: 'home-a' } } });
        h.adapter.openHref('/settings/account', { replace: true });
        expect(h.active().target).toEqual({ kind: 'settings', params: { pageId: 'account' } });
        expect(h.adapter.canGoForward).toBe(true);
        h.adapter.step(1);
        expect(h.active().target).toEqual({ kind: 'settings', params: { pageId: 'appearance' } });
    });

    it('uses the exact browser entry position when a destination was revisited', () => {
        const h = harness();
        h.adapter.initialize('/session/A1?serverId=home-a');
        h.adapter.openHref('/session/A2?serverId=home-a', { tabId: 'A' });
        h.adapter.openHref('/session/A1?serverId=home-a', { tabId: 'A' });
        const last = h.adapter.history.entries[2];
        h.adapter.acceptUrl('/session/A1?serverId=home-a', last, 2);
        expect(h.adapter.history.index).toBe(2);
        h.adapter.step(-1);
        expect(h.active().target.params.id).toBe('A2');
    });

    it('leaves the layout and history intact when a measured split cannot fit', () => {
        const h = harness();
        h.adapter.initialize('/session/A1?serverId=home-a');
        const before = h.state();
        expect(h.adapter.openHref('/settings/appearance', {
            mode: 'splitRight', availableSizePx: 400,
            minimumFirstSizePx: 300, minimumSecondSizePx: 300,
        })).toBe(false);
        expect(h.state()).toBe(before);
        expect(h.adapter.history.entries).toHaveLength(1);
    });

    it('does not push another browser entry when accepting an external deep link', () => {
        const h = harness();
        h.adapter.initialize('/session/A1?serverId=home-a');
        const commitsBefore = h.commits.length;
        h.adapter.acceptUrl('/settings/appearance');
        expect(h.active().target).toEqual({ kind: 'settings', params: { pageId: 'appearance' } });
        expect(h.commits).toHaveLength(commitsBefore);
    });

    it('opens a server-qualified destination in a measured split when it fits', () => {
        const h = harness();
        h.adapter.initialize('/session/A1?serverId=home-a');
        expect(h.adapter.openHref('/session/B1?serverId=home-b', {
            mode: 'splitRight', availableSizePx: 900,
            minimumFirstSizePx: 300, minimumSecondSizePx: 300,
        })).toBe(true);
        expect(Object.keys(h.state().groups)).toHaveLength(2);
        expect(h.active().target.params).toEqual({ id: 'B1', serverId: 'home-b' });
        h.adapter.step(-1);
        expect(h.state().focusedGroupId).toBe('group:1');
        expect(h.active().target.params).toEqual({ id: 'A1', serverId: 'home-a' });
    });
});
