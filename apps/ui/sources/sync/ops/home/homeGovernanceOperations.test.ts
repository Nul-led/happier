import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
    createHomeGovernanceHarness,
    homeAccountRowFixture,
    homeGovernancePolicyProjectionFixture,
    installHomeGovernanceBoundaries,
    standardCleanup,
} from '@/dev/testkit';
import { resetServerFeaturesClientForTests } from '@/sync/api/capabilities/serverFeaturesClient';

/**
 * The Home operation wrappers, through the path they actually take.
 *
 * Every wrapper names a canonical Action id and nothing else. The method, path
 * and result shape come from that id's row by way of the shared Action executor,
 * so these tests watch the network boundary: a wrapper pointed at the wrong id,
 * or a row whose transport moved, changes what arrives there and fails here.
 * Only the network and the device credential store are replaced.
 */

const harness = createHomeGovernanceHarness();
installHomeGovernanceBoundaries(harness);

const GOVERNANCE_PATH = '/v1/home/governance/get';

async function operations() {
    return await import('./homeGovernanceOperations');
}

async function addHome(): Promise<string> {
    return await harness.addHome({
        name: 'Home A',
        serverUrl: 'https://home-a.example',
        accountId: 'account-admin',
    });
}

beforeEach(async () => {
    const { resetHomeGovernanceSnapshotsForTests } = await import(
        '@/sync/store/home/governance/homeGovernanceSnapshots'
    );
    const { resetHomeGovernanceEngineForTests } = await import(
        '@/sync/engine/home/governance/homeGovernanceEngine'
    );
    resetHomeGovernanceSnapshotsForTests();
    resetHomeGovernanceEngineForTests();
    resetServerFeaturesClientForTests();
    await harness.reset();
});

afterEach(() => {
    standardCleanup();
});

describe('home governance mutations', () => {
    it('keeps a deferred approval distinct from a committed Home mutation', async () => {
        const { classifyHomeGovernanceActionOutcome } = await operations();

        expect(classifyHomeGovernanceActionOutcome({
            ok: true,
            result: {
                kind: 'approval_request_created',
                artifactId: 'approval-home-1',
                actionId: 'home.policy.set',
            },
        })).toEqual({ kind: 'approval_pending', artifactId: 'approval-home-1' });
    });

    it('rejects an explicit Home intent without a bound port instead of mutating the focused Home', async () => {
        const homeA = await addHome();
        const homeB = await harness.addHome({
            name: 'Home B',
            serverUrl: 'https://home-b.example',
            accountId: 'account-admin',
        });
        const { storage } = await import('@/sync/domains/state/storage');
        storage.setState({ profileScope: { serverId: homeB, accountId: 'account-admin' } });
        harness.answer(homeB, '/v1/home/accounts/role/set', {
            body: homeAccountRowFixture('acc_target', { homeRole: 'admin' }),
        });

        const { createDefaultActionExecutor } = await import('@/sync/ops/actions/defaultActionExecutor');
        const result = await createDefaultActionExecutor().execute(
            'home.accounts.role.set',
            { accountId: 'acc_target', homeRole: 'admin' },
            { surface: 'ui', serverId: homeA },
        );

        expect(result).toMatchObject({ ok: false, errorCode: 'unsupported_action' });
        expect(harness.requestsFor('/v1/home/accounts/role/set')).toEqual([]);
    });

    it('carries a role change to the exact Home over its own Action row transport', async () => {
        const home = await addHome();
        const focusedHome = await harness.addHome({
            name: 'Home B',
            serverUrl: 'https://home-b.example',
            accountId: 'account-admin',
        });
        const { storage } = await import('@/sync/domains/state/storage');
        storage.setState({ profileScope: { serverId: focusedHome, accountId: 'account-admin' } });
        harness.answer(home, '/v1/home/accounts/role/set', {
            body: homeAccountRowFixture('acc_target', { homeRole: 'admin' }),
        });

        const { setHomeAccountRole } = await operations();
        const outcome = await setHomeAccountRole({
            scope: { serverId: home, accountId: 'account-admin' },
            accountId: 'acc_target',
            homeRole: 'admin',
        });

        expect(outcome.kind).toBe('succeeded');
        const [request] = harness.requestsFor('/v1/home/accounts/role/set');
        expect(request?.serverId).toBe(home);
        expect(request?.input).toEqual({ accountId: 'acc_target', homeRole: 'admin' });
    });

    it('re-reads the same Home only after a change it actually accepted', async () => {
        const home = await addHome();
        harness.answer(home, '/v1/home/accounts/disable', {
            body: homeAccountRowFixture('acc_target', { status: 'suspended' }),
        });

        const { disableHomeAccount } = await operations();
        await disableHomeAccount({
            scope: { serverId: home, accountId: 'account-admin' },
            accountId: 'acc_target',
        });

        // The refresh is the observable consequence of an accepted change.
        expect(harness.requestsFor(GOVERNANCE_PATH).length).toBeGreaterThan(0);
    });

    it('does not re-read a Home that refused the change', async () => {
        const home = await addHome();
        harness.answer(home, '/v1/home/accounts/disable', {
            status: 403,
            body: { error: 'home_governance_forbidden' },
        });

        const { disableHomeAccount } = await operations();
        const outcome = await disableHomeAccount({
            scope: { serverId: home, accountId: 'account-admin' },
            accountId: 'acc_target',
        });

        expect(outcome).toEqual({
            kind: 'failed',
            failure: {
                kind: 'forbidden',
                retryable: false,
                code: 'home_governance_forbidden',
                details: { error: 'home_governance_forbidden' },
            },
        });
        expect(harness.requestsFor(GOVERNANCE_PATH)).toHaveLength(0);
    });

    it('reports a Home with no such operation as unsupported rather than a generic failure', async () => {
        const home = await addHome();
        // No answer registered: this Home does not serve the operation.

        const { enableHomeAccount } = await operations();
        const outcome = await enableHomeAccount({
            scope: { serverId: home, accountId: 'account-admin' },
            accountId: 'acc_target',
        });

        expect(outcome.kind).toBe('failed');
        if (outcome.kind !== 'failed') throw new Error('unreachable');
        expect(outcome.failure.kind).toBe('unsupported');
        expect(outcome.failure.retryable).toBe(false);
    });

    it('keeps an unfinished erasure distinguishable from a completed one', async () => {
        const home = await addHome();
        harness.answer(home, '/v1/home/accounts/delete', {
            body: { status: 'disabled_pending_completion' },
        });

        const { deleteHomeAccount } = await operations();
        const outcome = await deleteHomeAccount({
            scope: { serverId: home, accountId: 'account-admin' },
            accountId: 'acc_target',
        });

        expect(outcome.kind).toBe('incomplete');
        // Either answer means the Account's access is gone, so the Home moved.
        expect(harness.requestsFor(GOVERNANCE_PATH).length).toBeGreaterThan(0);
    });

    it('reports a finished erasure as succeeded', async () => {
        const home = await addHome();
        harness.answer(home, '/v1/home/accounts/delete', { body: { status: 'deleted' } });

        const { deleteHomeAccount } = await operations();
        const outcome = await deleteHomeAccount({
            scope: { serverId: home, accountId: 'account-admin' },
            accountId: 'acc_target',
        });

        expect(outcome.kind).toBe('succeeded');
    });

    it('sends both policy wrappers to the Home one policy mutation with its revision', async () => {
        const home = await addHome();
        harness.answer(home, '/v1/home/policy/set', { body: homeGovernancePolicyProjectionFixture() });

        const { setHomeTeamCreationPolicy, setHomeAuthenticationPolicies } = await operations();
        const scope = { serverId: home, accountId: 'account-admin' } as const;

        await setHomeTeamCreationPolicy({
            scope,
            expectedRevision: 4,
            teamCreationPolicy: 'self_service',
        });
        await setHomeAuthenticationPolicies({
            scope,
            expectedRevision: 7,
            teamProviderPolicy: {
                v: 1,
                allowedTeamProviderKinds: ['oidc', 'workos_sso'],
                teamJitAllowed: false,
                approvedGitHubEnterpriseOrigins: [],
            },
            identityNetworkPolicy: null,
        });

        const [teamCreation, authentication] = harness.requestsFor('/v1/home/policy/set');
        expect(teamCreation?.input).toEqual({
            expectedRevision: 4,
            teamCreationPolicy: 'self_service',
        });
        expect(authentication?.input).toEqual({
            expectedRevision: 7,
            teamProviderPolicy: {
                v: 1,
                allowedTeamProviderKinds: ['oidc', 'workos_sso'],
                teamJitAllowed: false,
                approvedGitHubEnterpriseOrigins: [],
            },
            identityNetworkPolicy: null,
        });
    });

    it('reads a People page without re-reading the viewer own capabilities', async () => {
        const home = await addHome();
        harness.answer(home, '/v1/home/accounts/list', {
            body: { items: [], nextCursor: null },
        });

        const { listHomeAccounts } = await operations();
        const outcome = await listHomeAccounts({
            scope: { serverId: home, accountId: 'account-admin' },
            cursor: 'cur_2',
        });

        expect(outcome.kind).toBe('succeeded');
        expect(harness.requestsFor('/v1/home/accounts/list')[0]?.input).toEqual({ cursor: 'cur_2' });
        // A list page moving does not mean the viewer's capabilities did.
        expect(harness.requestsFor(GOVERNANCE_PATH)).toHaveLength(0);
    });

    it('searches the Home scope explicitly so managing one Team cannot widen the lookup', async () => {
        const home = await addHome();
        harness.answer(home, '/v1/home/accounts/search', { body: { accounts: [] } });

        const { searchHomeAccounts } = await operations();
        const outcome = await searchHomeAccounts({
            scope: { serverId: home, accountId: 'account-admin' },
            query: '  ada  ',
        });

        expect(outcome.kind).toBe('succeeded');
        expect(harness.requestsFor('/v1/home/accounts/search')[0]?.input).toEqual({
            query: 'ada',
            scope: { kind: 'home' },
        });
    });

    it('rejects an answer that does not satisfy the read contract', async () => {
        const home = await addHome();
        harness.answer(home, '/v1/home/accounts/list', { body: { items: 'not-a-list' } });

        const { listHomeAccounts } = await operations();
        const outcome = await listHomeAccounts({
            scope: { serverId: home, accountId: 'account-admin' },
        });

        expect(outcome.kind).toBe('failed');
        if (outcome.kind !== 'failed') throw new Error('unreachable');
        expect(outcome.failure.kind).toBe('invalid');
    });
});
