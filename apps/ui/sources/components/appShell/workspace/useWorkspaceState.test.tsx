import { afterEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react-test-renderer';

import { renderHook, standardCleanup } from '@/dev/testkit';
import { createStorageModuleStub } from '@/dev/testkit/mocks/storage';
import { createWorkspaceState } from './workspaceState';
import { workspaceLayoutScopeKey } from './workspacePersistence';

const initialTab = {
    id: 'new', target: { kind: 'newTab', params: {} }, pinned: false, preview: true,
};
const storedTab = {
    id: 'session-a', target: { kind: 'session', params: { id: 'session-a', serverId: 'home' } },
    pinned: true, preview: false,
};

const storageState = vi.hoisted(() => ({
    ready: false,
    scope: { serverId: 'home', accountId: 'alice' },
    layouts: {} as Record<string, unknown>,
}));
const saveLayouts = vi.hoisted(() => vi.fn((next: Record<string, unknown>) => { storageState.layouts = next; }));

vi.mock('@/sync/domains/state/storage', () => createStorageModuleStub({
    useIsDataReady: () => storageState.ready,
    useActiveServerAccountScope: () => storageState.scope,
    useLocalSettingMutable: (key: string) => {
        if (key !== 'workspaceLayoutV1') throw new Error(`Unexpected setting: ${key}`);
        return [storageState.layouts, saveLayouts] as const;
    },
}));

describe('useWorkspaceState', () => {
    it('imports shared membership without publishing, stealing focus or losing local restore', async () => {
        storageState.ready = true;
        const { useWorkspaceState } = await import('./useWorkspaceState');
        const hook = await renderHook(() => useWorkspaceState({ initialTab, windowId: 'window-a' }));
        act(() => hook.getCurrent().dispatch({ type: 'openTab', groupId: 'group:1', tab: storedTab }));
        const root = hook.getCurrent().getState().root;
        act(() => hook.getCurrent().applySharedRecord({ v: 1, tabsById: {
            'session-a': { id: storedTab.id, target: storedTab.target, pinned: true },
            remote: { id: 'remote', target: { kind: 'futurePlugin', params: { page: 'opaque' } }, pinned: false },
        }, order: ['session-a', 'remote'], pairs: [] }));
        expect(hook.getCurrent().state.groups['group:1'].activeTabId).toBe('session-a');
        expect(hook.getCurrent().state.root).toBe(root);
        expect(hook.getCurrent().state.tabs.remote.target.kind).toBe('futurePlugin');
        const scopeKey = workspaceLayoutScopeKey({ ...storageState.scope, windowId: 'window-a' });
        expect((storageState.layouts[scopeKey] as ReturnType<typeof createWorkspaceState>).tabs.remote).toBeDefined();
        const before = saveLayouts.mock.calls.length;
        act(() => hook.getCurrent().applySharedRecord({ v: 1, tabsById: {
            'session-a': { id: storedTab.id, target: storedTab.target, pinned: true },
            remote: { id: 'remote', target: { kind: 'futurePlugin', params: { page: 'opaque' } }, pinned: false },
        }, order: ['session-a', 'remote'], pairs: [] }));
        expect(saveLayouts.mock.calls.length).toBe(before);
        await hook.unmount();
    });
    it('exposes the synchronous owner state across composed intents before React renders', async () => {
        storageState.ready = true;
        const { useWorkspaceState } = await import('./useWorkspaceState');
        const hook = await renderHook(() => useWorkspaceState({ initialTab, windowId: 'window-a' }));
        act(() => {
            const owner = hook.getCurrent();
            owner.dispatch({ type: 'openTab', groupId: 'group:1', tab: storedTab });
            expect(owner.getState().groups['group:1'].activeTabId).toBe('session-a');
            owner.dispatch({ type: 'setTarget', tabId: 'session-a', target: { kind: 'session', params: { id: 'session-b', serverId: 'home-b' } } });
            expect(owner.getState().tabs['session-a'].target.params).toEqual({ id: 'session-b', serverId: 'home-b' });
        });
        await hook.unmount();
    });
    afterEach(() => {
        storageState.ready = false;
        storageState.scope = { serverId: 'home', accountId: 'alice' };
        storageState.layouts = {};
        saveLayouts.mockClear();
        standardCleanup();
    });

    it('hydrates the account/window layout without writing on mount and persists only an intent', async () => {
        const scopeKey = workspaceLayoutScopeKey({ ...storageState.scope, windowId: 'window-a' });
        const { useWorkspaceState } = await import('./useWorkspaceState');
        const hook = await renderHook(() => useWorkspaceState({ initialTab, windowId: 'window-a' }));
        expect(hook.getCurrent().state.tabs.new).toBeTruthy();
        expect(saveLayouts).not.toHaveBeenCalled();

        storageState.ready = true;
        storageState.layouts = { [scopeKey]: createWorkspaceState(storedTab) };
        await hook.rerender(undefined);
        expect(hook.getCurrent().state.tabs['session-a']).toBeTruthy();
        expect(saveLayouts).not.toHaveBeenCalled();

        act(() => hook.getCurrent().dispatch({ type: 'openTab', groupId: 'group:1', tab: initialTab }));
        expect(saveLayouts).toHaveBeenCalledTimes(1);
        expect((storageState.layouts[scopeKey] as ReturnType<typeof createWorkspaceState>).groups['group:1']?.tabIds).toEqual(['session-a', 'new']);
        await hook.unmount();
    });

    it('never presents a previous Account tab while switching Account scopes', async () => {
        storageState.ready = true;
        const aliceScopeKey = workspaceLayoutScopeKey({ ...storageState.scope, windowId: 'window-a' });
        storageState.layouts = { [aliceScopeKey]: createWorkspaceState(storedTab) };
        const observed: Array<{ accountId: string; tabIds: string[]; ready: boolean }> = [];
        const { useWorkspaceState } = await import('./useWorkspaceState');
        const hook = await renderHook(() => {
            const result = useWorkspaceState({ initialTab, windowId: 'window-a' });
            observed.push({ accountId: storageState.scope.accountId, tabIds: Object.keys(result.state.tabs), ready: result.isReady });
            return result;
        });
        expect(hook.getCurrent().state.tabs['session-a']).toBeTruthy();

        storageState.scope = { serverId: 'home', accountId: 'bob' };
        await hook.rerender(undefined);
        expect(observed.filter((entry) => entry.accountId === 'bob').every((entry) => !entry.tabIds.includes('session-a'))).toBe(true);
        expect(hook.getCurrent().state.tabs.new).toBeTruthy();
        expect(saveLayouts).not.toHaveBeenCalled();
        await hook.unmount();
    });
});
