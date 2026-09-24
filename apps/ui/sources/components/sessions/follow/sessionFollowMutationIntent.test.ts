import { describe, expect, it } from 'vitest';

import {
    createIdleSessionFollowMutationIntent,
    reduceSessionFollowMutationIntent,
} from './sessionFollowMutationIntent';

type Intent = Readonly<{ field: string; value: boolean }>;

const idle = createIdleSessionFollowMutationIntent<Intent>();
const intent: Intent = { field: 'group', value: true };

describe('reduceSessionFollowMutationIntent', () => {
    it('keeps a failed intent, its error and its retry across a passive refresh', () => {
        const started = reduceSessionFollowMutationIntent(idle, { kind: 'started', intent });
        const failed = reduceSessionFollowMutationIntent(started, { kind: 'failed', error: true });
        expect(failed).toEqual({ pending: null, failed: intent, error: true });

        const refreshed = reduceSessionFollowMutationIntent(failed, { kind: 'refreshed' });
        expect(refreshed.failed).toEqual(intent);
        expect(refreshed.error).toBe(true);

        const retried = reduceSessionFollowMutationIntent(refreshed, { kind: 'started', intent });
        expect(reduceSessionFollowMutationIntent(retried, { kind: 'succeeded' })).toEqual(idle);
    });

    it('clears a stale load error on refresh when no mutation intent is outstanding', () => {
        const loadFailed = reduceSessionFollowMutationIntent(idle, { kind: 'failed', error: true });
        expect(loadFailed).toEqual({ pending: null, failed: null, error: true });
        expect(reduceSessionFollowMutationIntent(loadFailed, { kind: 'refreshed' })).toEqual(idle);
    });

    it('retains the failed intent when a later refresh also fails', () => {
        const started = reduceSessionFollowMutationIntent(idle, { kind: 'started', intent });
        const failed = reduceSessionFollowMutationIntent(started, { kind: 'failed', error: true });
        const refreshFailed = reduceSessionFollowMutationIntent(failed, { kind: 'failed', error: true });
        expect(refreshFailed.failed).toEqual(intent);
    });

    it('drops the intent only when it is explicitly abandoned', () => {
        const started = reduceSessionFollowMutationIntent(idle, { kind: 'started', intent });
        const failed = reduceSessionFollowMutationIntent(started, { kind: 'failed', error: true });
        expect(reduceSessionFollowMutationIntent(failed, { kind: 'abandoned' })).toEqual(idle);
    });

    it('does not allocate a new state for a refresh with nothing outstanding', () => {
        expect(reduceSessionFollowMutationIntent(idle, { kind: 'refreshed' })).toBe(idle);
    });
});
