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

vi.mock('@/components/ui/lists/ItemGroup', () => ({
    ItemGroup: ({ children, title }: any) => React.createElement('ItemGroup', { title }, children),
}));

vi.mock('@/components/ui/lists/Item', () => ({
    Item: (props: any) => React.createElement('Item', props, props.rightElement),
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

    it('keeps the stable switch test id on the row action and the rarer actions in its menu on web', async () => {
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

        expect(screen.findByTestId('saved-server-switch-server-b')).not.toBeNull();
        const rowActions = screen.findByType('ItemRowActions' as never);
        expect(rowActions?.props?.actions).toEqual([
            expect.objectContaining({ id: 'switch-device', accessibilityLabel: 'server.makeDefaultOnDevice: Secondary' }),
            expect.objectContaining({ id: 'rename', accessibilityLabel: 'common.rename: Secondary' }),
            expect.objectContaining({ id: 'remove', accessibilityLabel: 'common.remove: Secondary' }),
        ]);
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
        expect(row?.props?.subtitle).toBe('status.unknown');
        expect(row?.props?.accessibilityLabel).toContain('server.homes.currentPill');
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
            homeConnectionSummaryByServerId: {
                'server-a': { kind: 'connected', statusLabelKey: 'connectionStatus.summary.connected', statusKey: 'connected', action: 'none' },
                'server-b': { kind: 'unavailable', statusLabelKey: 'connectionStatus.summary.unavailable', statusKey: 'error', action: 'none' },
            },
            onSwitch: vi.fn(),
            onRename: vi.fn(),
            onRemove: vi.fn(),
        }));

        const focused = screen.findByTestId('saved-server-row-server-a');
        const offline = screen.findByTestId('saved-server-row-server-b');
        // The current Home's line is its state; "default" is said to assistive tech (below).
        expect(focused?.props?.subtitle).toBe('connectionStatus.summary.connected');
        expect(focused?.props?.accessibilityLabel).toBe('Focused Home With A Very Long Name, connectionStatus.summary.connected, server.homes.currentPill · homesHub.opensFirst');
        expect(focused?.props?.subtitle).not.toContain('focused.example');
        expect(focused?.props?.titleLines).toBe(1);
        expect(focused?.props?.titleEllipsizeMode).toBe('tail');
        expect(offline?.props?.subtitle).toBe('connectionStatus.summary.unavailable');
        expect(offline?.props?.accessibilityLabel).toBe('Offline Home, connectionStatus.summary.unavailable');
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
            homeConnectionSummaryByServerId: {
                'server-a': { kind: 'connected', statusLabelKey: 'connectionStatus.summary.connected', statusKey: 'connected', action: 'none' },
                'server-b': { kind: 'connected', statusLabelKey: 'connectionStatus.summary.connected', statusKey: 'connected', action: 'none' },
            },
            onSwitch: vi.fn(),
            onRename: vi.fn(),
            onRemove: vi.fn(),
        }));

        const first = screen.findByTestId('saved-server-row-server-a');
        const second = screen.findByTestId('saved-server-row-server-b');
        // The visible status line carries the connection and Home facts, never the URL.
        expect(first?.props.subtitle).toMatch(/^connectionStatus\.summary\.connected( · |$)/);
        expect(second?.props.subtitle).toMatch(/^connectionStatus\.summary\.connected( · |$)/);
        expect(first?.props.subtitle).not.toContain('example');
        expect(second?.props.subtitle).not.toContain('example');
        expect(first?.props.accessibilityLabel).toContain('first.example');
        expect(second?.props.accessibilityLabel).toContain('second.example');
        expect(first?.props.accessibilityLabel).not.toBe(second?.props.accessibilityLabel);
    });
});
