import * as React from 'react';
import type { HomeGovernanceProjectionV1 } from '@happier-dev/protocol/home/governance';
import { act } from 'react-test-renderer';
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
import { setActiveServerId } from '@/sync/domains/server/serverProfiles';
import { getActiveServerSnapshot } from '@/sync/domains/server/serverRuntime';

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

// Only the network and the device credential store are replaced. The credential
// binding, scoped request authority, strict schemas, status classification,
// engine, store and view state below them are the production ones.
const harness = createHomeGovernanceHarness();
installHomeGovernanceBoundaries(harness);

const GOVERNANCE_PATH = '/v1/home/governance/get';

function projection(overrides?: Partial<HomeGovernanceProjectionV1>): HomeGovernanceProjectionV1 {
    return homeGovernanceProjectionFixture(overrides);
}

async function renderOverview(serverId: string) {
    const { HomeAdministrationOverviewScreen } = await import('./HomeAdministrationOverviewScreen');
    const { resetHomeGovernanceEngineForTests } = await import('@/sync/engine/home/governance/homeGovernanceEngine');
    resetHomeGovernanceEngineForTests();
    return renderScreen(<HomeAdministrationOverviewScreen serverId={serverId} />);
}

beforeEach(async () => {
    const { resetHomeGovernanceSnapshotsForTests } = await import(
        '@/sync/store/home/governance/homeGovernanceSnapshots'
    );
    resetHomeGovernanceSnapshotsForTests();
    resetServerFeaturesClientForTests();
    await harness.reset();
    routerPush.mockReset();
});

afterEach(() => {
    standardCleanup();
});

describe('HomeAdministrationSection', () => {
    it('keeps a pending Home Action reachable through its shared approval artifact', async () => {
        const home = await harness.addHome({ name: 'Home A', serverUrl: 'https://home-a.example', accountId: 'account-ada' });
        const { TokenStorage } = await import('@/auth/storage/tokenStorage');
        expect(await TokenStorage.getCredentialsForServerUrl('https://home-a.example')).not.toBeNull();
        harness.answer(home, GOVERNANCE_PATH, { body: projection() });
        const { HomeAdministrationSection } = await import('./HomeAdministrationSection');
        // Imported here, not at the top of the file: `Item` reaches the shared
        // scoped-request transport through `@/modal`, and a static import would
        // evaluate that module before `installHomeGovernanceBoundaries` replaces
        // its network leaf — leaving every Home read on the real network.
        const { Item } = await import('@/components/ui/lists/Item');

        const screen = await renderScreen(
            <HomeAdministrationSection serverId={home} title="Home">
                {(context) => (
                    <Item
                        testID="request-home-approval"
                        title="Request approval"
                        disabled={!context.mutationsAvailable}
                        onPress={context.mutationsAvailable
                            ? () => context.requestApproval?.('approval-home-1')
                            : undefined}
                    />
                )}
            </HomeAdministrationSection>,
        );
        await vi.waitFor(() => expect(collectRenderedTestIds(screen.tree.toJSON())).toContain('request-home-approval'));

        screen.pressByTestId('request-home-approval');
        await vi.waitFor(() => expect(collectRenderedTestIds(screen.tree.toJSON())).toContain('home-admin-approval'));
        expect(screen.findByTestId('request-home-approval')?.props.accessibilityState?.disabled).toBe(true);
        screen.pressByTestId('home-admin-approval');

        expect(routerPush).toHaveBeenCalledWith(
            `/inbox/approvals/approval-home-1?serverId=${encodeURIComponent(home)}`,
        );
    });

    it('says the device is signed out of a Home rather than claiming the Home refused', async () => {
        const home = await harness.addHome({ name: 'Home A', serverUrl: 'https://home-a.example', accountId: null });

        const screen = await renderOverview(home);
        await vi.waitFor(() => {
            expect(collectRenderedTestIds(screen.tree.toJSON())).toContain('home-admin-signed-out');
        });
        // Nothing is asked of a Home this device holds no credential for.
        expect(harness.requestsFor(GOVERNANCE_PATH)).toHaveLength(0);
    });

    it('reports a Home this device has never saved as unknown', async () => {
        const screen = await renderOverview('home-never-added');
        await vi.waitFor(() => {
            expect(collectRenderedTestIds(screen.tree.toJSON())).toContain('home-admin-unknown-home');
        });
    });

    it('reads the exact Home as the Account that Home is signed in as', async () => {
        const home = await harness.addHome({
            name: 'Home A',
            serverUrl: 'https://home-a.example',
            accountId: 'account-ada',
        });
        harness.answer(home, GOVERNANCE_PATH, { body: projection() });

        const screen = await renderOverview(home);
        await vi.waitFor(() => {
            expect(collectRenderedTestIds(screen.tree.toJSON())).toContain('home-admin-viewer-role');
        });

        const [request] = harness.requestsFor(GOVERNANCE_PATH);
        expect(request?.serverId).toBe(home);
        expect(request?.serverUrl).toBe('https://home-a.example');
        // The bearer the scoped authority attached is that Home's own credential.
        expect(request?.token).toContain('.');
    });

    it('offers a retry when the Home could not be reached and nothing was retained', async () => {
        const home = await harness.addHome({ name: 'Home A', serverUrl: 'https://home-a.example' });
        harness.answer(home, GOVERNANCE_PATH, { status: 500, body: { error: 'boom' } });

        const screen = await renderOverview(home);
        await vi.waitFor(() => {
            expect(collectRenderedTestIds(screen.tree.toJSON())).toContain('home-admin-unavailable');
        });
        expect(screen.findByTestId('home-admin-unavailable')?.props.accessibilityLiveRegion).toBe('assertive');
        expect(collectRenderedTestIds(screen.tree.toJSON())).toContain('home-admin-retry');

        harness.answer(home, GOVERNANCE_PATH, { body: projection() });
        const before = harness.requestsFor(GOVERNANCE_PATH).length;
        await screen.pressByTestIdAsync('home-admin-retry');

        await vi.waitFor(() => {
            expect(harness.requestsFor(GOVERNANCE_PATH).length).toBeGreaterThan(before);
            expect(collectRenderedTestIds(screen.tree.toJSON())).toContain('home-admin-viewer-role');
        });
    });

    it('does not offer a retry for a settled refusal by the Home', async () => {
        const home = await harness.addHome({ name: 'Home A', serverUrl: 'https://home-a.example' });
        harness.answer(home, GOVERNANCE_PATH, {
            status: 403,
            body: { error: 'home_governance_forbidden' },
        });

        const screen = await renderOverview(home);
        await vi.waitFor(() => {
            expect(collectRenderedTestIds(screen.tree.toJSON())).toContain('home-admin-unavailable');
        });
        expect(collectRenderedTestIds(screen.tree.toJSON())).not.toContain('home-admin-retry');
    });

    it('shows setup instructions for the typed ownerless-Home response without rendering administration data', async () => {
        const home = await harness.addHome({ name: 'Home A', serverUrl: 'https://home-a.example' });
        harness.answer(home, GOVERNANCE_PATH, {
            status: 409,
            body: { error: 'home_governance_setup_required' },
        });

        const screen = await renderOverview(home);
        await vi.waitFor(() => {
            expect(collectRenderedTestIds(screen.tree.toJSON())).toContain('home-admin-setup-required');
        });
        const ids = collectRenderedTestIds(screen.tree.toJSON());
        expect(ids).not.toContain('home-admin-viewer-role');
        expect(ids).not.toContain('home-admin-people');
        expect(ids).not.toContain('home-admin-policies');
        expect(ids.some((id) => id.includes('claim'))).toBe(false);
    });

    it('reports a Home whose answer does not satisfy the contract as unavailable', async () => {
        const home = await harness.addHome({ name: 'Home A', serverUrl: 'https://home-a.example' });
        // A 200 whose body is not a governance projection is not a projection.
        harness.answer(home, GOVERNANCE_PATH, { body: { viewer: { accountId: '' } } });

        const screen = await renderOverview(home);
        await vi.waitFor(() => {
            expect(collectRenderedTestIds(screen.tree.toJSON())).toContain('home-admin-unavailable');
        });
        expect(collectRenderedTestIds(screen.tree.toJSON())).not.toContain('home-admin-viewer-role');
    });

    it('keeps the last known Home on screen and explains it once the Home stops answering', async () => {
        const home = await harness.addHome({
            name: 'Home A',
            serverUrl: 'https://home-a.example',
            accountId: 'account-ada',
        });
        harness.answer(home, GOVERNANCE_PATH, { body: projection() });

        const screen = await renderOverview(home);
        await vi.waitFor(() => {
            expect(collectRenderedTestIds(screen.tree.toJSON())).toContain('home-admin-viewer-role');
        });

        const { applyHomeGovernanceFailure } = await import(
            '@/sync/store/home/governance/homeGovernanceSnapshots'
        );
        act(() => {
            applyHomeGovernanceFailure({
                scope: { serverId: home, accountId: 'account-ada' },
                error: { kind: 'unreachable', retryable: true },
            });
        });

        await vi.waitFor(() => {
            expect(collectRenderedTestIds(screen.tree.toJSON())).toContain('home-admin-stale');
        });
        expect(screen.findByTestId('home-admin-stale')?.props.accessibilityLiveRegion).toBe('polite');
        // The administrator keeps reading the Home they were looking at.
        expect(collectRenderedTestIds(screen.tree.toJSON())).toContain('home-admin-viewer-role');
    });

    it('refreshes the exact ownerless Home after local setup without offering a claim action', async () => {
        const home = await harness.addHome({ name: 'Home A', serverUrl: 'https://home-a.example' });
        const otherHome = await harness.addHome({
            name: 'Home B',
            serverUrl: 'https://home-b.example',
            active: false,
        });
        harness.answer(home, GOVERNANCE_PATH, {
            body: projection({ setupState: 'setup_required', activeOwnerCount: 0 }),
        });

        const screen = await renderOverview(home);
        await vi.waitFor(() => {
            expect(collectRenderedTestIds(screen.tree.toJSON())).toContain('home-admin-setup-required');
        });
        const ids = collectRenderedTestIds(screen.tree.toJSON());
        expect(ids.some((id) => id.includes('claim'))).toBe(false);

        // The operator assigned an owner outside this running server process.
        // Focus moves elsewhere while this Home's administration stays open.
        await act(async () => {
            await setActiveServerId(otherHome, { scope: 'device' });
        });
        expect(getActiveServerSnapshot().serverId).toBe(otherHome);
        harness.answer(home, GOVERNANCE_PATH, { body: projection() });
        await vi.waitFor(() => {
            expect(collectRenderedTestIds(screen.tree.toJSON())).toContain('home-admin-setup-refresh');
        });
        const before = harness.requestsFor(GOVERNANCE_PATH).length;
        await screen.pressByTestIdAsync('home-admin-setup-refresh');

        await vi.waitFor(() => {
            expect(collectRenderedTestIds(screen.tree.toJSON())).not.toContain('home-admin-setup-required');
            expect(collectRenderedTestIds(screen.tree.toJSON())).toContain('home-admin-viewer-role');
        });
        const refreshRequests = harness.requestsFor(GOVERNANCE_PATH).slice(before);
        expect(refreshRequests.length).toBeGreaterThan(0);
        expect(refreshRequests.every((request) => request.serverId === home)).toBe(true);
    });

    it('opens Team administration for the exact Home it is administering', async () => {
        const home = await harness.addHome({ name: 'Home A', serverUrl: 'https://home-a.example' });
        harness.answer(home, GOVERNANCE_PATH, { body: projection() });

        const screen = await renderOverview(home);
        await vi.waitFor(() => {
            expect(collectRenderedTestIds(screen.tree.toJSON())).toContain('home-admin-teams');
        });

        screen.pressByTestId('home-admin-teams');
        // The Home's own id is in the destination, so this never resolves to the
        // focused Home or to the viewer's own membership list.
        expect(routerPush).toHaveBeenCalledWith(`/settings/home/${home}/teams`);
    });

    it('states that Teams are off on this Home instead of offering the destination', async () => {
        const home = await harness.addHome({ name: 'Home A', serverUrl: 'https://home-a.example' });
        harness.answer(home, GOVERNANCE_PATH, { body: projection({ teamsEnabled: false }) });

        const screen = await renderOverview(home);
        await vi.waitFor(() => {
            expect(collectRenderedTestIds(screen.tree.toJSON())).toContain('home-admin-teams');
        });

        const row = screen.findByTestId('home-admin-teams');
        expect(row?.props?.onPress ?? row?.props?.onClick).toBeUndefined();
        expect(routerPush).not.toHaveBeenCalled();
    });

    it('omits Team administration entirely from a viewer who may not govern Teams', async () => {
        const home = await harness.addHome({ name: 'Home A', serverUrl: 'https://home-a.example' });
        harness.answer(home, GOVERNANCE_PATH, {
            body: projection({
                capabilities: { ...projection().capabilities, manageAllTeams: false },
            }),
        });

        const screen = await renderOverview(home);
        await vi.waitFor(() => {
            expect(collectRenderedTestIds(screen.tree.toJSON())).toContain('home-admin-viewer-role');
        });
        expect(collectRenderedTestIds(screen.tree.toJSON())).not.toContain('home-admin-teams');
    });
});
