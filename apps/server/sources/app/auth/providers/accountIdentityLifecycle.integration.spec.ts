import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '@/storage/db';
import { inTx } from '@/storage/inTx';
import { eventRouter } from '@/app/events/eventRouter';
import { createLightSqliteHarness, type LightSqliteHarness } from '@/testkit/lightSqliteHarness';
import {
    prepareIdentityLink,
    ProviderAlreadyLinkedError,
    refreshIdentity,
    removeIdentitiesForProviderInTx,
    setIdentityVisibilityInTx,
    unlinkIdentity,
} from './accountIdentityLifecycle';
import { connectExternalIdentity } from './identity';
import { resolveOAuthRuntimeById } from './identityProviderCatalog';
import { encryptString } from '@/modules/encrypt';

describe('AccountIdentity lifecycle transaction contract', () => {
    let harness: LightSqliteHarness;
    beforeAll(async () => {
        harness = await createLightSqliteHarness({ tempDirPrefix: 'identity-lifecycle-', initEncrypt: true });
    }, 120_000);
    afterAll(async () => { await harness.close(); });
    beforeEach(async () => {
        vi.restoreAllMocks();
        harness.resetEnv();
        await harness.resetDbTables([
            () => db.accountChange.deleteMany(),
            () => db.accountIdentity.deleteMany(),
            () => db.identityProviderInstance.deleteMany(),
            () => db.account.deleteMany(),
        ]);
    });
    async function account(key: string) {
        return db.account.create({ data: { publicKey: key }, select: { id: true } });
    }
    const intent = (accountId: string) => ({ accountId, provider: 'mtls', providerUserId: 'exact-Subject', providerLogin: 'alice', showOnProfile: false, profile: { subject: 'exact-Subject' } });

    it('keeps the native email locator non-presentational at the identity lifecycle owner', async () => {
        const a = await account('identity-native-email');
        await inTx((await prepareIdentityLink({
            ...intent(a.id),
            provider: 'email',
            providerUserId: 'alice@example.test',
            providerLogin: 'alice@example.test',
            showOnProfile: true,
        })).connectInTx);

        await expect(db.accountIdentity.findFirstOrThrow({
            where: { accountId: a.id, provider: 'email' },
            select: { showOnProfile: true },
        })).resolves.toEqual({ showOnProfile: false });
        await expect(inTx((tx) => setIdentityVisibilityInTx(tx, {
            accountId: a.id,
            provider: 'email',
            showOnProfile: true,
        }))).resolves.toBe(false);
        await expect(db.accountIdentity.findFirstOrThrow({
            where: { accountId: a.id, provider: 'email' },
            select: { showOnProfile: true },
        })).resolves.toEqual({ showOnProfile: false });
    });

    it('rechecks a collision at commit and rolls back identity writes and publication', async () => {
        const first = await account('identity-first');
        const second = await account('identity-second');
        const pending = await prepareIdentityLink(intent(second.id));
        await inTx((await prepareIdentityLink(intent(first.id))).connectInTx);
        await expect(inTx(pending.connectInTx)).rejects.toThrow('provider-already-linked');
        expect(await db.accountIdentity.count({ where: { accountId: second.id } })).toBe(0);
        expect(await db.accountChange.count({ where: { accountId: second.id } })).toBe(0);
        // Socket transport is the genuine external boundary; transaction and domain logic stay real.
        const emit = vi.spyOn(eventRouter, 'emitUpdate').mockImplementation(() => {});
        await expect(inTx(async (tx) => {
            await setIdentityVisibilityInTx(tx, { accountId: first.id, provider: 'mtls', showOnProfile: true });
            expect(emit).not.toHaveBeenCalled();
            throw new Error('cancel-composition');
        })).rejects.toThrow('cancel-composition');
        expect(emit).not.toHaveBeenCalled();
        expect((await db.accountIdentity.findFirst({ where: { accountId: first.id } }))?.showOnProfile).toBe(false);
    });

    it('translates a unique-constraint race loser into the identity collision contract', async () => {
        const target = await account('identity-race-loser');
        const pending = await prepareIdentityLink(intent(target.id));

        await expect(inTx(async (tx) => {
            // Persistence is the genuine boundary: this is the constraint result a concurrent
            // winner can produce after the in-transaction collision read has completed.
            vi.spyOn(tx.accountIdentity, 'upsert').mockRejectedValueOnce(
                Object.assign(new Error('unique constraint'), { code: 'P2002' }),
            );
            await pending.connectInTx(tx);
        })).rejects.toBeInstanceOf(ProviderAlreadyLinkedError);
        await expect(db.accountIdentity.count({ where: { accountId: target.id } })).resolves.toBe(0);
        await expect(db.accountChange.count({ where: { accountId: target.id } })).resolves.toBe(0);
    });

    it('applies provider eligibility state as part of the canonical link mutation', async () => {
        const a = await account('identity-link-eligibility');
        const emit = vi.spyOn(eventRouter, 'emitUpdate').mockImplementation(() => {});

        await inTx((await prepareIdentityLink({
            ...intent(a.id),
            eligibility: {
                eligibilityStatus: 'eligible',
                eligibilityReason: null,
                eligibilityCheckedAt: new Date('2026-09-06T00:00:00.000Z'),
                eligibilityNextCheckAt: null,
            },
        })).connectInTx);

        await expect(db.accountIdentity.findFirstOrThrow({ where: { accountId: a.id } })).resolves.toMatchObject({
            eligibilityStatus: 'eligible',
            eligibilityReason: null,
            eligibilityCheckedAt: new Date('2026-09-06T00:00:00.000Z'),
            eligibilityNextCheckAt: null,
        });
        expect(emit.mock.calls.filter(([value]) => value.recipientFilter?.type === 'user-scoped-only')).toHaveLength(1);
    });

    it('publishes each committed standalone refresh, visibility and unlink once', async () => {
        const a = await account('identity-standalone');
        await inTx((await prepareIdentityLink(intent(a.id))).connectInTx);
        const identity = await db.accountIdentity.findFirstOrThrow({ where: { accountId: a.id } });
        const emit = vi.spyOn(eventRouter, 'emitUpdate').mockImplementation(() => {});
        const updateCount = () => emit.mock.calls.filter(([value]) => value.recipientFilter?.type === 'user-scoped-only').length;
        await refreshIdentity({ accountId: a.id, provider: 'mtls', identityId: identity.id, data: { eligibilityStatus: 'eligible', providerLogin: 'alice-updated' } });
        expect(updateCount()).toBe(1);
        await inTx((tx) => setIdentityVisibilityInTx(tx, { accountId: a.id, provider: 'mtls', showOnProfile: true }));
        expect(updateCount()).toBe(2);
        expect((await db.accountIdentity.findUnique({ where: { id: identity.id } }))?.providerLogin).toBe('alice-updated');
        await unlinkIdentity({ accountId: a.id, provider: 'mtls' });
        expect(updateCount()).toBe(3);
        await unlinkIdentity({ accountId: a.id, provider: 'mtls' });
        expect(updateCount()).toBe(3);
    });

    it('does not apply a stale refresh to a replacement subject', async () => {
        const a = await account('identity-relink');
        await inTx((await prepareIdentityLink(intent(a.id))).connectInTx);
        const previous = await db.accountIdentity.findFirstOrThrow({ where: { accountId: a.id } });
        await inTx((await prepareIdentityLink({ ...intent(a.id), providerUserId: 'replacement', providerLogin: 'bob' })).connectInTx);
        await refreshIdentity({ accountId: a.id, provider: 'mtls', identityId: previous.id, data: { providerLogin: 'stale-alice', eligibilityStatus: 'ineligible' } });
        expect(await db.accountIdentity.findFirstOrThrow({ where: { accountId: a.id } })).toMatchObject({ providerUserId: 'replacement', providerLogin: 'bob' });
    });

    it('batches surviving provider presentation across namespace removal and publishes each Account’s own identities', async () => {
        const accounts = await Promise.all(['first', 'second', 'third'].map((key) => account(`identity-removal-${key}`)));
        for (const [index, target] of accounts.entries()) {
            await db.accountIdentity.createMany({ data: [
                { accountId: target.id, provider: 'removed', providerUserId: `removed-${index}`, profile: {} },
                { accountId: target.id, provider: `retained-${index}`, providerUserId: `retained-${index}`, providerLogin: `member-${index}`, profile: {} },
            ] });
        }
        const emit = vi.spyOn(eventRouter, 'emitUpdate').mockImplementation(() => {});
        await inTx(async (tx) => {
            // Observe real database reads: neither surviving identities nor catalog presentation
            // may scale with the number of affected Accounts.
            const findManyIdentities = tx.accountIdentity.findMany.bind(tx.accountIdentity);
            const identityReads = vi.spyOn(tx.accountIdentity, 'findMany')
                .mockImplementation(findManyIdentities);
            const findManyProviderInstances = tx.identityProviderInstance.findMany.bind(tx.identityProviderInstance);
            const providerReads = vi.spyOn(tx.identityProviderInstance, 'findMany')
                .mockImplementation(findManyProviderInstances);
            await removeIdentitiesForProviderInTx(tx, 'removed');
            const survivingIdentityReads = identityReads.mock.calls.filter(([query]) => query?.where?.accountId !== undefined);
            expect(survivingIdentityReads).toHaveLength(1);
            expect(survivingIdentityReads[0]?.[0]?.where?.accountId).toEqual({ in: expect.arrayContaining(accounts.map(({ id }) => id)) });
            const linkedPresentationReads = providerReads.mock.calls.filter(([query]) => query?.where?.id !== undefined);
            expect(linkedPresentationReads).toHaveLength(1);
            expect(linkedPresentationReads[0]?.[0]?.where?.id).toEqual({ in: expect.arrayContaining(['retained-0', 'retained-1', 'retained-2']) });
            expect(emit).not.toHaveBeenCalled();
        });
        await expect(db.accountIdentity.count({ where: { provider: 'removed' } })).resolves.toBe(0);
        for (const [index, target] of accounts.entries()) {
            const events = emit.mock.calls.map(([event]) => event).filter((event) =>
                event.userId === target.id && event.payload.body.t === 'update-account');
            expect(events).toHaveLength(1);
            expect(events[0]?.payload).toMatchObject({ body: { linkedProviders: [{ id: `retained-${index}`, login: `member-${index}` }] } });
            await expect(db.accountChange.count({ where: { accountId: target.id } })).resolves.toBe(1);
        }
    });

    it('transfers the exact subject and visibility atomically and preserves the source on rollback', async () => {
        const source = await account('identity-source');
        const target = await account('identity-target');
        await inTx((await prepareIdentityLink({ ...intent(source.id), showOnProfile: true })).connectInTx);
        const prepared = await prepareIdentityLink({ ...intent(target.id), showOnProfile: undefined, transferFromAccountId: source.id });
        await expect(inTx(async (tx) => {
            await prepared.connectInTx(tx);
            throw new Error('reset-cancelled');
        })).rejects.toThrow('reset-cancelled');
        expect((await db.accountIdentity.findFirstOrThrow({ where: { provider: 'mtls' } })).accountId).toBe(source.id);
        const emit = vi.spyOn(eventRouter, 'emitUpdate').mockImplementation(() => {});
        await inTx(prepared.connectInTx);
        const row = await db.accountIdentity.findFirstOrThrow({ where: { provider: 'mtls' } });
        expect(row).toMatchObject({ accountId: target.id, provider: 'mtls', providerUserId: 'exact-Subject', showOnProfile: true });
        expect(emit.mock.calls.filter(([value]) => value.recipientFilter?.type === 'user-scoped-only')).toHaveLength(2);
    });

    it('revalidates a bound managed runtime in the identity mutation transaction', async () => {
        harness.resetEnv({ HAPPIER_PUBLIC_SERVER_URL: 'https://home.example.test' });
        const a = await account('identity-managed-bound-runtime');
        const provider = await db.identityProviderInstance.create({
            data: {
                kind: 'oidc',
                displayName: 'Company login',
                enabled: true,
                firstEnabledAt: new Date('2026-09-06T00:00:00.000Z'),
                config: {
                    v: 1,
                    kind: 'oidc',
                    issuer: 'https://id.example.test',
                    clientId: 'happier',
                    clientAuthenticationMethod: "client_secret_post",
                    scopes: 'openid profile email',
                    httpTimeoutSeconds: 30,
                    claims: { login: 'preferred_username', email: 'email', groups: 'groups' },
                    allow: { usersAllowlist: [], emailDomains: [], groupsAny: [], groupsAll: [] },
                    fetchUserInfo: true,
                    storeRefreshToken: false,
                    ui: { buttonColor: null, iconHint: 'oidc' },
                },
                encryptedSecrets: null,
            },
        });
        await db.identityProviderInstance.update({
            where: { id: provider.id },
            data: {
                encryptedSecrets: encryptString(
                    ['storage', 'identity_provider_instance', provider.id, 'oidc', 'secrets', 'v1'],
                    JSON.stringify({ v: 1, kind: 'oidc', clientSecret: 'secret' }),
                ),
            },
        });
        const runtime = await resolveOAuthRuntimeById(process.env, provider.id);
        expect(runtime).not.toBeNull();

        await expect(connectExternalIdentity({
            providerId: provider.id,
            reference: runtime!.reference,
            ctx: { uid: a.id } as never,
            profile: { sub: 'subject-1', preferred_username: 'alice' },
            accessToken: 'test-token',
        })).resolves.toBeUndefined();
        await expect(db.accountIdentity.findFirst({
            where: { accountId: a.id, provider: provider.id },
            select: { providerUserId: true },
        })).resolves.toEqual({ providerUserId: 'subject-1' });
    });
});
