import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    collectRenderedTestIds,
    createHomeGovernanceHarness,
    installHomeGovernanceBoundaries,
    renderScreen,
    standardCleanup,
    homeGovernanceProjectionFixture,
} from '@/dev/testkit';
import { resetServerFeaturesClientForTests } from '@/sync/api/capabilities/serverFeaturesClient';

import { installSettingsViewCommonModuleMocks } from '../../settingsViewTestHelpers';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const routerPush = vi.hoisted(() => vi.fn());

installSettingsViewCommonModuleMocks({
    router: async () => ({
        useRouter: () => ({ push: routerPush, back: vi.fn() }),
        useNavigation: () => ({ setOptions: vi.fn() }),
        useLocalSearchParams: () => ({}),
    }),
});

const harness = createHomeGovernanceHarness();
installHomeGovernanceBoundaries(harness);

const GOVERNANCE_PATH = '/v1/home/governance/get';

async function renderHomes() {
    const { HomeAdministrationHomesScreen } = await import('./HomeAdministrationHomesScreen');
    const { resetHomeGovernanceEngineForTests } = await import('@/sync/engine/home/governance/homeGovernanceEngine');
    resetHomeGovernanceEngineForTests();
    return renderScreen(<HomeAdministrationHomesScreen />);
}

beforeEach(async () => {
    const { resetHomeGovernanceSnapshotsForTests } = await import(
        '@/sync/store/home/governance/homeGovernanceSnapshots'
    );
    resetHomeGovernanceSnapshotsForTests();
    resetServerFeaturesClientForTests();
    await harness.reset();
    await harness.selectHomes([]);
    routerPush.mockReset();
});

afterEach(() => {
    standardCleanup();
});

describe('HomeAdministrationHomesScreen', () => {
    it('offers each Home that admits this account and opens it by its own id', async () => {
        const homeA = await harness.addHome({ name: 'Home A', serverUrl: 'https://home-a.example' });
        const homeB = await harness.addHome({ name: 'Home B', serverUrl: 'https://home-b.example' });
        await harness.selectHomes([homeA, homeB]);
        harness.answer(homeA, GOVERNANCE_PATH, { body: homeGovernanceProjectionFixture() });
        harness.answer(homeB, GOVERNANCE_PATH, { body: homeGovernanceProjectionFixture() });

        const screen = await renderHomes();
        await vi.waitFor(() => {
            expect(collectRenderedTestIds(screen.tree.toJSON())).toContain(`home-admin-home:${homeB}`);
        });

        // Each Home was asked as the Account this device holds there.
        expect(new Set(harness.requestsFor(GOVERNANCE_PATH).map((request) => request.serverId)))
            .toEqual(new Set([homeA, homeB]));

        screen.pressByTestId(`home-admin-home:${homeB}`);
        expect(routerPush).toHaveBeenCalledWith(`/settings/home/${homeB}`);
    });

    it('leaves out a Home this account cannot administer while keeping its capable sibling', async () => {
        const homeA = await harness.addHome({ name: 'Home A', serverUrl: 'https://home-a.example' });
        const homeB = await harness.addHome({ name: 'Home B', serverUrl: 'https://home-b.example' });
        await harness.selectHomes([homeA, homeB]);
        harness.answer(homeA, GOVERNANCE_PATH, {
            body: homeGovernanceProjectionFixture({
                viewer: { accountId: 'account-ada', homeRole: 'member', status: 'active' },
                capabilities: {
                    ...homeGovernanceProjectionFixture().capabilities,
                    viewAdministration: false,
                },
            }),
        });
        harness.answer(homeB, GOVERNANCE_PATH, { body: homeGovernanceProjectionFixture() });

        const screen = await renderHomes();
        await vi.waitFor(() => {
            expect(collectRenderedTestIds(screen.tree.toJSON())).toContain(`home-admin-home:${homeB}`);
        });
        const ids = collectRenderedTestIds(screen.tree.toJSON());
        expect(ids).not.toContain(`home-admin-home:${homeA}`);
        expect(ids).not.toContain(`home-admin-home-unresolved:${homeA}`);
    });

    it('offers an ownerless Home so its state can be read, without a claim action', async () => {
        const home = await harness.addHome({ name: 'Home A', serverUrl: 'https://home-a.example' });
        await harness.selectHomes([home]);
        harness.answer(home, GOVERNANCE_PATH, {
            body: homeGovernanceProjectionFixture({
                viewer: { accountId: 'account-ada', homeRole: 'member', status: 'active' },
                capabilities: {
                    ...homeGovernanceProjectionFixture().capabilities,
                    viewAdministration: false,
                },
                setupState: 'setup_required',
                activeOwnerCount: 0,
            }),
        });

        const screen = await renderHomes();
        await vi.waitFor(() => {
            expect(collectRenderedTestIds(screen.tree.toJSON())).toContain(`home-admin-home:${home}`);
        });
        expect(collectRenderedTestIds(screen.tree.toJSON()).some((id) => id.includes('claim'))).toBe(false);
    });

    it('explains a Home this device is signed out of instead of offering it', async () => {
        const home = await harness.addHome({
            name: 'Home A',
            serverUrl: 'https://home-a.example',
            accountId: null,
        });
        await harness.selectHomes([home]);

        const screen = await renderHomes();
        await vi.waitFor(() => {
            expect(collectRenderedTestIds(screen.tree.toJSON()))
                .toContain(`home-admin-home-unresolved:${home}`);
        });

        // Listed with its reason, but not offered: there is nothing to open on
        // a Home this device holds no credential for, and nothing is asked of it.
        const row = screen.findByTestId(`home-admin-home-unresolved:${home}`);
        expect(row?.props?.onPress ?? row?.props?.onClick).toBeUndefined();
        expect(harness.requestsFor(GOVERNANCE_PATH)).toHaveLength(0);
        expect(routerPush).not.toHaveBeenCalled();
    });

    it('keeps an unreachable Home listed as unresolved rather than dropping it', async () => {
        const home = await harness.addHome({ name: 'Home A', serverUrl: 'https://home-a.example' });
        await harness.selectHomes([home]);
        harness.answer(home, GOVERNANCE_PATH, { status: 502, body: { error: 'bad gateway' } });

        const screen = await renderHomes();
        await vi.waitFor(() => {
            expect(collectRenderedTestIds(screen.tree.toJSON()))
                .toContain(`home-admin-home-unresolved:${home}`);
        });
    });

    it('stops offering a Home that refuses after it had already answered', async () => {
        const home = await harness.addHome({
            name: 'Home A',
            serverUrl: 'https://home-a.example',
            accountId: 'account-ada',
        });
        await harness.selectHomes([home]);
        harness.answer(home, GOVERNANCE_PATH, { body: homeGovernanceProjectionFixture() });

        const screen = await renderHomes();
        await vi.waitFor(() => {
            expect(collectRenderedTestIds(screen.tree.toJSON())).toContain(`home-admin-home:${home}`);
        });

        const { applyHomeGovernanceFailure } = await import(
            '@/sync/store/home/governance/homeGovernanceSnapshots'
        );
        const { act } = await import('react-test-renderer');
        act(() => {
            applyHomeGovernanceFailure({
                scope: { serverId: home, accountId: 'account-ada' },
                error: { kind: 'forbidden', retryable: false },
            });
        });

        // Retention keeps an offline Home readable; it must not outlive the Home
        // saying this account may not administer it.
        await vi.waitFor(() => {
            expect(collectRenderedTestIds(screen.tree.toJSON()))
                .not.toContain(`home-admin-home:${home}`);
        });
    });

    it('says so plainly when no selected Home grants administration', async () => {
        const home = await harness.addHome({ name: 'Home A', serverUrl: 'https://home-a.example' });
        await harness.selectHomes([home]);
        harness.answer(home, GOVERNANCE_PATH, {
            body: homeGovernanceProjectionFixture({
                viewer: { accountId: 'account-ada', homeRole: 'member', status: 'active' },
                capabilities: {
                    ...homeGovernanceProjectionFixture().capabilities,
                    viewAdministration: false,
                },
            }),
        });

        const screen = await renderHomes();
        await vi.waitFor(() => {
            expect(collectRenderedTestIds(screen.tree.toJSON())).toContain('home-admin-homes-none');
        });
    });

    it('claims nothing about a Home the selection points at but this device never saved', async () => {
        // The Home-view selection can name a Home this device no longer holds a
        // profile for. That is not a Home refusing administration and not an
        // empty device: it is unresolved, and it is asked nothing.
        await harness.selectHomes(['home-that-was-removed']);

        const screen = await renderHomes();
        await vi.waitFor(() => {
            const ids = collectRenderedTestIds(screen.tree.toJSON());
            expect(ids.some((id) => id.startsWith('home-admin-home'))).toBe(true);
        });
        const ids = collectRenderedTestIds(screen.tree.toJSON());
        expect(ids).not.toContain('home-admin-home:home-that-was-removed');
        expect(harness.requestsFor(GOVERNANCE_PATH)).toHaveLength(0);
    });
});
