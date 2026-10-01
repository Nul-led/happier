import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { invokeTestInstanceHandler, renderScreen, standardCleanup } from '@/dev/testkit';

import { buildSessionListFilterTagOptionId } from './sessionListFilterEditorModel';
import { createSessionListViewFilterDefaults, type SessionListViewFilters } from './sessionListViewFilters';
import { SessionListFilterEditor, type SessionListFilterEditorProps } from './SessionListFilterEditor';

vi.mock('react-native', async () => {
    const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
    return createReactNativeWebMock();
});

afterEach(standardCleanup);

const labels = {
    search: 'Search filters', show: 'Show', myWork: 'My work', assignedToMe: 'Assigned to me',
    following: 'Following', involvingMe: 'Involving me', allAccessible: 'All accessible',
    attention: 'Attention', anyAttention: 'Any', needsMyAttention: 'Only sessions that need me',
    needsMeOnly: 'Needs me only', needsMeOnlyDescription: 'Sessions waiting on you',
    inactiveSessions: 'Inactive sessions', showInactive: 'Show', hideInactive: 'Hide', homes: 'Homes',
    sharedWith: 'Shared with', outsideTeams: 'Personal & direct', tags: 'Tags', source: 'Source',
    allSources: 'All', persistedSource: 'Happier', directSource: 'External', noOptions: 'No options',
    clear: 'Reset', done: 'Done', title: 'Session filters', archived: 'Archived',
    moreTags: (count: number) => `+ ${count} more`,
    resultCount: (count: number) => `${count} sessions`,
} as const;

type HarnessOverrides = Partial<SessionListFilterEditorProps>;

function editorProps(overrides: HarnessOverrides = {}): SessionListFilterEditorProps {
    return {
        filters: createSessionListViewFilterDefaults({ homeServerIds: ['home-a'] }),
        includeInactive: true,
        queryEnabled: true,
        followingAvailable: true,
        sourceAvailable: true,
        homes: [{ serverId: 'home-a', label: 'Home A' }],
        audiences: [],
        tags: [],
        labels,
        updateFilters: vi.fn(),
        removeAuthoritativelyDeletedSelections: vi.fn(),
        setIncludeInactive: vi.fn(),
        setSource: vi.fn(),
        resetFilters: vi.fn(),
        disableTransitions: true,
        ...overrides,
    };
}

describe('SessionListFilterEditor panel', () => {
    it('offers only the available scopes as a grid and writes the chosen one; Archived opens without writing', async () => {
        const updateFilters = vi.fn();
        const setIncludeInactive = vi.fn();
        const onOpenArchived = vi.fn();
        const screen = await renderScreen(
            <SessionListFilterEditor {...editorProps({
                followingAvailable: false,
                updateFilters,
                setIncludeInactive,
                onOpenArchived,
            })} />,
        );

        expect(screen.findByTestId('session-list-filter-scope:scope:my_work')).not.toBeNull();
        expect(screen.findByTestId('session-list-filter-scope:scope:following')).toBeNull();

        screen.pressByTestId('session-list-filter-scope:scope:all_accessible');
        expect(updateFilters).toHaveBeenLastCalledWith(expect.objectContaining({ scope: 'all_accessible' }));

        updateFilters.mockClear();
        screen.pressByTestId('session-list-filter-scope:destination:archived');
        expect(onOpenArchived).toHaveBeenCalledTimes(1);
        expect(updateFilters).not.toHaveBeenCalled();
        expect(setIncludeInactive).not.toHaveBeenCalled();
    });

    it('writes Needs me, inactive visibility and source through their existing owners', async () => {
        const updateFilters = vi.fn();
        const setIncludeInactive = vi.fn();
        const setSource = vi.fn();
        const screen = await renderScreen(
            <SessionListFilterEditor {...editorProps({ updateFilters, setIncludeInactive, setSource })} />,
        );

        invokeTestInstanceHandler(screen.findByTestId('session-list-filter-attention'), 'onValueChange', true);
        expect(updateFilters).toHaveBeenLastCalledWith(expect.objectContaining({ attention: 'needs_my_attention' }));

        screen.pressByTestId('session-list-filter:inactive:hide');
        expect(setIncludeInactive).toHaveBeenLastCalledWith(false);

        screen.pressByTestId('session-list-filter:source:direct');
        expect(setSource).toHaveBeenLastCalledWith('direct');
        // Source has its own persisted owner; it never also writes the retained view filters.
        expect(updateFilters).toHaveBeenCalledTimes(1);
    });

    it('turns Needs me off back to any attention', async () => {
        const updateFilters = vi.fn();
        const filters: SessionListViewFilters = {
            ...createSessionListViewFilterDefaults({ homeServerIds: ['home-a'] }),
            attention: 'needs_my_attention',
        };
        const screen = await renderScreen(
            <SessionListFilterEditor {...editorProps({ filters, updateFilters })} />,
        );

        expect(screen.findByTestId('session-list-filter-attention')?.props.value).toBe(true);
        invokeTestInstanceHandler(screen.findByTestId('session-list-filter-attention'), 'onValueChange', false);
        expect(updateFilters).toHaveBeenLastCalledWith(expect.objectContaining({ attention: 'any' }));
    });

    it('toggles Homes and Tags chips by qualified identity and reaches every tag through "more"', async () => {
        const updateFilters = vi.fn();
        const tags = Array.from({ length: 7 }, (_, index) => ({
            serverId: 'home-a',
            tagId: `tag-${index}`,
            label: `tag ${index}`,
        }));
        const filters = createSessionListViewFilterDefaults({ homeServerIds: ['home-a', 'home-b'] });
        const screen = await renderScreen(
            <SessionListFilterEditor {...editorProps({
                filters,
                updateFilters,
                homes: [{ serverId: 'home-a', label: 'Home A' }, { serverId: 'home-b', label: 'Home B' }],
                tags,
            })} />,
        );

        screen.pressByTestId('session-list-filter:home:home-b');
        expect(updateFilters).toHaveBeenLastCalledWith(expect.objectContaining({ homeServerIds: ['home-a'] }));

        const firstTagId = buildSessionListFilterTagOptionId(tags[0]!);
        screen.pressByTestId(`session-list-filter:${firstTagId}`);
        expect(updateFilters).toHaveBeenLastCalledWith(expect.objectContaining({
            tagIds: [{ serverId: 'home-a', tagId: 'tag-0' }],
        }));

        const lastTagId = buildSessionListFilterTagOptionId(tags[6]!);
        expect(screen.findByTestId(`session-list-filter:${lastTagId}`)).toBeNull();
        expect(screen.getTextContent()).toContain('+ 2 more');
        await screen.pressByTestIdAsync('session-list-filter-tags-more');
        await vi.waitFor(() => {
            expect(screen.findByTestId(`session-list-filter-editor:session-list-filters:option:${lastTagId}`))
                .not.toBeNull();
        });
        screen.pressByTestId(`session-list-filter-editor:session-list-filters:option:${lastTagId}`);
        expect(updateFilters).toHaveBeenLastCalledWith(expect.objectContaining({
            tagIds: [{ serverId: 'home-a', tagId: 'tag-6' }],
        }));

        await screen.pressByTestIdAsync('session-list-filter-drill-back');
        expect(screen.findByTestId('session-list-filter-scope:scope:my_work')).not.toBeNull();
    });

    it('states the result count and resets through the filter owner; Done only closes', async () => {
        const resetFilters = vi.fn();
        const onDone = vi.fn();
        const screen = await renderScreen(
            <SessionListFilterEditor {...editorProps({ resetFilters, onDone, resultCount: 14 })} />,
        );

        expect(screen.getTextContent()).toContain('14 sessions');
        // Reset is an icon-only action: it announces itself and explains itself on hover/focus.
        const reset = screen.findByTestId('session-list-filter-clear');
        expect(reset?.props.accessibilityLabel).toBe('Reset');
        expect(screen.findByTestId('session-list-filter-clear-icon')).not.toBeNull();
        screen.pressByTestId('session-list-filter-clear');
        expect(resetFilters).toHaveBeenCalledTimes(1);
        screen.pressByTestId('session-list-filter-done');
        expect(onDone).toHaveBeenCalledTimes(1);
        expect(resetFilters).toHaveBeenCalledTimes(1);
    });

    it('keeps the footer actions at the canonical touch-target size', async () => {
        const screen = await renderScreen(
            <SessionListFilterEditor {...editorProps({ onDone: vi.fn() })} />,
        );
        const flatten = (style: unknown): Record<string, unknown> => (
            typeof style === 'function'
                ? flatten(style({ hovered: false, pressed: false }))
                : Array.isArray(style)
                ? style.reduce<Record<string, unknown>>((result, value) => ({ ...result, ...flatten(value) }), {})
                : (style as Record<string, unknown> | null) ?? {}
        );

        const reset = flatten(screen.findByTestId('session-list-filter-clear')?.props.style);
        expect(Math.max(Number(reset.minHeight ?? 0), Number(reset.height ?? 0))).toBeGreaterThanOrEqual(44);
        expect(flatten(screen.findByTestId('session-list-filter-done')?.props.style).minHeight).toBe(44);
    });
});
