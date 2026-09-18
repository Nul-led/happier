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
    it('gives expanded search its own full-width row and moves filters below it', async () => {
        const { SessionListSearchChrome } = await import('./SessionListSearchChrome');
        const screen = await renderScreen(
            <SessionListSearchChrome
                filterControl={React.createElement('FilterControl', { testID: 'session-list-filter-control' })}
                tagOptions={[{ id: 'tag:a', label: 'alpha' }]}
                selectedTagOptionIds={[]}
                searchQuery="responsive"
                onToggleTagOption={vi.fn()}
                onSearchQueryChange={vi.fn()}
            />,
        );
        const flatten = (style: unknown): Record<string, unknown> => (
            Array.isArray(style)
                ? style.reduce<Record<string, unknown>>((acc, entry) => ({ ...acc, ...flatten(entry) }), {})
                : (style as Record<string, unknown> | null) ?? {}
        );

        const searchRow = screen.root.findByProps({ testID: 'session-list-search-primary-controls' });
        const auxiliaryRow = screen.root.findByProps({ testID: 'session-list-search-auxiliary-controls' });
        expect(searchRow.findByProps({ testID: 'session-list-search-input' })).toBeTruthy();
        expect(searchRow.findAllByProps({ testID: 'session-list-filter-control' })).toHaveLength(0);
        expect(searchRow.findAllByProps({ testID: 'session-list-tag-filter-trigger' })).toHaveLength(0);
        expect(searchRow.findAllByProps({ testID: 'session-list-view-options-trigger' })).toHaveLength(0);
        expect(auxiliaryRow.findByProps({ testID: 'session-list-filter-control' })).toBeTruthy();
        expect(auxiliaryRow.findByProps({ testID: 'session-list-tag-filter-trigger' })).toBeTruthy();
        expect(auxiliaryRow.findByProps({ testID: 'session-list-view-options-trigger' })).toBeTruthy();

        const shellStyle = flatten(screen.root.findByProps({ testID: 'session-list-search-trigger' }).props.style);
        expect(shellStyle.maxWidth).toBe('100%');
        expect(shellStyle.flexGrow).toBe(1);
    });
});
