import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { renderScreen, standardCleanup } from '@/dev/testkit';

import { createSessionListViewFilterDefaults } from './sessionListViewFilters';
import { SessionListFilterEditor } from './SessionListFilterEditor';

vi.mock('react-native', async () => {
    const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
    return createReactNativeWebMock();
});

afterEach(standardCleanup);

const labels = {
    search: 'Search filters', show: 'Show', myWork: 'My work', assignedToMe: 'Assigned to me',
    following: 'Following', involvingMe: 'Involving me', allAccessible: 'All accessible',
    attention: 'Attention', anyAttention: 'Any', needsMyAttention: 'Only sessions that need me',
    inactiveSessions: 'Inactive sessions', showInactive: 'Show', hideInactive: 'Hide', homes: 'Homes',
    sharedWith: 'Shared with', outsideTeams: 'Personal & direct', tags: 'Tags', source: 'Source',
    allSources: 'All', persistedSource: 'Saved in Happier', directSource: 'External', noOptions: 'No options',
    clear: 'Clear filters', done: 'Done', title: 'Session filters',
} as const;

describe('SessionListFilterEditor', () => {
    it('applies structural and Account inactive choices immediately while Done only closes', async () => {
        const updateFilters = vi.fn();
        const setIncludeInactive = vi.fn();
        const resetFilters = vi.fn();
        const onDone = vi.fn();
        const filters = createSessionListViewFilterDefaults({ homeServerIds: ['home-a'] });
        const screen = await renderScreen(
            <SessionListFilterEditor
                filters={filters}
                includeInactive={false}
                queryEnabled
                followingAvailable={false}
                sourceAvailable
                homes={[{ serverId: 'home-a', label: 'Home A' }]}
                audiences={[]}
                tags={[]}
                labels={labels}
                updateFilters={updateFilters}
                removeAuthoritativelyDeletedSelections={vi.fn()}
                setIncludeInactive={setIncludeInactive}
                setSource={vi.fn()}
                resetFilters={resetFilters}
                onDone={onDone}
                disableTransitions
            />,
        );

        screen.pressByTestId('session-list-filter-editor:session-list-filters:option:scope:all_accessible');
        expect(updateFilters).toHaveBeenCalledWith(expect.objectContaining({ scope: 'all_accessible' }));

        screen.pressByTestId('session-list-filter-editor:session-list-filters:option:inactive:show');
        expect(setIncludeInactive).toHaveBeenCalledWith(true);

        screen.pressByTestId('session-list-filter-clear');
        expect(resetFilters).toHaveBeenCalledTimes(1);

        screen.pressByTestId('session-list-filter-done');
        expect(onDone).toHaveBeenCalledTimes(1);
        expect(resetFilters).toHaveBeenCalledTimes(1);
    });

    it('keeps the compact editor actions at the canonical touch-target size', async () => {
        const filters = createSessionListViewFilterDefaults({ homeServerIds: ['home-a'] });
        const screen = await renderScreen(
            <SessionListFilterEditor
                filters={filters}
                includeInactive={false}
                queryEnabled
                followingAvailable={false}
                sourceAvailable
                homes={[{ serverId: 'home-a', label: 'Home A' }]}
                audiences={[]}
                tags={[]}
                labels={labels}
                updateFilters={vi.fn()}
                removeAuthoritativelyDeletedSelections={vi.fn()}
                setIncludeInactive={vi.fn()}
                setSource={vi.fn()}
                resetFilters={vi.fn()}
                onDone={vi.fn()}
                disableTransitions
            />,
        );
        const flatten = (style: unknown): Record<string, unknown> => (
            typeof style === 'function'
                ? flatten(style({ hovered: false, pressed: false }))
                : Array.isArray(style)
                ? style.reduce<Record<string, unknown>>((result, value) => ({ ...result, ...flatten(value) }), {})
                : (style as Record<string, unknown> | null) ?? {}
        );

        expect(flatten(screen.findByTestId('session-list-filter-clear')?.props.style).minHeight).toBe(44);
        expect(flatten(screen.findByTestId('session-list-filter-done')?.props.style).minHeight).toBe(44);
    });
});
