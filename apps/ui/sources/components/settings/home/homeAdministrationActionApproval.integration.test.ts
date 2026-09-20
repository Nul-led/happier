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
    createHomeGovernanceHarness,
    installHomeGovernanceBoundaries,
} from '@/dev/testkit/harness/homeGovernanceHarness';

vi.mock('@/sync/api/capabilities/accountStoredContentCompatibility', async (importOriginal) => ({
    ...await importOriginal<typeof import('@/sync/api/capabilities/accountStoredContentCompatibility')>(),
    // This integration owns Action approval and artifact transport. Stored-
    // content compatibility is independently covered by its owner tests.
    requireCurrentAccountStoredContentServerCompatibility: vi.fn(async () => undefined),
}));

const harness = createHomeGovernanceHarness();
installHomeGovernanceBoundaries(harness);

async function addHome(): Promise<Readonly<{ serverId: string; accountId: string }>> {
    const accountId = 'account-admin';
    const serverId = await harness.addHome({
        name: 'Approval Home',
        serverUrl: 'https://approval-home.example',
        accountId,
    });
    return { serverId, accountId };
}

beforeEach(async () => {
    await harness.reset();
    const { resetScopedHomeActionExecutorsForTests } = await import(
        '@/sync/ops/actions/scopedHomeActionExecutor'
    );
    resetScopedHomeActionExecutorsForTests();
});

afterEach(async () => {
    const { resetScopedHomeActionExecutorsForTests } = await import(
        '@/sync/ops/actions/scopedHomeActionExecutor'
    );
    resetScopedHomeActionExecutorsForTests();
    standardCleanup();
});

describe('Home administration Action approval convergence', () => {
    it('runs a direct present-user mutation without inventing a second default approval', async () => {
        const scope = await addHome();
        harness.answer(scope.serverId, '/v1/identity/github-apps/remove', {
            body: { removed: true },
        });
        const { createManagedGitHubAppsClient } = await import(
            './githubApps/managedGitHubAppsClient'
        );

        const result = await createManagedGitHubAppsClient(scope).execute(
            'identity.githubApps.remove',
            {
                owner: { kind: 'home' },
                installationId: 'installation-1',
                expectedRevision: 1,
            },
        );

        expect(result).toEqual({ kind: 'succeeded', value: { removed: true } });
        expect(harness.requestsFor('/v1/identity/github-apps/remove')).toHaveLength(1);
        expect(harness.requestsFor('/v1/artifacts')).toEqual([]);
    });

    it('keeps an identity-provider mutation pending without reaching its Home route', async () => {
        const scope = await addHome();
        await harness.requireUiApproval(scope.serverId, 'identity.providers.enable');
        const { createManagedIdentityProviderClient } = await import(
            './identity/managedIdentityProviderClient'
        );

        const result = await createManagedIdentityProviderClient(scope).execute(
            'identity.providers.enable',
            {
                owner: { kind: 'home' },
                id: 'provider-1',
                expectedRevision: 1,
                expectedSecurityRevision: 1,
            },
        );

        expect(result).toMatchObject({ kind: 'approval_pending', artifactId: expect.any(String) });
        expect(harness.requestsFor('/v1/identity/providers/enable')).toEqual([]);
        expect(harness.requestsFor('/v1/artifacts')).toHaveLength(1);
    });

    it('keeps a GitHub App mutation pending without reaching its Home route', async () => {
        const scope = await addHome();
        await harness.requireUiApproval(scope.serverId, 'identity.githubApps.remove');
        const { createManagedGitHubAppsClient } = await import(
            './githubApps/managedGitHubAppsClient'
        );

        const result = await createManagedGitHubAppsClient(scope).execute(
            'identity.githubApps.remove',
            {
                owner: { kind: 'home' },
                installationId: 'installation-1',
                expectedRevision: 1,
            },
        );

        expect(result).toMatchObject({ kind: 'approval_pending', artifactId: expect.any(String) });
        expect(harness.requestsFor('/v1/identity/github-apps/remove')).toEqual([]);
        expect(harness.requestsFor('/v1/artifacts')).toHaveLength(1);
    });

    it('fails closed when an impossible read approval replaces the list result', async () => {
        const scope = await addHome();
        await harness.requireUiApproval(scope.serverId, 'identity.providers.list');
        const { createManagedIdentityProviderClient } = await import(
            './identity/managedIdentityProviderClient'
        );

        const result = await createManagedIdentityProviderClient(scope).execute(
            'identity.providers.list',
            { owner: { kind: 'home' } },
        );

        expect(result).toEqual({
            kind: 'failed',
            failure: { code: 'invalid_action_output', retryable: false },
        });
        expect(harness.requestsFor('/v1/identity/providers/list')).toEqual([]);
    });
});
