import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '@/storage/db';
import { Context } from '@/context';
import { eventRouter } from '@/app/events/eventRouter';
import { createLightSqliteHarness, type LightSqliteHarness } from '@/testkit/lightSqliteHarness';
import { githubDisconnect } from './githubDisconnect';

describe('githubDisconnect (AccountChange integration)', () => {
    let harness: LightSqliteHarness;
    beforeAll(async () => {
        harness = await createLightSqliteHarness({ tempDirPrefix: 'github-disconnect-' });
    }, 120_000);
    afterAll(async () => { await harness.close(); });
    beforeEach(async () => {
        vi.restoreAllMocks();
        harness.resetEnv();
        await harness.resetDbTables([() => db.accountChange.deleteMany(), () => db.accountIdentity.deleteMany(), () => db.account.deleteMany()]);
    });
    it.each([{ username: 'octocat', expected: null }, { username: 'custom', expected: 'custom' }])(
        'disconnects and preserves only a custom username: $username', async ({ username, expected }) => {
            const account = await db.account.create({ data: { publicKey: `disconnect-${username}`, username } });
            await db.accountIdentity.create({ data: { accountId: account.id, provider: 'github', providerUserId: '123', providerLogin: 'octocat', profile: { login: 'octocat' } } });
            // Replace socket delivery only; real mutation, cursor allocation and afterTx remain exercised.
            const emit = vi.spyOn(eventRouter, 'emitUpdate').mockImplementation(() => {});
            await githubDisconnect(Context.create(account.id));
            expect(await db.accountIdentity.count({ where: { accountId: account.id } })).toBe(0);
            expect((await db.account.findUniqueOrThrow({ where: { id: account.id } })).username).toBe(expected);
            const change = await db.accountChange.findUniqueOrThrow({ where: { accountId_kind_entityId: { accountId: account.id, kind: 'account', entityId: 'self' } } });
            expect(change.hint).toEqual({ linkedProviders: true });
            const updates = emit.mock.calls.filter(([value]) => value.recipientFilter?.type === 'user-scoped-only');
            expect(updates).toHaveLength(1);
            expect(updates[0]?.[0].payload.seq).toBe(change.cursor);
        },
    );
});
