import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';

import { findTestInstanceByTypeWithProps, renderScreen } from '@/dev/testkit';
import { installServerSettingsHooksCommonModuleMocks } from '@/components/settings/server/hooks/serverSettingsHooksTestHelpers';

installServerSettingsHooksCommonModuleMocks();
vi.mock('react-native-unistyles', async () => {
    const { createUnistylesMock } = await import('@/dev/testkit/mocks/unistyles');
    return createUnistylesMock({ theme: { colors: { text: { secondary: '#666' }, status: { connected: '#0a0' } } } });
});
vi.mock('@/components/ui/lists/ItemGroup', () => ({
    ItemGroup: ({ children }: { children?: React.ReactNode }) => React.createElement(React.Fragment, null, children),
}));
vi.mock('@/components/ui/lists/Item', () => ({
    Item: (props: Record<string, unknown>) => React.createElement('Item', props),
}));
vi.mock('@/components/ui/forms/Switch', () => ({
    Switch: (props: Record<string, unknown>) => React.createElement('Switch', props),
}));

describe('ServerGroupsSection membership', () => {
    it('renders active-group membership without a separate enable switch', async () => {
        const onToggleGroupServer = vi.fn();
        const { ServerGroupsSection } = await import('./ServerGroupsSection');
        const screen = await renderScreen(React.createElement(ServerGroupsSection, {
            groupSelectionPresentation: 'grouped',
            groupId: 'group-ab',
            selectedGroupServerIds: new Set(['identity-b']),
            servers: [{
                id: 'profile-b',
                serverIdentityId: 'identity-b',
                name: 'Home B',
                serverUrl: 'https://b.example.test',
                createdAt: 0,
                updatedAt: 0,
                lastUsedAt: 0,
            }],
            onToggleGroupPresentation: vi.fn(),
            onToggleGroupServer,
        }));

        expect(screen.findAllByType('Switch' as never)).toHaveLength(0);
        const row = findTestInstanceByTypeWithProps(screen, 'Item' as never, { title: 'Home B' });
        expect(row).toBeTruthy();
        expect(row?.props.accessibilityRole).toBe('checkbox');
        expect(row?.props.webRole).toBe('checkbox');
        expect(row?.props.selected).toBe(true);
        row?.props.onPress();
        expect(onToggleGroupServer).toHaveBeenCalledWith('identity-b');
    });

    it('chooses how grouped Homes appear with a two-option control instead of a tap-to-cycle row', async () => {
        const onToggleGroupPresentation = vi.fn();
        const { ServerGroupsSection } = await import('./ServerGroupsSection');
        const screen = await renderScreen(React.createElement(ServerGroupsSection, {
            groupSelectionPresentation: 'grouped',
            groupId: 'group-ab',
            selectedGroupServerIds: new Set<string>(),
            servers: [],
            onToggleGroupPresentation,
            onToggleGroupServer: vi.fn(),
        }));

        const row = findTestInstanceByTypeWithProps(screen, 'Item' as never, { testID: 'server-group-presentation' });
        expect(row?.props.onPress).toBeUndefined();
        const control = row?.props.rightElement?.props as { tabs: { id: string }[]; activeTabId: string; onSelectTab: (id: string) => void };
        expect(control.tabs.map((tab) => tab.id)).toEqual(['flat-with-badge', 'grouped']);
        expect(control.activeTabId).toBe('grouped');

        control.onSelectTab('grouped');
        expect(onToggleGroupPresentation).not.toHaveBeenCalled();
        control.onSelectTab('flat-with-badge');
        expect(onToggleGroupPresentation).toHaveBeenCalledTimes(1);
    });
});
