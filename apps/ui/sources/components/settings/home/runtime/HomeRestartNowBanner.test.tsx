import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { standardCleanup } from '@/dev/testkit/cleanup/standardCleanup';
import { homeGovernanceProjectionFixture } from '@/dev/testkit/fixtures/homeGovernanceFixtures';
import { collectRenderedTestIds } from '@/dev/testkit/render/collectRenderedTestIds';
import { renderScreen } from '@/dev/testkit/render/renderScreen';

import type { HomeAdministrationContext } from '@/components/settings/home/governance/homeAdministrationContext';

import { installSettingsViewCommonModuleMocks } from '../../settingsViewTestHelpers';
import { HomeRestartNowBanner } from './HomeRuntimeSections';
import type { HomeRuntimeExecutor } from './resolveHomeRuntimeExecutor';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

installSettingsViewCommonModuleMocks({
    router: async () => ({
        useRouter: () => ({ push: vi.fn(), back: vi.fn(), setParams: vi.fn() }),
        useNavigation: () => ({ setOptions: vi.fn() }),
        useLocalSearchParams: () => ({}),
    }),
});

function context(overrides?: Partial<HomeAdministrationContext>): HomeAdministrationContext {
    return {
        scope: { serverId: 'home-1', accountId: 'account-1' },
        homeName: 'Home A',
        projection: homeGovernanceProjectionFixture(),
        mutationsAvailable: true,
        approvalPending: false,
        refresh: () => {},
        ...overrides,
    };
}

async function renderBanner(executor: HomeRuntimeExecutor, pendingCount: number) {
    const screen = await renderScreen(
        <HomeRestartNowBanner
            context={context()}
            executor={executor}
            pendingCount={pendingCount}
            discard={{ onPress: () => {}, loading: false }}
        />,
    );
    return collectRenderedTestIds(screen.tree.toJSON());
}

afterEach(() => {
    standardCleanup();
});

describe('HomeRestartNowBanner', () => {
    it('offers Restart now, with Discard beside it, only when changes are pending and this device can restart the runtime', async () => {
        const ids = await renderBanner({ kind: 'hosting_desktop' }, 2);
        expect(ids).toContain('home-runtime-pending-restart.action');
        expect(ids).toContain('home-runtime-pending-restart.discard');
    });

    it('names where to restart and keeps Discard as the only action without an executor', async () => {
        const elsewhere = await renderBanner({ kind: 'elsewhere', hostName: 'MacBook Pro' }, 2);
        expect(elsewhere).not.toContain('home-runtime-pending-restart.action');
        expect(elsewhere).toContain('home-runtime-pending-restart.discard');

        const deployment = await renderBanner({ kind: 'deployment' }, 1);
        expect(deployment).not.toContain('home-runtime-pending-restart.action');
    });

    it('renders nothing when nothing is pending, whatever the executor', async () => {
        const ids = await renderBanner({ kind: 'hosting_desktop' }, 0);
        expect(ids.filter((id) => id.startsWith('home-runtime-pending-restart'))).toEqual([]);
    });
});
