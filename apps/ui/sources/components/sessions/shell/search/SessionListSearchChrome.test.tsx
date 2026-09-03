import React from 'react';
import { Animated, Platform } from 'react-native';
import { act } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { invokeTestInstanceHandler, renderScreen, standardCleanup } from '@/dev/testkit';
import { Text } from '@/components/ui/text/Text';
import { installSessionShellCommonModuleMocks } from '../sessionShellTestHelpers';

const dropdownMenuSpy = vi.fn();
const setStorageFilterSpy = vi.hoisted(() => vi.fn());
const featureFlags = vi.hoisted(() => ({ externalSessionsEnabled: true }));
const reducedMotion = vi.hoisted(() => ({ value: false }));

vi.mock('@/hooks/ui/useReducedMotionPreference', () => ({
    useReducedMotionPreference: () => reducedMotion.value,
}));

vi.mock('@/components/ui/forms/dropdown/DropdownMenu', () => ({
    DropdownMenu: (props: React.Attributes & Record<string, unknown> & Readonly<{
        trigger?: (input: { toggle: () => void }) => React.ReactNode;
    }>) => {
        dropdownMenuSpy(props);
        return React.createElement('DropdownMenu', props, props.trigger?.({ toggle: vi.fn() }));
    },
}));

vi.mock('@expo/vector-icons', () => ({
    Ionicons: 'Ionicons',
    Octicons: 'Octicons',
}));

vi.mock('expo-image', () => ({
    Image: 'Image',
}));

installSessionShellCommonModuleMocks({
    storage: async () => ({
        useLocalSettingMutable: (key: string) => {
            if (key === 'sessionsListStorageFilter') return ['direct', setStorageFilterSpy] as const;
            return [undefined, vi.fn()] as const;
        },
    }),
});

vi.mock('@/hooks/server/useFeatureEnabled', () => ({
    useFeatureEnabled: (featureId: string) => featureId === 'sessions.direct' && featureFlags.externalSessionsEnabled,
}));

afterEach(() => {
    standardCleanup();
    dropdownMenuSpy.mockClear();
    setStorageFilterSpy.mockClear();
    featureFlags.externalSessionsEnabled = true;
    reducedMotion.value = false;
});

describe('SessionListSearchChrome', () => {
    it('renders the query from its single owner without a second local echo state', async () => {
        const { SessionListSearchChrome } = await import('./SessionListSearchChrome');
        const onSearchQueryChange = vi.fn();
        const screen = await renderScreen(
            <SessionListSearchChrome
                allKnownTags={[]}
                selectedTags={[]}
                searchQuery="sta"
                onSelectedTagsChange={vi.fn()}
                onSearchQueryChange={onSearchQueryChange}
            />,
        );

        const input = screen.root.findByProps({ testID: 'session-list-search-input' });
        expect(input.props.value).toBe('sta');

        await act(async () => {
            invokeTestInstanceHandler(input, 'onChangeText', 'stab');
        });

        expect(onSearchQueryChange).toHaveBeenCalledWith('stab');
        // The chrome does not shadow the query: an unchanged prop keeps the rendered value.
        expect(screen.root.findByProps({ testID: 'session-list-search-input' }).props.value).toBe('sta');
    });

    it('offers an interactive Search everything escalation carrying the current query', async () => {
        const { SessionListSearchChrome } = await import('./SessionListSearchChrome');
        const onSearchEverything = vi.fn();
        const screen = await renderScreen(
            <SessionListSearchChrome
                allKnownTags={[]}
                selectedTags={[]}
                searchQuery="  vector  "
                onSelectedTagsChange={vi.fn()}
                onSearchQueryChange={vi.fn()}
                onSearchEverything={onSearchEverything}
            />,
        );

        const escalation = screen.root.findByProps({ testID: 'session-list-search-everything' });
        expect(escalation.props.accessibilityRole).toBe('button');
        expect(escalation.props.pointerEvents).not.toBe('none');

        await act(async () => {
            escalation.props.onPress?.({ stopPropagation: vi.fn() });
        });

        expect(onSearchEverything).toHaveBeenCalledWith('vector');
    });

    it('hides the escalation while the contextual query is empty', async () => {
        const { SessionListSearchChrome } = await import('./SessionListSearchChrome');
        const screen = await renderScreen(
            <SessionListSearchChrome
                allKnownTags={[]}
                selectedTags={[]}
                searchQuery=""
                onSelectedTagsChange={vi.fn()}
                onSearchQueryChange={vi.fn()}
                onSearchEverything={vi.fn()}
            />,
        );

        expect(screen.root.findAllByProps({ testID: 'session-list-search-everything' })).toHaveLength(0);
    });

    it('does not keep the expanded search shell as a button around search content', async () => {
        const { SessionListSearchChrome } = await import('./SessionListSearchChrome');
        const screen = await renderScreen(
            <SessionListSearchChrome
                allKnownTags={[]}
                selectedTags={[]}
                searchQuery="vector"
                onSelectedTagsChange={vi.fn()}
                onSearchQueryChange={vi.fn()}
            />,
        );

        const shell = screen.root.findByProps({ testID: 'session-list-search-trigger' });

        expect(shell.props.accessibilityRole).toBeUndefined();
        expect(shell.props.onPress).toBeUndefined();
    });

    it('renders the search trailing accessory in a stable hidden slot when search is open', async () => {
        const { SessionListSearchChrome } = await import('./SessionListSearchChrome');
        const screen = await renderScreen(
            <SessionListSearchChrome
                allKnownTags={[]}
                selectedTags={[]}
                searchQuery="vector"
                onSelectedTagsChange={vi.fn()}
                onSearchQueryChange={vi.fn()}
                searchTrailingAccessory={React.createElement('ActivityIndicator', {
                    testID: 'session-list-memory-search-loading-indicator',
                })}
            />,
        );

        const slot = screen.root.findByProps({ testID: 'session-list-search-trailing-accessory' });

        expect(slot.props.pointerEvents).toBe('none');
        expect(slot.props.accessibilityElementsHidden).toBe(true);
        expect(slot.findByProps({ testID: 'session-list-memory-search-loading-indicator' })).toBeTruthy();
    });

    it('keeps the same input instance when an async search accessory publishes', async () => {
        const { SessionListSearchChrome } = await import('./SessionListSearchChrome');
        const baseProps = {
            allKnownTags: [] as string[],
            selectedTags: [] as string[],
            searchQuery: 'vector',
            onSelectedTagsChange: vi.fn(),
            onSearchQueryChange: vi.fn(),
        };
        const screen = await renderScreen(<SessionListSearchChrome {...baseProps} />);
        const inputBeforePublication = screen.root.findByProps({ testID: 'session-list-search-input' });

        await act(async () => {
            screen.tree.update(
                <SessionListSearchChrome
                    {...baseProps}
                    searchTrailingAccessory={React.createElement('ActivityIndicator')}
                />,
            );
        });

        expect(screen.root.findByProps({ testID: 'session-list-search-input' })).toBe(inputBeforePublication);
    });

    it('keeps the opened input mounted when clear is followed by an incidental native blur', async () => {
        const { SessionListSearchChrome } = await import('./SessionListSearchChrome');

        function Harness() {
            const [query, setQuery] = React.useState('');
            return (
                <SessionListSearchChrome
                    allKnownTags={[]}
                    selectedTags={[]}
                    searchQuery={query}
                    onSelectedTagsChange={vi.fn()}
                    onSearchQueryChange={setQuery}
                />
            );
        }

        const screen = await renderScreen(<Harness />);
        await act(async () => {
            screen.root.findByProps({ testID: 'session-list-search-trigger' }).props.onPress?.();
        });
        const openedInput = screen.root.findByProps({ testID: 'session-list-search-input' });

        await act(async () => {
            invokeTestInstanceHandler(openedInput, 'onFocus');
            invokeTestInstanceHandler(openedInput, 'onChangeText', 'v');
        });
        await act(async () => {
            invokeTestInstanceHandler(openedInput, 'onChangeText', '');
            invokeTestInstanceHandler(openedInput, 'onBlur');
        });

        expect(screen.root.findByProps({ testID: 'session-list-search-input' })).toBe(openedInput);
    });

    it('persists storage filter selection and exposes the active-filter affordance', async () => {
        const { SessionListSearchChrome } = await import('./SessionListSearchChrome');
        const screen = await renderScreen(
            <SessionListSearchChrome
                allKnownTags={[]}
                selectedTags={[]}
                searchQuery=""
                onSelectedTagsChange={vi.fn()}
                onSearchQueryChange={vi.fn()}
            />,
        );

        expect(screen.root.findByProps({ testID: 'session-list-ordering-menu-trigger' }).props.accessibilityState)
            .toEqual({ selected: true });
        expect(screen.root.findByProps({ testID: 'session-list-active-filter-indicator' })).toBeTruthy();

        const orderingMenuProps = dropdownMenuSpy.mock.calls
            .map(([props]) => props as { items?: Array<{ id: string }>; onSelect?: (id: string) => void })
            .find((props) => props.items?.some((item) => item.id === 'sessionListStorageFilterAll'));
        expect(orderingMenuProps).toBeTruthy();

        await act(async () => {
            orderingMenuProps?.onSelect?.('sessionListStorageFilterPersisted');
        });
        expect(setStorageFilterSpy).toHaveBeenCalledWith('persisted');
    });

    it('uses non-overlapping real minimum touch boxes for every chrome action', async () => {
        const { SessionListSearchChrome } = await import('./SessionListSearchChrome');
        const { resolveMinimumInteractiveTargetSize } = await import('@/components/ui/interactiveTargetSize');
        const screen = await renderScreen(
            <SessionListSearchChrome
                allKnownTags={['alpha']}
                selectedTags={[]}
                searchQuery=""
                onSelectedTagsChange={vi.fn()}
                onSearchQueryChange={vi.fn()}
            />,
        );

        const minimum = resolveMinimumInteractiveTargetSize(Platform.OS);
        const flatten = (style: unknown): Record<string, unknown> => (
            Array.isArray(style)
                ? style.reduce<Record<string, unknown>>((acc, entry) => ({ ...acc, ...flatten(entry) }), {})
                : (style as Record<string, unknown> | null) ?? {}
        );

        const trigger = screen.root.findByProps({ testID: 'session-list-search-trigger' });
        expect(flatten(trigger.props.style)).toMatchObject({ minWidth: minimum, minHeight: minimum });
        expect(trigger.props.hitSlop).toBeUndefined();

        const tagTrigger = screen.root.findByProps({ testID: 'session-list-tag-filter-trigger' });
        expect(flatten(tagTrigger.props.style)).toMatchObject({ minWidth: minimum, minHeight: minimum });
        expect(tagTrigger.props.hitSlop).toBeUndefined();

        const orderingTrigger = screen.root.findByProps({ testID: 'session-list-ordering-menu-trigger' });
        expect(flatten(orderingTrigger.props.style)).toMatchObject({ minWidth: minimum, minHeight: minimum });
        expect(orderingTrigger.props.hitSlop).toBeUndefined();
    });

    it('lets the expanded field use available width and Dynamic Type height', async () => {
        const { SessionListSearchChrome } = await import('./SessionListSearchChrome');
        const { resolveMinimumInteractiveTargetSize } = await import('@/components/ui/interactiveTargetSize');
        const screen = await renderScreen(
            <SessionListSearchChrome
                allKnownTags={['alpha']}
                selectedTags={[]}
                searchQuery="responsive"
                onSelectedTagsChange={vi.fn()}
                onSearchQueryChange={vi.fn()}
                onSearchEverything={vi.fn()}
            />,
        );
        const flatten = (style: unknown): Record<string, unknown> => (
            Array.isArray(style)
                ? style.reduce<Record<string, unknown>>((acc, entry) => ({ ...acc, ...flatten(entry) }), {})
                : (style as Record<string, unknown> | null) ?? {}
        );

        const shellStyle = flatten(screen.root.findByProps({ testID: 'session-list-search-trigger' }).props.style);
        expect(shellStyle.width).toBeUndefined();
        expect(shellStyle).toMatchObject({
            flexGrow: 1,
            flexShrink: 1,
            minWidth: resolveMinimumInteractiveTargetSize(Platform.OS),
        });

        const inputStyle = flatten(screen.root.findByProps({ testID: 'session-list-search-input' }).props.style);
        expect(inputStyle.height).toBeUndefined();
        expect(inputStyle.lineHeight).toBeUndefined();
        expect(inputStyle.minHeight).toBe(resolveMinimumInteractiveTargetSize(Platform.OS));
        expect(screen.root.findByProps({ testID: 'session-list-search-input' }).props.clearButtonMode).toBe('never');

        const escalation = screen.root.findByProps({ testID: 'session-list-search-everything' });
        expect(flatten(escalation.props.style).minHeight).toBe(resolveMinimumInteractiveTargetSize(Platform.OS));
        expect(escalation.findByType(Text).props.numberOfLines).toBeUndefined();
    });

    it('makes search expansion immediate when Reduced Motion is enabled', async () => {
        reducedMotion.value = true;
        const timingSpy = vi.spyOn(Animated, 'timing');
        const { SessionListSearchChrome } = await import('./SessionListSearchChrome');
        const screen = await renderScreen(
            <SessionListSearchChrome
                allKnownTags={[]}
                selectedTags={[]}
                searchQuery=""
                onSelectedTagsChange={vi.fn()}
                onSearchQueryChange={vi.fn()}
            />,
        );

        await act(async () => {
            screen.root.findByProps({ testID: 'session-list-search-trigger' }).props.onPress?.();
        });

        expect(timingSpy).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ duration: 0 }));
        timingSpy.mockRestore();
    });

    it('keeps a visible web focus ring on the collapsed search trigger', async () => {
        const { SessionListSearchChrome } = await import('./SessionListSearchChrome');
        const screen = await renderScreen(
            <SessionListSearchChrome
                allKnownTags={[]}
                selectedTags={[]}
                searchQuery=""
                onSelectedTagsChange={vi.fn()}
                onSearchQueryChange={vi.fn()}
            />,
        );

        const flatten = (style: unknown): Record<string, unknown> => (
            Array.isArray(style)
                ? style.reduce<Record<string, unknown>>((acc, entry) => ({ ...acc, ...flatten(entry) }), {})
                : (style as Record<string, unknown> | null) ?? {}
        );
        const trigger = screen.root.findByProps({ testID: 'session-list-search-trigger' });

        // Unfocused: the native browser ring is suppressed and no replacement paints.
        expect(flatten(trigger.props.style).outlineStyle).not.toBe('solid');

        await act(async () => {
            trigger.props.onFocus?.();
        });
        const focused = screen.root.findByProps({ testID: 'session-list-search-trigger' });
        const focusedStyle = flatten(focused.props.style);
        expect(focusedStyle.outlineStyle).toBe('solid');
        expect(focusedStyle.outlineWidth).toBe(2);
        expect(focusedStyle.outlineColor).toBeTypeOf('string');

        await act(async () => {
            focused.props.onBlur?.();
        });
        const blurred = screen.root.findByProps({ testID: 'session-list-search-trigger' });
        expect(flatten(blurred.props.style).outlineStyle).not.toBe('solid');
    });

    it('does not advertise a persisted external filter while the feature is disabled', async () => {
        featureFlags.externalSessionsEnabled = false;
        const { SessionListSearchChrome } = await import('./SessionListSearchChrome');
        const screen = await renderScreen(
            <SessionListSearchChrome
                allKnownTags={[]}
                selectedTags={[]}
                searchQuery=""
                onSelectedTagsChange={vi.fn()}
                onSearchQueryChange={vi.fn()}
            />,
        );

        expect(screen.root.findByProps({ testID: 'session-list-ordering-menu-trigger' }).props.accessibilityState)
            .toEqual({ selected: false });
        expect(screen.root.findAllByProps({ testID: 'session-list-active-filter-indicator' })).toHaveLength(0);

        const orderingMenuProps = dropdownMenuSpy.mock.calls
            .map(([props]) => props as { items?: Array<{ id: string }> })
            .find((props) => props.items?.some((item) => item.id === 'custom'));
        expect(orderingMenuProps?.items?.some((item) => item.id.startsWith('sessionListStorageFilter'))).toBe(false);
    });
});
