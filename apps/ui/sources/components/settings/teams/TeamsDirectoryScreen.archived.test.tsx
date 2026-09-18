import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    collectRenderedTestIds,
    createHomeGovernanceHarness,
    installHomeGovernanceBoundaries,
    renderScreen,
    standardCleanup,
    teamSummaryFixture,
} from '@/dev/testkit';
import { resetServerFeaturesClientForTests } from '@/sync/api/capabilities/serverFeaturesClient';

import { installSettingsViewCommonModuleMocks } from '../settingsViewTestHelpers';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const routerPush = vi.hoisted(() => vi.fn());

vi.mock('@/components/ui/lists/virtualized', () => ({
    VirtualizedList: (props: Record<string, unknown>) => {
        const data = (props.data as readonly unknown[] | undefined) ?? [];
        const renderItem = props.renderItem as (info: { item: unknown; index: number }) => React.ReactNode;
        return React.createElement(
            'VirtualizedList',
            props,
            props.ListHeaderComponent as React.ReactNode,
            ...data.map((item, index) => renderItem({ item, index })),
        );
    },
}));

installSettingsViewCommonModuleMocks({
    router: async () => ({
        useRouter: () => ({ push: routerPush, replace: vi.fn(), back: vi.fn() }),
        useNavigation: () => ({ setOptions: vi.fn() }),
        useLocalSearchParams: () => ({}),
    }),
});

const harness = createHomeGovernanceHarness();
installHomeGovernanceBoundaries(harness);

const ELIGIBILITY_PATH = '/v1/home/governance/eligibility/get';
const TEAMS_LIST_PATH = '/v1/teams/list';

async function renderDirectory() {
    const { TeamsDirectoryScreen } = await import('./TeamsDirectoryScreen');
    return renderScreen(<TeamsDirectoryScreen />);
}

beforeEach(async () => {
    const { resetTeamsSnapshotsForTests } = await import('@/sync/store/teams/teamsSnapshots');
    const { resetTeamsDirectoryEngineForTests } = await import('@/sync/engine/teams/teamsDirectoryEngine');
    const { resetHomeGovernanceEligibilitySnapshotsForTests } = await import(
        '@/sync/store/home/governance/homeGovernanceEligibilitySnapshots'
    );
    const { resetHomeGovernanceEligibilityEngineForTests } = await import(
        '@/sync/engine/home/governance/homeGovernanceEligibilityEngine'
    );
    resetTeamsSnapshotsForTests();
    resetTeamsDirectoryEngineForTests();
    resetHomeGovernanceEligibilitySnapshotsForTests();
    resetHomeGovernanceEligibilityEngineForTests();
    resetServerFeaturesClientForTests();
    await harness.reset();
    await harness.selectHomes([]);
    routerPush.mockReset();
});

afterEach(() => standardCleanup());

/**
 * Opening "Show archived" asks a question, and the section always answers it.
 *
 * The archived sequence is a separate read from the active one, so its own
 * emptiness, its own progress and its own unreachable Homes have to be stated
 * where the person is looking. A section that renders nothing at all is
 * indistinguishable from a control that did not work.
 */
describe('TeamsDirectoryScreen archived Teams', () => {
    it('states that a Home has no archived Teams instead of showing nothing', async () => {
        const home = await harness.addHome({
            name: 'Home A',
            serverUrl: 'https://home-a.example',
            accountId: 'member-a',
            teamsEnabled: true,
        });
        await harness.selectHomes([home]);
        harness.answer(home, ELIGIBILITY_PATH, { body: { teamsEnabled: true, createTeam: false } });
        harness.answer(home, TEAMS_LIST_PATH, {
            body: { items: [teamSummaryFixture({ id: 'team-1' })], nextCursor: null },
        });

        const screen = await renderDirectory();
        await vi.waitFor(() => expect(collectRenderedTestIds(screen.tree.toJSON()))
            .toContain('teams-directory-toggle-archived'));
        expect(screen.findByTestId('teams-directory-toggle-archived')?.props.accessibilityState?.expanded)
            .toBe(false);

        harness.answer(home, TEAMS_LIST_PATH, { body: { items: [], nextCursor: null } });
        await screen.pressByTestIdAsync('teams-directory-toggle-archived');

        await vi.waitFor(() => {
            expect(collectRenderedTestIds(screen.tree.toJSON())).toContain('teams-directory-archived-empty');
        });
        expect(screen.findByTestId('teams-directory-toggle-archived')?.props.accessibilityState?.expanded)
            .toBe(true);
    });

    it('names a Home that could not answer the archived read rather than reporting an empty archive', async () => {
        const home = await harness.addHome({
            name: 'Home A',
            serverUrl: 'https://home-a.example',
            accountId: 'member-a',
            teamsEnabled: true,
        });
        await harness.selectHomes([home]);
        harness.answer(home, ELIGIBILITY_PATH, { body: { teamsEnabled: true, createTeam: false } });
        harness.answer(home, TEAMS_LIST_PATH, {
            body: { items: [teamSummaryFixture({ id: 'team-1' })], nextCursor: null },
        });

        const screen = await renderDirectory();
        await vi.waitFor(() => expect(collectRenderedTestIds(screen.tree.toJSON()))
            .toContain('teams-directory-toggle-archived'));

        harness.answer(home, TEAMS_LIST_PATH, { status: 503 });
        await screen.pressByTestIdAsync('teams-directory-toggle-archived');

        await vi.waitFor(() => {
            expect(collectRenderedTestIds(screen.tree.toJSON()))
                .toContain(`teams-archived-home-unavailable:${home}`);
            // The archive is not claimed to be empty while the Home never said so.
            expect(collectRenderedTestIds(screen.tree.toJSON()))
                .not.toContain('teams-directory-archived-empty');
        });
    });

    it('lists a Team archived from this device exactly once after the archived sequence returns it', async () => {
        const home = await harness.addHome({
            name: 'Home A',
            serverUrl: 'https://home-a.example',
            accountId: 'member-a',
            teamsEnabled: true,
        });
        await harness.selectHomes([home]);
        harness.answer(home, ELIGIBILITY_PATH, { body: { teamsEnabled: true, createTeam: false } });
        // The active sequence's own answer still carries the Team it has just
        // been told is archived; the archived sequence returns the same Team.
        harness.answer(home, TEAMS_LIST_PATH, {
            body: {
                items: [teamSummaryFixture({ id: 'team-1', archivedAt: 1_700_000_000_000 })],
                nextCursor: null,
            },
        });

        const screen = await renderDirectory();
        await vi.waitFor(() => expect(collectRenderedTestIds(screen.tree.toJSON()))
            .toContain('teams-directory-toggle-archived'));

        await screen.pressByTestIdAsync('teams-directory-toggle-archived');

        await vi.waitFor(() => {
            const ids = collectRenderedTestIds(screen.tree.toJSON());
            expect(ids.filter((id) => id === `teams-row:${home}:team-1`)).toHaveLength(1);
        });
    });
});
