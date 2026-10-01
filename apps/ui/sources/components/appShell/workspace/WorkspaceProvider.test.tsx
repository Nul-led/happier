import * as React from 'react';
import { act } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { invokeTestInstanceHandler, renderScreen, standardCleanup } from '@/dev/testkit';
import { WORKSPACE_ACTION_OUTPUT_SCHEMAS } from '@happier-dev/protocol';
import { createStorageModuleStub } from '@/dev/testkit/mocks/storage';
import { resolveCompactAppDestinations } from '../destinations/compactAppDestinationCatalog';
import { DestinationInstanceHost, useDestinationParams, useDestinationRouter } from './DestinationInstanceHost';
import type { WorkspaceNavigationContextValue } from './WorkspaceNavigationContext';
import { WorkspaceProvider } from './WorkspaceProvider';
import { WorkspaceShell } from './WorkspaceShell';
import { captureMountedWorkspaceAction, invokeWorkspaceAction } from './workspaceActionRuntime';
import { clearActiveUnsavedChangesGuard, setActiveUnsavedChangesGuard } from '@/utils/navigation/runGuardedNavigation';

const boundary = vi.hoisted(() => ({ layouts: {} as Record<string, unknown>, mirrors: [] as string[], scope: { serverId: 'home-a', accountId: 'alice' } }));
// Native has no browser History; Expo is the genuine platform URL boundary here.
vi.mock('react-native', async () => {
    const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
    return createReactNativeWebMock({ Platform: { OS: 'ios', select: (values: Record<string, unknown>) => values.ios ?? values.default } });
});
vi.mock('react-native-unistyles', async () => {
    const { createUnistylesMock } = await import('@/dev/testkit/mocks/unistyles');
    return createUnistylesMock();
});
vi.mock('@expo/vector-icons', async () => {
    const { createExpoVectorIconsMock } = await import('@/dev/testkit/mocks/icons');
    return createExpoVectorIconsMock();
});
vi.mock('expo-router', async () => {
    const { createExpoRouterMock } = await import('@/dev/testkit/mocks/router');
    return createExpoRouterMock({ pathname: '/session/A1', params: { id: 'A1', serverId: 'home-a' },
        router: { replace: (href: unknown) => { boundary.mirrors.push(String(href)); } } }).module;
});
vi.mock('@/sync/domains/state/storage', () => createStorageModuleStub({
    useIsDataReady: () => true,
    useActiveServerAccountScope: () => boundary.scope,
    useLocalSettingMutable: (key: string) => {
        if (key !== 'workspaceLayoutV1') throw new Error(`Unexpected setting ${key}`);
        return [boundary.layouts, (next: Record<string, unknown>) => { boundary.layouts = next; }] as const;
    },
}));

function HostedProbe() {
    const params = useDestinationParams<{ id?: string; serverId?: string }>();
    const router = useDestinationRouter();
    return React.createElement('HostedIdentity', { params, next: () => router.push('/session/A2?serverId=home-a') });
}

function NavigationProbe(props: Readonly<{ navigation: WorkspaceNavigationContextValue }>) {
    const state = props.navigation.state;
    const group = state.groups[state.focusedGroupId];
    const tab = state.tabs[group.activeTabId];
    return <>
        {React.createElement('WorkspaceOwner', { navigation: props.navigation })}
        <DestinationInstanceHost tabId={tab.id} ref={tab.target} pathname={`/session/${tab.target.params.id}`}
            focused visible navigation={props.navigation.navigationForTab(tab.id)}><HostedProbe /></DestinationInstanceHost>
    </>;
}

describe('consumed workspace navigation owner', () => {
    afterEach(() => { boundary.layouts = {}; boundary.mirrors = []; boundary.scope = { serverId: 'home-a', accountId: 'alice' }; clearActiveUnsavedChangesGuard(); standardCleanup(); });
    it('does not carry a guarded Action into the replacement Account workspace', async () => {
        const catalog = resolveCompactAppDestinations({ pages: [], builtins: {
            externalSessions: false, inbox: false, workflows: false, friends: false,
        } });
        const element = () => <WorkspaceProvider enabled catalog={catalog}>
            {(navigation) => React.createElement('WorkspaceOwner', { navigation })}
        </WorkspaceProvider>;
        const screen = await renderScreen(element());
        const mounted = captureMountedWorkspaceAction();
        let settleDecision!: (value: 'discard') => void;
        setActiveUnsavedChangesGuard({ isDirtyRef: { current: true }, tag: 'account-change-test',
            requestDecision: () => new Promise((resolve) => { settleDecision = resolve; }) });
        const pending = invokeWorkspaceAction({ actionId: 'workspace.tabs.open', input: {} });
        await act(async () => {
            boundary.scope = { serverId: 'home-a', accountId: 'bob' };
            screen.update(element());
        });
        await act(async () => { settleDecision('discard'); });
        expect(await pending).toMatchObject({ ok: false, errorCode: 'workspace_unavailable' });
        expect(await mounted?.({ actionId: 'workspace.tabs.list', input: {} })).toMatchObject({ ok: false, errorCode: 'workspace_unavailable' });
        const listed = WORKSPACE_ACTION_OUTPUT_SCHEMAS['workspace.tabs.list'].parse(await invokeWorkspaceAction({ actionId: 'workspace.tabs.list', input: {} }));
        expect(listed.tabs).toHaveLength(1);
    });
    it('splits an explicitly selected inactive-group tab through the mounted measured canvas and resizes that split', async () => {
        const catalog = resolveCompactAppDestinations({ pages: [], builtins: {
            externalSessions: false, inbox: false, workflows: false, friends: false,
        } });
        let showCanvas = false;
        const screen = await renderScreen(<WorkspaceProvider enabled catalog={catalog}>
            {(navigation) => <>{React.createElement('WorkspaceOwner', { navigation })}
                {showCanvas ? <WorkspaceShell catalog={catalog} /> : null}</>}
        </WorkspaceProvider>);
        const state = () => (screen.root.findByType('WorkspaceOwner').props.navigation as WorkspaceNavigationContextValue).state;
        const sourceGroupId = state().focusedGroupId;
        await act(async () => {
            const navigation = screen.root.findByType('WorkspaceOwner').props.navigation as WorkspaceNavigationContextValue;
            navigation.dispatch({ type: 'setTarget', tabId: state().groups[sourceGroupId].activeTabId, target: { kind: 'newTab', params: {} } });
            showCanvas = true;
            expect(await invokeWorkspaceAction({ actionId: 'workspace.tabs.open', input: {} })).toMatchObject({ ok: true });
        });
        const inactiveTabId = state().groups[sourceGroupId].activeTabId;
        await act(async () => {
            expect(await invokeWorkspaceAction({ actionId: 'workspace.tabs.open', input: {} })).toMatchObject({ ok: true });
            invokeTestInstanceHandler(screen.findByTestId('split-canvas-host'), 'onLayout', { nativeEvent: { layout: { width: 3000, height: 1000 } } });
        });
        await act(async () => {
            expect(await invokeWorkspaceAction({ actionId: 'workspace.split', input: { direction: 'right' } })).toMatchObject({ ok: true });
        });
        const previouslyFocusedGroupId = state().focusedGroupId;
        await act(async () => {
            expect(await invokeWorkspaceAction({ actionId: 'workspace.split', input: { tabId: inactiveTabId, groupId: previouslyFocusedGroupId, direction: 'down' } }))
                .toMatchObject({ ok: false, errorCode: 'workspace_group_mismatch' });
            expect(await invokeWorkspaceAction({ actionId: 'workspace.split', input: { tabId: inactiveTabId, direction: 'down' } })).toMatchObject({ ok: true });
        });
        const root = state().root;
        expect(root).toMatchObject({ kind: 'split', first: { kind: 'split', axis: 'column' }, second: { id: previouslyFocusedGroupId, kind: 'leaf' } });
        expect(state().groups[state().focusedGroupId].tabIds).toEqual([inactiveTabId]);
        if (root.kind !== 'split' || root.first.kind !== 'split') throw new Error('The source group must own the new split');
        const splitId = root.first.id;
        await act(async () => {
            expect(await invokeWorkspaceAction({ actionId: 'workspace.resize', input: { splitId, ratio: 0.65 } })).toMatchObject({ ok: true });
        });
        expect(state().root).toMatchObject({ first: { id: splitId, ratio: 0.65 } });
        const listed = WORKSPACE_ACTION_OUTPUT_SCHEMAS['workspace.tabs.list'].parse(await invokeWorkspaceAction({ actionId: 'workspace.tabs.list', input: {} }));
        expect(listed.tabs.find((tab) => tab.id === inactiveTabId)?.groupId).toBe(state().focusedGroupId);
        expect(listed.rootNodeId).toBe(state().root.id);
        expect(listed.splits).toEqual(expect.arrayContaining([expect.objectContaining({ id: splitId, axis: 'column', ratio: 0.65,
            firstNodeId: root.first.first.id, secondNodeId: root.first.second.id })]));
    });
    it('executes mounted Actions against real tabs, honors cancellation and retires with its owner', async () => {
        const catalog = resolveCompactAppDestinations({ pages: [], builtins: {
            externalSessions: false, inbox: false, workflows: false, friends: false,
        } });
        const screen = await renderScreen(<WorkspaceProvider enabled catalog={catalog}>
            {(navigation) => React.createElement('WorkspaceOwner', { navigation })}
        </WorkspaceProvider>);
        const navigation = () => screen.root.findByType('WorkspaceOwner').props.navigation as WorkspaceNavigationContextValue;
        const originalId = navigation().state.groups[navigation().state.focusedGroupId].activeTabId;
        const mounted = captureMountedWorkspaceAction();
        expect(mounted).not.toBeNull();
        await act(async () => {
            expect(await invokeWorkspaceAction({ actionId: 'workspace.tabs.open', input: { href: '/session/B1?serverId=home-b', mode: 'newTab' } })).toMatchObject({ ok: true });
        });
        const newId = navigation().state.groups[navigation().state.focusedGroupId].activeTabId;
        expect(newId).not.toBe(originalId);
        await act(async () => {
            expect(await invokeWorkspaceAction({ actionId: 'workspace.tabs.pin', input: { tabId: newId, pinned: true } })).toMatchObject({ ok: true });
            expect(await invokeWorkspaceAction({ actionId: 'workspace.tabs.open', input: { tabId: originalId, href: '/session/C1?serverId=home-c' } })).toMatchObject({ ok: true });
        });
        expect(navigation().state.tabs[newId]).toMatchObject({ pinned: true, target: { params: { id: 'B1', serverId: 'home-b' } } });
        expect(navigation().state.tabs[originalId].target.params).toEqual({ id: 'C1', serverId: 'home-c' });
        expect(Object.keys(navigation().state.tabs)).toHaveLength(2);
        const before = navigation().state;
        setActiveUnsavedChangesGuard({ isDirtyRef: { current: true }, requestDecision: async () => 'keepEditing', tag: 'workspace-action-test' });
        await act(async () => {
            expect(await invokeWorkspaceAction({ actionId: 'workspace.tabs.close', input: { tabId: originalId } })).toMatchObject({ ok: false, errorCode: 'workspace_navigation_cancelled' });
        });
        expect(navigation().state).toBe(before);
        clearActiveUnsavedChangesGuard();
        expect(await invokeWorkspaceAction({ actionId: 'workspace.split', input: { direction: 'right' } })).toMatchObject({ ok: false, errorCode: 'workspace_layout_unmeasured' });
        await act(async () => { screen.unmount(); });
        expect(await invokeWorkspaceAction({ actionId: 'workspace.tabs.list', input: {} })).toMatchObject({ ok: false, errorCode: 'unsupported_action' });
        expect(await mounted?.({ actionId: 'workspace.tabs.open', input: {} })).toMatchObject({ ok: false, errorCode: 'workspace_unavailable' });
    });
    it('routes hosted actions and cross-tab history through one owner with scoped server identity', async () => {
        const catalog = resolveCompactAppDestinations({ pages: [], builtins: {
            externalSessions: false, inbox: false, workflows: false, friends: false,
        } });
        const screen = await renderScreen(<WorkspaceProvider enabled catalog={catalog}>
            {(navigation) => <NavigationProbe navigation={navigation} />}
        </WorkspaceProvider>);
        const navigation = () => screen.root.findByType('WorkspaceOwner').props.navigation as WorkspaceNavigationContextValue;
        expect(navigation().active).toBe(true);
        expect(screen.root.findByType('HostedIdentity').props.params).toEqual({ id: 'A1', serverId: 'home-a' });
        await act(async () => { screen.root.findByType('HostedIdentity').props.next(); });
        await act(async () => { navigation().openHref('/session/B1?serverId=home-b', { mode: 'newTab' }); });
        for (const [direction, id, serverId] of [['back', 'A2', 'home-a'], ['back', 'A1', 'home-a'], ['forward', 'A2', 'home-a'], ['forward', 'B1', 'home-b']] as const) {
            await act(async () => { navigation()[direction](); });
            expect(screen.root.findByType('HostedIdentity').props.params).toEqual({ id, serverId });
            expect(boundary.mirrors.at(-1)).toBe(`/session/${id}?serverId=${serverId}`);
        }
    });
});
