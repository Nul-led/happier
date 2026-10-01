import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';

import { renderScreen } from '@/dev/testkit';
import { installServerSettingsHooksCommonModuleMocks } from '@/components/settings/server/hooks/serverSettingsHooksTestHelpers';

const viewport = vi.hoisted(() => ({ width: 390 }));

installServerSettingsHooksCommonModuleMocks({
    reactNative: async () => {
        const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
        return createReactNativeWebMock({
            Platform: { OS: 'web' },
            useWindowDimensions: () => ({ width: viewport.width, height: 844, scale: 1, fontScale: 1 }),
        });
    },
});

vi.mock('react-native-unistyles', async () => {
    const { createUnistylesMock } = await import('@/dev/testkit/mocks/unistyles');
    return createUnistylesMock({ theme: { colors: { text: { secondary: '#666' } } } });
});
vi.mock('@/components/ui/lists/ItemGroup', () => ({
    ItemGroup: ({ children }: { children?: React.ReactNode }) => React.createElement(React.Fragment, null, children),
}));
// The row shell is the list owner's; this suite checks what the Home row puts in it.
vi.mock('@/components/ui/lists/Item', () => ({
    Item: (props: Record<string, unknown>) => React.createElement('Item', props, props.rightElement as React.ReactNode),
}));

async function renderHomeRow() {
    const { SavedServersSection } = await import('./SavedServersSection');
    return renderScreen(React.createElement(SavedServersSection, {
        servers: [
            { id: 'server-a', name: 'Home A', serverUrl: 'https://a.example.test', createdAt: 0, updatedAt: 0, lastUsedAt: 0 },
            { id: 'server-b', name: 'Home B', serverUrl: 'https://b.example.test', createdAt: 0, updatedAt: 0, lastUsedAt: 0 },
        ],
        activeServerId: 'server-a',
        // The default is another Home than the one in use, so its row states it.
        deviceDefaultServerId: 'server-b',
        authStatusByServerId: { 'server-a': 'signedIn', 'server-b': 'signedIn' },
        onSwitch: vi.fn(),
        onRename: vi.fn(),
        onRemove: vi.fn(),
    }));
}

describe('SavedServersSection on a phone', () => {
    it('keeps the Home facts on the status line and leaves only the ⋯ menu beside the name', async () => {
        viewport.width = 390;
        const screen = await renderHomeRow();

        const row = screen.findByTestId('saved-server-row-server-b')!;
        // The connection status first, then the Home's facts, on one line under the name.
        expect(row.props.subtitle).toMatch(/^\S+ · homesHub\.opensFirst$/);
        expect(row.props.detail).toBeUndefined();
        // Every action, the switch included, is in the overflow menu on a phone.
        expect(screen.root.findAll((node) => node.props?.testID === 'saved-server-switch-server-b')).toHaveLength(0);
    });

    it('shows the row action beside the name on a wide window', async () => {
        viewport.width = 1440;
        const screen = await renderHomeRow();

        expect(screen.root.findAll((node) => node.props?.testID === 'saved-server-switch-server-b').length).toBeGreaterThan(0);
    });
});
