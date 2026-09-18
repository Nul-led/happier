import { afterEach, describe, expect, it, vi } from 'vitest';

import { publishMountedSessionDiscussionChanges, watchMountedSessionDiscussions } from './sessionDiscussionChangeWatch';

afterEach(() => {
    vi.clearAllMocks();
});

describe('mounted Session Discussion AccountChange watch', () => {
    it('wakes only the exact Home-qualified Session and treats every Session change as advisory invalidation', async () => {
        const onFirstInvalidated = vi.fn();
        const onSecondHomeInvalidated = vi.fn();
        const onSecondSessionInvalidated = vi.fn();

        const first = watchMountedSessionDiscussions({
            address: { serverId: 'server-a', sessionId: 'same-session' },
            onInvalidated: onFirstInvalidated,
        });
        const secondHome = watchMountedSessionDiscussions({
            address: { serverId: 'server-b', sessionId: 'same-session' },
            onInvalidated: onSecondHomeInvalidated,
        });
        const secondSession = watchMountedSessionDiscussions({
            address: { serverId: 'server-a', sessionId: 'other-session' },
            onInvalidated: onSecondSessionInvalidated,
        });

        publishMountedSessionDiscussionChanges({
            serverId: 'server-a',
            changes: [{
                cursor: 1,
                kind: 'session',
                entityId: 'same-session',
                changedAt: 1,
                hint: { unrelatedSessionProjection: true },
            }],
        });

        expect(onFirstInvalidated).toHaveBeenCalledOnce();
        expect(onSecondHomeInvalidated).not.toHaveBeenCalled();
        expect(onSecondSessionInvalidated).not.toHaveBeenCalled();

        publishMountedSessionDiscussionChanges({
            serverId: 'server-a',
            changes: [{
                cursor: 2,
                kind: 'session',
                entityId: 'same-session',
                changedAt: 2,
                hint: { v: 1, sessionDiscussions: true },
            }],
        });
        expect(onFirstInvalidated).toHaveBeenCalledTimes(2);

        first.dispose();
        secondHome.dispose();
        secondSession.dispose();
        publishMountedSessionDiscussionChanges({
            serverId: 'server-a',
            changes: [{ cursor: 3, kind: 'session', entityId: 'same-session', changedAt: 3 }],
        });
        expect(onFirstInvalidated).toHaveBeenCalledTimes(2);
    });

    it('ignores other change kinds even when their entity id matches the Session', async () => {
        const onInvalidated = vi.fn();
        const watch = watchMountedSessionDiscussions({
            address: { serverId: 'server-a', sessionId: 'same-session' },
            onInvalidated,
        });

        publishMountedSessionDiscussionChanges({
            serverId: 'server-a',
            changes: [
                { cursor: 1, kind: 'share', entityId: 'same-session', changedAt: 1 },
                { cursor: 2, kind: 'account', entityId: 'same-session', changedAt: 2 },
            ],
        });

        expect(onInvalidated).not.toHaveBeenCalled();
        watch.dispose();
    });
});
