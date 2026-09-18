import { describe, expect, it, vi } from 'vitest';

import type {
    SessionDiscussionCreateResultV1,
    SessionDiscussionListResultV1,
    SessionDiscussionOpenedMessageV1,
    SessionDiscussionOpenedSummaryV1,
    SessionDiscussionReadResultV1,
} from '@happier-dev/protocol';
import type { SessionDiscussionDraftSubmission } from './sessionDiscussionRepository';

import { createSessionDiscussionRepository, type SessionDiscussionRepositoryClient } from './sessionDiscussionRepository';
import { publishMountedSessionDiscussionChanges } from '@/sync/domains/session/discussions/sessionDiscussionChangeWatch';
import {
    clearSessionDiscussionRepositoryRegistryForTests,
    getSessionDiscussionRepository,
} from './sessionDiscussionRepositoryRegistry';

const address = { serverId: 'home-a', sessionId: 'session-a' } as const;

function draftSubmission(kind: 'newDiscussion' | 'discussion' = 'newDiscussion'): SessionDiscussionDraftSubmission {
    return {
        scope: { serverId: address.serverId, accountId: 'account-a' },
        address: kind === 'newDiscussion'
            ? { kind, sessionId: address.sessionId }
            : { kind, sessionId: address.sessionId, discussionId: 'discussion-a' },
        currentness: {
            address: kind === 'newDiscussion'
                ? { kind, sessionId: address.sessionId }
                : { kind, sessionId: address.sessionId, discussionId: 'discussion-a' },
            mutationIds: { 'composer.text': 'text-mutation', 'composer.mentions': 'mentions-mutation' },
        },
    };
}

function summary(id: string, localId: string | null, messageSeq: number): SessionDiscussionOpenedSummaryV1 {
    return {
        id,
        sessionId: address.sessionId,
        creationLocalId: localId,
        title: id,
        latestMessage: { id: `${id}-message`, localId: null, seq: messageSeq, authorAccountId: 'account-a', accountActor: { v: 1, accountId: 'account-a', profile: null }, producerV1: null, createdAt: messageSeq },
        messageSeq,
        lastReadSeq: 0,
        unreadCount: messageSeq,
        unreadMentionCount: 0,
        recentAuthorAccountIds: ['account-a'],
        archivedAt: null,
        capabilities: { postMessages: true, rename: true, archive: true, restore: false, askAgent: true, sendToSession: true },
    };
}

function message(seq: number, localId: string | null = null): SessionDiscussionOpenedMessageV1 {
    return { id: `message-${seq}`, discussionId: 'discussion-a', localId, seq, authorAccountId: 'account-a', accountActor: { v: 1, accountId: 'account-a', profile: null }, producerV1: null, content: { v: 1, parts: [{ t: 'text', text: `message ${seq}` }] }, mentionedAccountIds: [], createdAt: seq };
}

function listResult(discussions: readonly SessionDiscussionOpenedSummaryV1[], nextCursor: string | null): SessionDiscussionListResultV1 {
    return { v: 1, serverId: address.serverId, sessionId: address.sessionId, discussions: [...discussions], nextCursor, incomplete: false };
}

function readResult(messages: readonly SessionDiscussionOpenedMessageV1[], hasMoreOlder: boolean, messageSeq: number): SessionDiscussionReadResultV1 {
    return { v: 1, serverId: address.serverId, sessionId: address.sessionId, discussionId: 'discussion-a', messages: [...messages], hasMoreOlder, messageSeq, incomplete: false };
}

function client(overrides: Partial<SessionDiscussionRepositoryClient> = {}): SessionDiscussionRepositoryClient {
    return {
        list: vi.fn<SessionDiscussionRepositoryClient['list']>().mockResolvedValue({ kind: 'succeeded', value: listResult([], null) }),
        get: vi.fn<SessionDiscussionRepositoryClient['get']>().mockResolvedValue({ kind: 'failed', errorCode: 'not_found' }),
        read: vi.fn<SessionDiscussionRepositoryClient['read']>().mockResolvedValue({ kind: 'succeeded', value: readResult([], false, 0) }),
        create: vi.fn<SessionDiscussionRepositoryClient['create']>().mockResolvedValue({ kind: 'failed', errorCode: 'not_implemented' }),
        post: vi.fn<SessionDiscussionRepositoryClient['post']>().mockResolvedValue({ kind: 'failed', errorCode: 'not_implemented' }),
        rename: vi.fn<SessionDiscussionRepositoryClient['rename']>().mockResolvedValue({ kind: 'failed', errorCode: 'not_implemented' }),
        archive: vi.fn<SessionDiscussionRepositoryClient['archive']>().mockResolvedValue({ kind: 'failed', errorCode: 'not_implemented' }),
        restore: vi.fn<SessionDiscussionRepositoryClient['restore']>().mockResolvedValue({ kind: 'failed', errorCode: 'not_implemented' }),
        readState: vi.fn<SessionDiscussionRepositoryClient['readState']>().mockResolvedValue({ kind: 'failed', errorCode: 'not_implemented' }),
        ...overrides,
    };
}

describe('Session Discussion repository', () => {
    it('publishes one stable optimistic message payload before a post settles', async () => {
        let resolvePost: (value: Awaited<ReturnType<SessionDiscussionRepositoryClient['post']>>) => void = () => {
            throw new Error('post resolver was not installed');
        };
        const post = vi.fn<SessionDiscussionRepositoryClient['post']>(() => new Promise((resolve) => {
            resolvePost = resolve;
        }));
        const repository = createSessionDiscussionRepository({ address, client: client({ post }) });
        const content = { v: 1 as const, parts: [{ t: 'text' as const, text: 'Visible now' }] };

        const pending = repository.post({
            discussionId: 'discussion-a',
            localId: 'post-local-pending',
            content,
            mentionedAccountIds: ['account-b'],
            draftSubmission: draftSubmission('discussion'),
        });

        expect(repository.getSnapshot().mutations['post-local-pending']).toMatchObject({
            localId: 'post-local-pending',
            discussionId: 'discussion-a',
            status: 'sending',
            content,
            mentionedAccountIds: ['account-b'],
        });

        resolvePost({
            kind: 'succeeded',
            value: {
                v: 1,
                serverId: address.serverId,
                sessionId: address.sessionId,
                message: { ...message(1, 'post-local-pending'), content },
                messageSeq: 1,
            },
        });
        await pending;

        const snapshot = repository.getSnapshot();
        expect(snapshot.mutations['post-local-pending']?.status).toBe('observed_success');
        expect(snapshot.threads['discussion-a']?.messages.filter((row) => row.localId === 'post-local-pending')).toHaveLength(1);
    });

    it('purges all decrypted discussion projections and mutations on explicit access loss', async () => {
        const list = vi.fn<SessionDiscussionRepositoryClient['list']>()
            .mockResolvedValue({ kind: 'succeeded', value: listResult([summary('discussion-a', null, 1)], null) });
        const read = vi.fn<SessionDiscussionRepositoryClient['read']>()
            .mockResolvedValueOnce({ kind: 'succeeded', value: readResult([message(1)], false, 1) })
            .mockResolvedValueOnce({ kind: 'failed', errorCode: 'session_discussion_read_denied' });
        const post = vi.fn<SessionDiscussionRepositoryClient['post']>()
            .mockResolvedValue({ kind: 'approval_request_created', artifactId: 'approval-a', actionId: 'session.discussion.post' });
        const repository = createSessionDiscussionRepository({ address, client: client({ list, read, post }) });
        await repository.refreshList('active');
        await repository.refreshMessages('discussion-a');
        await repository.post({
            discussionId: 'discussion-a',
            localId: 'post-local-a',
            content: { v: 1, parts: [{ t: 'text', text: 'Private pending text' }] },
            draftSubmission: draftSubmission('discussion'),
        });

        await repository.refreshMessages('discussion-a');

        expect(repository.getSnapshot()).toMatchObject({
            lists: {
                active: { items: [], status: 'revoked', errorCode: 'session_discussion_read_denied' },
                archived: { items: [], status: 'revoked', errorCode: 'session_discussion_read_denied' },
            },
            threads: {},
            mutations: {},
        });
    });

    it('purges retained decrypted state when a protected refresh nondiscloses the discussion as not found', async () => {
        const list = vi.fn<SessionDiscussionRepositoryClient['list']>()
            .mockResolvedValue({ kind: 'succeeded', value: listResult([summary('discussion-a', null, 1)], null) });
        const read = vi.fn<SessionDiscussionRepositoryClient['read']>()
            .mockResolvedValue({ kind: 'succeeded', value: readResult([message(1)], false, 1) });
        const get = vi.fn<SessionDiscussionRepositoryClient['get']>()
            .mockResolvedValueOnce({
                kind: 'succeeded',
                value: {
                    v: 1,
                    serverId: address.serverId,
                    sessionId: address.sessionId,
                    discussion: summary('discussion-a', null, 1),
                },
            })
            .mockResolvedValueOnce({ kind: 'failed', errorCode: 'session_discussion_not_found' });
        const repository = createSessionDiscussionRepository({ address, client: client({ list, read, get }) });
        await repository.refreshList('active');
        await repository.refreshDiscussion('discussion-a');
        expect(repository.getSnapshot().threads['discussion-a']?.messages).toHaveLength(1);

        await repository.refreshDiscussion('discussion-a');

        expect(repository.getSnapshot()).toMatchObject({
            lists: {
                active: { items: [], status: 'revoked', errorCode: 'session_discussion_not_found' },
                archived: { items: [], status: 'revoked', errorCode: 'session_discussion_not_found' },
            },
            threads: {},
            mutations: {},
        });
    });

    it('retains recoverable projections across a transient list failure', async () => {
        const retained = summary('discussion-a', null, 1);
        const list = vi.fn<SessionDiscussionRepositoryClient['list']>()
            .mockResolvedValueOnce({ kind: 'succeeded', value: listResult([retained], null) })
            .mockResolvedValueOnce({ kind: 'failed', errorCode: 'offline' });
        const repository = createSessionDiscussionRepository({ address, client: client({ list }) });

        await repository.refreshList('active');
        await repository.refreshList('active');

        expect(repository.getSnapshot().lists.active).toMatchObject({
            items: [retained],
            status: 'offline',
            errorCode: 'offline',
        });
    });

    it('does not let an older in-flight success repopulate state after access loss', async () => {
        let resolveRead: (value: Awaited<ReturnType<SessionDiscussionRepositoryClient['read']>>) => void = () => {
            throw new Error('read resolver was not installed');
        };
        const read = vi.fn<SessionDiscussionRepositoryClient['read']>(() => new Promise((resolve) => {
            resolveRead = resolve;
        }));
        const list = vi.fn<SessionDiscussionRepositoryClient['list']>()
            .mockResolvedValue({ kind: 'failed', errorCode: 'session_discussion_read_denied' });
        const repository = createSessionDiscussionRepository({ address, client: client({ list, read }) });

        const staleRefresh = repository.refreshMessages('discussion-a');
        await repository.refreshList('active');
        resolveRead({ kind: 'succeeded', value: readResult([message(1)], false, 1) });
        await staleRefresh;

        expect(repository.getSnapshot()).toMatchObject({
            lists: { active: { status: 'revoked' }, archived: { status: 'revoked' } },
            threads: {},
        });
    });

    it('keeps active and archived keyset pages separate and merges repeated rows stably', async () => {
        const first = summary('discussion-a', null, 3);
        const second = summary('discussion-b', null, 2);
        const list = vi.fn<SessionDiscussionRepositoryClient['list']>()
            .mockResolvedValueOnce({ kind: 'succeeded', value: listResult([first], 'next-active') })
            .mockResolvedValueOnce({ kind: 'succeeded', value: listResult([first, second], null) })
            .mockResolvedValueOnce({ kind: 'succeeded', value: listResult([{ ...first, archivedAt: 20 }], null) });
        const repository = createSessionDiscussionRepository({ address, client: client({ list }) });

        await repository.refreshList('active');
        const firstReference = repository.getSnapshot().lists.active.items[0];
        await repository.loadMoreList('active');
        await repository.refreshList('archived');

        const snapshot = repository.getSnapshot();
        expect(snapshot.lists.active.items.map((item) => item.id)).toEqual(['discussion-a', 'discussion-b']);
        expect(snapshot.lists.active.items[0]).toBe(firstReference);
        expect(snapshot.lists.archived.items.map((item) => item.id)).toEqual(['discussion-a']);
        expect(list.mock.calls.map(([input]) => input)).toEqual([
            { state: 'active' },
            { state: 'active', cursor: 'next-active' },
            { state: 'archived' },
        ]);
    });

    it('prepends older message pages without disturbing existing row identities', async () => {
        const recent = [message(3), message(4)];
        const older = [message(1), message(2)];
        const read = vi.fn<SessionDiscussionRepositoryClient['read']>()
            .mockResolvedValueOnce({ kind: 'succeeded', value: readResult(recent, true, 4) })
            .mockResolvedValueOnce({ kind: 'succeeded', value: readResult(older, false, 4) });
        const repository = createSessionDiscussionRepository({ address, client: client({ read }) });

        await repository.refreshMessages('discussion-a');
        const recentReference = repository.getSnapshot().threads['discussion-a']!.messages[0];
        await repository.loadOlderMessages('discussion-a');

        const thread = repository.getSnapshot().threads['discussion-a']!;
        expect(thread.messages.map((item) => item.seq)).toEqual([1, 2, 3, 4]);
        expect(thread.messages[2]).toBe(recentReference);
        expect(read.mock.calls[1]?.[1]).toEqual({ beforeSeq: 3 });
    });

    it('retains one create identity through outcome-unknown reconciliation and explicit retry', async () => {
        const canonicalSummary = summary('discussion-created', 'create-local-a', 1);
        const created: SessionDiscussionCreateResultV1 = {
            v: 1,
            serverId: address.serverId,
            sessionId: address.sessionId,
            discussion: canonicalSummary,
            firstMessage: { ...message(1, 'message-local-a'), discussionId: 'discussion-created' },
        };
        const create = vi.fn<SessionDiscussionRepositoryClient['create']>()
            .mockResolvedValueOnce({ kind: 'failed', errorCode: 'outcome_unknown' })
            .mockResolvedValueOnce({ kind: 'succeeded', value: created });
        const repository = createSessionDiscussionRepository({ address, client: client({ create }) });
        const input = { creationLocalId: 'create-local-a', messageLocalId: 'message-local-a', title: 'Release', content: { v: 1 as const, parts: [{ t: 'text' as const, text: 'Ready?' }] }, draftSubmission: draftSubmission() };

        const unknown = await repository.create(input);
        expect(unknown.kind).toBe('checking');
        expect(repository.getSnapshot().mutations['create-local-a']).toMatchObject({ status: 'checking', messageLocalId: 'message-local-a' });
        await vi.waitFor(() => expect(repository.getSnapshot().mutations['create-local-a']).toMatchObject({
            status: 'outcome_unknown',
            errorCode: 'outcome_unknown',
        }));

        const retried = await repository.retry('create-local-a');
        expect(retried.kind).toBe('succeeded');
        expect(create.mock.calls[0]?.[0]).toEqual(create.mock.calls[1]?.[0]);
        expect(repository.getSnapshot().lists.active.items[0]?.id).toBe('discussion-created');
    });

    it('keeps activity order stable when a title-only rename updates an existing summary', async () => {
        const newest = summary('discussion-newest', null, 3);
        const renamed = {
            ...summary('discussion-older', null, 2),
            title: 'Renamed without new activity',
        };
        const list = vi.fn<SessionDiscussionRepositoryClient['list']>()
            .mockResolvedValue({ kind: 'succeeded', value: listResult([
                newest,
                { ...renamed, title: 'Original title' },
            ], null) });
        const rename = vi.fn<SessionDiscussionRepositoryClient['rename']>()
            .mockResolvedValue({
                kind: 'succeeded',
                value: {
                    v: 1,
                    serverId: address.serverId,
                    sessionId: address.sessionId,
                    discussion: renamed,
                },
            });
        const repository = createSessionDiscussionRepository({ address, client: client({ list, rename }) });
        await repository.refreshList('active');

        await repository.rename('discussion-older', 'Renamed without new activity');

        expect(repository.getSnapshot().lists.active.items.map((item) => item.id)).toEqual([
            'discussion-newest',
            'discussion-older',
        ]);
        expect(repository.getSnapshot().lists.active.items[1]?.title).toBe('Renamed without new activity');
    });

    it('reconciles an outcome-unknown create from canonical list/read state without resending', async () => {
        const canonicalSummary = summary('discussion-created', 'create-local-a', 1);
        const create = vi.fn<SessionDiscussionRepositoryClient['create']>()
            .mockResolvedValue({ kind: 'failed', errorCode: 'outcome_unknown' });
        const list = vi.fn<SessionDiscussionRepositoryClient['list']>()
            .mockResolvedValue({ kind: 'succeeded', value: listResult([canonicalSummary], null) });
        const read = vi.fn<SessionDiscussionRepositoryClient['read']>()
            .mockResolvedValue({
                kind: 'succeeded',
                value: {
                    ...readResult([{ ...message(1, 'message-local-a'), discussionId: 'discussion-created' }], false, 1),
                    discussionId: 'discussion-created',
                },
            });
        const repository = createSessionDiscussionRepository({ address, client: client({ create, list, read }) });

        const outcome = await repository.create({
            creationLocalId: 'create-local-a',
            messageLocalId: 'message-local-a',
            title: 'Release',
            content: { v: 1, parts: [{ t: 'text', text: 'Ready?' }] },
            draftSubmission: draftSubmission(),
        });
        expect(outcome.kind).toBe('checking');
        await vi.waitFor(() => expect(repository.getSnapshot().mutations['create-local-a']?.status).toBe('observed_success'));

        expect(create).toHaveBeenCalledTimes(1);
        expect(repository.getSnapshot().threads['discussion-created']?.messages[0]?.localId).toBe('message-local-a');
        repository.acknowledgeObservedSuccess('create-local-a');
        expect(repository.getSnapshot().mutations['create-local-a']).toBeUndefined();
    });

    it('recognizes an outcome-unknown post already published by a racing refresh', async () => {
        const published = { ...message(2, 'post-local-a'), discussionId: 'discussion-a' };
        const read = vi.fn<SessionDiscussionRepositoryClient['read']>()
            .mockResolvedValueOnce({ kind: 'succeeded', value: readResult([published], false, 2) })
            .mockResolvedValue({ kind: 'succeeded', value: readResult([], false, 2) });
        const post = vi.fn<SessionDiscussionRepositoryClient['post']>()
            .mockResolvedValue({ kind: 'failed', errorCode: 'outcome_unknown' });
        const repository = createSessionDiscussionRepository({ address, client: client({ read, post }) });
        await repository.refreshMessages('discussion-a');

        const outcome = await repository.post({
            discussionId: 'discussion-a',
            localId: 'post-local-a',
            content: { v: 1, parts: [{ t: 'text', text: 'Already visible' }] },
            draftSubmission: draftSubmission(),
        });

        expect(outcome.kind).toBe('checking');
        await vi.waitFor(() => expect(repository.getSnapshot().mutations['post-local-a']).toMatchObject({
            status: 'observed_success',
        }));
        expect(post).toHaveBeenCalledTimes(1);
    });

    it('adopts a reload-restored post identity by reconciling before any resend', async () => {
        const published = { ...message(2, 'post-local-restored'), discussionId: 'discussion-a' };
        const read = vi.fn<SessionDiscussionRepositoryClient['read']>()
            .mockResolvedValue({ kind: 'succeeded', value: readResult([published], false, 2) });
        const post = vi.fn<SessionDiscussionRepositoryClient['post']>();
        const repository = createSessionDiscussionRepository({ address, client: client({ read, post }) });

        repository.adoptPendingIntent({
            kind: 'post',
            discussionId: 'discussion-a',
            localId: 'post-local-restored',
            content: { v: 1, parts: [{ t: 'text', text: 'Restored' }] },
            draftSubmission: draftSubmission('discussion'),
        });

        await vi.waitFor(() => expect(repository.getSnapshot().mutations['post-local-restored']?.status)
            .toBe('observed_success'));
        expect(post).not.toHaveBeenCalled();
    });

    it('separates a dismissable definitive refusal from a retryable transient failure', async () => {
        const post = vi.fn<SessionDiscussionRepositoryClient['post']>()
            .mockResolvedValueOnce({ kind: 'failed', errorCode: 'session_discussion_invalid_mention' })
            .mockResolvedValueOnce({ kind: 'failed', errorCode: 'offline' });
        const repository = createSessionDiscussionRepository({ address, client: client({ post }) });
        const content = { v: 1 as const, parts: [{ t: 'text' as const, text: 'Keep me' }] };

        await repository.post({ discussionId: 'discussion-a', localId: 'post-definitive', content, draftSubmission: draftSubmission('discussion') });
        await repository.post({ discussionId: 'discussion-a', localId: 'post-transient', content, draftSubmission: draftSubmission('discussion') });

        expect(repository.getSnapshot().mutations['post-definitive']).toMatchObject({
            status: 'failed', errorCode: 'session_discussion_invalid_mention', recovery: 'dismiss',
        });
        expect(repository.getSnapshot().mutations['post-transient']).toMatchObject({
            status: 'failed', errorCode: 'offline', recovery: 'retry',
        });

        expect(repository.dismissFailure('post-definitive')).toBe(true);
        expect(repository.getSnapshot().mutations['post-definitive']).toBeUndefined();
        await expect(repository.retry('post-definitive')).resolves.toEqual({
            kind: 'failed', errorCode: 'session_discussion_retry_not_found',
        });
        // Only a settled failure can be dismissed; in-flight and unknown outcomes keep their identity.
        expect(repository.dismissFailure('post-missing')).toBe(false);
        expect(repository.getSnapshot().mutations['post-transient']?.status).toBe('failed');
    });

    it('keeps an approval-pending post visible without claiming success', async () => {
        const post = vi.fn<SessionDiscussionRepositoryClient['post']>().mockResolvedValue({
            kind: 'approval_request_created', artifactId: 'approval-a', actionId: 'session.discussion.post',
        });
        const repository = createSessionDiscussionRepository({ address, client: client({ post }) });

        const outcome = await repository.post({ discussionId: 'discussion-a', localId: 'post-local-a', content: { v: 1, parts: [{ t: 'text', text: 'Needs approval' }] }, draftSubmission: draftSubmission('discussion') });

        expect(outcome).toEqual({ kind: 'approval_request_created', artifactId: 'approval-a' });
        expect(repository.getSnapshot().mutations['post-local-a']).toMatchObject({ status: 'approval_pending', artifactId: 'approval-a' });
    });

    it('retains remount-adoptable draft currentness until later canonical success is acknowledged', async () => {
        const submission = draftSubmission('discussion');
        const canonical = message(2, 'post-local-remount');
        const post = vi.fn<SessionDiscussionRepositoryClient['post']>().mockResolvedValue({
            kind: 'approval_request_created', artifactId: 'approval-remount', actionId: 'session.discussion.post',
        });
        const read = vi.fn<SessionDiscussionRepositoryClient['read']>().mockResolvedValue({
            kind: 'succeeded', value: readResult([canonical], false, 2),
        });
        const repository = createSessionDiscussionRepository({ address, client: client({ post, read }) });

        await repository.post({
            discussionId: 'discussion-a',
            localId: 'post-local-remount',
            content: { v: 1, parts: [{ t: 'text', text: 'Survive remount' }] },
            draftSubmission: submission,
        });
        const adopted = repository.getSnapshot().mutations['post-local-remount'];
        expect(adopted).toMatchObject({ status: 'approval_pending', draftSubmission: submission });

        await repository.refreshMessages('discussion-a');
        await vi.waitFor(() => expect(repository.getSnapshot().mutations['post-local-remount']?.status).toBe('observed_success'));
        expect(repository.getSnapshot().mutations['post-local-remount']?.draftSubmission).toBe(submission);
        repository.acknowledgeObservedSuccess('post-local-remount');
        expect(repository.getSnapshot().mutations['post-local-remount']).toBeUndefined();
        expect(post).toHaveBeenCalledOnce();
    });

    it('shares one qualified repository and one mounted watcher lifetime across list and detail consumers', () => {
        clearSessionDiscussionRepositoryRegistryForTests();
        const scope = { serverId: address.serverId, accountId: 'account-a' } as const;
        const repositoryClient = client();
        const first = getSessionDiscussionRepository({ scope, address, client: repositoryClient });
        const second = getSessionDiscussionRepository({ scope, address, client: repositoryClient });

        expect(second).toBe(first);
        const unmountList = first.mount();
        const unmountDetails = second.mount();
        unmountList();
        expect(first.isMounted()).toBe(true);
        unmountDetails();
        expect(first.isMounted()).toBe(false);
        clearSessionDiscussionRepositoryRegistryForTests();
    });

    it('refreshes the shared repository client when its exact-Home runtime is reconstructed', async () => {
        clearSessionDiscussionRepositoryRegistryForTests();
        const scope = { serverId: address.serverId, accountId: 'account-a' } as const;
        const staleList = vi.fn<SessionDiscussionRepositoryClient['list']>();
        const currentList = vi.fn<SessionDiscussionRepositoryClient['list']>()
            .mockResolvedValue({ kind: 'succeeded', value: listResult([summary('discussion-current', null, 1)], null) });
        const first = getSessionDiscussionRepository({ scope, address, client: client({ list: staleList }) });
        const second = getSessionDiscussionRepository({ scope, address, client: client({ list: currentList }) });

        await second.refreshList('active');

        expect(second).toBe(first);
        expect(staleList).not.toHaveBeenCalled();
        expect(currentList).toHaveBeenCalledOnce();
        expect(second.getSnapshot().lists.active.items[0]?.id).toBe('discussion-current');
        clearSessionDiscussionRepositoryRegistryForTests();
    });

    it('refreshes mounted canonical state for any exact-Session AccountChange while retaining the last page', async () => {
        const first = summary('discussion-a', null, 1);
        const refreshed = { ...first, messageSeq: 2, unreadCount: 2 };
        let resolveRefresh: (value: Awaited<ReturnType<SessionDiscussionRepositoryClient['list']>>) => void = () => {
            throw new Error('refresh resolver was not installed');
        };
        const list = vi.fn<SessionDiscussionRepositoryClient['list']>()
            .mockResolvedValueOnce({ kind: 'succeeded', value: listResult([first], null) })
            .mockImplementationOnce(() => new Promise((resolve) => { resolveRefresh = resolve; }));
        const repository = createSessionDiscussionRepository({ address, client: client({ list }) });
        await repository.refreshList('active');
        const unmount = repository.mount();

        publishMountedSessionDiscussionChanges({
            serverId: address.serverId,
            changes: [{ cursor: 1, kind: 'session', entityId: address.sessionId, changedAt: 1, hint: { unrelatedSessionProjection: true } }],
        });

        expect(repository.getSnapshot().lists.active).toMatchObject({
            items: [first],
            status: 'loading',
        });
        resolveRefresh({ kind: 'succeeded', value: listResult([refreshed], null) });
        await vi.waitFor(() => expect(repository.getSnapshot().lists.active.items[0]?.messageSeq).toBe(2));
        expect(list).toHaveBeenCalledTimes(2);
        unmount();
    });

    it('classifies read-cursor transport failures for state-change retry without treating them as success', async () => {
        const readState = vi.fn<SessionDiscussionRepositoryClient['readState']>()
            .mockResolvedValue({ kind: 'failed', errorCode: 'outcome_unknown' });
        const repository = createSessionDiscussionRepository({ address, client: client({ readState }) });

        await expect(repository.setReadState('discussion-a', 4)).resolves.toEqual({
            kind: 'retryable',
            errorCode: 'outcome_unknown',
        });
    });

    it('stops visible-read retries after canonical untracking without purging readable discussion content', async () => {
        const readState = vi.fn<SessionDiscussionRepositoryClient['readState']>()
            .mockResolvedValue({ kind: 'failed', errorCode: 'session_not_tracked' });
        const repository = createSessionDiscussionRepository({ address, client: client({ readState }) });

        await expect(repository.setReadState('discussion-a', 4)).resolves.toEqual({
            kind: 'stopped',
            errorCode: 'session_not_tracked',
        });
        expect(repository.getSnapshot().lists.active.status).toBe('idle');
    });

    it('retires retained repository state with its canonical Account lifetime', () => {
        clearSessionDiscussionRepositoryRegistryForTests();
        const scope = { serverId: address.serverId, accountId: 'account-a' } as const;
        const retireListeners = new Set<() => void>();
        const accountLifetime = {
            scope,
            isCurrent: () => true,
            onRetire(listener: () => void) {
                retireListeners.add(listener);
                return { dispose: () => retireListeners.delete(listener) };
            },
        } as const;
        const repositoryClient = client();
        const first = getSessionDiscussionRepository({ scope, address, client: repositoryClient, accountLifetime });

        for (const retire of [...retireListeners]) retire();
        const replacement = getSessionDiscussionRepository({ scope, address, client: repositoryClient });

        expect(replacement).not.toBe(first);
        clearSessionDiscussionRepositoryRegistryForTests();
    });
});
