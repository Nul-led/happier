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
});
