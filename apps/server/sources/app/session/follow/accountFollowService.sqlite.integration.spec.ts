import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { db } from '@/storage/db';
import { inTx } from '@/storage/inTx';
import { createLightSqliteHarness, type LightSqliteHarness } from '@/testkit/lightSqliteHarness';
import { resolveSessionFollowFactsInTx } from '@/app/session/personal/followFacts';
import { createSessionListScopeWhere } from '@/app/session/personal/queries';
import { loadSessionDiscussionAttentionForAccounts } from '@/app/session/discussions/attentionFacts';
import { postSessionDiscussionMessage } from '@/app/session/discussions/mutations';
import {
    applySessionAutoFollowForRelationshipChangeInTx,
    setSessionAutoFollowPreferences,
    getAccountSessionFollow as getAccountSessionFollowWithAuthentication,
    removeAccountSessionFollow as removeAccountSessionFollowWithAuthentication,
    setAccountSessionFollow as setAccountSessionFollowWithAuthentication,
    replaceAccountSessionVoiceInclusions as replaceAccountSessionVoiceInclusionsWithAuthentication,
    observePendingAccountVoiceFollowInTx,
    acknowledgeAccountVoiceFollowInTx,
    removeAccountSessionFollowsOnAccessLossInTx,
} from './accountFollowService';
import { VOICE_TRANSCRIPT_HISTORY_SYSTEM_SESSION_TAG } from '@happier-dev/protocol';

// The push provider is the external boundary; Follow, transactions, badge
// candidacy, counting and coalescing execute through their real owners.
const sendPushNotificationsAsync = vi.hoisted(() => vi.fn(async (messages: unknown[]) => messages.map(() => ({ status: 'ok' }))));
vi.mock('expo-server-sdk', () => {
    class Expo {
        static isExpoPushToken() { return true; }
        chunkPushNotifications(messages: unknown[]) { return [messages]; }
        async sendPushNotificationsAsync(messages: unknown[]) { return sendPushNotificationsAsync(messages); }
        async getPushNotificationReceiptsAsync() { return {}; }
    }
    return { Expo };
});

const defaultAuthentication = {
    env: process.env,
    authority: 'present_user' as const,
    authenticationEvidence: undefined,
};

type GetAccountSessionFollowParams = Parameters<typeof getAccountSessionFollowWithAuthentication>[0];
function getAccountSessionFollow(params: Omit<GetAccountSessionFollowParams, 'authentication'>) {
    return getAccountSessionFollowWithAuthentication({ ...params, authentication: defaultAuthentication });
}

type RemoveAccountSessionFollowParams = Parameters<typeof removeAccountSessionFollowWithAuthentication>[0];
function removeAccountSessionFollow(params: Omit<RemoveAccountSessionFollowParams, 'authentication'>) {
    return removeAccountSessionFollowWithAuthentication({ ...params, authentication: defaultAuthentication });
}

type SetAccountSessionFollowParams = Parameters<typeof setAccountSessionFollowWithAuthentication>[0];
function setAccountSessionFollow(params: Omit<SetAccountSessionFollowParams, 'authentication'>) {
    return setAccountSessionFollowWithAuthentication({ ...params, authentication: defaultAuthentication });
}
function replaceAccountSessionVoiceInclusions(params: Omit<Parameters<typeof replaceAccountSessionVoiceInclusionsWithAuthentication>[0], 'authentication'>) {
    return replaceAccountSessionVoiceInclusionsWithAuthentication({ ...params, authentication: defaultAuthentication });
}

async function fixture() {
    const owner = await db.account.create({ data: { publicKey: randomUUID(), encryptionMode: 'plain' } });
    const viewer = await db.account.create({ data: { publicKey: randomUUID(), encryptionMode: 'plain' } });
    const session = await db.session.create({ data: { accountId: owner.id, tag: randomUUID(), metadata: '{}', encryptionMode: 'plain', seq: 10 } });
    await db.sessionShare.create({ data: { sessionId: session.id, sharedByUserId: owner.id, sharedWithUserId: viewer.id, accessLevel: 'view' } });
    return { owner, viewer, session, key: { accountId: viewer.id, sessionId: session.id } };
}

async function createDiscussion(params: Readonly<{
    sessionId: string;
    creatorAccountId: string;
    messageSeq: number;
    archivedAt?: Date;
}>) {
    return await db.sessionDiscussion.create({
        data: {
            sessionId: params.sessionId,
            creationLocalId: randomUUID(),
            creationEqualityEvidenceV1: { kind: 'plainDigest', digest: randomUUID() },
            createdByAccountId: params.creatorAccountId,
            titleContent: { t: 'plain', v: { v: 1, title: 'Tracking baseline' } },
            messageSeq: params.messageSeq,
            lastMessageAt: new Date(),
            archivedAt: params.archivedAt,
        },
    });
}
describe('Account Follow service', () => {
    let harness: LightSqliteHarness;
    beforeAll(async () => { harness = await createLightSqliteHarness({ tempDirPrefix: 'happier-follow-service-',
        env: { HAPPIER_FEATURE_SESSIONS_FOLLOWING__ENABLED: 'true' } }); }, 180_000);
    afterEach(async () => {
        await db.accountPushToken.deleteMany();
        await db.accountSessionReadState.deleteMany();
        await db.accountSessionFollow.deleteMany();
        await db.sessionShare.deleteMany();
        await db.sessionMessage.deleteMany();
        await db.session.deleteMany();
        await db.account.deleteMany();
    });
    afterAll(async () => { await harness?.close(); });

    it('atomically replaces durable Voice inclusions while preserving Follow preferences', async () => {
        const { owner, viewer, session, key } = await fixture();
        const second = await db.session.create({ data: {
            accountId: owner.id, tag: randomUUID(), metadata: '{}', encryptionMode: 'plain', seq: 11,
        } });
        await db.sessionShare.create({ data: {
            sessionId: second.id, sharedByUserId: owner.id, sharedWithUserId: viewer.id, accessLevel: 'view',
        } });
        await setAccountSessionFollow({ ...key, preferences: { notificationLevel: 'important', includeInVoice: true } });
        await setAccountSessionFollow({
            accountId: viewer.id,
            sessionId: second.id,
            preferences: { notificationLevel: 'all_messages', includeInVoice: false },
        });

        await expect(replaceAccountSessionVoiceInclusions({ accountId: viewer.id, sessionIds: [second.id] }))
            .resolves.toEqual({ ok: true, value: { changed: true, sessionIds: [second.id] } });
        expect(await db.accountSessionFollow.findUnique({ where: { accountId_sessionId: key } }))
            .toMatchObject({ following: true, notificationLevel: 'important', includeInVoice: false });
        expect(await db.accountSessionFollow.findUnique({ where: {
            accountId_sessionId: { accountId: viewer.id, sessionId: second.id },
        } })).toMatchObject({ following: true, notificationLevel: 'all_messages', includeInVoice: true });

        await expect(replaceAccountSessionVoiceInclusions({ accountId: viewer.id, sessionIds: [] }))
            .resolves.toMatchObject({ ok: true, value: { changed: true, sessionIds: [] } });
        expect(await db.accountSessionFollow.findMany({ where: { accountId: viewer.id, includeInVoice: true } })).toEqual([]);
    });

    it('validates the complete replacement before mutating durable Voice inclusions', async () => {
        const { viewer, key } = await fixture();
        await setAccountSessionFollow({ ...key, preferences: { notificationLevel: 'important', includeInVoice: true } });
        await expect(replaceAccountSessionVoiceInclusions({ accountId: viewer.id, sessionIds: [key.sessionId, 'missing'] }))
            .resolves.toEqual({ ok: false, error: 'session_not_found' });
        expect(await db.accountSessionFollow.findUnique({ where: { accountId_sessionId: key } }))
            .toMatchObject({ following: true, notificationLevel: 'important', includeInVoice: true });
    });

    it('refreshes the affected Account badge after committed Follow choices and stays quiet on no-op', async () => {
        const { owner, key } = await fixture();
        const token = `ExponentPushToken[${key.accountId}]`;
        await db.accountPushToken.createMany({ data: [
            { accountId: key.accountId, token },
            { accountId: owner.id, token: `ExponentPushToken[${owner.id}]` },
        ] });
        const preferences = { notificationLevel: 'important' as const, includeInVoice: false };
        const expectBadge = async (badge: number) => {
            await vi.waitFor(() => expect(sendPushNotificationsAsync.mock.calls.flatMap(([messages]) => messages))
                .toEqual([{ to: token, badge, data: { type: 'badge_refresh' } }]));
            sendPushNotificationsAsync.mockClear();
        };
        sendPushNotificationsAsync.mockClear();
        await setAccountSessionFollow({ ...key, preferences });
        await expectBadge(0);
        await db.accountSessionReadState.update({ where: { accountId_sessionId: key }, data: { lastViewedSessionSeq: 5 } });
        await setAccountSessionFollow({ ...key, preferences: { ...preferences, notificationLevel: 'all_messages' } });
        await expectBadge(1);
        await removeAccountSessionFollow(key);
        await expectBadge(0);
        expect(await removeAccountSessionFollow(key)).toEqual({ ok: true, value: { changed: false } });
        await new Promise(resolve => setTimeout(resolve, 100));
        expect(sendPushNotificationsAsync.mock.calls.flatMap(([messages]) => messages)).toEqual([]);
    });

    it('refreshes badges for committed automatic Follow and access loss, but never rollback', async () => {
        const { key } = await fixture();
        const token = `ExponentPushToken[${key.accountId}]`;
        await db.accountPushToken.create({ data: { accountId: key.accountId, token } });
        await db.session.update({ where: { id: key.sessionId }, data: { responsibleAccountId: key.accountId, pendingUserActionRequestCount: 1 } });
        const automaticallyFollow = async (tx: Parameters<typeof applySessionAutoFollowForRelationshipChangeInTx>[0]) =>
            applySessionAutoFollowForRelationshipChangeInTx(tx, {
                sessionId: key.sessionId, accountIds: [key.accountId], relationship: 'assigned',
            });
        sendPushNotificationsAsync.mockClear();
        await expect(inTx(async tx => {
            await automaticallyFollow(tx);
            throw new Error('abort Follow transaction');
        })).rejects.toThrow('abort Follow transaction');
        await new Promise(resolve => setTimeout(resolve, 100));
        expect(sendPushNotificationsAsync.mock.calls.flatMap(([messages]) => messages)).toEqual([]);
        expect(await db.accountSessionFollow.findUnique({ where: { accountId_sessionId: key } })).toBeNull();

        await inTx(automaticallyFollow);
        await vi.waitFor(() => expect(sendPushNotificationsAsync.mock.calls.flatMap(([messages]) => messages))
            .toEqual([{ to: token, badge: 1, data: { type: 'badge_refresh' } }]));
        sendPushNotificationsAsync.mockClear();
        await inTx(async tx => {
            await tx.sessionShare.deleteMany({ where: { sessionId: key.sessionId } });
            await removeAccountSessionFollowsOnAccessLossInTx(tx, { sessionId: key.sessionId, accountIds: [key.accountId] });
        });
        await vi.waitFor(() => expect(sendPushNotificationsAsync.mock.calls.flatMap(([messages]) => messages))
            .toEqual([{ to: token, badge: 0, data: { type: 'badge_refresh' } }]));
    });

    it('removes final-access Follows for many Accounts with one set invalidation', async () => {
        const owner = await db.account.create({ data: { publicKey: randomUUID(), encryptionMode: 'plain' } });
        const viewers = await Promise.all([0, 1, 2].map(() => db.account.create({ data: { publicKey: randomUUID(), encryptionMode: 'plain' } })));
        const viewerIds = viewers.map(viewer => viewer.id);
        const session = await db.session.create({ data: { accountId: owner.id, tag: randomUUID(), metadata: '{}', encryptionMode: 'plain', seq: 10 } });
        for (const viewer of viewers) {
            await db.sessionShare.create({ data: { sessionId: session.id, sharedByUserId: owner.id, sharedWithUserId: viewer.id, accessLevel: 'view' } });
        }
        for (const viewerId of viewerIds) {
            await setAccountSessionFollow({ accountId: viewerId, sessionId: session.id, preferences: { notificationLevel: 'important', includeInVoice: false } });
        }
        const tokens = new Map(viewerIds.map(viewerId => [viewerId, `ExponentPushToken[${viewerId}]`] as const));
        await db.accountPushToken.createMany({ data: [...tokens].map(([accountId, token]) => ({ accountId, token })) });
        const bystander = await db.account.create({ data: { publicKey: randomUUID(), encryptionMode: 'plain' } });
        const bystanderToken = `ExponentPushToken[${bystander.id}]`;
        await db.accountPushToken.create({ data: { accountId: bystander.id, token: bystanderToken } });
        // Let Follow-creation badge refreshes flush so the access-loss phase is observed alone.
        await new Promise(resolve => setTimeout(resolve, 100));
        sendPushNotificationsAsync.mockClear();
        // Revoke every direct share so the next call observes final access loss.
        await db.sessionShare.deleteMany({ where: { sessionId: session.id } });

        const counts = { accountUpdate: 0, accountUpdateMany: 0, accountFindMany: 0, accountChangeUpsert: 0, accountChangeUpdateMany: 0, accountChangeCreateMany: 0, accountChangeDeleteMany: 0 };
        const removed = await inTx(async tx => {
            const account = tx.account as unknown as Record<string, unknown>;
            const accountChange = tx.accountChange as unknown as Record<string, unknown>;
            const wrap = (target: Record<string, unknown>, method: string, counter: keyof typeof counts) => {
                const original = ((target[method] as (...args: any[]) => Promise<unknown>).bind(target));
                (target[method] as unknown) = async (...args: any[]) => {
                    counts[counter] += 1;
                    return original(...args);
                };
            };
            wrap(account, 'update', 'accountUpdate');
            wrap(account, 'updateMany', 'accountUpdateMany');
            wrap(account, 'findMany', 'accountFindMany');
            wrap(accountChange, 'upsert', 'accountChangeUpsert');
            wrap(accountChange, 'updateMany', 'accountChangeUpdateMany');
            wrap(accountChange, 'createMany', 'accountChangeCreateMany');
            wrap(accountChange, 'deleteMany', 'accountChangeDeleteMany');
            return await removeAccountSessionFollowsOnAccessLossInTx(tx, { sessionId: session.id, accountIds: viewerIds });
        });
        expect(removed).toBe(viewerIds.length);
        // All active Follows disappear.
        expect(await db.accountSessionFollow.findMany({ where: { sessionId: session.id } })).toEqual([]);
        // Each affected Account receives the current coarse Follow hint.
        for (const viewerId of viewerIds) {
            await expect(db.accountChange.findFirst({ where: { accountId: viewerId, kind: 'account', entityId: 'session-follows' }, select: { hint: true } }))
                .resolves.toMatchObject({ hint: { sessionFollows: true, full: true } });
        }
        // One set invalidation, not one statement per Account.
        expect(counts.accountUpdate).toBe(0);
        expect(counts.accountChangeUpsert).toBe(0);
        expect(counts.accountUpdateMany).toBe(1);
        expect(counts.accountFindMany).toBe(1);
        expect(counts.accountChangeDeleteMany).toBe(1);
        expect(counts.accountChangeCreateMany).toBe(1);
        expect(counts.accountChangeUpdateMany).toBe(1);
        // Badge refresh scheduling covers the exact full Account set through the real transport.
        await vi.waitFor(() => {
            const delivered = sendPushNotificationsAsync.mock.calls.flatMap(([messages]) => messages as Array<{ to: string }>);
            expect(new Set(delivered.map(message => message.to))).toEqual(new Set(tokens.values()));
        });
        const deliveredTokens = new Set(sendPushNotificationsAsync.mock.calls.flatMap(([messages]) => (messages as Array<{ to: string }>).map(message => message.to)));
        expect(deliveredTokens.has(bystanderToken)).toBe(false);
        // Repeating after final loss is a no-op.
        expect(await inTx(tx => removeAccountSessionFollowsOnAccessLossInTx(tx, { sessionId: session.id, accountIds: viewerIds }))).toBe(0);
    });

    it('projects create, update, Unfollow, and refollow into the Following list predicate', async () => {
        const { key, session } = await fixture();
        const followingIds = async () => (await db.session.findMany({
            where: createSessionListScopeWhere({ accountId: key.accountId, scope: 'following' }),
            select: { id: true },
        })).map((row) => row.id);

        expect(await followingIds()).toEqual([]);
        await setAccountSessionFollow({
            ...key,
            preferences: { notificationLevel: 'important', includeInVoice: false },
        });
        expect(await followingIds()).toEqual([session.id]);
        await setAccountSessionFollow({
            ...key,
            preferences: { notificationLevel: 'all_messages', includeInVoice: true },
        });
        expect(await followingIds()).toEqual([session.id]);
        await removeAccountSessionFollow(key);
        expect(await followingIds()).toEqual([]);
        await setAccountSessionFollow({
            ...key,
            preferences: { notificationLevel: 'important', includeInVoice: false },
        });
        expect(await followingIds()).toEqual([session.id]);
    });

    it('seeds re-entry at current but preserves owner and already tracked unread state', async () => {
        const { owner, key, session } = await fixture();
        await db.accountSessionReadState.create({ data: { ...key, lastViewedSessionSeq: 2, unreadSince: new Date(1000) } });
        const preferences = { notificationLevel: 'important' as const, includeInVoice: false };
        expect(await setAccountSessionFollow({ ...key, preferences })).toMatchObject({ ok: true });
        expect(await db.accountSessionReadState.findUnique({ where: { accountId_sessionId: key } })).toMatchObject({ lastViewedSessionSeq: 10, unreadSince: null });
        await db.accountSessionReadState.update({ where: { accountId_sessionId: key }, data: { lastViewedSessionSeq: 5, unreadSince: new Date(2000) } });
        await setAccountSessionFollow({ ...key, preferences: { ...preferences, notificationLevel: 'all_messages' } });
        expect(await db.accountSessionReadState.findUnique({ where: { accountId_sessionId: key } })).toMatchObject({ lastViewedSessionSeq: 5, unreadSince: new Date(2000) });
        await removeAccountSessionFollow(key);
        await db.session.update({ where: { id: session.id }, data: { seq: 20 } });
        await setAccountSessionFollow({ ...key, preferences });
        expect(await db.accountSessionReadState.findUnique({ where: { accountId_sessionId: key } })).toMatchObject({ lastViewedSessionSeq: 20, unreadSince: null });
        const ownerKey = { accountId: owner.id, sessionId: session.id };
        await db.accountSessionReadState.create({ data: { ...ownerKey, lastViewedSessionSeq: 3, unreadSince: new Date(3000) } });
        await setAccountSessionFollow({ ...ownerKey, preferences });
        expect(await db.accountSessionReadState.findUnique({ where: { accountId_sessionId: ownerKey } })).toMatchObject({ lastViewedSessionSeq: 3, unreadSince: new Date(3000) });
    });

    it('atomically baselines every current discussion only on a genuine Follow entry', async () => {
        const { owner, viewer, key, session } = await fixture();
        const first = await createDiscussion({ sessionId: session.id, creatorAccountId: owner.id, messageSeq: 3 });
        const second = await createDiscussion({ sessionId: session.id, creatorAccountId: owner.id, messageSeq: 7 });
        const archived = await createDiscussion({
            sessionId: session.id,
            creatorAccountId: owner.id,
            messageSeq: 11,
            archivedAt: new Date(),
        });
        const preferences = { notificationLevel: 'important' as const, includeInVoice: false };

        // Merely having read access (including browsing) must not materialize tracking state.
        expect(await db.sessionDiscussionReadState.count({ where: { accountId: viewer.id } })).toBe(0);

        await setAccountSessionFollow({ ...key, preferences });
        expect(await db.sessionDiscussionReadState.findMany({
            where: { accountId: viewer.id },
            orderBy: { discussionId: 'asc' },
            select: { discussionId: true, lastReadSeq: true },
        })).toEqual([
            { discussionId: first.id, lastReadSeq: 3 },
            { discussionId: second.id, lastReadSeq: 7 },
            { discussionId: archived.id, lastReadSeq: 11 },
        ].sort((a, b) => a.discussionId.localeCompare(b.discussionId)));

        // A preference refresh while already tracked cannot erase unread work.
        await db.sessionDiscussion.update({ where: { id: first.id }, data: { messageSeq: 5 } });
        await setAccountSessionFollow({
            ...key,
            preferences: { ...preferences, notificationLevel: 'all_messages' },
        });
        expect(await db.sessionDiscussionReadState.findUnique({
            where: { discussionId_accountId: { discussionId: first.id, accountId: viewer.id } },
        })).toMatchObject({ lastReadSeq: 3 });

        // A real exit followed by a later entry gets a fresh quiet baseline.
        await removeAccountSessionFollow(key);
        await db.sessionDiscussion.update({ where: { id: first.id }, data: { messageSeq: 9 } });
        await setAccountSessionFollow({ ...key, preferences });
        expect(await db.sessionDiscussionReadState.findUnique({
            where: { discussionId_accountId: { discussionId: first.id, accountId: viewer.id } },
        })).toMatchObject({ lastReadSeq: 9 });
    });

    it('keeps repeated and concurrent Follow entry idempotent without duplicate discussion cursors', async () => {
        const { owner, viewer, key, session } = await fixture();
        const discussion = await createDiscussion({ sessionId: session.id, creatorAccountId: owner.id, messageSeq: 4 });
        const preferences = { notificationLevel: 'important' as const, includeInVoice: false };

        await Promise.all([
            setAccountSessionFollow({ ...key, preferences }),
            setAccountSessionFollow({ ...key, preferences }),
        ]);

        expect(await db.sessionDiscussionReadState.findMany({ where: {
            discussionId: discussion.id,
            accountId: viewer.id,
        } })).toEqual([expect.objectContaining({ lastReadSeq: 4 })]);
    });

    it('serializes Follow entry with concurrent Discussion activity without losing the baseline', async () => {
        const { owner, viewer, key, session } = await fixture();
        const discussion = await createDiscussion({ sessionId: session.id, creatorAccountId: owner.id, messageSeq: 4 });
        const preferences = { notificationLevel: 'important' as const, includeInVoice: false };

        const [, concurrentPost] = await Promise.all([
            setAccountSessionFollow({ ...key, preferences }),
            postSessionDiscussionMessage({
                authentication: defaultAuthentication,
                actorAccountId: owner.id,
                sessionId: session.id,
                discussionId: discussion.id,
                request: {
                    localId: randomUUID(),
                    content: { t: 'plain', v: { v: 1, parts: [{ t: 'text', text: 'concurrent' }] } },
                    mentionedAccountIds: [],
                },
            }),
        ]);
        expect(concurrentPost.ok).toBe(true);

        const baseline = await db.sessionDiscussionReadState.findUniqueOrThrow({
            where: { discussionId_accountId: { discussionId: discussion.id, accountId: viewer.id } },
        });
        // Either serial order is valid: entry sees the old or new ceiling, but
        // it must never omit the Discussion or invent a future cursor.
        expect([4, 5]).toContain(baseline.lastReadSeq);

        const laterPost = await postSessionDiscussionMessage({
            authentication: defaultAuthentication,
            actorAccountId: owner.id,
            sessionId: session.id,
            discussionId: discussion.id,
            request: {
                localId: randomUUID(),
                content: { t: 'plain', v: { v: 1, parts: [{ t: 'text', text: 'later' }] } },
                mentionedAccountIds: [],
            },
        });
        expect(laterPost.ok).toBe(true);
        const attention = await loadSessionDiscussionAttentionForAccounts({
            accountIds: [viewer.id],
            sessionIds: [session.id],
        });
        expect(attention.get(viewer.id)?.get(session.id)?.unreadConversationCount).toBe(1);
    });

    it('preserves acknowledged Voice on true→true and resets only disable/re-enable', async () => {
        const { key } = await fixture();
        const preferences = { notificationLevel: 'none' as const, includeInVoice: true };
        await setAccountSessionFollow({ ...key, preferences });
        const frontier = JSON.stringify({ v: 1, transcriptSeq: 10, readyEventSeq: 0, agentStateVersion: 0, turn: null });
        await db.accountSessionFollow.update({ where: { accountId_sessionId: key }, data: { voiceDeliveredFrontier: frontier } });
        await setAccountSessionFollow({ ...key, preferences: { ...preferences, notificationLevel: 'important' } });
        expect(await db.accountSessionFollow.findUnique({ where: { accountId_sessionId: key } })).toMatchObject({ voiceDeliveredFrontier: frontier });
        await setAccountSessionFollow({ ...key, preferences: { ...preferences, includeInVoice: false } });
        await setAccountSessionFollow({ ...key, preferences });
        expect(await db.accountSessionFollow.findUnique({ where: { accountId_sessionId: key } })).toMatchObject({ voiceDeliveredFrontier: null });
    });

    it('delivers one pending-current Voice snapshot and advances only its exact accepted frontier', async () => {
        const { viewer, session, key } = await fixture();
        const ordinarySession = await db.session.create({ data: {
            accountId: viewer.id,
            tag: randomUUID(),
            metadata: '{}',
            encryptionMode: 'plain',
        } });
        const voiceSession = await db.session.create({ data: {
            accountId: viewer.id,
            tag: VOICE_TRANSCRIPT_HISTORY_SYSTEM_SESSION_TAG,
            metadata: '{}',
            encryptionMode: 'plain',
        } });
        await setAccountSessionFollow({
            ...key,
            preferences: { notificationLevel: 'none', includeInVoice: true },
        });
        const runtimeAuthority = {
            executionRunId: 'voice-run-current',
            occurrenceId: 'voice-occurrence-current',
            parentSessionId: voiceSession.id,
            intent: 'voice_agent' as const,
            runtimeState: 'active_turn' as const,
        };
        expect(await inTx((tx) => observePendingAccountVoiceFollowInTx(tx, {
            accountId: viewer.id,
            voiceSessionId: ordinarySession.id,
            authentication: defaultAuthentication,
            runtimeAuthority: { ...runtimeAuthority, parentSessionId: ordinarySession.id },
        }))).toBeNull();
        const observe = () => inTx((tx) => observePendingAccountVoiceFollowInTx(tx, {
            accountId: viewer.id,
            voiceSessionId: voiceSession.id,
            authentication: defaultAuthentication,
            runtimeAuthority,
        }));
        const pending = await observe();
        expect(pending).toEqual([expect.objectContaining({
            sourceSessionId: session.id,
            voiceSessionId: voiceSession.id,
            expected: null,
            observed: expect.objectContaining({ transcriptSeq: 10 }),
        })]);
        if (pending === null) throw new Error('Expected a pending Account Voice Follow observation');
        expect(await getAccountSessionFollow(key)).toMatchObject({
            ok: true,
            value: { voiceInitialSnapshotPending: true },
        });
        const acceptance = { localInputId: 'accepted-voice-follow-input', userMessageSeq: 1 } as const;
        expect(await inTx((tx) => acknowledgeAccountVoiceFollowInTx(tx, {
            accountId: viewer.id,
            voiceSessionId: voiceSession.id,
            sourceSessionId: session.id,
            expected: null,
            observed: pending[0]!.observed,
            consumed: pending[0]!.observed,
            acceptance,
            authentication: defaultAuthentication,
            runtimeAuthority,
        }))).toEqual({ ok: false, rejection: 'provider_acceptance_unverified' });
        await db.sessionMessage.create({ data: {
            sessionId: voiceSession.id,
            seq: 1,
            localId: acceptance.localInputId,
            messageRole: 'user',
            content: { t: 'plain', v: { role: 'user', content: { type: 'text', text: 'voice turn' } } },
            inputAdmissionReceipt: { v: 1, issuer: 'authenticatedAccount', actorAccountId: viewer.id, sessionRelationship: 'owner' },
        } });
        expect(await inTx((tx) => acknowledgeAccountVoiceFollowInTx(tx, {
            accountId: viewer.id,
            voiceSessionId: voiceSession.id,
            sourceSessionId: session.id,
            expected: null,
            observed: pending[0]!.observed,
            consumed: pending[0]!.observed,
            acceptance,
            authentication: defaultAuthentication,
            runtimeAuthority,
        }))).toEqual({ ok: true, delivered: pending[0]!.observed });
        expect(await observe()).toEqual([]);
        expect(await getAccountSessionFollow(key)).toMatchObject({
            ok: true,
            value: { voiceInitialSnapshotPending: false },
        });

        await db.session.update({ where: { id: session.id }, data: { seq: 11 } });
        const advanced = await observe();
        expect(advanced).toHaveLength(1);
        if (advanced === null) throw new Error('Expected an advanced Account Voice Follow observation');
        await db.session.update({ where: { id: session.id }, data: { seq: 12 } });
        expect(await inTx((tx) => acknowledgeAccountVoiceFollowInTx(tx, {
            accountId: viewer.id,
            voiceSessionId: voiceSession.id,
            sourceSessionId: session.id,
            expected: advanced[0]!.expected,
            observed: advanced[0]!.observed,
            consumed: { ...advanced[0]!.observed, transcriptSeq: 12 },
            acceptance,
            authentication: defaultAuthentication,
            runtimeAuthority,
        }))).toEqual({ ok: false, rejection: 'invalid_consumed_frontier' });
        expect(await inTx((tx) => acknowledgeAccountVoiceFollowInTx(tx, {
            accountId: viewer.id,
            voiceSessionId: voiceSession.id,
            sourceSessionId: session.id,
            expected: advanced[0]!.expected,
            observed: advanced[0]!.observed,
            consumed: advanced[0]!.observed,
            acceptance,
            authentication: defaultAuthentication,
            runtimeAuthority,
        }))).toEqual({ ok: true, delivered: advanced[0]!.observed });
        expect(await observe()).toEqual([expect.objectContaining({
            expected: advanced[0]!.observed,
            observed: expect.objectContaining({ transcriptSeq: 12 }),
        })]);
        expect(await inTx((tx) => acknowledgeAccountVoiceFollowInTx(tx, {
            accountId: viewer.id,
            voiceSessionId: voiceSession.id,
            sourceSessionId: session.id,
            expected: null,
            observed: advanced[0]!.observed,
            consumed: advanced[0]!.observed,
            acceptance,
            authentication: defaultAuthentication,
            runtimeAuthority,
        }))).toEqual({ ok: false, rejection: 'stale_expected_frontier' });
    });

    it('fails Account Voice observation closed without the current private voice_agent Run authority', async () => {
        const { viewer, session, key } = await fixture();
        const voiceSession = await db.session.create({ data: {
            accountId: viewer.id,
            tag: VOICE_TRANSCRIPT_HISTORY_SYSTEM_SESSION_TAG,
            metadata: '{}',
            encryptionMode: 'plain',
        } });
        await setAccountSessionFollow({ ...key, preferences: { notificationLevel: 'none', includeInVoice: true } });
        const observe = (runtimeAuthority?: Readonly<{
            executionRunId: string;
            occurrenceId: string;
            parentSessionId: string;
            intent: 'voice_agent';
            runtimeState: 'active_turn' | 'idle';
        }>) => inTx((tx) => observePendingAccountVoiceFollowInTx(tx, {
            accountId: viewer.id,
            voiceSessionId: voiceSession.id,
            authentication: defaultAuthentication,
            runtimeAuthority,
        }));
        const current = {
            executionRunId: 'voice-run-current',
            occurrenceId: 'voice-occurrence-current',
            parentSessionId: voiceSession.id,
            intent: 'voice_agent' as const,
            runtimeState: 'active_turn' as const,
        };

        await expect(observe()).resolves.toBeNull();
        await expect(observe({ ...current, parentSessionId: session.id })).resolves.toBeNull();

        const share = await db.sessionShare.create({ data: {
            sessionId: voiceSession.id,
            sharedByUserId: viewer.id,
            sharedWithUserId: (await db.account.create({ data: {
                publicKey: randomUUID(), encryptionMode: 'plain',
            } })).id,
            accessLevel: 'view',
        } });
        await expect(observe(current)).resolves.toBeNull();
        await db.sessionShare.delete({ where: { id: share.id } });
        const pending = await observe(current);
        expect(pending).toEqual([expect.objectContaining({
            sourceSessionId: session.id,
            voiceSessionId: voiceSession.id,
        })]);
        expect(await inTx((tx) => acknowledgeAccountVoiceFollowInTx(tx, {
            accountId: viewer.id,
            voiceSessionId: voiceSession.id,
            sourceSessionId: session.id,
            expected: null,
            observed: pending![0]!.observed,
            consumed: pending![0]!.observed,
            acceptance: { localInputId: 'ordinary-input', userMessageSeq: null },
            authentication: defaultAuthentication,
        }))).toEqual({ ok: false, rejection: 'forbidden' });
    });

    it('retains explicit suppression after access loss and never lets auto-follow overwrite a manual choice', async () => {
        const { key } = await fixture();
        await setAccountSessionFollow({ ...key, preferences: { notificationLevel: 'none', includeInVoice: true } });
        await inTx(tx => applySessionAutoFollowForRelationshipChangeInTx(tx, { sessionId: key.sessionId, accountIds: [key.accountId], relationship: 'assigned' }));
        expect(await inTx(tx => resolveSessionFollowFactsInTx(tx, key))).toEqual({ follows: true, notificationLevel: 'none' });
        await db.sessionShare.deleteMany({ where: { sessionId: key.sessionId } });
        expect(await getAccountSessionFollow(key)).toEqual({ ok: false, error: 'session_not_found' });
        expect(await removeAccountSessionFollow(key)).toEqual({ ok: true, value: { changed: true } });
        expect(await inTx(tx => resolveSessionFollowFactsInTx(tx, key))).toEqual({ follows: false, notificationLevel: 'none' });
        await inTx(tx => applySessionAutoFollowForRelationshipChangeInTx(tx, { sessionId: key.sessionId, accountIds: [key.accountId], relationship: 'assigned' }));
        expect(await db.accountSessionFollow.findUnique({ where: { accountId_sessionId: key } })).toMatchObject({ following: false, includeInVoice: false, voiceDeliveredFrontier: null });
    });

    it('seeds automatic tracking only when its conditional insert creates the Follow row', async () => {
        const { owner, viewer, key, session } = await fixture();
        const discussion = await createDiscussion({
            sessionId: session.id,
            creatorAccountId: owner.id,
            messageSeq: 8,
        });
        const unreadSince = new Date(1_234);
        await db.accountSessionReadState.create({
            data: { ...key, lastViewedSessionSeq: 2, unreadSince },
        });
        await db.sessionDiscussionReadState.create({
            data: { discussionId: discussion.id, accountId: viewer.id, lastReadSeq: 3 },
        });

        // SQLite serializes writers, so this trigger deterministically exercises
        // the same conditional-insert boundary as a concurrent explicit choice:
        // the service's eligibility snapshot sees no row, then the explicit row
        // wins immediately before the automatic insert settles.
        await db.$executeRawUnsafe('CREATE TABLE "AutoFollowInsertRaceGate" ("armed" INTEGER NOT NULL)');
        await db.$executeRawUnsafe('INSERT INTO "AutoFollowInsertRaceGate" ("armed") VALUES (1)');
        await db.$executeRawUnsafe(`
            CREATE TRIGGER "inject_explicit_follow_before_automatic_insert"
            BEFORE INSERT ON "AccountSessionFollow"
            WHEN EXISTS (SELECT 1 FROM "AutoFollowInsertRaceGate" WHERE "armed" = 1)
            BEGIN
                DELETE FROM "AutoFollowInsertRaceGate";
                INSERT INTO "AccountSessionFollow" (
                    "accountId", "sessionId", "following", "notificationLevel",
                    "includeInVoice", "voiceDeliveredFrontier"
                ) VALUES (NEW."accountId", NEW."sessionId", true, 'all_messages', true, NULL);
            END
        `);
        try {
            expect(await inTx(tx => applySessionAutoFollowForRelationshipChangeInTx(tx, {
                sessionId: session.id,
                accountIds: [viewer.id],
                relationship: 'assigned',
            }))).toBe(0);

            expect(await db.accountSessionFollow.findUnique({
                where: { accountId_sessionId: key },
            })).toMatchObject({
                following: true,
                notificationLevel: 'all_messages',
                includeInVoice: true,
                voiceDeliveredFrontier: null,
            });
            expect(await db.accountSessionReadState.findUnique({
                where: { accountId_sessionId: key },
            })).toMatchObject({ lastViewedSessionSeq: 2, unreadSince });
            expect(await db.sessionDiscussionReadState.findUnique({
                where: { discussionId_accountId: { discussionId: discussion.id, accountId: viewer.id } },
            })).toMatchObject({ lastReadSeq: 3 });
            expect(await db.accountChange.count({
                where: { accountId: viewer.id, entityId: 'session-follows' },
            })).toBe(0);
        } finally {
            await db.$executeRawUnsafe('DROP TRIGGER IF EXISTS "inject_explicit_follow_before_automatic_insert"');
            await db.$executeRawUnsafe('DROP TABLE IF EXISTS "AutoFollowInsertRaceGate"');
        }
    });

    it('atomically seeds both automatic Follow baselines once and preserves them on retry', async () => {
        const { owner, viewer, key, session } = await fixture();
        const discussion = await createDiscussion({
            sessionId: session.id,
            creatorAccountId: owner.id,
            messageSeq: 8,
        });
        await db.accountSessionReadState.create({
            data: { ...key, lastViewedSessionSeq: 2, unreadSince: new Date(2_000) },
        });
        await db.sessionDiscussionReadState.create({
            data: { discussionId: discussion.id, accountId: viewer.id, lastReadSeq: 3 },
        });
        const apply = () => inTx(tx => applySessionAutoFollowForRelationshipChangeInTx(tx, {
            sessionId: session.id,
            accountIds: [viewer.id],
            relationship: 'assigned',
        }));

        expect(await apply()).toBe(1);
        expect(await db.accountSessionFollow.findUnique({
            where: { accountId_sessionId: key },
        })).toMatchObject({
            following: true,
            notificationLevel: 'important',
            includeInVoice: false,
        });
        expect(await db.accountSessionReadState.findUnique({
            where: { accountId_sessionId: key },
        })).toMatchObject({ lastViewedSessionSeq: 10, unreadSince: null });
        expect(await db.sessionDiscussionReadState.findUnique({
            where: { discussionId_accountId: { discussionId: discussion.id, accountId: viewer.id } },
        })).toMatchObject({ lastReadSeq: 8 });

        const laterUnreadSince = new Date(3_000);
        await db.accountSessionReadState.update({
            where: { accountId_sessionId: key },
            data: { lastViewedSessionSeq: 4, unreadSince: laterUnreadSince },
        });
        await db.sessionDiscussionReadState.update({
            where: { discussionId_accountId: { discussionId: discussion.id, accountId: viewer.id } },
            data: { lastReadSeq: 5 },
        });
        await db.session.update({ where: { id: session.id }, data: { seq: 12 } });
        await db.sessionDiscussion.update({ where: { id: discussion.id }, data: { messageSeq: 9 } });

        expect(await apply()).toBe(0);
        expect(await db.accountSessionReadState.findUnique({
            where: { accountId_sessionId: key },
        })).toMatchObject({ lastViewedSessionSeq: 4, unreadSince: laterUnreadSince });
        expect(await db.sessionDiscussionReadState.findUnique({
            where: { discussionId_accountId: { discussionId: discussion.id, accountId: viewer.id } },
        })).toMatchObject({ lastReadSeq: 5 });
    });

    it('leaves retained read frontiers untouched when explicit Unfollow suppresses automatic entry', async () => {
        const { owner, viewer, key, session } = await fixture();
        const discussion = await createDiscussion({
            sessionId: session.id,
            creatorAccountId: owner.id,
            messageSeq: 8,
        });
        expect(await removeAccountSessionFollow(key)).toEqual({ ok: true, value: { changed: true } });
        const unreadSince = new Date(4_000);
        await db.accountSessionReadState.create({
            data: { ...key, lastViewedSessionSeq: 2, unreadSince },
        });
        await db.sessionDiscussionReadState.create({
            data: { discussionId: discussion.id, accountId: viewer.id, lastReadSeq: 3 },
        });
        const changesBefore = await db.accountChange.count({
            where: { accountId: viewer.id, entityId: 'session-follows' },
        });

        expect(await inTx(tx => applySessionAutoFollowForRelationshipChangeInTx(tx, {
            sessionId: session.id,
            accountIds: [viewer.id],
            relationship: 'assigned',
        }))).toBe(0);

        expect(await db.accountSessionFollow.findUnique({
            where: { accountId_sessionId: key },
        })).toMatchObject({ following: false, notificationLevel: 'none', includeInVoice: false });
        expect(await db.accountSessionReadState.findUnique({
            where: { accountId_sessionId: key },
        })).toMatchObject({ lastViewedSessionSeq: 2, unreadSince });
        expect(await db.sessionDiscussionReadState.findUnique({
            where: { discussionId_accountId: { discussionId: discussion.id, accountId: viewer.id } },
        })).toMatchObject({ lastReadSeq: 3 });
        expect(await db.accountChange.count({
            where: { accountId: viewer.id, entityId: 'session-follows' },
        })).toBe(changesBefore);
    });

    it('rolls back the Follow write when the canonical tracking initializer cannot persist', async () => {
        const { key } = await fixture();
        await db.$executeRawUnsafe('CREATE TRIGGER fail_follow_tracking BEFORE INSERT ON "AccountSessionReadState" BEGIN SELECT RAISE(ABORT, \'tracking unavailable\'); END');
        try {
            await expect(setAccountSessionFollow({ ...key, preferences: { notificationLevel: 'important', includeInVoice: false } })).rejects.toThrow();
            expect(await db.accountSessionFollow.findUnique({ where: { accountId_sessionId: key } })).toBeNull();
            expect(await db.accountChange.count({ where: { accountId: key.accountId, entityId: 'session-follows' } })).toBe(0);
        } finally { await db.$executeRawUnsafe('DROP TRIGGER fail_follow_tracking'); }
    });

    it('reports the caller\'s own ownership so an owner without a stored row is not rendered as off', async () => {
        const { owner, viewer, session } = await fixture();
        expect(await getAccountSessionFollow({ accountId: owner.id, sessionId: session.id }))
            .toEqual({ ok: true, value: {
                follow: null,
                isSessionOwner: true,
                capabilities: { manageFollow: true },
                voiceInitialSnapshotPending: false,
            } });
        expect(await getAccountSessionFollow({ accountId: viewer.id, sessionId: session.id }))
            .toEqual({ ok: true, value: {
                follow: null,
                isSessionOwner: false,
                capabilities: { manageFollow: true },
                voiceInitialSnapshotPending: false,
            } });
    });

    it('uses the same coarse snapshot invalidation for defaults and relationship changes', async () => {
        const { viewer, key } = await fixture();
        const hintFor = async (accountId: string) => (await db.accountChange.findFirst({
            where: { accountId, entityId: 'session-follows' }, select: { hint: true },
        }))?.hint;
        const preferences = { assigned: false, direct: false, team: false, group: false };
        expect(await setSessionAutoFollowPreferences({ accountId: viewer.id, preferences })).toMatchObject({ ok: true });
        expect(await hintFor(viewer.id)).toEqual({ sessionFollows: true, full: true });

        // A Follow relationship change uses the same consumed snapshot refresh.
        await setAccountSessionFollow({ ...key, preferences: { notificationLevel: 'important', includeInVoice: false } });
        expect(await hintFor(viewer.id)).toEqual({ sessionFollows: true, full: true });

        // A later defaults edit cannot narrow the coalesced invalidation.
        expect(await setSessionAutoFollowPreferences({ accountId: viewer.id, preferences: { ...preferences, team: true } }))
            .toMatchObject({ ok: true });
        expect(await hintFor(viewer.id)).toEqual({ sessionFollows: true, full: true });
    });

    it('keeps an explicit concurrent Unfollow authoritative over automatic assignment enrollment', async () => {
        const { key } = await fixture();
        await Promise.all([
            inTx(tx => applySessionAutoFollowForRelationshipChangeInTx(tx, {
                sessionId: key.sessionId, accountIds: [key.accountId], relationship: 'assigned',
            })),
            removeAccountSessionFollow(key),
        ]);
        expect(await db.accountSessionFollow.findUnique({ where: { accountId_sessionId: key } })).toMatchObject({
            following: false, notificationLevel: 'none', includeInVoice: false, voiceDeliveredFrontier: null,
        });
    });
});
