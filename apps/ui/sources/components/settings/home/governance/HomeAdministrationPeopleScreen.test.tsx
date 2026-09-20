import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Imported from their own testkit modules rather than the `@/dev/testkit`
 * barrel. The barrel re-exports `fixtures/agentCatalogFixtures`, whose
 * production projection reaches `@/sync/runtime/orchestration/connectionManager`
 * and, through it, `@/sync/http/client` and the reachability fetch. Evaluating
 * that graph on this file's first import binds the real transports and freezes
 * the applied active Home to the built-in default *before*
 * `installHomeGovernanceBoundaries` can install either boundary, so every Home
 * request leaves the harness and the screen never settles. This is the same
 * rule the harness states for its own late imports.
 */
import { standardCleanup } from '@/dev/testkit/cleanup/standardCleanup';
import {
    homeAccountPickerRowFixture,
    homeAccountRowFixture,
    homeGovernanceProjectionFixture,
} from '@/dev/testkit/fixtures/homeGovernanceFixtures';
import {
    createHomeGovernanceHarness,
    installHomeGovernanceBoundaries,
} from '@/dev/testkit/harness/homeGovernanceHarness';
import { collectRenderedTestIds } from '@/dev/testkit/render/collectRenderedTestIds';
import { renderScreen } from '@/dev/testkit/render/renderScreen';
import { resetServerFeaturesClientForTests } from '@/sync/api/capabilities/serverFeaturesClient';
import { publishHomeAccountChange } from '@/sync/runtime/orchestration/homeAccountChange';

import { installSettingsViewCommonModuleMocks } from '../../settingsViewTestHelpers';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const routerPush = vi.hoisted(() => vi.fn());
const virtualizedBoundary = vi.hoisted(() => ({
    props: null as Record<string, any> | null,
    mountLimit: Number.POSITIVE_INFINITY,
}));

vi.mock('@/components/ui/lists/virtualized', () => ({
    VirtualizedList: (props: Record<string, any>) => {
        virtualizedBoundary.props = props;
        const data = (props.data ?? []).slice(0, virtualizedBoundary.mountLimit);
        return React.createElement(
            'VirtualizedList',
            props,
            props.ListHeaderComponent,
            ...data.map((item: unknown, index: number) => props.renderItem({ item, index })),
            props.ListFooterComponent,
        );
    },
}));

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
const LIST_PATH = '/v1/home/accounts/list';
const SEARCH_PATH = '/v1/home/accounts/search';

async function renderPeople(serverId: string) {
    const { HomeAdministrationPeopleScreen } = await import('./HomeAdministrationPeopleScreen');
    const { resetHomeGovernanceEngineForTests } = await import('@/sync/engine/home/governance/homeGovernanceEngine');
    resetHomeGovernanceEngineForTests();
    return renderScreen(<HomeAdministrationPeopleScreen serverId={serverId} />);
}

async function addAdministeredHome(): Promise<string> {
    const home = await harness.addHome({
        name: 'Home A',
        serverUrl: 'https://home-a.example',
        accountId: 'account-ada',
    });
    harness.answer(home, GOVERNANCE_PATH, { body: homeGovernanceProjectionFixture() });
    return home;
}

beforeEach(async () => {
    const { resetHomeGovernanceSnapshotsForTests } = await import(
        '@/sync/store/home/governance/homeGovernanceSnapshots'
    );
    resetHomeGovernanceSnapshotsForTests();
    resetServerFeaturesClientForTests();
    await harness.reset();
    routerPush.mockReset();
    virtualizedBoundary.props = null;
    virtualizedBoundary.mountLimit = Number.POSITIVE_INFINITY;
});

afterEach(() => {
    standardCleanup();
});

describe('HomeAdministrationPeopleScreen', () => {
    it('keeps a large Home roster behind the canonical virtualized window', async () => {
        virtualizedBoundary.mountLimit = 2;
        const home = await addAdministeredHome();
        harness.answer(home, LIST_PATH, {
            body: {
                items: Array.from({ length: 120 }, (_, index) => homeAccountRowFixture(`account-${index}`)),
                nextCursor: null,
            },
        });

        const screen = await renderPeople(home);
        await vi.waitFor(() => {
            expect(virtualizedBoundary.props?.data.length).toBe(10);
        });

        expect(virtualizedBoundary.props?.testID).toBe('home-people-virtualized-list');
        expect(virtualizedBoundary.props?.maintainVisibleContentPosition).toBe(true);
        expect(collectRenderedTestIds(screen.tree.toJSON()).filter((id) => id.startsWith('home-people-row:')))
            .toHaveLength(24);
    });

    it('lists the Home roster and opens one account by its own Home id', async () => {
        const home = await addAdministeredHome();
        harness.answer(home, LIST_PATH, {
            body: {
                // The canonical page convention is `{ items, nextCursor }`; the
                // strict result schema no longer has an `accounts` arm, so a
                // fixture using it is not a roster this Home could answer with.
                items: [
                    homeAccountRowFixture('ada'),
                    homeAccountRowFixture('grace', { homeRole: 'admin' }),
                ],
                nextCursor: null,
            },
        });

        const screen = await renderPeople(home);
        await vi.waitFor(() => {
            expect(collectRenderedTestIds(screen.tree.toJSON())).toContain('home-people-row:grace');
        });

        screen.pressByTestId('home-people-row:grace');
        expect(routerPush).toHaveBeenCalledWith(`/settings/home/${home}/people/grace`);
    });

    it('searches the Home when a query is typed and shows the matches it found', async () => {
        const home = await addAdministeredHome();
        harness.answer(home, LIST_PATH, {
            body: { items: [homeAccountRowFixture('ada')], nextCursor: null },
        });
        harness.answer(home, SEARCH_PATH, {
            body: { accounts: [homeAccountPickerRowFixture('grace', 'Grace')] },
        });

        const screen = await renderPeople(home);
        await vi.waitFor(() => {
            expect(collectRenderedTestIds(screen.tree.toJSON())).toContain('home-people-row:ada');
        });

        screen.changeTextByTestId('home-people-search:input', 'grace');

        await vi.waitFor(() => {
            expect(collectRenderedTestIds(screen.tree.toJSON())).toContain('home-people-search-row:grace');
        });
        // The scope is stated explicitly, so managing one Team could never widen
        // the lookup to the Home.
        expect(harness.requestsFor(SEARCH_PATH)[0]?.input).toEqual({
            query: 'grace',
            scope: { kind: 'home' },
        });
        // The roster is replaced by the matches while searching, so the list is
        // never a mixture of two different answers to two different questions.
        expect(collectRenderedTestIds(screen.tree.toJSON())).not.toContain('home-people-row:ada');
    });

    it('says a Home has no account search rather than reporting no matches', async () => {
        const home = await addAdministeredHome();
        harness.answer(home, LIST_PATH, {
            body: { items: [homeAccountRowFixture('ada')], nextCursor: null },
        });
        // No answer registered for the search path: this Home does not serve it.

        const screen = await renderPeople(home);
        await vi.waitFor(() => {
            expect(collectRenderedTestIds(screen.tree.toJSON())).toContain('home-people-row:ada');
        });

        screen.changeTextByTestId('home-people-search:input', 'grace');

        await vi.waitFor(() => {
            expect(collectRenderedTestIds(screen.tree.toJSON())).toContain('home-people-search-unsupported');
        });
        expect(collectRenderedTestIds(screen.tree.toJSON())).not.toContain('home-people-search-empty');
        // A settled answer is not asked again.
        expect(harness.requestsFor(SEARCH_PATH)).toHaveLength(1);
    });

    it('reports an empty search result as no matches, not as a broken Home', async () => {
        const home = await addAdministeredHome();
        harness.answer(home, LIST_PATH, {
            body: { items: [homeAccountRowFixture('ada')], nextCursor: null },
        });
        harness.answer(home, SEARCH_PATH, { body: { accounts: [] } });

        const screen = await renderPeople(home);
        await vi.waitFor(() => {
            expect(collectRenderedTestIds(screen.tree.toJSON())).toContain('home-people-row:ada');
        });

        screen.changeTextByTestId('home-people-search:input', 'nobody');

        await vi.waitFor(() => {
            expect(collectRenderedTestIds(screen.tree.toJSON())).toContain('home-people-search-empty');
        });
    });

    it('offers no search box to a viewer who may not read the Home roster', async () => {
        const home = await harness.addHome({
            name: 'Home A',
            serverUrl: 'https://home-a.example',
            accountId: 'account-ada',
        });
        harness.answer(home, GOVERNANCE_PATH, {
            body: homeGovernanceProjectionFixture({
                viewer: { accountId: 'account-ada', homeRole: 'member', status: 'active' },
                capabilities: {
                    ...homeGovernanceProjectionFixture().capabilities,
                    manageAccounts: false,
                },
            }),
        });

        const screen = await renderPeople(home);
        await vi.waitFor(() => {
            expect(collectRenderedTestIds(screen.tree.toJSON())).toContain('home-admin-viewer-forbidden');
        });
        expect(collectRenderedTestIds(screen.tree.toJSON())).not.toContain('home-people-search');
        expect(harness.requestsFor(LIST_PATH)).toHaveLength(0);
    });

    it('keeps the pages already read when the Home stops answering mid-list', async () => {
        const home = await addAdministeredHome();
        harness.answer(home, LIST_PATH, {
            body: { items: [homeAccountRowFixture('ada')], nextCursor: 'cursor-2' },
        });

        const screen = await renderPeople(home);
        await vi.waitFor(() => {
            expect(collectRenderedTestIds(screen.tree.toJSON())).toContain('home-people-load-more');
        });

        harness.answer(home, LIST_PATH, { status: 503, body: { error: 'unavailable' } });
        await screen.pressByTestIdAsync('home-people-load-more');

        await vi.waitFor(() => {
            expect(collectRenderedTestIds(screen.tree.toJSON())).toContain('home-people-retry');
        });
        // The page already read stays on screen instead of blanking.
        expect(collectRenderedTestIds(screen.tree.toJSON())).toContain('home-people-row:ada');
        expect(harness.requestsFor(LIST_PATH)[1]?.input).toEqual({ cursor: 'cursor-2' });
    });

    it('reloads the exact Home roster after the focused viewer role or status changes', async () => {
        const home = await addAdministeredHome();
        harness.answer(home, LIST_PATH, {
            body: { items: [homeAccountRowFixture('ada')], nextCursor: null },
        });

        const screen = await renderPeople(home);
        await vi.waitFor(() => {
            expect(collectRenderedTestIds(screen.tree.toJSON())).toContain('home-people-row:ada');
        });

        harness.answer(home, LIST_PATH, {
            body: { items: [homeAccountRowFixture('grace')], nextCursor: null },
        });
        publishHomeAccountChange(home, ['self']);

        await vi.waitFor(() => {
            expect(collectRenderedTestIds(screen.tree.toJSON())).toContain('home-people-row:grace');
        });
        expect(collectRenderedTestIds(screen.tree.toJSON())).not.toContain('home-people-row:ada');
        expect(harness.requestsFor(LIST_PATH)).toHaveLength(2);
    });
});
