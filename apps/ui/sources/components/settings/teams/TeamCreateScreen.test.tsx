import * as React from 'react';
import { act } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    collectRenderedTestIds,
    createHomeGovernanceHarness,
    homeGovernanceProjectionFixture,
    homeAccountPickerRowFixture,
    installHomeGovernanceBoundaries,
    renderScreen,
    standardCleanup,
    teamCapabilitiesFixture,
    teamSummaryFixture,
} from '@/dev/testkit';
import { resetServerFeaturesClientForTests } from '@/sync/api/capabilities/serverFeaturesClient';

import { installSettingsViewCommonModuleMocks } from '../settingsViewTestHelpers';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const routerReplace = vi.hoisted(() => vi.fn());
const pickImages = vi.hoisted(() => vi.fn());

installSettingsViewCommonModuleMocks({
    router: async () => ({
        useRouter: () => ({ push: vi.fn(), replace: routerReplace, back: vi.fn() }),
        useNavigation: () => ({ setOptions: vi.fn() }),
        useLocalSearchParams: () => ({}),
    }),
});

vi.mock('@/utils/files/nativePickImages', () => ({ nativePickImages: pickImages }));
vi.mock('expo-file-system', () => ({
    File: class {
        async bytes(): Promise<Uint8Array> { return new Uint8Array(); }
    },
}));

const harness = createHomeGovernanceHarness();
installHomeGovernanceBoundaries(harness);

const ELIGIBILITY_PATH = '/v1/home/governance/eligibility/get';
const GOVERNANCE_PATH = '/v1/home/governance/get';
const TEAM_CREATE_PATH = '/v1/teams/create';
const TEAM_LOGO_SET_PATH = '/v1/teams/logo/set';
const HOME_ACCOUNT_SEARCH_PATH = '/v1/home/accounts/search';

async function renderCreate(administrationServerId?: string) {
    const { TeamCreateScreen } = await import('./TeamCreateScreen');
    return renderScreen(<TeamCreateScreen administrationServerId={administrationServerId} />);
}

beforeEach(async () => {
    const { resetHomeGovernanceEligibilitySnapshotsForTests } = await import(
        '@/sync/store/home/governance/homeGovernanceEligibilitySnapshots'
    );
    const { resetHomeGovernanceEligibilityEngineForTests } = await import(
        '@/sync/engine/home/governance/homeGovernanceEligibilityEngine'
    );
    const { resetHomeGovernanceSnapshotsForTests } = await import(
        '@/sync/store/home/governance/homeGovernanceSnapshots'
    );
    const { resetHomeGovernanceEngineForTests } = await import(
        '@/sync/engine/home/governance/homeGovernanceEngine'
    );
    const { resetTeamActionClientForTests } = await import('@/sync/ops/teams/teamActionClient');
    resetHomeGovernanceEligibilitySnapshotsForTests();
    resetHomeGovernanceEligibilityEngineForTests();
    resetHomeGovernanceSnapshotsForTests();
    resetHomeGovernanceEngineForTests();
    resetTeamActionClientForTests();
    resetServerFeaturesClientForTests();
    await harness.reset();
    await harness.selectHomes([]);
    routerReplace.mockReset();
    pickImages.mockReset();
});

afterEach(() => {
    standardCleanup();
});

describe('TeamCreateScreen', () => {
    it('starts only one Team creation when activated twice before the busy state renders', async () => {
        let releaseCreate = (): void => {};
        const respondAfter = new Promise<void>((resolve) => { releaseCreate = resolve; });
        const home = await harness.addHome({
            name: 'Home A',
            serverUrl: 'https://home-a.example',
            accountId: 'member-a',
            teamsEnabled: true,
        });
        await harness.selectHomes([home]);
        harness.answer(home, ELIGIBILITY_PATH, { body: { teamsEnabled: true, createTeam: true } });
        harness.answer(home, TEAM_CREATE_PATH, {
            body: teamSummaryFixture({ id: 'server-team-id', name: 'Platform' }),
            respondAfter,
        });

        const screen = await renderCreate();
        await vi.waitFor(() => expect(collectRenderedTestIds(screen.tree.toJSON())).toContain('teams-create-submit'));
        act(() => screen.changeTextByTestId('teams-create-name', 'Platform'));
        act(() => {
            screen.pressByTestId('teams-create-submit');
            screen.pressByTestId('teams-create-submit');
        });

        await vi.waitFor(() => expect(harness.requestsFor(TEAM_CREATE_PATH)).toHaveLength(1));
        await act(async () => releaseCreate());
    });

    it('admits an ordinary member from only the minimum eligibility projection', async () => {
        const home = await harness.addHome({
            name: 'Home A',
            serverUrl: 'https://home-a.example',
            accountId: 'member-a',
            teamsEnabled: true,
        });
        await harness.selectHomes([home]);
        harness.answer(home, ELIGIBILITY_PATH, { body: { teamsEnabled: true, createTeam: true } });

        const screen = await renderCreate();
        await vi.waitFor(() => {
            expect(collectRenderedTestIds(screen.tree.toJSON())).toContain('teams-create-submit');
        });

        expect(harness.requestsFor(ELIGIBILITY_PATH)).toHaveLength(1);
        expect(harness.requestsFor(GOVERNANCE_PATH)).toHaveLength(0);
        expect(collectRenderedTestIds(screen.tree.toJSON())).not.toContain('teams-create-owner-search');
    });

    it('uses the full projection only for an explicit admitted Home Administration entry', async () => {
        const home = await harness.addHome({
            name: 'Home A',
            serverUrl: 'https://home-a.example',
            accountId: 'admin-a',
            teamsEnabled: true,
        });
        harness.answer(home, GOVERNANCE_PATH, { body: homeGovernanceProjectionFixture() });

        const screen = await renderCreate(home);
        await vi.waitFor(() => {
            expect(collectRenderedTestIds(screen.tree.toJSON())).toContain('teams-create-owner-search');
        });

        expect(harness.requestsFor(GOVERNANCE_PATH)).toHaveLength(1);
        expect(harness.requestsFor(ELIGIBILITY_PATH)).toHaveLength(0);
        expect(screen.findByTestId('teams-create-submit')?.props.disabled).toBe(true);
    });

    it('exposes Home and initial-owner choices as labeled radio groups with checked state', async () => {
        const home = await harness.addHome({
            name: 'Home A',
            serverUrl: 'https://home-a.example',
            accountId: 'admin-a',
            teamsEnabled: true,
        });
        harness.answer(home, GOVERNANCE_PATH, { body: homeGovernanceProjectionFixture() });
        harness.answer(home, HOME_ACCOUNT_SEARCH_PATH, {
            body: { accounts: [homeAccountPickerRowFixture('owner-grace', 'Grace')] },
        });

        const screen = await renderCreate(home);
        await vi.waitFor(() => {
            expect(collectRenderedTestIds(screen.tree.toJSON())).toContain('teams-create-owner-search');
        });

        const selectedHome = screen.findByTestId(`teams-create-home:${home}`);
        expect([selectedHome?.props.accessibilityRole, selectedHome?.props.role]).toContain('radio');
        expect(selectedHome?.props.accessibilityState).toMatchObject({ checked: true });

        let homeGroup = selectedHome?.parent ?? null;
        while (homeGroup
            && homeGroup.props.accessibilityRole !== 'radiogroup'
            && homeGroup.props.role !== 'radiogroup') {
            homeGroup = homeGroup.parent;
        }
        expect(homeGroup).not.toBeNull();
        expect(homeGroup?.props.accessibilityLabel ?? homeGroup?.props['aria-label']).toBe('teams.homeLabel');

        act(() => screen.changeTextByTestId('teams-create-owner-search', 'Grace'));
        await vi.waitFor(() => {
            expect(collectRenderedTestIds(screen.tree.toJSON())).toContain('teams-create-owner:owner-grace');
        });

        const owner = screen.findByTestId('teams-create-owner:owner-grace');
        expect([owner?.props.accessibilityRole, owner?.props.role]).toContain('radio');
        expect(owner?.props.accessibilityState).toMatchObject({ checked: false });

        let ownerGroup = owner?.parent ?? null;
        while (ownerGroup
            && ownerGroup.props.accessibilityRole !== 'radiogroup'
            && ownerGroup.props.role !== 'radiogroup') {
            ownerGroup = ownerGroup.parent;
        }
        expect(ownerGroup).not.toBeNull();
        expect(ownerGroup?.props.accessibilityLabel ?? ownerGroup?.props['aria-label']).toBe('teams.create.initialOwnerLabel');

        await screen.pressByTestIdAsync('teams-create-owner:owner-grace');
        expect(screen.findByTestId('teams-create-owner:owner-grace')?.props.accessibilityState)
            .toMatchObject({ checked: true });
    });

    it('keeps an eligible Home visible but makes creation read-only after an offline refresh', async () => {
        const home = await harness.addHome({
            name: 'Home A',
            serverUrl: 'https://home-a.example',
            accountId: 'member-a',
            teamsEnabled: true,
        });
        await harness.selectHomes([home]);
        harness.answer(home, ELIGIBILITY_PATH, { body: { teamsEnabled: true, createTeam: true } });

        const screen = await renderCreate();
        await vi.waitFor(() => {
            expect(collectRenderedTestIds(screen.tree.toJSON())).toContain('teams-create-submit');
        });

        const { applyHomeGovernanceEligibilityFailure } = await import(
            '@/sync/store/home/governance/homeGovernanceEligibilitySnapshots'
        );
        act(() => applyHomeGovernanceEligibilityFailure({
            scope: { serverId: home, accountId: 'member-a' },
            error: { kind: 'unreachable', retryable: true },
        }));

        await vi.waitFor(() => {
            expect(collectRenderedTestIds(screen.tree.toJSON())).toContain('teams-create-stale');
        });
        expect(collectRenderedTestIds(screen.tree.toJSON())).not.toContain('teams-create-submit');
        expect(screen.findByTestId(`teams-create-home:${home}`)).not.toBeNull();
    });

    it('creates once, then uploads a confirmed logo using the returned Team id and captured Home', async () => {
        const home = await harness.addHome({
            name: 'Home A',
            serverUrl: 'https://home-a.example',
            accountId: 'member-a',
            teamsEnabled: true,
        });
        await harness.selectHomes([home]);
        harness.answer(home, ELIGIBILITY_PATH, { body: { teamsEnabled: true, createTeam: true } });
        const created = teamSummaryFixture({
            id: 'server-team-id',
            name: 'Platform',
            capabilities: teamCapabilitiesFixture({ manageSettings: true }),
        });
        harness.answer(home, TEAM_CREATE_PATH, { body: created });
        harness.answer(home, TEAM_LOGO_SET_PATH, {
            body: { ...created, logo: { path: 'teams/server-team-id/logo.webp', url: 'https://home-a.example/logo.webp', thumbhash: 'logo' } },
        });
        const bytes = new Uint8Array([137, 80, 78, 71]);
        pickImages.mockResolvedValue([{
            kind: 'web',
            file: { type: 'image/png', arrayBuffer: async () => bytes.buffer },
        }]);

        const screen = await renderCreate();
        await vi.waitFor(() => expect(collectRenderedTestIds(screen.tree.toJSON())).toContain('teams-create-submit'));
        act(() => screen.changeTextByTestId('teams-create-name', 'Platform'));
        await screen.pressByTestIdAsync('teams-create-logo-set');
        await screen.pressByTestIdAsync('teams-create-logo-use');
        expect(harness.requestsFor(TEAM_LOGO_SET_PATH)).toHaveLength(0);

        await screen.pressByTestIdAsync('teams-create-submit');
        await vi.waitFor(() => expect(harness.requestsFor(TEAM_LOGO_SET_PATH)).toHaveLength(1));
        expect(harness.requestsFor(TEAM_CREATE_PATH)).toHaveLength(1);
        expect(harness.requestsFor(TEAM_LOGO_SET_PATH)[0]).toMatchObject({
            serverId: home,
            input: { teamId: 'server-team-id', image: { mimeType: 'image/png' } },
        });
        // Navigation follows the published logo, not the issued request: the
        // Team is opened once the Home's answer has been accepted.
        await vi.waitFor(() => expect(routerReplace)
            .toHaveBeenCalledWith(`/settings/teams/${home}/server-team-id`));
    });

    it('retains a confirmed logo after upload failure and retries without creating another Team', async () => {
        const home = await harness.addHome({
            name: 'Home A',
            serverUrl: 'https://home-a.example',
            accountId: 'member-a',
            teamsEnabled: true,
        });
        await harness.selectHomes([home]);
        harness.answer(home, ELIGIBILITY_PATH, { body: { teamsEnabled: true, createTeam: true } });
        const created = teamSummaryFixture({ id: 'server-team-id', name: 'Platform' });
        harness.answer(home, TEAM_CREATE_PATH, { body: created });
        harness.answer(home, TEAM_LOGO_SET_PATH, { status: 503, body: { error: 'unavailable' } });
        const bytes = new Uint8Array([137, 80, 78, 71]);
        pickImages.mockResolvedValue([{
            kind: 'web',
            file: { type: 'image/png', arrayBuffer: async () => bytes.buffer },
        }]);

        const screen = await renderCreate();
        await vi.waitFor(() => expect(collectRenderedTestIds(screen.tree.toJSON())).toContain('teams-create-submit'));
        act(() => screen.changeTextByTestId('teams-create-name', 'Platform'));
        await screen.pressByTestIdAsync('teams-create-logo-set');
        await screen.pressByTestIdAsync('teams-create-logo-use');
        await screen.pressByTestIdAsync('teams-create-submit');

        await vi.waitFor(() => {
            expect(collectRenderedTestIds(screen.tree.toJSON())).toContain('teams-create-continue-without-logo');
        });
        expect(harness.requestsFor(TEAM_CREATE_PATH)).toHaveLength(1);
        expect(harness.requestsFor(TEAM_LOGO_SET_PATH)).toHaveLength(1);
        expect(JSON.stringify(screen.tree.toJSON())).toContain('data:image/png;base64,');

        harness.answer(home, TEAM_LOGO_SET_PATH, {
            body: { ...created, logo: { path: 'teams/server-team-id/logo.webp', url: 'https://home-a.example/logo.webp', thumbhash: 'logo' } },
        });
        await screen.pressByTestIdAsync('teams-create-submit');
        await vi.waitFor(() => expect(routerReplace).toHaveBeenCalled());
        expect(harness.requestsFor(TEAM_CREATE_PATH)).toHaveLength(1);
        expect(harness.requestsFor(TEAM_LOGO_SET_PATH)).toHaveLength(2);
    });

    it('keeps logo retry and navigation bound to the Home whose delayed create committed', async () => {
        const homeA = await harness.addHome({
            name: 'Home A',
            serverUrl: 'https://home-a.example',
            accountId: 'member-a',
            teamsEnabled: true,
        });
        const homeB = await harness.addHome({
            name: 'Home B',
            serverUrl: 'https://home-b.example',
            accountId: 'member-b',
            teamsEnabled: true,
        });
        await harness.selectHomes([homeA, homeB]);
        harness.answer(homeA, ELIGIBILITY_PATH, { body: { teamsEnabled: true, createTeam: true } });
        harness.answer(homeB, ELIGIBILITY_PATH, { body: { teamsEnabled: true, createTeam: true } });

        let releaseCreateResponse = (): void => {};
        const createResponseGate = new Promise<void>((resolve) => {
            releaseCreateResponse = resolve;
        });
        const created = teamSummaryFixture({ id: 'same-team-id', name: 'Platform' });
        harness.answer(homeA, TEAM_CREATE_PATH, { body: created, respondAfter: createResponseGate });
        harness.answer(homeA, TEAM_LOGO_SET_PATH, { status: 503, body: { error: 'unavailable' } });
        // The same Team id can exist on another Home. An accidental scope switch
        // would therefore look valid unless the owning Home is asserted too.
        harness.answer(homeB, TEAM_LOGO_SET_PATH, {
            body: { ...created, logo: { path: 'teams/server-team-id/logo.webp', url: 'https://home-b.example/logo.webp', thumbhash: 'wrong-home' } },
        });
        const bytes = new Uint8Array([137, 80, 78, 71]);
        pickImages.mockResolvedValue([{
            kind: 'web',
            file: { type: 'image/png', arrayBuffer: async () => bytes.buffer },
        }]);

        const screen = await renderCreate();
        await vi.waitFor(() => expect(collectRenderedTestIds(screen.tree.toJSON())).toContain('teams-create-submit'));
        await screen.pressByTestIdAsync(`teams-create-home:${homeA}`);
        act(() => screen.changeTextByTestId('teams-create-name', 'Platform'));
        await screen.pressByTestIdAsync('teams-create-logo-set');
        await screen.pressByTestIdAsync('teams-create-logo-use');

        // Capture the press before submission to model an already-queued Home
        // choice racing the disabled-state render.
        const staleHomeBPress = screen.findByTestId(`teams-create-home:${homeB}`)?.props.onPress;
        screen.pressByTestId('teams-create-submit');
        await vi.waitFor(() => expect(harness.requestsFor(TEAM_CREATE_PATH)).toHaveLength(1));
        expect(screen.findByTestId(`teams-create-home:${homeB}`)?.props.disabled).toBe(true);
        act(() => staleHomeBPress?.());
        act(() => releaseCreateResponse());

        await vi.waitFor(() => {
            expect(collectRenderedTestIds(screen.tree.toJSON())).toContain('teams-create-continue-without-logo');
        });
        expect(harness.requestsFor(TEAM_CREATE_PATH)).toEqual([
            expect.objectContaining({ serverId: homeA }),
        ]);
        expect(harness.requestsFor(TEAM_LOGO_SET_PATH)).toEqual([
            expect.objectContaining({ serverId: homeA, input: expect.objectContaining({ teamId: 'same-team-id' }) }),
        ]);

        harness.answer(homeA, TEAM_LOGO_SET_PATH, {
            body: { ...created, logo: { path: 'teams/server-team-id/logo.webp', url: 'https://home-a.example/logo.webp', thumbhash: 'right-home' } },
        });
        await screen.pressByTestIdAsync('teams-create-submit');
        await vi.waitFor(() => expect(routerReplace).toHaveBeenCalledWith(
            `/settings/teams/${homeA}/same-team-id`,
        ));
        expect(harness.requestsFor(TEAM_CREATE_PATH)).toHaveLength(1);
        expect(harness.requestsFor(TEAM_LOGO_SET_PATH).map((request) => request.serverId)).toEqual([homeA, homeA]);
    });
});
