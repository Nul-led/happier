import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { standardCleanup } from '@/dev/testkit/cleanup/standardCleanup';
import {
    homeGovernanceProjectionFixture,
    homeSettingEntryFixture,
    homeSettingsProjectionFixture,
} from '@/dev/testkit/fixtures/homeGovernanceFixtures';
import { createHomeGovernanceHarness, installHomeGovernanceBoundaries, waitForHomeGovernance } from '@/dev/testkit/harness/homeGovernanceHarness';
import { renderScreen } from '@/dev/testkit/render/renderScreen';
import { installSettingsViewCommonModuleMocks } from '../../settingsViewTestHelpers';

const routeParams = vi.hoisted(() => ({ value: {} as Record<string, string> }));
installSettingsViewCommonModuleMocks({
    storage: async (importOriginal) => await importOriginal(),
    router: async () => {
        const { createExpoRouterMock } = await import('@/dev/testkit/mocks/router');
        return createExpoRouterMock({ params: () => routeParams.value, navigation: { setOptions: () => undefined } }).module;
    },
});
const harness = createHomeGovernanceHarness();
installHomeGovernanceBoundaries(harness);
const { HomeAdministrationSignInProvidersScreen } = await import('./HomeAdministrationSignInProvidersScreen');
const { resetHomeGovernanceEngineForTests } = await import('@/sync/engine/home/governance/homeGovernanceEngine');
const { resetHomeGovernanceSnapshotsForTests } = await import('@/sync/store/home/governance/homeGovernanceSnapshots');

beforeEach(async () => {
    standardCleanup();
    routeParams.value = {};
    resetHomeGovernanceEngineForTests();
    resetHomeGovernanceSnapshotsForTests();
    await harness.reset();
});
afterEach(() => standardCleanup());

describe('Sign-in providers page', () => {
    it('lists what the deployment provides beside the Home\'s own providers, with the key that sets it', async () => {
        const serverId = await harness.addHome({ name: 'Acme Home', serverUrl: 'https://acme-home.example', accountId: 'owner-1' });
        harness.answer(serverId, '/v1/home/governance/get', {
            body: homeGovernanceProjectionFixture({
                identityServices: {
                    workos: 'partially_configured',
                    privateIdentityNetworkAllowed: false,
                    teamProviderKinds: ['oidc'],
                    deploymentOidcProviders: [
                        { id: 'acme-sso', displayName: 'Acme SSO', sourceKey: 'AUTH_PROVIDERS_CONFIG_PATH' },
                    ],
                },
            }),
        });
        harness.answer(serverId, '/v1/home/settings/get', {
            body: homeSettingsProjectionFixture({
                entries: [
                    homeSettingEntryFixture('WORKOS_API_KEY', { source: 'deployment', fixed: true }),
                    homeSettingEntryFixture('HAPPIER_FEATURE_AUTH_MANAGED_IDENTITY__PRIVATE_NETWORK_ENABLED', { source: 'deployment', fixed: true }),
                ],
            }),
        });

        const screen = await renderScreen(<HomeAdministrationSignInProvidersScreen serverId={serverId} />);

        await waitForHomeGovernance(() => expect(screen.findByTestId('home-sign-in-deployment-oidc:acme-sso')).not.toBeNull());
        expect(screen.getTextContent()).toContain('Acme SSO');
        expect(screen.getTextContent()).toContain('homeGovernance.signInProviders.fromDeployment(key=AUTH_PROVIDERS_CONFIG_PATH)');
        // Whether the deployment locks WorkOS and private endpoints is the registry's answer, not a guess.
        await waitForHomeGovernance(() => expect(screen.getTextContent())
            .toContain('homeGovernance.signInProviders.workosSetByDeployment(keys=WORKOS_API_KEY, WORKOS_CLIENT_ID)'));
        expect(screen.getTextContent()).toContain(
            'homeGovernance.signInProviders.privateEndpointsFixed(key=HAPPIER_FEATURE_AUTH_MANAGED_IDENTITY__PRIVATE_NETWORK_ENABLED)',
        );
        expect(screen.findByTestId('home-sign-in-providers-owners-only')).toBeNull();
    });

    it('tells an administrator who is not an owner who can change providers, without offering controls', async () => {
        const serverId = await harness.addHome({ name: 'Acme Home', serverUrl: 'https://acme-home-admin.example', accountId: 'admin-1' });
        const projection = homeGovernanceProjectionFixture();
        projection.capabilities = { ...projection.capabilities, manageAuthentication: false };
        harness.answer(serverId, '/v1/home/governance/get', { body: projection });

        const screen = await renderScreen(<HomeAdministrationSignInProvidersScreen serverId={serverId} />);

        await waitForHomeGovernance(() => expect(screen.findByTestId('home-sign-in-providers-owners-only')).not.toBeNull());
        expect(screen.findByTestId('home-identity-provider-add')).toBeNull();
        expect(screen.findByTestId('home-policy-team-jit')).toBeNull();
        expect(harness.requestsFor('/v1/home/settings/get')).toHaveLength(0);
    });
});
