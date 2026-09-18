import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { renderScreen, standardCleanup } from '@/dev/testkit';

import { createSessionListViewFilterDefaults } from './sessionListViewFilters';
import type { SessionListViewFilterController } from './useSessionListViewFilterController';

const editorControlSpy = vi.fn();

vi.mock('./SessionListFilterEditorControl', () => ({
    SessionListFilterEditorControl: (props: Readonly<Record<string, unknown>>) => {
        editorControlSpy(props);
        return React.createElement('SessionListFilterEditorControl', props);
    },
}));

afterEach(() => {
    standardCleanup();
    editorControlSpy.mockClear();
});

function controller(
    overrides: Partial<SessionListViewFilterController> = {},
): SessionListViewFilterController {
    const filters = createSessionListViewFilterDefaults({ homeServerIds: ['home-a'] });
    return {
        filters,
        defaultFilters: filters,
        updateFilters: vi.fn(),
        setSearchQuery: vi.fn(),
        removeAuthoritativelyDeletedSelections: vi.fn(),
        resetFilters: vi.fn(),
        includeInactive: true,
        corpusStorage: 'active',
        setIncludeInactive: vi.fn(),
        setSource: vi.fn(),
        queryEnabled: false,
        corpusPresentation: 'legacy_owner_or_direct',
        queryHomes: [],
        pagingHomes: undefined,
        followingAvailable: false,
        sourceAvailable: false,
        homeOptions: [{ serverId: 'home-a', label: 'Home A' }],
        viewContext: { kind: 'global' },
        viewContextKey: 'global',
        retentionScopeKey: 'global:home-a',
        ...overrides,
    };
}

describe('SessionListFilterControl legacy corpus presentation', () => {
    it('labels the released owner/direct corpus truthfully and exposes no semantic query scopes', async () => {
        const { SessionListFilterControl } = await import('./SessionListFilterControl');
        await renderScreen(
            <SessionListFilterControl
                controller={controller()}
                organizationProjectionsByServerId={{}}
            />,
        );

        const props = editorControlSpy.mock.lastCall?.[0] as Readonly<{
            label: string;
            editor: Readonly<{ queryEnabled: boolean }>;
        }>;
        expect(props.label).toBe('Owned & shared directly');
        expect(props.label).not.toContain('My work');
        expect(props.editor.queryEnabled).toBe(false);
    });

    it('retains My work and semantic query scopes when exact filtered listing is available', async () => {
        const { SessionListFilterControl } = await import('./SessionListFilterControl');
        await renderScreen(
            <SessionListFilterControl
                controller={controller({ queryEnabled: true, corpusPresentation: 'semantic_query' })}
                organizationProjectionsByServerId={{}}
            />,
        );

        const props = editorControlSpy.mock.lastCall?.[0] as Readonly<{
            label: string;
            editor: Readonly<{ queryEnabled: boolean }>;
        }>;
        expect(props.label).toBe('My work');
        expect(props.editor.queryEnabled).toBe(true);
    });

    it('marks the inactive preference unavailable for the archived corpus', async () => {
        const { SessionListFilterControl } = await import('./SessionListFilterControl');
        await renderScreen(
            <SessionListFilterControl
                controller={controller({ corpusStorage: 'archived' })}
                organizationProjectionsByServerId={{}}
            />,
        );

        const props = editorControlSpy.mock.lastCall?.[0] as Readonly<{
            editor: Readonly<{ inactiveVisibilityAvailable: boolean }>;
        }>;
        expect(props.editor.inactiveVisibilityAvailable).toBe(false);
    });
});
