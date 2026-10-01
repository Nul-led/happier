import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { renderScreen, standardCleanup } from '@/dev/testkit';
import { installSessionShellCommonModuleMocks } from '../sessionShellTestHelpers';

vi.mock('react-native-enriched-markdown/lib/module/web/streamingReveal.js', () => ({
    splitStreamingRevealTextParts: () => [],
}));

vi.mock('@/hooks/ui/useReducedMotionPreference', () => ({
    useReducedMotionPreference: () => true,
}));

vi.mock('@/components/ui/forms/dropdown/DropdownMenu', () => ({
    DropdownMenu: (props: React.Attributes & Record<string, unknown> & Readonly<{
        trigger?: (input: { toggle: () => void }) => React.ReactNode;
    }>) => React.createElement('DropdownMenu', props, props.trigger?.({ toggle: vi.fn() })),
}));

vi.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons', Octicons: 'Octicons' }));
vi.mock('expo-image', () => ({ Image: 'Image' }));

installSessionShellCommonModuleMocks({
    reactNative: async () => {
        const { createReactNativeNativeMock } = await import('@/dev/testkit/mocks/reactNative');
        return createReactNativeNativeMock({ platformOS: 'ios' });
    },
    storage: async () => ({
        useLocalSettingMutable: () => ['all', vi.fn()] as const,
    }),
});

vi.mock('@/hooks/server/useFeatureEnabled', () => ({ useFeatureEnabled: () => true }));

afterEach(standardCleanup);

describe('SessionListSearchChrome native layout', () => {
    it('keeps the title row and gives the open field its own full-width row beneath it', async () => {
        const { SessionListSearchChrome } = await import('./SessionListSearchChrome');
        const screen = await renderScreen(
            <SessionListSearchChrome
                filterControl={React.createElement('FilterControl', { testID: 'session-list-filter-control' })}
                searchQuery="responsive"
                onSearchQueryChange={vi.fn()}
            />,
        );

        const titleRow = screen.root.findByProps({ testID: 'session-list-search-primary-controls' });
        expect(titleRow.findByProps({ testID: 'session-list-filter-control' })).toBeTruthy();
        expect(titleRow.findAllByProps({ testID: 'session-list-search-trigger' }).length).toBeGreaterThan(0);
        expect(titleRow.findAllByProps({ testID: 'session-list-view-options-trigger' }).length).toBeGreaterThan(0);
        expect(titleRow.findAllByProps({ testID: 'session-list-search-input' })).toHaveLength(0);

        const [field] = screen.root.findAllByProps({ testID: 'session-list-search-input.field' });
        expect(field?.findAllByProps({ testID: 'session-list-search-input' }).length).toBeGreaterThan(0);
    });

    it('gives every header and field action the touch floor on a touch platform', async () => {
        const { SessionListSearchChrome } = await import('./SessionListSearchChrome');
        const { resolveMinimumInteractiveTargetSize } = await import('@/components/ui/interactiveTargetSize');
        const screen = await renderScreen(
            <SessionListSearchChrome
                searchQuery="responsive"
                onSearchQueryChange={vi.fn()}
            />,
        );

        for (const testID of ['session-list-search-trigger', 'session-list-view-options-trigger', 'session-list-search-close']) {
            const [button] = screen.root.findAllByProps({ testID });
            expect(button?.props.minimumInteractiveTargetSize).toBe(resolveMinimumInteractiveTargetSize('ios'));
        }
    });
});
