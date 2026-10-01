import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { renderScreen, standardCleanup } from '@/dev/testkit';
import { installSessionShellCommonModuleMocks } from './sessionShellTestHelpers';

installSessionShellCommonModuleMocks({
    text: async () => {
        const { createTextModuleMock } = await import('@/dev/testkit/mocks/text');
        return createTextModuleMock({ translate: (key: string) => key });
    },
});

// Item is the list-row presentation leaf; the rail line only needs its title and trailing slot.
vi.mock('@/components/ui/lists/Item', () => ({
    Item: (props: any) => React.createElement('Item', props, props.title, props.rightElement),
}));

const filters = {
    scope: 'my_work',
    attention: 'any',
    homeServerIds: ['home-a'],
    audiences: [],
    tagIds: [],
    source: 'all',
    searchQuery: '',
} as const;

function stateProps(overrides: Record<string, unknown> = {}) {
    return {
        presentation: { kind: 'ready', complete: true },
        visibleSessionCount: 0,
        filters,
        defaults: filters,
        viewContext: { kind: 'global' },
        includeInactive: true,
        hasHiddenInactiveSessions: false,
        onRetry: vi.fn(),
        onLoadMore: vi.fn(),
        onClearFilters: vi.fn(),
        onBrowseAllAccessible: vi.fn(),
        onShowInactive: vi.fn(),
        ...overrides,
    } as any;
}

describe('SessionListViewEmptyState in the rail', () => {
    afterEach(() => {
        standardCleanup();
    });

    it('says an empty scope in one line with a quiet way to show everything', async () => {
        const props = stateProps();
        const { SessionListViewEmptyState } = await import('./SessionListViewEmptyState');
        const screen = await renderScreen(<SessionListViewEmptyState {...props} />);

        const line = screen.findByTestId('session-list-query-empty-state');
        expect(line?.findByType('Item' as any).props.title).toBe('sessionsList.queryMyWorkEmptyTitle');
        // One line: no purpose paragraph, no glyph, no full-width button.
        expect(line?.findByType('Item' as any).props.rightElement).toBeTruthy();
        expect(screen.getTextContent()).not.toContain('sessionsList.queryScopeEmptyDescription');
        await screen.pressByTestIdAsync('session-list-query-action:browse_all_accessible');
        expect(props.onBrowseAllAccessible).toHaveBeenCalledTimes(1);
    });

    it('says a failed refresh in one line with Retry', async () => {
        const props = stateProps({ presentation: { kind: 'error', retainedRows: false } });
        const { SessionListViewEmptyState } = await import('./SessionListViewEmptyState');
        const screen = await renderScreen(<SessionListViewEmptyState {...props} />);

        expect(screen.findByTestId('session-list-query-empty-state')?.findByType('Item' as any).props.title)
            .toBe('sessionsList.queryRefreshFailedTitle');
        expect(screen.getTextContent()).not.toContain('sessionsList.queryRefreshFailedEmptyDescription');
        await screen.pressByTestIdAsync('session-list-query-action:retry');
        expect(props.onRetry).toHaveBeenCalledTimes(1);
    });

    it('holds the first load with skeleton rows in the list shape instead of a loading message', async () => {
        const props = stateProps({ presentation: { kind: 'initial_loading' } });
        const { SessionListViewEmptyState } = await import('./SessionListViewEmptyState');
        const screen = await renderScreen(<SessionListViewEmptyState {...props} />);

        expect(screen.getTextContent()).not.toContain('sessionsList.queryInitialLoadingTitle');
        expect(screen.findByTestId('session-list-skeleton')).toBeTruthy();
        expect(screen.findByTestId('session-list-skeleton-row:0')).toBeTruthy();
    });
});
