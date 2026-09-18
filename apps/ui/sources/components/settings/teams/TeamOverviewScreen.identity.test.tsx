import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    collectRenderedTestIds,
    createHomeGovernanceHarness,
    installHomeGovernanceBoundaries,
    renderScreen,
    standardCleanup,
    teamCapabilitiesFixture,
    teamSummaryFixture,
} from '@/dev/testkit';

import { installSettingsViewCommonModuleMocks } from '../settingsViewTestHelpers';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const routerPush = vi.hoisted(() => vi.fn());

installSettingsViewCommonModuleMocks({
    router: async () => ({
        useRouter: () => ({ push: routerPush, back: vi.fn(), replace: vi.fn() }),
        useNavigation: () => ({ setOptions: vi.fn() }),
        useLocalSearchParams: () => ({}),
    }),
});

const harness = createHomeGovernanceHarness();
installHomeGovernanceBoundaries(harness);

const TEAM_GET_PATH = '/v1/teams/get';

async function renderOverview(serverId: string) {
    const { TeamOverviewScreen } = await import('./TeamOverviewScreen');
    return renderScreen(<TeamOverviewScreen serverId={serverId} teamId="team-1" />);
}

async function addHome(team: Parameters<typeof teamSummaryFixture>[0]): Promise<string> {
    const serverId = await harness.addHome({
        name: 'Home A',
        serverUrl: 'https://home-a.example',
        accountId: 'account-ada',
        teamsEnabled: true,
    });
    await harness.selectHomes([serverId]);
    harness.answer(serverId, TEAM_GET_PATH, { body: teamSummaryFixture(team) });
    return serverId;
}

async function waitForTestId(
    screen: Awaited<ReturnType<typeof renderOverview>>,
    testID: string,
): Promise<void> {
    await vi.waitFor(() => {
        expect(collectRenderedTestIds(screen.tree.toJSON())).toContain(testID);
    });
}

beforeEach(async () => {
    const { resetTeamsSnapshotsForTests } = await import('@/sync/store/teams/teamsSnapshots');
    const { resetTeamsDirectoryEngineForTests } = await import('@/sync/engine/teams/teamsDirectoryEngine');
    const { resetTeamActionClientForTests } = await import('@/sync/ops/teams/teamActionClient');
    resetTeamsSnapshotsForTests();
    resetTeamsDirectoryEngineForTests();
    resetTeamActionClientForTests();
    await harness.reset();
    await harness.selectHomes([]);
    routerPush.mockReset();
});

afterEach(() => {
    standardCleanup();
});

describe('TeamOverviewScreen Team identity', () => {
    it('renders the Team logo the Home published, not a name-derived stand-in', async () => {
        const serverId = await addHome({
            name: 'Acme',
            logo: {
                path: 'public/teams/team-1/logo.png',
                url: 'https://home-a.example/logo.png',
                thumbhash: 'abc',
            },
            capabilities: teamCapabilitiesFixture({ manageMembers: true }),
        });

        const screen = await renderOverview(serverId);
        await waitForTestId(screen, 'team-overview-identity');

        // The Home's own logo reaches the avatar owner. A Team that has one must
        // show it here exactly as the directory row and the join screen do.
        expect(JSON.stringify(screen.tree.toJSON()))
            .toContain('https://home-a.example/logo.png');
    });

    it('still anchors on Team identity when the Home published no logo', async () => {
        const serverId = await addHome({
            name: 'Acme',
            logo: null,
            capabilities: teamCapabilitiesFixture({ manageMembers: true }),
        });

        const screen = await renderOverview(serverId);
        await waitForTestId(screen, 'team-overview-identity');

        // No logo is not "no identity": the shared avatar owner derives a
        // monogram and accent from the immutable Team id, so the row is still a
        // recognizable Team rather than an unbranded line of text.
        const ids = collectRenderedTestIds(screen.tree.toJSON());
        expect(ids).toContain('team-overview-identity');
        expect(ids).toContain('team-overview-home');
        // Nothing fabricates an image URL when the Home published none.
        expect(JSON.stringify(screen.tree.toJSON())).not.toContain('logo.png');
    });

    it('opens the ordinary Team Sessions destination with its exact Home-qualified address', async () => {
        const serverId = await addHome({
            name: 'Acme',
            logo: null,
            capabilities: teamCapabilitiesFixture(),
        });
        const screen = await renderOverview(serverId);
        await waitForTestId(screen, 'team-overview-sessions');

        screen.tree.root.findByProps({ testID: 'team-overview-sessions' }).props.onPress();

        expect(routerPush).toHaveBeenCalledWith(
            `/teams/team-1/sessions?serverId=${encodeURIComponent(serverId)}`,
        );
    });

    it('shows owner-required recovery and routes an authorized Home administrator to the roster', async () => {
        const serverId = await addHome({
            name: 'Acme',
            logo: null,
            capabilities: teamCapabilitiesFixture(),
            recovery: { kind: 'owner_required', canAppointOwner: true },
        });
        const screen = await renderOverview(serverId);
        await waitForTestId(screen, 'team-owner-required-choose');

        await screen.pressByTestIdAsync('team-owner-required-choose');

        expect(routerPush).toHaveBeenCalledWith(
            `/settings/teams/${encodeURIComponent(serverId)}/team-1/members`,
        );
    });

    it('shows the owner-required fact without offering recovery to an unauthorized viewer', async () => {
        const serverId = await addHome({
            name: 'Acme',
            logo: null,
            capabilities: teamCapabilitiesFixture(),
            recovery: { kind: 'owner_required', canAppointOwner: false },
        });
        const screen = await renderOverview(serverId);
        await waitForTestId(screen, 'team-owner-required');

        expect(collectRenderedTestIds(screen.tree.toJSON())).not.toContain('team-owner-required-choose');
    });
});
