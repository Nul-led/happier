import * as React from 'react';
import { act } from 'react-test-renderer';
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
import { homeGovernanceProjectionFixture } from '@/dev/testkit/fixtures/homeGovernanceFixtures';
import {
    createHomeGovernanceHarness,
    installHomeGovernanceBoundaries,
    waitForHomeGovernance,
} from '@/dev/testkit/harness/homeGovernanceHarness';
import { renderScreen } from '@/dev/testkit/render/renderScreen';
import type { HomeAdministrationContext } from './homeAdministrationContext';

import { installSettingsViewCommonModuleMocks } from '../../settingsViewTestHelpers';

const homePolicyOperationBoundary = vi.hoisted(() => ({
    setAuthenticationPolicies: null as null | ((params: unknown) => Promise<unknown>),
}));

installSettingsViewCommonModuleMocks();
vi.mock('@/sync/ops/home/homeGovernanceOperations', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@/sync/ops/home/homeGovernanceOperations')>();
    return {
        ...actual,
        setHomeAuthenticationPolicies: async (
            params: Parameters<typeof actual.setHomeAuthenticationPolicies>[0],
        ): ReturnType<typeof actual.setHomeAuthenticationPolicies> => {
            const override = homePolicyOperationBoundary.setAuthenticationPolicies;
            if (!override) return actual.setHomeAuthenticationPolicies(params);
            return await override(params) as Awaited<ReturnType<typeof actual.setHomeAuthenticationPolicies>>;
        },
    };
});
vi.mock('@/sync/api/capabilities/accountStoredContentCompatibility', async (importOriginal) => ({
    ...await importOriginal<typeof import('@/sync/api/capabilities/accountStoredContentCompatibility')>(),
    // Artifact protocol compatibility is independently covered by its owner;
    // this suite exercises policy state across the shared approval lifecycle.
    requireCurrentAccountStoredContentServerCompatibility: vi.fn(async () => undefined),
}));
// The generated bundled-artifact inventory is an unrelated build product and
// is deliberately absent from remote source mirrors. Keep this policy suite on
// the real Action path while supplying the inventory boundary's valid empty
// projection; plugin artifact selection is covered by its owning suites.
vi.mock('@/sync/domains/plugins/availability/generatedBundledPluginUiArtifacts', () => ({
    BUNDLED_PLUGIN_UI_APP_ARTIFACTS: [],
}));
vi.mock('@/sync/domains/plugins/availability/bundledAppExactArtifactSource', () => ({
    createBundledPluginUiAppExactArtifactSource: () => Object.freeze({
        kind: 'appExact' as const,
        readFile: vi.fn(async () => null),
    }),
}));
vi.mock('@/sync/domains/plugins/availability/reader', () => ({
    createPluginAccountAvailabilityReader: vi.fn(),
    createPluginAccountAvailabilityReaderStore: () => Object.freeze({
        replace: () => null,
        clear: () => null,
        subscribe: () => () => undefined,
        bind: vi.fn(),
    }),
    projectPluginAccountAvailabilityMaterializationIdentity: vi.fn(),
}));
// This suite owns the Home policy controller. Provider/App lists are sibling
// surfaces with their own integration suites; importing their full runtime here
// would replace a focused policy check with plugin-artifact setup.
vi.mock('../identity/ManagedIdentityProvidersSection', () => ({
    ManagedIdentityProvidersSection: () => null,
}));
vi.mock('../githubApps/ManagedGitHubAppsSection', () => ({
    ManagedGitHubAppsSection: () => null,
    homeManagedGitHubAppSurface: vi.fn(),
    homeManagedGitHubAppCreatePath: vi.fn(),
}));
const harness = createHomeGovernanceHarness();
installHomeGovernanceBoundaries(harness);
let testStorage: typeof import('@/sync/domains/state/storage')['storage'];

function renderedControlIsDisabled(control: { props: Record<string, unknown> } | null): boolean {
    const props = control?.props;
    const accessibilityState = props?.accessibilityState as { disabled?: boolean } | undefined;
    return props?.['aria-disabled'] === true || accessibilityState?.disabled === true;
}

function renderedControlIsChecked(control: { props: Record<string, unknown> } | null): boolean {
    const props = control?.props;
    const accessibilityState = props?.accessibilityState as { checked?: boolean } | undefined;
    return props?.['aria-checked'] === true || accessibilityState?.checked === true;
}
beforeEach(async () => {
    await harness.reset();
    homePolicyOperationBoundary.setAuthenticationPolicies = null;
    ({ storage: testStorage } = await import('@/sync/domains/state/storage'));
    testStorage.setState({ settingsScope: null, settings: {} as never });
});
afterEach(() => {
    homePolicyOperationBoundary.setAuthenticationPolicies = null;
    standardCleanup();
});

describe('HomeAuthenticationPolicySections', () => {
    it('does not replace an explicitly absent narrowed recommendation with the deployment default', async () => {
        const { HomeAuthenticationPolicySections } = await import('./HomeAdministrationPoliciesScreen');
        const serverId = await harness.addHome({ name: 'Home A', serverUrl: 'https://home-a.example', accountId: 'owner' });
        const projection = homeGovernanceProjectionFixture({
            authenticationOptions: {
                methods: [{ id: 'key_challenge', displayName: 'Recovery key', actions: [] }],
                permittedAccountModes: ['e2ee', 'plain'],
                recommendedProvisioningMode: 'e2ee',
                signInService: { deploymentMode: 'self', canDisable: true },
            },
        });
        projection.policy = {
            ...projection.policy,
            authentication: {
                status: 'narrowed',
                enabledMethodIds: ['key_challenge'],
                permittedAccountModes: ['e2ee', 'plain'],
                recommendedProvisioningMode: null,
                admission: null,
                signInServiceDisabled: false,
            },
        };
        const context: HomeAdministrationContext = {
            scope: { serverId, accountId: 'owner' },
            homeName: 'Home A',
            projection,
            mutationsAvailable: true,
            approvalPending: false,
            refresh: vi.fn(),
        };

        const screen = await renderScreen(<HomeAuthenticationPolicySections context={context} />);

        expect(renderedControlIsChecked(screen.findByTestId('home-policy-auth-recommended:e2ee'))).toBe(false);
        expect(renderedControlIsChecked(screen.findByTestId('home-policy-auth-recommended:plain'))).toBe(false);
        expect(renderedControlIsDisabled(screen.findByTestId('home-policy-auth-save'))).toBe(true);
    });

    it('edits sign-in methods, Account modes, recommendation and admission in one explicit CAS save', async () => {
        const { HomeAuthenticationPolicySections } = await import('./HomeAdministrationPoliciesScreen');
        const serverId = await harness.addHome({ name: 'Home A', serverUrl: 'https://home-a.example', accountId: 'owner' });
        const projection = homeGovernanceProjectionFixture({
            authenticationOptions: {
                methods: [
                    { id: 'key_challenge', displayName: 'Recovery key', actions: [] },
                    { id: 'github', displayName: 'GitHub', actions: [] },
                ],
                permittedAccountModes: ['e2ee', 'plain'],
                recommendedProvisioningMode: 'e2ee',
                signInService: { deploymentMode: 'self', canDisable: true },
            },
        });
        projection.policy = {
            ...projection.policy,
            revision: 9,
            authentication: {
                status: 'narrowed',
                enabledMethodIds: ['key_challenge'],
                permittedAccountModes: ['e2ee'],
                recommendedProvisioningMode: 'e2ee',
                admission: 'invitation_only',
                signInServiceDisabled: false,
            },
        };
        harness.answer(serverId, '/v1/home/policy/set', {
            body: { ...projection.policy, revision: 10 },
        });
        harness.answer(serverId, '/v1/home/governance/get', { body: projection });
        const context: HomeAdministrationContext = {
            scope: { serverId, accountId: 'owner' },
            homeName: 'Home A',
            projection,
            mutationsAvailable: true,
            approvalPending: false,
            refresh: vi.fn(),
        };

        const screen = await renderScreen(<HomeAuthenticationPolicySections context={context} />);
        await screen.pressByTestIdAsync('home-policy-auth-method:github');
        await screen.pressByTestIdAsync('home-policy-auth-mode:plain');
        await screen.pressByTestIdAsync('home-policy-auth-recommended:plain');
        await screen.pressByTestIdAsync('home-policy-auth-admission:closed');
        await screen.pressByTestIdAsync('home-policy-auth-service-disabled');
        await screen.pressByTestIdAsync('home-policy-auth-save');

        await waitForHomeGovernance(() => expect(harness.requestsFor('/v1/home/policy/set')).toHaveLength(1));
        expect(harness.requestsFor('/v1/home/policy/set')[0]).toMatchObject({
            serverId,
            input: {
                expectedRevision: 9,
                authenticationPolicy: {
                    v: 1,
                    enabledMethodIds: ['key_challenge', 'github'],
                    permittedAccountModes: ['e2ee', 'plain'],
                    recommendedProvisioningMode: 'plain',
                    admission: 'closed',
                    signInService: { mode: 'disabled' },
                },
            },
        });
    });

    it('does not allow the last sign-in method or Account mode to be removed', async () => {
        const { HomeAuthenticationPolicySections } = await import('./HomeAdministrationPoliciesScreen');
        const serverId = await harness.addHome({ name: 'Home A', serverUrl: 'https://home-a.example', accountId: 'owner' });
        const projection = homeGovernanceProjectionFixture({
            authenticationOptions: {
                methods: [{ id: 'key_challenge', displayName: 'Recovery key', actions: [] }],
                permittedAccountModes: ['e2ee'],
                recommendedProvisioningMode: 'e2ee',
                signInService: { deploymentMode: 'self', canDisable: true },
            },
        });
        const context: HomeAdministrationContext = {
            scope: { serverId, accountId: 'owner' },
            homeName: 'Home A',
            projection,
            mutationsAvailable: true,
            approvalPending: false,
            refresh: vi.fn(),
        };

        const screen = await renderScreen(<HomeAuthenticationPolicySections context={context} />);
        expect(renderedControlIsDisabled(screen.findByTestId('home-policy-auth-method:key_challenge'))).toBe(true);
        expect(renderedControlIsDisabled(screen.findByTestId('home-policy-auth-mode:e2ee'))).toBe(true);
        expect(renderedControlIsDisabled(screen.findByTestId('home-policy-auth-save'))).toBe(true);
    });

    it('does not turn an inherited policy into an explicit service disable when the deployment is disabled', async () => {
        const { HomeAuthenticationPolicySections } = await import('./HomeAdministrationPoliciesScreen');
        const serverId = await harness.addHome({ name: 'Home A', serverUrl: 'https://home-a.example', accountId: 'owner' });
        const projection = homeGovernanceProjectionFixture({
            authenticationOptions: {
                methods: [{ id: 'key_challenge', actions: [] }],
                permittedAccountModes: ['e2ee'],
                recommendedProvisioningMode: 'e2ee',
                signInService: { deploymentMode: 'disabled', canDisable: false },
            },
        });
        harness.answer(serverId, '/v1/home/policy/set', {
            body: { ...projection.policy, revision: projection.policy.revision + 1 },
        });
        const context: HomeAdministrationContext = {
            scope: { serverId, accountId: 'owner' },
            homeName: 'Home A',
            projection,
            mutationsAvailable: true,
            approvalPending: false,
            refresh: vi.fn(),
        };

        const screen = await renderScreen(<HomeAuthenticationPolicySections context={context} />);
        await screen.pressByTestIdAsync('home-policy-auth-admission:closed');
        await screen.pressByTestIdAsync('home-policy-auth-save');

        await waitForHomeGovernance(() => expect(harness.requestsFor('/v1/home/policy/set')).toHaveLength(1));
        expect(harness.requestsFor('/v1/home/policy/set')[0]?.input).toEqual({
            expectedRevision: projection.policy.revision,
            authenticationPolicy: {
                v: 1,
                admission: 'closed',
                signInService: null,
            },
        });
    });

    it('keeps narrowed choices that left the deployment ceiling visible until the administrator repairs them', async () => {
        const { HomeAuthenticationPolicySections } = await import('./HomeAdministrationPoliciesScreen');
        const serverId = await harness.addHome({ name: 'Home A', serverUrl: 'https://home-a.example', accountId: 'owner' });
        const projection = homeGovernanceProjectionFixture({
            authenticationOptions: {
                methods: [{ id: 'key_challenge', displayName: 'Recovery key', actions: [] }],
                permittedAccountModes: ['e2ee'],
                recommendedProvisioningMode: 'e2ee',
                signInService: { deploymentMode: 'self', canDisable: true },
            },
        });
        projection.policy = {
            ...projection.policy,
            authentication: {
                status: 'narrowed',
                enabledMethodIds: ['retired_method'],
                permittedAccountModes: ['plain'],
                recommendedProvisioningMode: 'plain',
                admission: null,
                signInServiceDisabled: false,
            },
        };
        harness.answer(serverId, '/v1/home/policy/set', {
            body: { ...projection.policy, revision: projection.policy.revision + 1 },
        });
        const context: HomeAdministrationContext = {
            scope: { serverId, accountId: 'owner' },
            homeName: 'Home A',
            projection,
            mutationsAvailable: true,
            approvalPending: false,
            refresh: vi.fn(),
        };

        const screen = await renderScreen(<HomeAuthenticationPolicySections context={context} />);
        expect(renderedControlIsChecked(screen.findByTestId('home-policy-auth-method:retired_method'))).toBe(true);
        expect(renderedControlIsChecked(screen.findByTestId('home-policy-auth-mode:plain'))).toBe(true);
        expect(renderedControlIsDisabled(screen.findByTestId('home-policy-auth-save'))).toBe(true);

        await screen.pressByTestIdAsync('home-policy-auth-method:key_challenge');
        await screen.pressByTestIdAsync('home-policy-auth-method:retired_method');
        await screen.pressByTestIdAsync('home-policy-auth-mode:e2ee');
        await screen.pressByTestIdAsync('home-policy-auth-mode:plain');
        expect(renderedControlIsDisabled(screen.findByTestId('home-policy-auth-save'))).toBe(true);
        await screen.pressByTestIdAsync('home-policy-auth-recommended:e2ee');
        expect(renderedControlIsDisabled(screen.findByTestId('home-policy-auth-save'))).toBe(false);
        await screen.pressByTestIdAsync('home-policy-auth-save');

        await waitForHomeGovernance(() => expect(harness.requestsFor('/v1/home/policy/set')).toHaveLength(1));
        expect(harness.requestsFor('/v1/home/policy/set')[0]?.input).toMatchObject({
            authenticationPolicy: {
                enabledMethodIds: ['key_challenge'],
                permittedAccountModes: ['e2ee'],
                recommendedProvisioningMode: 'e2ee',
            },
        });
    });

    it('keeps the administrator draft when the Home rejects a stale revision', async () => {
        const { HomeAuthenticationPolicySections } = await import('./HomeAdministrationPoliciesScreen');
        const serverId = await harness.addHome({ name: 'Home A', serverUrl: 'https://home-a.example', accountId: 'owner' });
        const projection = homeGovernanceProjectionFixture({
            authenticationOptions: {
                methods: [
                    { id: 'key_challenge', actions: [] },
                    { id: 'github', displayName: 'GitHub', actions: [] },
                ],
                permittedAccountModes: ['e2ee'],
                recommendedProvisioningMode: 'e2ee',
                signInService: { deploymentMode: 'self', canDisable: true },
            },
        });
        projection.policy = {
            ...projection.policy,
            revision: 4,
            authentication: {
                status: 'narrowed',
                enabledMethodIds: ['key_challenge'],
                permittedAccountModes: ['e2ee'],
                recommendedProvisioningMode: 'e2ee',
                admission: null,
                signInServiceDisabled: false,
            },
        };
        harness.answer(serverId, '/v1/home/policy/set', {
            status: 409,
            body: { error: 'home_policy_revision_conflict' },
        });
        const refresh = vi.fn();
        const context: HomeAdministrationContext = {
            scope: { serverId, accountId: 'owner' },
            homeName: 'Home A',
            projection,
            mutationsAvailable: true,
            approvalPending: false,
            refresh,
        };

        const screen = await renderScreen(<HomeAuthenticationPolicySections context={context} />);
        await screen.pressByTestIdAsync('home-policy-auth-method:github');
        await screen.pressByTestIdAsync('home-policy-auth-save');
        await waitForHomeGovernance(() => expect(refresh).toHaveBeenCalled());

        expect(renderedControlIsChecked(screen.findByTestId('home-policy-auth-method:github'))).toBe(true);
        expect(renderedControlIsDisabled(screen.findByTestId('home-policy-auth-save'))).toBe(false);
    });

    it('edits Team provider kinds through the Home policy revision owner', async () => {
        const { HomeAuthenticationPolicySections } = await import('./HomeAdministrationPoliciesScreen');
        const serverId = await harness.addHome({ name: 'Home A', serverUrl: 'https://home-a.example', accountId: 'owner' });
        const projection = homeGovernanceProjectionFixture();
        projection.policy = {
            ...projection.policy,
            revision: 5,
            teamProviders: {
                status: 'narrowed',
                policy: {
                    v: 1,
                    allowedTeamProviderKinds: ['oidc'],
                    teamJitAllowed: false,
                    approvedGitHubEnterpriseOrigins: ['https://github.company.example'],
                },
            },
        };
        harness.answer(serverId, '/v1/home/policy/set', { body: { ...projection.policy, revision: 6 } });
        harness.answer(serverId, '/v1/home/governance/get', { body: projection });
        const context: HomeAdministrationContext = {
            scope: { serverId, accountId: 'owner' },
            homeName: 'Home A',
            projection,
            mutationsAvailable: true,
            approvalPending: false,
            refresh: vi.fn(),
        };

        const screen = await renderScreen(<HomeAuthenticationPolicySections context={context} />);
        expect(screen.findByTestId('home-policy-team-provider:oidc')).toBeTruthy();
        expect(screen.findByTestId('home-policy-team-provider:workos_sso')).toBeTruthy();
        expect(screen.findByTestId('home-policy-team-provider:github_app_identity')).toBeTruthy();

        await screen.pressByTestIdAsync('home-policy-team-provider:workos_sso');
        await waitForHomeGovernance(() => expect(harness.requestsFor('/v1/home/policy/set')).toHaveLength(1));
        expect(harness.requestsFor('/v1/home/policy/set')[0]).toMatchObject({
            serverId,
            input: {
                expectedRevision: 5,
                teamProviderPolicy: {
                    v: 1,
                    allowedTeamProviderKinds: ['workos_sso', 'oidc'],
                    teamJitAllowed: false,
                    approvedGitHubEnterpriseOrigins: ['https://github.company.example'],
                },
            },
        });
    });

    it('restores the committed Team-provider selection after an immediate refusal and submits the next click once', async () => {
        const { HomeAuthenticationPolicySections } = await import('./HomeAdministrationPoliciesScreen');
        const serverId = await harness.addHome({ name: 'Home A', serverUrl: 'https://home-a.example', accountId: 'owner' });
        const projection = homeGovernanceProjectionFixture();
        projection.policy = {
            ...projection.policy,
            revision: 5,
            teamProviders: {
                status: 'narrowed',
                policy: {
                    v: 1,
                    allowedTeamProviderKinds: ['oidc'],
                    teamJitAllowed: false,
                    approvedGitHubEnterpriseOrigins: [],
                },
            },
        };
        harness.answer(serverId, '/v1/home/policy/set', {
            status: 500,
            body: { error: 'home_policy_unavailable' },
        });
        const context: HomeAdministrationContext = {
            scope: { serverId, accountId: 'owner' },
            homeName: 'Home A',
            projection,
            mutationsAvailable: true,
            approvalPending: false,
            refresh: vi.fn(),
        };

        const screen = await renderScreen(<HomeAuthenticationPolicySections context={context} />);
        await screen.pressByTestIdAsync('home-policy-team-provider:workos_sso');
        await waitForHomeGovernance(() => expect(harness.requestsFor('/v1/home/policy/set')).toHaveLength(1));
        await waitForHomeGovernance(() => expect(
            renderedControlIsChecked(screen.findByTestId('home-policy-team-provider:workos_sso')),
        ).toBe(false));

        harness.answer(serverId, '/v1/home/policy/set', {
            body: { ...projection.policy, revision: 6 },
        });
        await screen.pressByTestIdAsync('home-policy-team-provider:workos_sso');
        await waitForHomeGovernance(() => expect(harness.requestsFor('/v1/home/policy/set')).toHaveLength(2));
        expect(harness.requestsFor('/v1/home/policy/set')[1]?.input).toMatchObject({
            expectedRevision: 5,
            teamProviderPolicy: {
                allowedTeamProviderKinds: ['workos_sso', 'oidc'],
            },
        });
    });

    it('restores the committed JIT selection after an immediate refusal', async () => {
        const { HomeAuthenticationPolicySections } = await import('./HomeAdministrationPoliciesScreen');
        const serverId = await harness.addHome({ name: 'Home A', serverUrl: 'https://home-a.example', accountId: 'owner' });
        const projection = homeGovernanceProjectionFixture();
        projection.policy = {
            ...projection.policy,
            revision: 6,
            teamProviders: {
                status: 'narrowed',
                policy: {
                    v: 1,
                    allowedTeamProviderKinds: ['oidc'],
                    teamJitAllowed: false,
                    approvedGitHubEnterpriseOrigins: [],
                },
            },
        };
        harness.answer(serverId, '/v1/home/policy/set', {
            status: 500,
            body: { error: 'home_policy_unavailable' },
        });
        const context: HomeAdministrationContext = {
            scope: { serverId, accountId: 'owner' },
            homeName: 'Home A',
            projection,
            mutationsAvailable: true,
            approvalPending: false,
            refresh: vi.fn(),
        };

        const screen = await renderScreen(<HomeAuthenticationPolicySections context={context} />);
        await screen.pressByTestIdAsync('home-policy-team-jit');
        await waitForHomeGovernance(() => expect(harness.requestsFor('/v1/home/policy/set')).toHaveLength(1));
        await waitForHomeGovernance(() => expect(
            renderedControlIsChecked(screen.findByTestId('home-policy-team-jit')),
        ).toBe(false));
    });

    it('keeps an approval candidate only while pending and restores the committed Team-provider selection when it terminates', async () => {
        const { HomeAuthenticationPolicySections } = await import('./HomeAdministrationPoliciesScreen');
        const serverId = await harness.addHome({ name: 'Home A', serverUrl: 'https://home-a.example', accountId: 'owner' });
        homePolicyOperationBoundary.setAuthenticationPolicies = async () => ({
            kind: 'approval_pending',
            artifactId: 'approval-home-policy-1',
        });
        const projection = homeGovernanceProjectionFixture();
        projection.policy = {
            ...projection.policy,
            revision: 7,
            teamProviders: {
                status: 'narrowed',
                policy: {
                    v: 1,
                    allowedTeamProviderKinds: ['oidc'],
                    teamJitAllowed: false,
                    approvedGitHubEnterpriseOrigins: [],
                },
            },
        };
        const requestApproval = vi.fn();
        const context: HomeAdministrationContext = {
            scope: { serverId, accountId: 'owner' },
            homeName: 'Home A',
            projection,
            mutationsAvailable: true,
            approvalPending: false,
            requestApproval,
            refresh: vi.fn(),
        };
        const screen = await renderScreen(<HomeAuthenticationPolicySections context={context} />);

        await screen.pressByTestIdAsync('home-policy-team-provider:workos_sso');
        await waitForHomeGovernance(() => expect(requestApproval).toHaveBeenCalledTimes(1));
        expect(renderedControlIsChecked(screen.findByTestId('home-policy-team-provider:workos_sso'))).toBe(true);

        await screen.update(<HomeAuthenticationPolicySections context={{ ...context, approvalPending: true }} />);
        expect(renderedControlIsChecked(screen.findByTestId('home-policy-team-provider:workos_sso'))).toBe(true);

        await screen.update(<HomeAuthenticationPolicySections context={{ ...context, approvalPending: false }} />);
        await waitForHomeGovernance(() => expect(
            renderedControlIsChecked(screen.findByTestId('home-policy-team-provider:workos_sso')),
        ).toBe(false));
    });

    it('adopts the refreshed authoritative Team-provider selection after approved execution', async () => {
        const { HomeAuthenticationPolicySections } = await import('./HomeAdministrationPoliciesScreen');
        const serverId = await harness.addHome({ name: 'Home A', serverUrl: 'https://home-a.example', accountId: 'owner' });
        homePolicyOperationBoundary.setAuthenticationPolicies = async () => ({
            kind: 'approval_pending',
            artifactId: 'approval-home-policy-2',
        });
        const projection = homeGovernanceProjectionFixture();
        projection.policy = {
            ...projection.policy,
            revision: 8,
            teamProviders: {
                status: 'narrowed',
                policy: {
                    v: 1,
                    allowedTeamProviderKinds: ['oidc'],
                    teamJitAllowed: false,
                    approvedGitHubEnterpriseOrigins: [],
                },
            },
        };
        const requestApproval = vi.fn();
        const context: HomeAdministrationContext = {
            scope: { serverId, accountId: 'owner' },
            homeName: 'Home A',
            projection,
            mutationsAvailable: true,
            approvalPending: false,
            requestApproval,
            refresh: vi.fn(),
        };
        const screen = await renderScreen(<HomeAuthenticationPolicySections context={context} />);
        await screen.pressByTestIdAsync('home-policy-team-provider:workos_sso');
        await waitForHomeGovernance(() => expect(requestApproval).toHaveBeenCalledTimes(1));
        await screen.update(<HomeAuthenticationPolicySections context={{ ...context, approvalPending: true }} />);

        const refreshedProjection = homeGovernanceProjectionFixture();
        refreshedProjection.policy = {
            ...refreshedProjection.policy,
            revision: 9,
            teamProviders: {
                status: 'narrowed',
                policy: {
                    v: 1,
                    allowedTeamProviderKinds: ['workos_sso', 'oidc'],
                    teamJitAllowed: false,
                    approvedGitHubEnterpriseOrigins: [],
                },
            },
        };
        await screen.update(
            <HomeAuthenticationPolicySections
                context={{ ...context, projection: refreshedProjection, approvalPending: false }}
            />,
        );
        await waitForHomeGovernance(() => expect(
            renderedControlIsChecked(screen.findByTestId('home-policy-team-provider:workos_sso')),
        ).toBe(true));
    });

    it('saves canonical GitHub Enterprise origins through the existing Team-provider policy CAS', async () => {
        const { HomeAuthenticationPolicySections } = await import('./HomeAdministrationPoliciesScreen');
        const serverId = await harness.addHome({ name: 'Home A', serverUrl: 'https://home-a.example', accountId: 'owner' });
        const projection = homeGovernanceProjectionFixture();
        projection.policy = {
            ...projection.policy,
            revision: 12,
            teamProviders: {
                status: 'narrowed',
                policy: {
                    v: 1,
                    allowedTeamProviderKinds: ['github_app_identity'],
                    teamJitAllowed: true,
                    approvedGitHubEnterpriseOrigins: ['https://github.first.example'],
                },
            },
        };
        harness.answer(serverId, '/v1/home/policy/set', { body: { ...projection.policy, revision: 13 } });
        harness.answer(serverId, '/v1/home/governance/get', { body: projection });
        const context: HomeAdministrationContext = {
            scope: { serverId, accountId: 'owner' },
            homeName: 'Home A',
            projection,
            mutationsAvailable: true,
            approvalPending: false,
            refresh: vi.fn(),
        };

        const screen = await renderScreen(<HomeAuthenticationPolicySections context={context} />);
        screen.changeTextByTestId(
            'home-policy-team-provider-origins',
            'https://github.first.example\n\nhttps://github.second.example:8443\n',
        );
        await waitForHomeGovernance(() => expect(
            renderedControlIsDisabled(screen.findByTestId('home-policy-team-provider-origins-save')),
        ).toBe(false));
        await screen.pressByTestIdAsync('home-policy-team-provider-origins-save');

        await waitForHomeGovernance(() => expect(harness.requestsFor('/v1/home/policy/set')).toHaveLength(1));
        expect(harness.requestsFor('/v1/home/policy/set')[0]).toMatchObject({
            serverId,
            input: {
                expectedRevision: 12,
                teamProviderPolicy: {
                    v: 1,
                    allowedTeamProviderKinds: ['github_app_identity'],
                    teamJitAllowed: true,
                    approvedGitHubEnterpriseOrigins: [
                        'https://github.first.example',
                        'https://github.second.example:8443',
                    ],
                },
            },
        });
    });

    it('keeps an invalid or duplicate GitHub Enterprise origin inline and never sends it', async () => {
        const { HomeAuthenticationPolicySections } = await import('./HomeAdministrationPoliciesScreen');
        const serverId = await harness.addHome({ name: 'Home A', serverUrl: 'https://home-a.example', accountId: 'owner' });
        const projection = homeGovernanceProjectionFixture();
        projection.policy = {
            ...projection.policy,
            revision: 14,
            teamProviders: {
                status: 'narrowed',
                policy: {
                    v: 1,
                    allowedTeamProviderKinds: ['github_app_identity'],
                    teamJitAllowed: false,
                    approvedGitHubEnterpriseOrigins: [],
                },
            },
        };
        const context: HomeAdministrationContext = {
            scope: { serverId, accountId: 'owner' },
            homeName: 'Home A',
            projection,
            mutationsAvailable: true,
            approvalPending: false,
            refresh: vi.fn(),
        };

        const screen = await renderScreen(<HomeAuthenticationPolicySections context={context} />);
        screen.changeTextByTestId(
            'home-policy-team-provider-origins',
            'https://github.company.example/path',
        );

        await waitForHomeGovernance(() => expect(screen.findByTestId('home-policy-team-provider-origins-invalid')).toBeTruthy());
        expect(renderedControlIsDisabled(screen.findByTestId('home-policy-team-provider-origins-save'))).toBe(true);
        expect(harness.requestsFor('/v1/home/policy/set')).toHaveLength(0);

        screen.changeTextByTestId(
            'home-policy-team-provider-origins',
            'https://github.company.example\nhttps://github.company.example',
        );
        await waitForHomeGovernance(() => expect(screen.findByTestId('home-policy-team-provider-origins-invalid')).toBeTruthy());
        expect(renderedControlIsDisabled(screen.findByTestId('home-policy-team-provider-origins-save'))).toBe(true);
        expect(harness.requestsFor('/v1/home/policy/set')).toHaveLength(0);
    });

    it('keeps a GitHub Enterprise origin draft across a CAS conflict and retries with the refreshed revision', async () => {
        const { HomeAuthenticationPolicySections } = await import('./HomeAdministrationPoliciesScreen');
        const serverId = await harness.addHome({ name: 'Home A', serverUrl: 'https://home-a.example', accountId: 'owner' });
        const projection = homeGovernanceProjectionFixture();
        projection.policy = {
            ...projection.policy,
            revision: 20,
            teamProviders: {
                status: 'narrowed',
                policy: {
                    v: 1,
                    allowedTeamProviderKinds: ['github_app_identity'],
                    teamJitAllowed: false,
                    approvedGitHubEnterpriseOrigins: ['https://github.old.example'],
                },
            },
        };
        harness.answer(serverId, '/v1/home/policy/set', {
            status: 409,
            body: { error: 'home_policy_revision_conflict' },
        });
        const refresh = vi.fn();
        const context: HomeAdministrationContext = {
            scope: { serverId, accountId: 'owner' },
            homeName: 'Home A',
            projection,
            mutationsAvailable: true,
            approvalPending: false,
            refresh,
        };

        const screen = await renderScreen(<HomeAuthenticationPolicySections context={context} />);
        screen.changeTextByTestId('home-policy-team-provider-origins', 'https://github.mine.example');
        await waitForHomeGovernance(() => expect(
            renderedControlIsDisabled(screen.findByTestId('home-policy-team-provider-origins-save')),
        ).toBe(false));
        await screen.pressByTestIdAsync('home-policy-team-provider-origins-save');
        await waitForHomeGovernance(() => expect(refresh).toHaveBeenCalledTimes(1));

        const refreshedProjection = homeGovernanceProjectionFixture();
        refreshedProjection.policy = {
            ...refreshedProjection.policy,
            revision: 21,
            teamProviders: {
                status: 'narrowed',
                policy: {
                    v: 1,
                    allowedTeamProviderKinds: ['oidc', 'github_app_identity'],
                    teamJitAllowed: true,
                    approvedGitHubEnterpriseOrigins: ['https://github.theirs.example'],
                },
            },
        };
        await screen.update(
            <HomeAuthenticationPolicySections context={{ ...context, projection: refreshedProjection }} />,
        );
        expect(screen.findByTestId('home-policy-team-provider-origins')!.props.value).toBe('https://github.mine.example');

        harness.answer(serverId, '/v1/home/policy/set', {
            body: { ...refreshedProjection.policy, revision: 22 },
        });
        await screen.pressByTestIdAsync('home-policy-team-provider-origins-save');
        await waitForHomeGovernance(() => expect(harness.requestsFor('/v1/home/policy/set')).toHaveLength(2));
        expect(harness.requestsFor('/v1/home/policy/set')[1]).toMatchObject({
            serverId,
            input: {
                expectedRevision: 21,
                teamProviderPolicy: {
                    v: 1,
                    allowedTeamProviderKinds: ['oidc', 'github_app_identity'],
                    teamJitAllowed: true,
                    approvedGitHubEnterpriseOrigins: ['https://github.mine.example'],
                },
            },
        });
    });

    it('reports the deployment WorkOS state and hides private endpoints the deployment forbids', async () => {
        const { HomeAuthenticationPolicySections } = await import('./HomeAdministrationPoliciesScreen');
        const serverId = await harness.addHome({ name: 'Cloud', serverUrl: 'https://cloud.example', accountId: 'owner' });
        const projection = homeGovernanceProjectionFixture({
            identityServices: { workos: 'partially_configured', privateIdentityNetworkAllowed: false },
        });
        harness.answer(serverId, '/v1/home/governance/get', { body: projection });
        const context: HomeAdministrationContext = {
            scope: { serverId, accountId: 'owner' },
            homeName: 'Cloud',
            projection,
            mutationsAvailable: true,
            approvalPending: false,
            refresh: vi.fn(),
        };

        const screen = await renderScreen(<HomeAuthenticationPolicySections context={context} />);
        expect(screen.findByTestId('home-policy-deployment-workos')).toBeTruthy();
        expect(screen.findAllByTestId('home-policy-identity-network-mode:private_allowlist')).toHaveLength(0);
    });

    it('saves an exact private endpoint allowlist through the Home policy revision owner', async () => {
        const { HomeAuthenticationPolicySections } = await import('./HomeAdministrationPoliciesScreen');
        const serverId = await harness.addHome({ name: 'Self hosted', serverUrl: 'https://self.example', accountId: 'owner' });
        const projection = homeGovernanceProjectionFixture({
            identityServices: { workos: 'configured', privateIdentityNetworkAllowed: true },
        });
        projection.policy = { ...projection.policy, revision: 7 };
        harness.answer(serverId, '/v1/home/policy/set', { body: { ...projection.policy, revision: 8 } });
        harness.answer(serverId, '/v1/home/governance/get', { body: projection });
        const context: HomeAdministrationContext = {
            scope: { serverId, accountId: 'owner' },
            homeName: 'Self hosted',
            projection,
            mutationsAvailable: true,
            approvalPending: false,
            refresh: vi.fn(),
        };

        const screen = await renderScreen(<HomeAuthenticationPolicySections context={context} />);
        await screen.pressByTestIdAsync('home-policy-identity-network-mode:private_allowlist');
        screen.changeTextByTestId('home-policy-identity-network-hostnames', 'idp.corp.example\n');
        screen.changeTextByTestId('home-policy-identity-network-cidrs', '10.0.0.0/8');
        screen.changeTextByTestId('home-policy-identity-network-ports', '443\n8443');
        await screen.pressByTestIdAsync('home-policy-identity-network-save');

        await waitForHomeGovernance(() => expect(harness.requestsFor('/v1/home/policy/set')).toHaveLength(1));
        expect(harness.requestsFor('/v1/home/policy/set')[0]).toMatchObject({
            serverId,
            input: {
                expectedRevision: 7,
                identityNetworkPolicy: {
                    v: 1,
                    mode: 'private_allowlist',
                    hostnames: ['idp.corp.example'],
                    cidrs: ['10.0.0.0/8'],
                    ports: [443, 8443],
                },
            },
        });
    });

    it('keeps a dirty private-network draft across a revision refresh and retries against the new revision', async () => {
        const { HomeAuthenticationPolicySections } = await import('./HomeAdministrationPoliciesScreen');
        const serverId = await harness.addHome({ name: 'Self hosted', serverUrl: 'https://self.example', accountId: 'owner' });
        const projection = homeGovernanceProjectionFixture({
            identityServices: { workos: 'configured', privateIdentityNetworkAllowed: true },
        });
        projection.policy = {
            ...projection.policy,
            revision: 7,
            identityNetwork: {
                status: 'narrowed',
                policy: { v: 1, mode: 'public_only' },
            },
        };
        harness.answer(serverId, '/v1/home/policy/set', {
            status: 409,
            body: { error: 'home_policy_revision_conflict' },
        });
        const refresh = vi.fn();
        const context: HomeAdministrationContext = {
            scope: { serverId, accountId: 'owner' },
            homeName: 'Self hosted',
            projection,
            mutationsAvailable: true,
            approvalPending: false,
            refresh,
        };

        const screen = await renderScreen(<HomeAuthenticationPolicySections context={context} />);
        await screen.pressByTestIdAsync('home-policy-identity-network-mode:private_allowlist');
        screen.changeTextByTestId('home-policy-identity-network-hostnames', 'idp.corp.example');
        screen.changeTextByTestId('home-policy-identity-network-cidrs', '10.0.0.0/8');
        screen.changeTextByTestId('home-policy-identity-network-ports', '443\n8443');
        await screen.pressByTestIdAsync('home-policy-identity-network-save');
        await waitForHomeGovernance(() => expect(refresh).toHaveBeenCalledTimes(1));

        const refreshedProjection = homeGovernanceProjectionFixture({
            identityServices: { workos: 'configured', privateIdentityNetworkAllowed: true },
        });
        refreshedProjection.policy = {
            ...refreshedProjection.policy,
            revision: 8,
            identityNetwork: {
                status: 'narrowed',
                policy: {
                    v: 1,
                    mode: 'private_allowlist',
                    hostnames: ['someone-elses-idp.example'],
                    cidrs: [],
                    ports: [9443],
                },
            },
        };
        await screen.update(
            <HomeAuthenticationPolicySections
                context={{ ...context, projection: refreshedProjection }}
            />,
        );

        harness.answer(serverId, '/v1/home/policy/set', {
            body: { ...refreshedProjection.policy, revision: 9 },
        });
        await screen.pressByTestIdAsync('home-policy-identity-network-save');
        await waitForHomeGovernance(() => expect(harness.requestsFor('/v1/home/policy/set')).toHaveLength(2));
        expect(harness.requestsFor('/v1/home/policy/set')[1]).toMatchObject({
            serverId,
            input: {
                expectedRevision: 8,
                identityNetworkPolicy: {
                    v: 1,
                    mode: 'private_allowlist',
                    hostnames: ['idp.corp.example'],
                    cidrs: ['10.0.0.0/8'],
                    ports: [443, 8443],
                },
            },
        });
    });
});

describe('TeamCreationPolicyEditor', () => {
    it('does not carry a retained draft into the same route on another Home', async () => {
        const { TeamCreationPolicyEditor } = await import('./HomeAdministrationPoliciesScreen');
        const serverA = await harness.addHome({ name: 'Home A', serverUrl: 'https://home-a.example', accountId: 'owner-a' });
        const serverB = await harness.addHome({ name: 'Home B', serverUrl: 'https://home-b.example', accountId: 'owner-b' });
        const projectionA = homeGovernanceProjectionFixture();
        harness.answer(serverA, '/v1/home/policy/set', { status: 500, body: { error: 'home_policy_unavailable' } });
        const contextA: HomeAdministrationContext = {
            scope: { serverId: serverA, accountId: 'owner-a' },
            homeName: 'Home A',
            projection: projectionA,
            mutationsAvailable: true,
            approvalPending: false,
            refresh: vi.fn(),
        };
        const projectionB = homeGovernanceProjectionFixture();
        projectionB.policy = { ...projectionB.policy, teamCreationPolicy: 'disabled' };
        const contextB: HomeAdministrationContext = {
            scope: { serverId: serverB, accountId: 'owner-b' },
            homeName: 'Home B',
            projection: projectionB,
            mutationsAvailable: true,
            approvalPending: false,
            refresh: vi.fn(),
        };

        const screen = await renderScreen(<TeamCreationPolicyEditor context={contextA} />);
        await screen.pressByTestIdAsync('home-policy-team-creation:self_service');
        await waitForHomeGovernance(() => expect(renderedControlIsChecked(screen.findByTestId('home-policy-team-creation:self_service'))).toBe(true));

        await act(async () => {
            screen.tree.update(<TeamCreationPolicyEditor context={contextB} />);
        });

        expect(renderedControlIsChecked(screen.findByTestId('home-policy-team-creation:disabled'))).toBe(true);
        expect(renderedControlIsChecked(screen.findByTestId('home-policy-team-creation:self_service'))).toBe(false);
    });

    it('closes the same-frame duplicate-submit window before the busy state renders', async () => {
        const { TeamCreationPolicyEditor } = await import('./HomeAdministrationPoliciesScreen');
        const serverId = await harness.addHome({ name: 'Home A', serverUrl: 'https://home-a.example', accountId: 'owner' });
        const projection = homeGovernanceProjectionFixture();
        let finishSave: (() => void) | null = null;
        const saveResponse = new Promise<void>((resolve) => { finishSave = resolve; });
        harness.answer(serverId, '/v1/home/policy/set', {
            body: { ...projection.policy, revision: projection.policy.revision + 1, teamCreationPolicy: 'self_service' },
            respondAfter: saveResponse,
        });
        const context: HomeAdministrationContext = {
            scope: { serverId, accountId: 'owner' },
            homeName: 'Home A',
            projection,
            mutationsAvailable: true,
            approvalPending: false,
            refresh: vi.fn(),
        };
        const screen = await renderScreen(<TeamCreationPolicyEditor context={context} />);
        const activate = screen.findByTestId('home-policy-team-creation:self_service')?.props.onPress as (() => void) | undefined;

        act(() => {
            activate?.();
            activate?.();
        });
        await waitForHomeGovernance(() => expect(harness.requestsFor('/v1/home/policy/set')).toHaveLength(1));

        await act(async () => {
            finishSave?.();
            await saveResponse;
        });
    });

    it('keeps the requested policy and offers an inline retry after a failed save', async () => {
        const { TeamCreationPolicyEditor } = await import('./HomeAdministrationPoliciesScreen');
        const serverId = await harness.addHome({ name: 'Home A', serverUrl: 'https://home-a.example', accountId: 'owner' });
        const projection = homeGovernanceProjectionFixture();
        harness.answer(serverId, '/v1/home/policy/set', {
            status: 500,
            body: { error: 'home_policy_unavailable' },
        });
        const context: HomeAdministrationContext = {
            scope: { serverId, accountId: 'owner' },
            homeName: 'Home A',
            projection,
            mutationsAvailable: true,
            approvalPending: false,
            refresh: vi.fn(),
        };

        const screen = await renderScreen(<TeamCreationPolicyEditor context={context} />);
        await screen.pressByTestIdAsync('home-policy-team-creation:self_service');
        await waitForHomeGovernance(() => expect(screen.findByTestId('home-policy-team-creation-retry')).toBeTruthy());
        expect(renderedControlIsChecked(screen.findByTestId('home-policy-team-creation:self_service'))).toBe(true);

        harness.answer(serverId, '/v1/home/policy/set', {
            body: { ...projection.policy, revision: projection.policy.revision + 1, teamCreationPolicy: 'self_service' },
        });
        await screen.pressByTestIdAsync('home-policy-team-creation-retry');
        await waitForHomeGovernance(() => expect(harness.requestsFor('/v1/home/policy/set')).toHaveLength(2));
        expect(screen.findByTestId('home-policy-team-creation-retry')).toBeNull();
    });
});
