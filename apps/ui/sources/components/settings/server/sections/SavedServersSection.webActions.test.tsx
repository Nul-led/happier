import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';

import { renderScreen } from '@/dev/testkit';
import { installSettingsViewCommonModuleMocks } from '../../settingsViewTestHelpers';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

installSettingsViewCommonModuleMocks({
    reactNative: async () => {
        const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
        return createReactNativeWebMock({
            Platform: {
                OS: 'web',
            },
        });
    },
    text: async () => {
        const { createTextModuleMock } = await import('@/dev/testkit/mocks/text');
        return createTextModuleMock({
            translate: (key: string) => key,
        });
    },
    unistyles: async () => {
        const { createUnistylesMock } = await import('@/dev/testkit/mocks/unistyles');
        return createUnistylesMock({
            theme: {
                colors: {
                    textSecondary: '#999999',
                },
            },
        });
    },
});

vi.mock('@/hooks/server/useServerRetentionPolicies', () => ({
    useServerRetentionPolicies: () => ({}),
}));

vi.mock('@/components/ui/lists/ItemGroup', () => ({
    ItemGroup: ({ children, title }: any) => React.createElement('ItemGroup', { title }, children),
}));

vi.mock('@/components/ui/lists/Item', () => ({
    Item: (props: any) => React.createElement('Item', props),
}));

vi.mock('@/components/ui/lists/ItemRowActions', () => ({
    ItemRowActions: (props: any) => React.createElement('ItemRowActions', props),
}));

describe('SavedServersSection web actions', () => {
    it('renders saved server rows without row press handlers when inline actions are present', async () => {
        const { SavedServersSection } = await import('./SavedServersSection');

        const screen = await renderScreen(React.createElement(SavedServersSection, {
            servers: [
                {
                    id: 'server-a',
                    name: 'Active',
                    serverUrl: 'https://active.example',
                    source: 'manual',
                    createdAt: 1,
                    updatedAt: 1,
                    lastUsedAt: 1,
                },
            ],
            activeServerId: 'server-a',
            authStatusByServerId: {
                'server-a': 'signedIn',
            },
            onSwitch: vi.fn(),
            onRename: vi.fn(),
            onRemove: vi.fn(),
        }));

        const row = screen.findByType('Item' as never);
        expect(row?.props?.onPress).toBeUndefined();
    });

    it('exposes stable inline switch action test ids for saved server rows on web', async () => {
        const { SavedServersSection } = await import('./SavedServersSection');

        const screen = await renderScreen(React.createElement(SavedServersSection, {
            servers: [
                {
                    id: 'server-b',
                    name: 'Secondary',
                    serverUrl: 'https://secondary.example',
                    source: 'manual',
                    createdAt: 1,
                    updatedAt: 1,
                    lastUsedAt: 1,
                },
            ],
            activeServerId: 'server-a',
            authStatusByServerId: {
                'server-b': 'signedIn',
            },
            onSwitch: vi.fn(),
            onRename: vi.fn(),
            onRemove: vi.fn(),
        }));

        const row = screen.findByType('Item' as never);
        const rowActions = row?.props?.rightElement;
        expect(rowActions?.props?.actions).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    id: 'switch-device',
                    inlineTestID: 'saved-server-switch-server-b',
                    accessibilityLabel: 'server.makeDefaultOnDevice: Secondary',
                }),
                expect.objectContaining({ id: 'rename', accessibilityLabel: 'common.rename: Secondary' }),
                expect.objectContaining({ id: 'remove', accessibilityLabel: 'common.remove: Secondary' }),
            ]),
        );
    });

    it('marks identity-backed saved server rows active and reads auth by server identity id', async () => {
        const { SavedServersSection } = await import('./SavedServersSection');

        const screen = await renderScreen(React.createElement(SavedServersSection, {
            servers: [
                {
                    id: 'server-host-derived',
                    name: 'Identity Relay',
                    serverUrl: 'https://identity.example',
                    serverIdentityId: 'srv_identity_saved',
                    source: 'manual',
                    createdAt: 1,
                    updatedAt: 1,
                    lastUsedAt: 1,
                },
            ],
            activeServerId: 'srv_identity_saved',
            authStatusByServerId: {
                srv_identity_saved: 'signedIn',
            },
            onSwitch: vi.fn(),
            onRename: vi.fn(),
            onRemove: vi.fn(),
        }));

        const row = screen.findByTestId('saved-server-row-server-host-derived');
        expect(row?.props?.selected).toBe(true);
        expect(row?.props?.subtitle).toContain('server.signedIn');
    });

    it('shows one truthful status without URL or retention metadata in each Home row', async () => {
        const { SavedServersSection } = await import('./SavedServersSection');

        const screen = await renderScreen(React.createElement(SavedServersSection, {
            servers: [
                {
                    id: 'server-a',
                    name: 'Focused Home With A Very Long Name',
                    serverUrl: 'https://focused.example',
                    source: 'manual',
                    createdAt: 1,
                    updatedAt: 1,
                    lastUsedAt: 1,
                },
                {
                    id: 'server-b',
                    name: 'Offline Home',
                    serverUrl: 'https://offline.example',
                    source: 'manual',
                    createdAt: 1,
                    updatedAt: 1,
                    lastUsedAt: 1,
                },
            ],
            activeServerId: 'server-a',
            deviceDefaultServerId: 'server-a',
            authStatusByServerId: { 'server-a': 'signedIn', 'server-b': 'signedIn' },
            connectionStatusByServerId: { 'server-a': 'connected', 'server-b': 'disconnected' },
            onSwitch: vi.fn(),
            onRename: vi.fn(),
            onRemove: vi.fn(),
        }));

        const focused = screen.findByTestId('saved-server-row-server-a');
        const offline = screen.findByTestId('saved-server-row-server-b');
        expect(focused?.props?.subtitle).toBe('status.connected');
        expect(focused?.props?.detail).toBeUndefined();
        expect(focused?.props?.accessibilityLabel).toBe('Focused Home With A Very Long Name, status.connected');
        expect(focused?.props?.subtitle).not.toContain('focused.example');
        expect(focused?.props?.titleLines).toBe(1);
        expect(focused?.props?.titleEllipsizeMode).toBe('tail');
        expect(offline?.props?.subtitle).toBe('status.disconnected');
        expect(offline?.props?.accessibilityLabel).toBe('Offline Home, status.disconnected');
    });

    it('disambiguates same-named Home actions without exposing URLs in the visible row', async () => {
        const { SavedServersSection } = await import('./SavedServersSection');

        const screen = await renderScreen(React.createElement(SavedServersSection, {
            servers: [
                {
                    id: 'server-a',
                    name: 'Personal Home',
                    serverUrl: 'https://first.example',
                    source: 'manual',
                    createdAt: 1,
                    updatedAt: 1,
                    lastUsedAt: 1,
                },
                {
                    id: 'server-b',
                    name: 'Personal Home',
                    serverUrl: 'https://second.example',
                    source: 'manual',
                    createdAt: 1,
                    updatedAt: 1,
                    lastUsedAt: 1,
                },
            ],
            activeServerId: 'server-a',
            authStatusByServerId: { 'server-a': 'signedIn', 'server-b': 'signedIn' },
            connectionStatusByServerId: { 'server-a': 'connected', 'server-b': 'connected' },
            onSwitch: vi.fn(),
            onRename: vi.fn(),
            onRemove: vi.fn(),
        }));

        const first = screen.findByTestId('saved-server-row-server-a');
        const second = screen.findByTestId('saved-server-row-server-b');
        expect(first?.props.subtitle).toBe('status.connected');
        expect(second?.props.subtitle).toBe('status.connected');
        expect(first?.props.accessibilityLabel).toContain('first.example');
        expect(second?.props.accessibilityLabel).toContain('second.example');
        expect(first?.props.accessibilityLabel).not.toBe(second?.props.accessibilityLabel);
    });
});
