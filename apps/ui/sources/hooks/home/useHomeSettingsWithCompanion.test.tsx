import { act } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Imported from their own testkit modules rather than the `@/dev/testkit` barrel: the barrel binds
 * the real transports before the Home boundaries are installed.
 */
import { standardCleanup } from '@/dev/testkit/cleanup/standardCleanup';
import { homeSettingsProjectionFixture } from '@/dev/testkit/fixtures/homeGovernanceFixtures';
import {
    createHomeGovernanceHarness,
    installHomeGovernanceBoundaries,
    waitForHomeGovernance,
} from '@/dev/testkit/harness/homeGovernanceHarness';
import { renderHook } from '@/dev/testkit/hooks/renderHook';
import { resetServerFeaturesClientForTests } from '@/sync/api/capabilities/serverFeaturesClient';

import { installSettingsViewCommonModuleMocks } from '@/components/settings/settingsViewTestHelpers';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('@react-navigation/native', async () => {
    const { createReactNavigationNativeMock } = await import('@/dev/testkit/mocks/reactNavigation');
    return createReactNavigationNativeMock();
});

installSettingsViewCommonModuleMocks({
    router: async () => ({
        useRouter: () => ({ push: vi.fn(), back: vi.fn() }),
        useNavigation: () => ({ setOptions: vi.fn() }),
        useLocalSearchParams: () => ({}),
    }),
});

// Only the network and the device credential store are replaced; the Action executor and the
// hook's read lifecycle are the production ones.
const harness = createHomeGovernanceHarness();
installHomeGovernanceBoundaries(harness);

const SETTINGS_GET = '/v1/home/settings/get';

beforeEach(async () => {
    resetServerFeaturesClientForTests();
    await harness.reset();
});

afterEach(() => {
    standardCleanup();
});

describe('useHomeSettingsWithCompanion', () => {
    it('keeps a settled Home through an enabled flicker and a reload, so a page never falls back to loading', async () => {
        const { useHomeSettingsWithCompanion } = await import('./useHomeSettingsWithCompanion');
        const serverId = await harness.addHome({ name: 'Home A', serverUrl: 'https://home-a.example', accountId: 'account-admin' });
        const scope = { serverId, accountId: 'account-admin' };
        harness.answer(serverId, SETTINGS_GET, { body: homeSettingsProjectionFixture({ revision: 3 }) });

        const hook = await renderHook(
            (props: Readonly<{ enabled: boolean }>) => useHomeSettingsWithCompanion(scope, props.enabled, null),
            { initialProps: { enabled: true } },
        );
        await waitForHomeGovernance(() => expect(hook.getCurrent().settings?.revision).toBe(3));

        // A transient loss of the viewer's capability (or of the scope's readiness) is not a new Home.
        await hook.rerender({ enabled: false });
        expect(hook.getCurrent().settings?.revision).toBe(3);
        await hook.rerender({ enabled: true });
        expect(hook.getCurrent().settings?.revision).toBe(3);

        // A reload keeps the last answer on screen until the new one lands.
        harness.answer(serverId, SETTINGS_GET, { body: homeSettingsProjectionFixture({ revision: 4 }) });
        await act(async () => {
            hook.getCurrent().reload();
        });
        expect(hook.getCurrent().settings).not.toBeNull();
        await waitForHomeGovernance(() => expect(hook.getCurrent().settings?.revision).toBe(4));
    });
});
