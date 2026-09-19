import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';

import { findTestInstanceByTypeWithProps, renderScreen } from '@/dev/testkit';
import { installServerSettingsHooksCommonModuleMocks } from '@/components/settings/server/hooks/serverSettingsHooksTestHelpers';

installServerSettingsHooksCommonModuleMocks({
    reactNative: async () => {
        const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
        return createReactNativeWebMock({ Platform: { OS: 'web' } });
    },
});

vi.mock('react-native-unistyles', async () => {
    const { createUnistylesMock } = await import('@/dev/testkit/mocks/unistyles');
    return createUnistylesMock({ theme: { colors: { text: { secondary: '#666' } } } });
});
vi.mock('@/hooks/server/useServerRetentionPolicies', () => ({ useServerRetentionPolicies: () => ({}) }));
vi.mock('@/components/ui/lists/ItemGroup', () => ({
    ItemGroup: ({ children }: { children?: React.ReactNode }) => React.createElement(React.Fragment, null, children),
}));
vi.mock('@/components/ui/lists/Item', () => ({
    Item: (props: Record<string, unknown>) => React.createElement('Item', props, props.rightElement as React.ReactNode),
}));
vi.mock('@/components/ui/lists/ItemRowActions', () => ({
    ItemRowActions: (props: Record<string, unknown>) => React.createElement('ItemRowActions', props),
}));

describe('SavedServersSection actions', () => {
    it('routes distinct web actions to tab-local and device-default focus scopes', async () => {
        const onSwitch = vi.fn();
        const { SavedServersSection } = await import('./SavedServersSection');
        const screen = await renderScreen(React.createElement(SavedServersSection, {
            servers: [{
                id: 'server-b',
                name: 'Home B',
                serverUrl: 'https://b.example.test',
                createdAt: 0,
                updatedAt: 0,
                lastUsedAt: 0,
            }],
            activeServerId: 'server-a',
            deviceDefaultServerId: 'server-a',
            authStatusByServerId: { 'server-b': 'signedIn' },
            onSwitch,
            onRename: vi.fn(),
            onRemove: vi.fn(),
        }));

        const actions = findTestInstanceByTypeWithProps(screen, 'ItemRowActions' as never, { title: 'Home B' })?.props.actions;
        const tabAction = actions.find((action: { id: string }) => action.id === 'switch-tab');
        const deviceAction = actions.find((action: { id: string }) => action.id === 'switch-device');
        tabAction.onPress();
        deviceAction.onPress();

        expect(onSwitch).toHaveBeenNthCalledWith(1, expect.objectContaining({ id: 'server-b' }), 'tab');
        expect(onSwitch).toHaveBeenNthCalledWith(2, expect.objectContaining({ id: 'server-b' }), 'device');
    });

    it('announces active and device-default Homes as distinct row facts', async () => {
        const { SavedServersSection } = await import('./SavedServersSection');
        const screen = await renderScreen(React.createElement(SavedServersSection, {
            servers: [
                { id: 'server-a', name: 'Home A', serverUrl: 'https://a.example.test', createdAt: 0, updatedAt: 0, lastUsedAt: 0 },
                { id: 'server-b', name: 'Home B', serverUrl: 'https://b.example.test', createdAt: 0, updatedAt: 0, lastUsedAt: 0 },
            ],
            activeServerId: 'server-a',
            deviceDefaultServerId: 'server-b',
            authStatusByServerId: { 'server-a': 'signedIn', 'server-b': 'signedIn' },
            onSwitch: vi.fn(),
            onRename: vi.fn(),
            onRemove: vi.fn(),
        }));

        const focused = findTestInstanceByTypeWithProps(screen, 'Item' as never, { testID: 'saved-server-row-server-a' })!.props;
        const other = findTestInstanceByTypeWithProps(screen, 'Item' as never, { testID: 'saved-server-row-server-b' })!.props;
        expect(focused.detail).toBe('server.active');
        expect(String(focused.accessibilityLabel)).toContain('server.active');
        expect(other.detail).toBe('server.default');
        expect(String(other.accessibilityLabel)).toContain('server.default');
        expect(String(other.accessibilityLabel)).not.toContain('server.active');
    });

    it('combines active and device-default facts when they name the same Home', async () => {
        const { SavedServersSection } = await import('./SavedServersSection');
        const screen = await renderScreen(React.createElement(SavedServersSection, {
            servers: [{ id: 'server-a', name: 'Home A', serverUrl: 'https://a.example.test', createdAt: 0, updatedAt: 0, lastUsedAt: 0 }],
            activeServerId: 'server-a',
            deviceDefaultServerId: 'server-a',
            authStatusByServerId: { 'server-a': 'signedIn' },
            onSwitch: vi.fn(),
            onRename: vi.fn(),
            onRemove: vi.fn(),
        }));

        const row = findTestInstanceByTypeWithProps(screen, 'Item' as never, { testID: 'saved-server-row-server-a' })!.props;
        expect(row.detail).toBe('server.active · server.default');
        expect(String(row.accessibilityLabel)).toContain('server.active · server.default');
    });

    it('offers an edit-members action on a group row without switching the client to it', async () => {
        const onEditGroupMembers = vi.fn();
        const onSwitchGroup = vi.fn();
        const { SavedServersSection } = await import('./SavedServersSection');
        const screen = await renderScreen(React.createElement(SavedServersSection, {
            servers: [],
            serverGroups: [{ id: 'group-1', name: 'Work', serverIds: ['server-a'], presentation: 'grouped' }],
            activeServerId: 'server-a',
            activeTargetKey: 'server:server-a',
            authStatusByServerId: {},
            onSwitch: vi.fn(),
            onSwitchGroup,
            onEditGroupMembers,
            onRename: vi.fn(),
            onRemove: vi.fn(),
        }));

        const actions = findTestInstanceByTypeWithProps(screen, 'ItemRowActions' as never, { title: 'Work' })?.props.actions;
        const editAction = actions.find((action: { id: string }) => action.id === 'edit-members');
        expect(editAction).toBeTruthy();
        editAction.onPress();
        expect(onEditGroupMembers).toHaveBeenCalledWith(expect.objectContaining({ id: 'group-1' }));
        expect(onSwitchGroup).not.toHaveBeenCalled();
    });
});
