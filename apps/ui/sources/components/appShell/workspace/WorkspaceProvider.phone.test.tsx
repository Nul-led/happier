import * as React from 'react';
import { act } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderScreen, standardCleanup } from '@/dev/testkit';
import { createStorageModuleMock } from '@/dev/testkit/mocks/storage';
import { resolveCompactAppDestinations, type CompactAppDestination } from '../destinations/compactAppDestinationCatalog';
import { WorkspaceProvider } from './WorkspaceProvider';
import { usePhoneWorkspaceTabs, type PhoneWorkspaceTabs } from './usePhoneWorkspaceTabs';
import { useOptionalWorkspaceNavigation } from './WorkspaceNavigationContext';
import { projectWorkspaceSharedTabs } from './workspaceSyncedTabs';
import { useWorkspaceOpenActions, WORKSPACE_OPEN_IN_NEW_TAB_ID } from './useWorkspaceOpenActions';
import { createWorkspaceState, reduceWorkspaceState } from './workspaceState';
import { workspaceLayoutScopeKey } from './workspacePersistence';

const boundary = vi.hoisted(() => ({
    layouts: {} as Record<string, unknown>,
    pathname: '/session/A1',
    params: { serverId: 'home-a', mobileSurface: 'git' } as Record<string, string>,
    pushes: [] as string[],
    replaces: [] as string[],
}));
// Native phones have no browser History; Expo's stack is the platform navigation boundary.
vi.mock('react-native', async () => {
    const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
    return createReactNativeWebMock({ Platform: { OS: 'ios', select: (values: Record<string, unknown>) => values.ios ?? values.default } });
});
vi.mock('react-native-unistyles', async () => {
    const { createUnistylesMock } = await import('@/dev/testkit/mocks/unistyles');
    return createUnistylesMock();
});
vi.mock('expo-router', async () => {
    const { createExpoRouterMock } = await import('@/dev/testkit/mocks/router');
    return createExpoRouterMock({ pathname: () => boundary.pathname, params: () => boundary.params, router: {
        push: (href: unknown) => { boundary.pushes.push(String(href)); },
        replace: (href: unknown) => { boundary.replaces.push(String(href)); },
    } }).module;
});
vi.mock('@/sync/domains/state/storage', importOriginal => createStorageModuleMock({ importOriginal, overrides: {
    useIsDataReady: () => true,
    useActiveServerAccountScope: () => ({ serverId: 'home-a', accountId: 'alice' }),
    useLocalSettingMutable: (key: string) => {
        if (key !== 'workspaceLayoutV1') throw new Error(`Unexpected setting ${key}`);
        // The workspace layout setting is the only device-local value this owner reads.
        return [boundary.layouts, (next: Record<string, unknown>) => { boundary.layouts = next; }] as never;
    },
} }));

const catalog = resolveCompactAppDestinations({ pages: [], builtins: {
    externalSessions: false, inbox: false, workflows: false, friends: false,
} });

function Probe() {
    const tabs = usePhoneWorkspaceTabs();
    const workspace = useOptionalWorkspaceNavigation();
    const rowMenu = useWorkspaceOpenActions('/session/B7?serverId=home-a');
    return React.createElement('PhoneTabs', { tabs, workspace, rowMenu });
}

describe('workspace owner on a phone', () => {
    afterEach(() => {
        boundary.layouts = {}; boundary.pathname = '/session/A1'; boundary.params = { serverId: 'home-a', mobileSurface: 'git' };
        boundary.pushes = []; boundary.replaces = []; standardCleanup();
    });

    const render = () => renderScreen(<WorkspaceProvider enabled={false} phone catalog={catalog}><Probe /></WorkspaceProvider>);
    const read = (screen: Awaited<ReturnType<typeof render>>) => screen.root.findByType('PhoneTabs').props as {
        tabs: PhoneWorkspaceTabs; workspace: NonNullable<ReturnType<typeof useOptionalWorkspaceNavigation>>;
        rowMenu: ReturnType<typeof useWorkspaceOpenActions>;
    };
    const rows = (tabs: PhoneWorkspaceTabs) => tabs.tabs.map((tab) => tab.panes.map((pane) =>
        `${pane.target.kind}:${pane.target.params.id ?? ''}${pane.preview ? ' (preview)' : ''}`).join('+'));

    it.each(['catalog', 'explicit'] as const)('keeps unknown-route hydration read-only without losing an explicit phone open: %s', async (arrival) => {
        boundary.pathname = '/plugins/acme.notes/notes'; boundary.params = {};
        const layouts = boundary.layouts;
        const screen = await render();
        expect(boundary.layouts).toBe(layouts);
        if (arrival === 'catalog') {
            const page = { id: 'acme.notes.notes', kind: 'plugin', container: 'appPage',
            destination: { pluginId: 'acme.notes', localId: 'notes' }, title: 'Notes', icon: 'file',
                order: 40, placement: { kind: 'rail', region: 'plugins' }, activation: 'navigate',
                availability: 'available', routePath: '/plugins/acme.notes/notes' } satisfies CompactAppDestination;
            await act(async () => {
                screen.update(<WorkspaceProvider enabled={false} phone catalog={[...catalog, page]}><Probe /></WorkspaceProvider>);
            });
            expect(read(screen).tabs.tabs.flatMap(tab => tab.panes).some(pane => pane.target.kind === page.id)).toBe(true);
            expect(boundary.layouts).toBe(layouts);
        }
        await act(async () => {
            expect(read(screen).workspace.phone?.openHref('/session/A3?serverId=home-a', 'newTab')).toBe(true);
        });
        expect(boundary.layouts).not.toBe(layouts);
        expect(Object.values(boundary.layouts)[0]).toEqual(read(screen).workspace.state);
        await screen.unmount();
    });

    it('persists explicit activation of a restored phone tab before the initial route is admitted', async () => {
        boundary.pathname = '/plugins/acme.notes/notes'; boundary.params = {};
        const tab = (id: string) => ({ id, target: { kind: 'session', params: { id, serverId: 'home-a' } }, pinned: false, preview: false });
        const initial = createWorkspaceState(tab('A1'));
        const groupId = initial.focusedGroupId;
        const opened = reduceWorkspaceState(initial, { type: 'openTab', groupId, tab: tab('A2') });
        const saved = reduceWorkspaceState(opened, { type: 'activateTab', groupId, tabId: 'A1' });
        boundary.layouts = { [workspaceLayoutScopeKey({ serverId: 'home-a', accountId: 'alice', windowId: 'main' })]: saved };
        const layouts = boundary.layouts;
        const screen = await render();
        await act(async () => { read(screen).tabs.activate('A2'); });
        boundary.pathname = '/session/A2'; boundary.params = { serverId: 'home-a' };
        await act(async () => { screen.update(<WorkspaceProvider enabled={false} phone catalog={catalog}><Probe /></WorkspaceProvider>); });
        expect(read(screen).workspace.state.groups[groupId].activeTabId).toBe('A2');
        expect(boundary.layouts).not.toBe(layouts);
        expect(Object.values(boundary.layouts)[0]).toEqual(read(screen).workspace.state);
        await screen.unmount();
    });

    it('shows what the phone opened as its one preview tab, never synced and never taking over the stack', async () => {
        const screen = await render();
        expect(read(screen).tabs.available).toBe(true);
        expect(read(screen).workspace.active).toBe(false);
        // The tool on screen is the phone's presentation, not the tab's identity.
        expect(rows(read(screen).tabs)).toEqual(['session:A1 (preview)']);
        expect(read(screen).tabs.activeTabId).toBe(read(screen).tabs.tabs[0].id);

        boundary.pathname = '/session/A2'; boundary.params = { serverId: 'home-a' };
        await act(async () => { screen.update(<WorkspaceProvider enabled={false} phone catalog={catalog}><Probe /></WorkspaceProvider>); });
        expect(rows(read(screen).tabs)).toEqual(['session:A2 (preview)']);

        // The Sessions list is the phone's own main tab, not something to keep open.
        boundary.pathname = '/'; boundary.params = {};
        await act(async () => { screen.update(<WorkspaceProvider enabled={false} phone catalog={catalog}><Probe /></WorkspaceProvider>); });
        expect(rows(read(screen).tabs)).toEqual(['session:A2 (preview)']);
        expect(read(screen).tabs.activeTabId).toBeNull();

        expect(projectWorkspaceSharedTabs(read(screen).workspace.state).order).toEqual([]);
        expect(boundary.replaces).toEqual([]);
        expect(boundary.pushes).toEqual([]);
    });

    it('keeps "Open in new tab" as a synced tab, switches tabs without history, and closes through the owner', async () => {
        boundary.pathname = '/'; boundary.params = {};
        const screen = await render();
        const rerender = async (pathname: string, params: Record<string, string>) => {
            boundary.pathname = pathname; boundary.params = params;
            await act(async () => { screen.update(<WorkspaceProvider enabled={false} phone catalog={catalog}><Probe /></WorkspaceProvider>); });
        };
        expect(rows(read(screen).tabs)).toEqual([]);
        // From the list (a main tab) the open pushes, so Back returns to the list.
        await act(async () => {
            expect(read(screen).workspace.phone?.openHref('/session/A3?serverId=home-a', 'newTab')).toBe(true);
        });
        expect(boundary.pushes).toEqual(['/session/A3?serverId=home-a']);
        await rerender('/session/A3', { serverId: 'home-a' });
        expect(rows(read(screen).tabs)).toEqual(['session:A3']);
        const shared = projectWorkspaceSharedTabs(read(screen).workspace.state);
        expect(shared.order.map((id) => shared.tabsById[id].target.params.id)).toEqual(['A3']);

        // Something opened without "new tab" is the preview, last in the rail.
        await rerender('/session/A1', { serverId: 'home-a', mobileSurface: 'chat' });
        expect(rows(read(screen).tabs)).toEqual(['session:A3', 'session:A1 (preview)']);
        const kept = read(screen).tabs.tabs[0];
        await act(async () => { read(screen).tabs.activate(kept.id); });
        // A tab switch replaces the screen: Back still leads to the list.
        expect(boundary.replaces).toEqual(['/session/A3?serverId=home-a']);

        await act(async () => { read(screen).tabs.close(kept.id); });
        expect(rows(read(screen).tabs)).toEqual(['session:A1 (preview)']);
        expect(projectWorkspaceSharedTabs(read(screen).workspace.state).order).toEqual([]);
    });

    it('offers a session row exactly "Open in new tab" on a phone (splits need a canvas the phone does not have)', async () => {
        boundary.pathname = '/'; boundary.params = {};
        const screen = await render();
        expect(read(screen).rowMenu.items.map((item) => item.id)).toEqual([WORKSPACE_OPEN_IN_NEW_TAB_ID]);
        await act(async () => { expect(read(screen).rowMenu.select(WORKSPACE_OPEN_IN_NEW_TAB_ID)).toBe(true); });
        expect(boundary.pushes).toEqual(['/session/B7?serverId=home-a']);
        expect(rows(read(screen).tabs)).toEqual(['session:B7']);
    });
});
