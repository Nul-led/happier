import React from 'react';
import { Animated, Platform } from 'react-native';
import { act } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { invokeTestInstanceHandler, renderScreen, standardCleanup } from '@/dev/testkit';
import { Text } from '@/components/ui/text/Text';
import { installSessionShellCommonModuleMocks } from '../sessionShellTestHelpers';

const dropdownMenuSpy = vi.fn();
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
        useLocalSettingMutable: () => [undefined, vi.fn()] as const,
    }),
});

afterEach(() => {
    standardCleanup();
    dropdownMenuSpy.mockClear();
    reducedMotion.value = false;
});

describe('SessionListSearchChrome', () => {
    it('keeps the canonical corpus filter control beside the stable search field', async () => {
        const { SessionListSearchChrome } = await import('./SessionListSearchChrome');
        const screen = await renderScreen(
            <SessionListSearchChrome
                filterControl={<Text testID="filter-control">My work</Text>}
                tagOptions={[]}
                selectedTagOptionIds={[]}
                searchQuery=""
                onToggleTagOption={vi.fn()}
                onSearchQueryChange={vi.fn()}
            />,
        );

        expect(screen.findByTestId('filter-control')).toBeDefined();
        expect(screen.findByTestId('session-list-search-trigger')).toBeDefined();
    });

    it('exposes selected and expanded state for the tag menu', async () => {
        const { SessionListSearchChrome } = await import('./SessionListSearchChrome');
        const screen = await renderScreen(
            <SessionListSearchChrome
                tagOptions={[{ id: 'tag:a', label: 'alpha' }, { id: 'tag:b', label: 'beta' }]}
                selectedTagOptionIds={['tag:a']}
                searchQuery=""
                onToggleTagOption={vi.fn()}
                onSearchQueryChange={vi.fn()}
            />,
        );

        expect(screen.findByTestId('session-list-tag-filter-trigger')?.props.accessibilityState).toEqual({
            expanded: false,
            selected: true,
        });
    });

    it('shows tag labels while toggling the exact qualified option id', async () => {
        const { SessionListSearchChrome } = await import('./SessionListSearchChrome');
        const onToggleTagOption = vi.fn();
        // Two Homes own a tag that reads `urgent`. The labels disambiguate them for
        // sighted and screen-reader users; the ids keep them two distinct selections.
        const homeATag = { id: 'tag:["home-a","tag_01HX"]', label: 'urgent · Home A' };
        const homeBTag = { id: 'tag:["home-b","tag_7ZQ"]', label: 'urgent · Home B' };
        await renderScreen(
            <SessionListSearchChrome
                tagOptions={[homeATag, homeBTag]}
                selectedTagOptionIds={[homeATag.id]}
                searchQuery=""
                onToggleTagOption={onToggleTagOption}
                onSearchQueryChange={vi.fn()}
            />,
        );

        const tagMenuProps = dropdownMenuSpy.mock.calls
            .map(([props]) => props as {
                items?: Array<{ id: string; title: string }>;
                onSelect?: (itemId: string) => void;
            })
            .find((props) => props.items?.some((item) => item.id === homeATag.id));
        expect(tagMenuProps?.items?.map((item) => item.title)).toEqual(['urgent · Home A', 'urgent · Home B']);

        await act(async () => {
            tagMenuProps?.onSelect?.(homeBTag.id);
        });
        expect(onToggleTagOption).toHaveBeenCalledWith(homeBTag.id);

        // A label is not an identity: nothing the menu did not present may write.
        onToggleTagOption.mockClear();
        await act(async () => {
            tagMenuProps?.onSelect?.('urgent');
        });
        expect(onToggleTagOption).not.toHaveBeenCalled();
    });

    it('renders the query from its single owner without a second local echo state', async () => {
        const { SessionListSearchChrome } = await import('./SessionListSearchChrome');
        const onSearchQueryChange = vi.fn();
        const screen = await renderScreen(
            <SessionListSearchChrome
                tagOptions={[]}
                selectedTagOptionIds={[]}
                searchQuery="sta"
                onToggleTagOption={vi.fn()}
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
                tagOptions={[]}
                selectedTagOptionIds={[]}
                searchQuery="  vector  "
                onToggleTagOption={vi.fn()}
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

    it('keeps local escalation available beside a polite retryable search-source status', async () => {
        const { SessionListSearchChrome } = await import('./SessionListSearchChrome');
        const onRetrySearch = vi.fn();
        const screen = await renderScreen(
            <SessionListSearchChrome
                tagOptions={[]}
                selectedTagOptionIds={[]}
                searchQuery="vector"
                searchStatus={{
                    message: 'Transcript search is temporarily unavailable.',
                    onRetry: onRetrySearch,
                }}
                onToggleTagOption={vi.fn()}
                onSearchQueryChange={vi.fn()}
                onSearchEverything={vi.fn()}
            />,
        );

        const status = screen.root.findByProps({ testID: 'session-list-search-status' });
        expect(status.props.accessibilityLiveRegion).toBe('polite');
        expect(status.props.role).toBe('status');
        expect(screen.root.findByProps({ testID: 'session-list-search-everything' })).toBeDefined();

        const retry = screen.root.findByProps({ testID: 'session-list-search-retry' });
        expect(retry.props.accessibilityRole).toBe('button');
        await act(async () => retry.props.onPress?.({ stopPropagation: vi.fn() }));
        expect(onRetrySearch).toHaveBeenCalledOnce();
    });

    it('labels the exact Home searched for transcript and Other matches results', async () => {
        const { SessionListSearchChrome } = await import('./SessionListSearchChrome');
        const screen = await renderScreen(
            <SessionListSearchChrome
                tagOptions={[]}
                selectedTagOptionIds={[]}
                searchQuery="vector"
                searchScopeLabel="Server: Studio Home"
                onToggleTagOption={vi.fn()}
                onSearchQueryChange={vi.fn()}
            />,
        );

        const scope = screen.root.findByProps({ testID: 'session-list-search-scope' });
        expect(scope.props.accessibilityLiveRegion).toBe('polite');
        expect(scope.findByType(Text).props.children).toBe('Server: Studio Home');
    });

    it('does not show transcript scope when there is no active query', async () => {
        const { SessionListSearchChrome } = await import('./SessionListSearchChrome');
        const screen = await renderScreen(
            <SessionListSearchChrome
                tagOptions={[]}
                selectedTagOptionIds={[]}
                searchQuery=""
                searchScopeLabel="Server: Studio Home"
                onToggleTagOption={vi.fn()}
                onSearchQueryChange={vi.fn()}
            />,
        );

        expect(screen.root.findAllByProps({ testID: 'session-list-search-scope' })).toHaveLength(0);
    });

    it('hides the escalation while the contextual query is empty', async () => {
        const { SessionListSearchChrome } = await import('./SessionListSearchChrome');
        const screen = await renderScreen(
            <SessionListSearchChrome
                tagOptions={[]}
                selectedTagOptionIds={[]}
                searchQuery=""
                onToggleTagOption={vi.fn()}
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
                tagOptions={[]}
                selectedTagOptionIds={[]}
                searchQuery="vector"
                onToggleTagOption={vi.fn()}
                onSearchQueryChange={vi.fn()}
            />,
        );

        const shell = screen.root.findByProps({ testID: 'session-list-search-trigger' });

        expect(shell.props.accessibilityRole).toBeUndefined();
        expect(shell.props.onPress).toBeUndefined();
        expect(shell.props.accessible).toBe(false);
        expect(shell.props.focusable).toBe(false);
    });

    it('keeps clear and close as distinct accessible actions', async () => {
        const { SessionListSearchChrome } = await import('./SessionListSearchChrome');

        function Harness() {
            const [query, setQuery] = React.useState('vector');
            return (
                <SessionListSearchChrome
                    tagOptions={[]}
                    selectedTagOptionIds={[]}
                    searchQuery={query}
                    onToggleTagOption={vi.fn()}
                    onSearchQueryChange={setQuery}
                />
            );
        }

        const screen = await renderScreen(<Harness />);
        const openedInput = screen.root.findByProps({ testID: 'session-list-search-input' });
        const clear = screen.root.findByProps({ testID: 'session-list-search-clear' });
        const close = screen.root.findByProps({ testID: 'session-list-search-close' });
        expect(clear.props.accessibilityRole).toBe('button');
        expect(close.props.accessibilityRole).toBe('button');

        await act(async () => {
            clear.props.onPress?.({ stopPropagation: vi.fn() });
        });

        expect(screen.root.findByProps({ testID: 'session-list-search-input' })).toBe(openedInput);

        await act(async () => {
            screen.root.findByProps({ testID: 'session-list-search-close' }).props.onPress?.({
                stopPropagation: vi.fn(),
            });
        });

        expect(screen.root.findAllByProps({ testID: 'session-list-search-input' })).toHaveLength(0);
    });

    it('renders the search trailing accessory in a stable hidden slot when search is open', async () => {
        const { SessionListSearchChrome } = await import('./SessionListSearchChrome');
        const screen = await renderScreen(
            <SessionListSearchChrome
                tagOptions={[]}
                selectedTagOptionIds={[]}
                searchQuery="vector"
                onToggleTagOption={vi.fn()}
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
            tagOptions: [] as Array<{ id: string; label: string }>,
            selectedTagOptionIds: [] as string[],
            searchQuery: 'vector',
            onToggleTagOption: vi.fn(),
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
                    tagOptions={[]}
                    selectedTagOptionIds={[]}
                    searchQuery={query}
                    onToggleTagOption={vi.fn()}
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

    it('keeps source filtering in the corpus editor instead of View options', async () => {
        const { SessionListSearchChrome } = await import('./SessionListSearchChrome');
        const screen = await renderScreen(
            <SessionListSearchChrome
                tagOptions={[]}
                selectedTagOptionIds={[]}
                searchQuery=""
                onToggleTagOption={vi.fn()}
                onSearchQueryChange={vi.fn()}
            />,
        );

        expect(screen.root.findByProps({ testID: 'session-list-view-options-trigger' })).toBeTruthy();
        expect(screen.root.findAllByProps({ testID: 'session-list-active-filter-indicator' })).toHaveLength(0);

        const viewOptionsProps = dropdownMenuSpy.mock.calls
            .map(([props]) => props as { items?: Array<{ id: string }> })
            .find((props) => props.items?.some((item) => item.id.startsWith('layout:')));
        expect(viewOptionsProps?.items?.some((item) => item.id.startsWith('sessionListStorageFilter'))).toBe(false);
    });

    it('uses non-overlapping real minimum touch boxes for every chrome action', async () => {
        const { SessionListSearchChrome } = await import('./SessionListSearchChrome');
        const { resolveMinimumInteractiveTargetSize } = await import('@/components/ui/interactiveTargetSize');
        const screen = await renderScreen(
            <SessionListSearchChrome
                tagOptions={[{ id: 'tag:a', label: 'alpha' }]}
                selectedTagOptionIds={[]}
                searchQuery=""
                onToggleTagOption={vi.fn()}
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

        const orderingTrigger = screen.root.findByProps({ testID: 'session-list-view-options-trigger' });
        expect(flatten(orderingTrigger.props.style)).toMatchObject({ minWidth: minimum, minHeight: minimum });
        expect(orderingTrigger.props.hitSlop).toBeUndefined();
    });

    it('uses real minimum touch boxes for expanded search actions', async () => {
        const { SessionListSearchChrome } = await import('./SessionListSearchChrome');
        const { resolveMinimumInteractiveTargetSize } = await import('@/components/ui/interactiveTargetSize');
        const screen = await renderScreen(
            <SessionListSearchChrome
                tagOptions={[]}
                selectedTagOptionIds={[]}
                searchQuery="vector"
                onToggleTagOption={vi.fn()}
                onSearchQueryChange={vi.fn()}
            />,
        );
        const minimum = resolveMinimumInteractiveTargetSize(Platform.OS);
        const flatten = (style: unknown): Record<string, unknown> => (
            Array.isArray(style)
                ? style.reduce<Record<string, unknown>>((acc, entry) => ({ ...acc, ...flatten(entry) }), {})
                : (style as Record<string, unknown> | null) ?? {}
        );

        for (const testID of ['session-list-search-clear', 'session-list-search-close']) {
            const action = screen.root.findByProps({ testID });
            expect(flatten(action.props.style)).toMatchObject({ minWidth: minimum, minHeight: minimum });
            expect(action.props.hitSlop).toBeUndefined();
        }
    });

    it('lets the expanded field use available width and Dynamic Type height', async () => {
        const { SessionListSearchChrome } = await import('./SessionListSearchChrome');
        const { resolveMinimumInteractiveTargetSize } = await import('@/components/ui/interactiveTargetSize');
        const screen = await renderScreen(
            <SessionListSearchChrome
                tagOptions={[{ id: 'tag:a', label: 'alpha' }]}
                selectedTagOptionIds={[]}
                searchQuery="responsive"
                onToggleTagOption={vi.fn()}
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
                tagOptions={[]}
                selectedTagOptionIds={[]}
                searchQuery=""
                onToggleTagOption={vi.fn()}
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
                tagOptions={[]}
                selectedTagOptionIds={[]}
                searchQuery=""
                onToggleTagOption={vi.fn()}
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

});
