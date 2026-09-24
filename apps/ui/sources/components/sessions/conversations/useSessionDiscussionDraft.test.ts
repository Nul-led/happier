import { afterEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react-test-renderer';

import { renderHook } from '@/dev/testkit';
import {
    getSessionDraftSnapshot,
    resetSessionDraftRepositoryForTests,
    writeDiscussionSessionDraft,
} from '@/sync/ops/sessionDrafts/sessionDraftRepository';
import type { SessionDiscussionDraftSubmission } from '@/sync/ops/sessionDiscussions/sessionDiscussionRepository';

import { useSessionDiscussionDraft } from './useSessionDiscussionDraft';

const scope = { serverId: 'discussion-draft-home', accountId: 'discussion-draft-account' } as const;
const newAddress = { kind: 'newDiscussion', sessionId: 'discussion-draft-session' } as const;
const existingAddress = {
    kind: 'discussion',
    sessionId: 'discussion-draft-session',
    discussionId: 'discussion-draft-existing',
} as const;

afterEach(() => {
    resetSessionDraftRepositoryForTests();
});

describe('useSessionDiscussionDraft', () => {
    it('projects one exact synchronized V2 draft and updates it through the repository owner', async () => {
        writeDiscussionSessionDraft({
            scope,
            address: newAddress,
            patch: {
                title: 'Release review',
                text: 'Ask @Alex',
                mentions: [
                    { start: 4, end: 9, accountId: 'account-alex' },
                    { start: 40, end: 50, accountId: 'forged-outside' },
                ],
            },
        });

        const rendered = await renderHook(() => useSessionDiscussionDraft({ scope, address: newAddress }));
        expect(rendered.getCurrent()).toMatchObject({
            title: 'Release review',
            text: 'Ask @Alex',
            mentions: [{ start: 4, end: 9, accountId: 'account-alex' }],
            status: 'clean',
            conflict: null,
        });

        const draftBeforeWrite = rendered.getCurrent();
        act(() => {
            draftBeforeWrite.setComposer({
                text: 'Ask @Alex and @Bob',
                mentions: [
                    { start: 4, end: 9, accountId: 'account-alex' },
                    { start: 14, end: 18, accountId: 'account-bob' },
                ],
            });
        });
        expect(draftBeforeWrite.captureSubmittedCurrentness()).toMatchObject({
            scope,
            address: newAddress,
            currentness: { address: newAddress },
        });
        await vi.waitFor(() => expect(rendered.getCurrent().text).toBe('Ask @Alex and @Bob'));
        expect(rendered.getCurrent().mentions).toHaveLength(2);

        act(() => rendered.getCurrent().setText('Ask @Bert and @Bob'));
        await vi.waitFor(() => expect(rendered.getCurrent().text).toBe('Ask @Bert and @Bob'));
        expect(rendered.getCurrent().mentions).toEqual([
            { start: 14, end: 18, accountId: 'account-bob' },
        ]);
        await rendered.unmount();
    });

    it('clears only the captured post fields after observed success and preserves a newer concurrent edit', async () => {
        writeDiscussionSessionDraft({
            scope,
            address: existingAddress,
            patch: {
                text: 'Captured @Alex',
                mentions: [{ start: 9, end: 14, accountId: 'account-alex' }],
            },
        });
        const rendered = await renderHook(() => useSessionDiscussionDraft({ scope, address: existingAddress }));
        const submitted = rendered.getCurrent().captureSubmittedCurrentness();

        act(() => {
            rendered.getCurrent().setComposer({
                text: 'Newer @Alex edit',
                mentions: [{ start: 6, end: 11, accountId: 'account-alex' }],
            });
        });
        await act(async () => {
            await rendered.getCurrent().clearAfterObservedSuccess(submitted);
        });

        expect(getSessionDraftSnapshot(scope, existingAddress)?.document.composer).toMatchObject({
            text: { value: 'Newer @Alex edit' },
            mentions: { value: [{ start: 6, end: 11, accountId: 'account-alex' }] },
        });
        await rendered.unmount();
    });

    it('restores and clears the same crash-stable post retry identity through the draft supplement', async () => {
        writeDiscussionSessionDraft({
            scope,
            address: existingAddress,
            patch: { text: 'Retry me', mentions: [] },
        });
        const first = await renderHook(() => useSessionDiscussionDraft({ scope, address: existingAddress }));
        let submitted: SessionDiscussionDraftSubmission | null = null;
        act(() => {
            submitted = first.getCurrent().captureSubmittedCurrentness({
                kind: 'post',
                discussionId: existingAddress.discussionId,
                localId: 'post-local-stable',
            });
        });
        await first.unmount();

        const restored = await renderHook(() => useSessionDiscussionDraft({ scope, address: existingAddress }));
        expect(restored.getCurrent().pendingMutationAttempt).toMatchObject({
            kind: 'post',
            discussionId: existingAddress.discussionId,
            localId: 'post-local-stable',
            currentness: submitted!.currentness,
        });
        await act(async () => {
            await restored.getCurrent().clearAfterObservedSuccess(submitted!);
        });
        expect(restored.getCurrent().pendingMutationAttempt).toBeNull();
        await restored.unmount();
    });

    it('releases a refused retry identity while keeping the drafted text for a fresh attempt', async () => {
        writeDiscussionSessionDraft({
            scope,
            address: existingAddress,
            patch: { text: 'Refused once', mentions: [] },
        });
        const hook = await renderHook(() => useSessionDiscussionDraft({ scope, address: existingAddress }));
        act(() => {
            hook.getCurrent().captureSubmittedCurrentness({
                kind: 'post',
                discussionId: existingAddress.discussionId,
                localId: 'post-local-refused',
            });
        });
        expect(hook.getCurrent().pendingMutationAttempt).not.toBeNull();

        act(() => {
            hook.getCurrent().releaseSubmittedAttempt();
        });

        expect(hook.getCurrent().pendingMutationAttempt).toBeNull();
        expect(hook.getCurrent().text).toBe('Refused once');
        await hook.unmount();
    });

    it('preserves a newer mention-only edit when accepted text is unchanged', async () => {
        writeDiscussionSessionDraft({
            scope,
            address: existingAddress,
            patch: { text: 'Captured @Alex', mentions: [] },
        });
        const rendered = await renderHook(() => useSessionDiscussionDraft({ scope, address: existingAddress }));
        const submitted = rendered.getCurrent().captureSubmittedCurrentness();

        act(() => {
            rendered.getCurrent().setMentions([{ start: 9, end: 14, accountId: 'account-alex' }]);
        });
        await act(async () => {
            await rendered.getCurrent().clearAfterObservedSuccess(submitted);
        });

        expect(getSessionDraftSnapshot(scope, existingAddress)?.document.composer).toMatchObject({
            text: { value: 'Captured @Alex' },
            mentions: { value: [{ start: 9, end: 14, accountId: 'account-alex' }] },
        });
        await rendered.unmount();
    });

    it('preserves a newer text-only edit when accepted mentions are unchanged', async () => {
        writeDiscussionSessionDraft({
            scope,
            address: existingAddress,
            patch: { text: 'Captured text', mentions: [] },
        });
        const rendered = await renderHook(() => useSessionDiscussionDraft({ scope, address: existingAddress }));
        const submitted = rendered.getCurrent().captureSubmittedCurrentness();

        act(() => {
            writeDiscussionSessionDraft({ scope, address: existingAddress, patch: { text: 'Newer text' } });
        });
        await act(async () => {
            await rendered.getCurrent().clearAfterObservedSuccess(submitted);
        });

        expect(getSessionDraftSnapshot(scope, existingAddress)?.document.composer).toMatchObject({
            text: { value: 'Newer text' },
            mentions: { value: [] },
        });
        await rendered.unmount();
    });

    it('preserves a newer grouped composer edit and a newer title', async () => {
        writeDiscussionSessionDraft({
            scope,
            address: newAddress,
            patch: { title: 'Accepted title', text: 'Captured @Alex', mentions: [] },
        });
        const rendered = await renderHook(() => useSessionDiscussionDraft({ scope, address: newAddress }));
        const submitted = rendered.getCurrent().captureSubmittedCurrentness();

        act(() => {
            rendered.getCurrent().setTitle('Newer title');
            rendered.getCurrent().setMentions([{ start: 9, end: 14, accountId: 'account-alex' }]);
        });
        await act(async () => {
            await rendered.getCurrent().clearAfterObservedSuccess(submitted);
        });

        expect(getSessionDraftSnapshot(scope, newAddress)?.document).toMatchObject({
            title: { value: 'Newer title' },
            composer: {
                text: { value: 'Captured @Alex' },
                mentions: { value: [{ start: 9, end: 14, accountId: 'account-alex' }] },
            },
        });
        await rendered.unmount();
    });

    it('clears captured create fields together and lets the repository contract the empty draft', async () => {
        writeDiscussionSessionDraft({
            scope,
            address: newAddress,
            patch: {
                title: 'Captured title',
                text: 'Captured text',
                mentions: [],
            },
        });
        const rendered = await renderHook(() => useSessionDiscussionDraft({ scope, address: newAddress }));
        const submitted = rendered.getCurrent().captureSubmittedCurrentness();
        let cleared = false;
        await act(async () => {
            cleared = await rendered.getCurrent().clearAfterObservedSuccess(submitted);
        });
        expect(cleared).toBe(true);

        expect(getSessionDraftSnapshot(scope, newAddress)).toBeNull();
        await rendered.unmount();
    });

    it.each([
        ['create', newAddress] as const,
        ['post', existingAddress] as const,
    ])('retires the %s mutation attempt after observed success even when every captured field moved on', async (kind, address) => {
        writeDiscussionSessionDraft({
            scope,
            address,
            patch: { ...(kind === 'create' ? { title: 'Captured title' } : {}), text: 'Captured text', mentions: [] },
        });
        const rendered = await renderHook(() => useSessionDiscussionDraft({ scope, address }));
        let submitted: SessionDiscussionDraftSubmission | null = null;
        act(() => {
            submitted = rendered.getCurrent().captureSubmittedCurrentness(
                kind === 'create'
                    ? { kind: 'create', creationLocalId: 'create-local-stable', messageLocalId: 'create-message-stable' }
                    : { kind: 'post', discussionId: existingAddress.discussionId, localId: 'post-local-stable' },
            );
        });
        expect(rendered.getCurrent().pendingMutationAttempt).not.toBeNull();

        // Every captured field moves on while the mutation is in flight.
        act(() => {
            if (kind === 'create') rendered.getCurrent().setTitle('Newer title');
            rendered.getCurrent().setComposer({
                text: 'Newer @Alex text',
                mentions: [{ start: 6, end: 11, accountId: 'account-alex' }],
            });
        });
        await act(async () => {
            await rendered.getCurrent().clearAfterObservedSuccess(submitted!);
        });

        expect(rendered.getCurrent().pendingMutationAttempt).toBeNull();
        await rendered.unmount();

        const remounted = await renderHook(() => useSessionDiscussionDraft({ scope, address }));
        expect(remounted.getCurrent().pendingMutationAttempt).toBeNull();
        expect(remounted.getCurrent().text).toBe('Newer @Alex text');
        expect(remounted.getCurrent().mentions).toEqual([{ start: 6, end: 11, accountId: 'account-alex' }]);
        if (kind === 'create') expect(remounted.getCurrent().title).toBe('Newer title');
        await remounted.unmount();
    });

    it('purges the local decrypted presentation when access is explicitly lost', async () => {
        writeDiscussionSessionDraft({
            scope,
            address: existingAddress,
            patch: { text: 'Private local draft', mentions: [] },
        });
        const rendered = await renderHook(() => useSessionDiscussionDraft({ scope, address: existingAddress }));

        await act(async () => {
            await rendered.getCurrent().purgePresentation();
        });

        expect(getSessionDraftSnapshot(scope, existingAddress)).toBeNull();
        await rendered.unmount();
    });
});
