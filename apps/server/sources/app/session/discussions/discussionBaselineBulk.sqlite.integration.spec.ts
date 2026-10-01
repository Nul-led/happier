import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db } from '@/storage/db';
import { inTx, type Tx } from '@/storage/inTx';
import { createLightSqliteHarness, type LightSqliteHarness } from '@/testkit/lightSqliteHarness';
import { initializeSessionDiscussionCursorsOnTrackingEntryInTx } from '@/app/session/discussions/trackingEntry';
import { initializeNewSessionDiscussionCursorsInTx } from '@/app/session/discussions/readState';
import { applySessionAutoFollowForRelationshipChangeInTx } from '@/app/session/follow/accountFollowService';
import { initializeSessionOwnerReadStateInTx } from '@/app/session/personal/readState';

/**
 * Lane09 baseline-materialization N+1 discrimination.
 * Counts every ORM model call plus raw statements through the passed Tx, then
 * compares a small and a large fixture at the same provider-chunk regime: a
 * per-Discussion/per-Account awaited loop makes the counted statements grow
 * with the fixture, while a set-oriented owner stays invariant. No magic
 * statement ceiling: legitimate set-oriented shape changes do not false-red.
 */
function createCountingReader(reader: Tx, counts: Map<string, number>): Tx {
    return new Proxy(reader, {
        get(target, property, receiver) {
            const delegate = Reflect.get(target, property, receiver);
            if (typeof property !== 'string') return delegate;
            if (typeof delegate === 'function' && property.startsWith('$')) {
                return (...args: readonly unknown[]) => {
                    const key = `$${property}`;
                    counts.set(key, (counts.get(key) ?? 0) + 1);
                    return Reflect.apply(delegate, target, args);
                };
            }
            if (typeof delegate !== 'object' || delegate === null) return delegate;
            if (property.startsWith('$')) return delegate;
            return new Proxy(delegate, {
                get(model, method, modelReceiver) {
                    const member = Reflect.get(model, method, modelReceiver);
                    if (typeof method !== 'string' || typeof member !== 'function') return member;
                    return (...args: readonly unknown[]) => {
                        const key = `${property}.${method}`;
                        counts.set(key, (counts.get(key) ?? 0) + 1);
                        return Reflect.apply(member, model, args);
                    };
                },
            });
        },
    }) as Tx;
}

function totalStatements(counts: Map<string, number>): number {
    let total = 0;
    for (const value of counts.values()) total += value;
    return total;
}

async function withCountedStatements<T>(run: (reader: Tx) => Promise<T>): Promise<Readonly<{
    result: T;
    statements: number;
}>> {
    const counts = new Map<string, number>();
    const result = await inTx(async tx => run(createCountingReader(tx, counts)));
    return { result, statements: totalStatements(counts) };
}

describe('Lane09 discussion baseline bulk (SQLite)', () => {
    let harness: LightSqliteHarness;
    beforeAll(async () => {
        harness = await createLightSqliteHarness({
            tempDirPrefix: 'happier-discussion-baseline-bulk-',
            env: {
                HAPPIER_FEATURE_SESSIONS_FOLLOWING__ENABLED: 'true',
                HAPPIER_FEATURE_SHARING_SESSION__ENABLED: 'true',
            },
        });
    }, 300_000);
    afterAll(async () => { await harness?.close(); });

    async function discussionFixture(params: Readonly<{ discussions: number; followers: number }>) {
        const owner = await db.account.create({ data: { publicKey: randomUUID(), encryptionMode: 'plain' } });
        const session = await db.session.create({
            data: { accountId: owner.id, tag: randomUUID(), metadata: '{}', encryptionMode: 'plain', seq: 10 },
        });
        await db.sessionDiscussion.createMany({
            data: Array.from({ length: params.discussions }, (_, index) => ({
                sessionId: session.id,
                creationLocalId: randomUUID(),
                creationEqualityEvidenceV1: { kind: 'plainDigest', digest: randomUUID() },
                createdByAccountId: owner.id,
                titleContent: { t: 'plain', v: { v: 1, title: `Bulk ${index}` } },
                messageSeq: 1 + (index % 5),
                lastMessageAt: new Date(),
            })),
        });
        const followers: Array<{ id: string }> = [];
        for (let index = 0; index < params.followers; index += 1) {
            const follower = await db.account.create({ data: { publicKey: randomUUID(), encryptionMode: 'plain' } });
            followers.push({ id: follower.id });
            await db.sessionShare.create({
                data: { sessionId: session.id, sharedByUserId: owner.id, sharedWithUserId: follower.id, accessLevel: 'view' },
            });
            await db.accountSessionFollow.create({
                data: { accountId: follower.id, sessionId: session.id, following: true, notificationLevel: 'important' },
            });
            await db.accountSessionReadState.create({
                data: { accountId: follower.id, sessionId: session.id, lastViewedSessionSeq: 10 },
            });
        }
        await inTx(tx => initializeSessionOwnerReadStateInTx(tx, { accountId: owner.id, sessionId: session.id }));
        return { owner, session, followers };
    }

    it('materializes tracking entry without per-Discussion statement growth', async () => {
        const materialize = async (discussions: number) => {
            const { owner, session } = await discussionFixture({ discussions, followers: 0 });
            const newcomer = await db.account.create({ data: { publicKey: randomUUID(), encryptionMode: 'plain' } });
            await db.sessionShare.create({
                data: { sessionId: session.id, sharedByUserId: owner.id, sharedWithUserId: newcomer.id, accessLevel: 'view' },
            });
            const { result, statements } = await withCountedStatements(reader =>
                initializeSessionDiscussionCursorsOnTrackingEntryInTx(reader, {
                    sessionId: session.id,
                    accountId: newcomer.id,
                }),
            );
            const baselines = await db.sessionDiscussionReadState.count({ where: { accountId: newcomer.id } });
            return { inserted: result, baselines, discussions, statements };
        };

        // Both fixtures share one provider-chunk regime, so the set-oriented
        // bulk must produce the exact same statement count at both scales.
        const small = await materialize(2);
        const large = await materialize(30);
        expect(small.inserted).toBe(small.discussions);
        expect(small.baselines).toBe(small.discussions);
        expect(large.inserted).toBe(large.discussions);
        expect(large.baselines).toBe(large.discussions);
        expect(large.statements).toBe(small.statements);
    });

    it('materializes a new Discussion without per-Account statement growth', async () => {
        const materializeNewDiscussion = async (followers: number) => {
            const fixture = await discussionFixture({ discussions: 1, followers });
            const discussion = await db.sessionDiscussion.create({
                data: {
                    sessionId: fixture.session.id,
                    creationLocalId: randomUUID(),
                    creationEqualityEvidenceV1: { kind: 'plainDigest', digest: randomUUID() },
                    createdByAccountId: fixture.session.accountId,
                    titleContent: { t: 'plain', v: { v: 1, title: 'New bulk' } },
                    messageSeq: 1,
                    lastMessageAt: new Date(),
                },
            });
            const { statements } = await withCountedStatements(reader =>
                initializeNewSessionDiscussionCursorsInTx(reader, {
                    sessionId: fixture.session.id,
                    discussionId: discussion.id,
                }),
            );
            return { ...fixture, discussion, statements };
        };

        // Owner tracks implicitly plus every follower: baselines at sequence zero.
        const small = await materializeNewDiscussion(2);
        expect(await db.sessionDiscussionReadState.count({ where: { discussionId: small.discussion.id } }))
            .toBe(small.followers.length + 1);

        const large = await materializeNewDiscussion(30);
        expect(await db.sessionDiscussionReadState.count({ where: { discussionId: large.discussion.id } }))
            .toBe(large.followers.length + 1);
        for (const follower of [...large.followers, { id: large.session.accountId }]) {
            expect(await db.sessionDiscussionReadState.findUnique({
                where: { discussionId_accountId: { discussionId: large.discussion.id, accountId: follower.id } },
            })).toMatchObject({ lastReadSeq: 0 });
        }
        // Both fixtures share one provider-chunk regime, so the set-oriented
        // bulk must produce the exact same statement count at both scales.
        expect(large.statements).toBe(small.statements);
    });

    it('initializes automatic Follow baselines as a set', async () => {
        const autoFollow = async (accounts: number, discussions: number) => {
            const owner = await db.account.create({ data: { publicKey: randomUUID(), encryptionMode: 'plain' } });
            const session = await db.session.create({
                data: { accountId: owner.id, tag: randomUUID(), metadata: '{}', encryptionMode: 'plain', seq: 10 },
            });
            await db.sessionDiscussion.createMany({
                data: Array.from({ length: discussions }, () => ({
                    sessionId: session.id,
                    creationLocalId: randomUUID(),
                    creationEqualityEvidenceV1: { kind: 'plainDigest', digest: randomUUID() },
                    createdByAccountId: owner.id,
                    titleContent: { t: 'plain', v: { v: 1, title: 'Auto' } },
                    messageSeq: 4,
                    lastMessageAt: new Date(),
                })),
            });
            const accountIds: string[] = [];
            for (let index = 0; index < accounts; index += 1) {
                const account = await db.account.create({ data: { publicKey: randomUUID(), encryptionMode: 'plain' } });
                accountIds.push(account.id);
                await db.sessionShare.create({
                    data: { sessionId: session.id, sharedByUserId: owner.id, sharedWithUserId: account.id, accessLevel: 'view' },
                });
            }
            const { result, statements } = await withCountedStatements(reader =>
                applySessionAutoFollowForRelationshipChangeInTx(reader, {
                    sessionId: session.id,
                    accountIds,
                    relationship: 'assigned',
                }),
            );
            return { inserted: result, statements, sessionId: session.id, accountIds, accounts, discussions };
        };

        // Assigned auto-follow defaults on: one call seeds every eligible follower.
        // Both fixtures stay inside the owners' explicit chunk regime (200-item
        // data chunks, 100-account access batches), so the set-oriented baseline
        // must produce the exact same statement count at both scales; a
        // per-Account or per-Discussion loop grows with the fixture instead.
        const small = await autoFollow(2, 2);
        const large = await autoFollow(20, 10);

        expect(small.inserted).toBe(small.accounts);
        expect(await db.sessionDiscussionReadState.count({ where: { accountId: { in: small.accountIds } } }))
            .toBe(small.accounts * small.discussions);

        expect(large.inserted).toBe(large.accounts);
        expect(await db.accountSessionFollow.count({ where: { sessionId: large.sessionId } })).toBe(large.accounts);
        expect(await db.accountSessionReadState.count({ where: { sessionId: large.sessionId } })).toBe(large.accounts);
        expect(await db.sessionDiscussionReadState.count({ where: { accountId: { in: large.accountIds } } })).toBe(large.accounts * large.discussions);
        expect(large.statements).toBe(small.statements);
    });

    it('does not baseline Discussion state through an unqualified restricted Team', async () => {
        const owner = await db.account.create({ data: { publicKey: randomUUID(), encryptionMode: 'plain' } });
        const viewer = await db.account.create({ data: { publicKey: randomUUID(), encryptionMode: 'plain' } });
        const session = await db.session.create({
            data: { accountId: owner.id, tag: randomUUID(), metadata: '{}', encryptionMode: 'plain', seq: 10 },
        });
        const discussion = await db.sessionDiscussion.create({
            data: {
                sessionId: session.id,
                creationLocalId: randomUUID(),
                creationEqualityEvidenceV1: { kind: 'plainDigest', digest: randomUUID() },
                createdByAccountId: owner.id,
                titleContent: { t: 'plain', v: { v: 1, title: 'Restricted' } },
                messageSeq: 3,
                lastMessageAt: new Date(),
            },
        });
        const team = await db.team.create({ data: {
            name: `restricted-discussion-${randomUUID()}`,
            authenticationPolicy: { v: 1, mode: 'restricted', accepted: [{ kind: 'home_method', methodId: 'github' }] },
        } });
        await db.teamMembership.create({ data: { teamId: team.id, accountId: viewer.id, role: 'member' } });
        await db.sessionTeamGrant.create({ data: {
            sessionId: session.id, teamId: team.id, accessLevel: 'view', effectiveAt: new Date(0),
        } });

        await expect(inTx(tx => initializeSessionDiscussionCursorsOnTrackingEntryInTx(tx, {
            sessionId: session.id, accountId: viewer.id,
        }))).resolves.toBe(0);
        expect(await db.sessionDiscussionReadState.findUnique({ where: {
            discussionId_accountId: { discussionId: discussion.id, accountId: viewer.id },
        } })).toBeNull();

        await db.sessionShare.create({ data: {
            sessionId: session.id, sharedByUserId: owner.id, sharedWithUserId: viewer.id, accessLevel: 'view',
        } });
        await expect(inTx(tx => initializeSessionDiscussionCursorsOnTrackingEntryInTx(tx, {
            sessionId: session.id, accountId: viewer.id,
        }))).resolves.toBe(1);
        expect(await db.sessionDiscussionReadState.findUnique({ where: {
            discussionId_accountId: { discussionId: discussion.id, accountId: viewer.id },
        } })).toMatchObject({ lastReadSeq: 3 });
    });
});
