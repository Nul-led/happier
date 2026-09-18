import { describe, expect, it } from 'vitest';
import type { SessionPersonalAttentionReasonV1 } from '@happier-dev/protocol';

import { createSessionFixture } from '@/dev/testkit/fixtures/sessionFixtures';
import { buildSessionActivityAttention } from '@/activity/attention/buildSessionActivityAttention';
import { buildActivityOverviewFromCandidates } from '@/activity/attention/buildActivityOverviewSnapshot';
import { sessionAddressKey } from '@/sync/domains/session/sessionAddress';

import { buildInboxSessionPresentation } from './buildInboxSessionPresentation';

function candidate(
    id: string,
    reasons: readonly SessionPersonalAttentionReasonV1[],
    serverId = 'server-a',
    sessionOverrides: Parameters<typeof createSessionFixture>[0] = {},
) {
    const session = createSessionFixture({
        id,
        serverId,
        ...sessionOverrides,
        viewer: {
            readState: { state: 'tracking', lastViewedSessionSeq: 1, unreadSince: null },
            relevance: { relevant: true, reasons: ['owned_by_me'] },
            follow: { follows: false, notificationLevel: null },
            notification: { level: 'important', source: 'owner' },
            attention: {
                needsAttention: reasons.length > 0,
                reasons,
                primary: reasons[0] ?? null,
                presentation: 'full',
            },
        },
    });
    return buildSessionActivityAttention({ session, nowMs: 1_000 });
}

describe('buildInboxSessionPresentation', () => {
    it('keeps every personal reason in its truthful section and only marks transcript progress as read', () => {
        const failed = candidate('failed', ['failed']);
        const permissionAndUnread = candidate('permission', ['permission_required', 'unread']);
        const discussion = candidate('discussion', ['unread_discussion']);
        const mentioned = candidate('mentioned', ['mentioned']);
        const unread = candidate('unread', ['unread']);
        const readyAfterRead = candidate('ready', ['ready_after_read']);
        const reminder = candidate('reminder', ['reminder_due']);
        const manual = candidate('manual', ['manual']);

        const presentation = buildInboxSessionPresentation({
            overview: buildActivityOverviewFromCandidates([
                failed,
                permissionAndUnread,
                discussion,
                mentioned,
                unread,
                readyAfterRead,
                reminder,
                manual,
            ]),
        });

        expect(presentation.sessionsNeedingAttention.map((entry) => entry.candidate.sessionId)).toEqual(expect.arrayContaining([
            'failed',
            'permission',
            'discussion',
            'mentioned',
            'reminder',
            'manual',
        ]));
        expect(presentation.sessionsNeedingAttention).toHaveLength(6);
        expect(presentation.readySessions.map((entry) => entry.sessionId)).toEqual(['ready']);
        // Discussion unread and mentions are Discussion-owned: a session-scoped
        // manual read does not clear them, so Inbox never offers them here.
        expect(presentation.markAllReadTargets.map((target) => target.sessionId).sort()).toEqual([
            'ready',
        ]);
        expect(presentation.markAllReadTargets.every((target) => target.readState === 'unread')).toBe(true);
    });

    it('addresses the same session id on two Homes as two distinct read targets', () => {
        const onHomeA = candidate('session-x', ['unread'], 'home-a');
        const onHomeB = candidate('session-x', ['unread'], 'home-b');

        const presentation = buildInboxSessionPresentation({
            overview: buildActivityOverviewFromCandidates([onHomeA, onHomeB]),
        });

        expect(presentation.readySessions).toHaveLength(0);
        expect(presentation.markAllReadTargets).toHaveLength(0);
    });

    it('lists an actionable session that is also unread once without inventing a read target', () => {
        const both = candidate('both', ['permission_required', 'unread'], 'server-a', {
            latestTurnStatus: 'completed',
            lastTurnCompletedAt: 900,
        });

        const presentation = buildInboxSessionPresentation({
            overview: buildActivityOverviewFromCandidates([both]),
        });

        expect(presentation.sessionsNeedingAttention.map((entry) => entry.candidate.sessionId)).toEqual(['both']);
        expect(presentation.readySessions).toHaveLength(0);
        expect(presentation.markAllReadTargets).toHaveLength(0);
    });

    it('defers read-only attention while the canonical runtime projection is working', () => {
        const workingUnread = candidate('working-unread', ['unread'], 'server-a', {
            active: true,
            presence: 'online',
            latestTurnStatus: 'in_progress',
        });

        const presentation = buildInboxSessionPresentation({
            overview: buildActivityOverviewFromCandidates([workingUnread]),
        });

        expect(workingUnread.awareness.operational.reasons).toContain('working');
        expect(presentation.readySessions).toHaveLength(0);
        expect(presentation.sessionsNeedingAttention).toHaveLength(0);
        expect(presentation.markAllReadTargets).toHaveLength(0);
    });

    it('presents a completed unseen turn as ready for review through the canonical operational state', () => {
        const completedUnread = candidate('completed-unread', ['unread'], 'server-a', {
            active: false,
            latestTurnStatus: 'completed',
            lastTurnCompletedAt: 900,
        });

        const presentation = buildInboxSessionPresentation({
            overview: buildActivityOverviewFromCandidates([completedUnread]),
        });

        expect(completedUnread.attentionState).toBe('ready');
        expect(presentation.readySessions.map((entry) => entry.sessionId)).toEqual(['completed-unread']);
        expect(presentation.markAllReadTargets.map((target) => target.sessionId)).toEqual(['completed-unread']);
    });

    it('defers a ready unread turn while canonical background activity is still running', () => {
        const backgroundActiveUnread = candidate('background-active-unread', ['unread'], 'server-a', {
            encryptionMode: 'plain',
            active: true,
            latestTurnStatus: 'completed',
            lastTurnCompletedAt: 900,
            activeAt: 950,
            runtimeActivityState: 'active',
            runtimeActivityActiveCount: 1,
            runtimeActivityObservedAt: 950,
            runtimeActivityRevision: 1,
            metadata: {
                path: '/Users/tester/project',
                homeDir: '/Users/tester',
                host: 'tester.local',
                machineId: 'machine-1',
                runtimeMode: 'background',
            },
        });

        const presentation = buildInboxSessionPresentation({
            overview: buildActivityOverviewFromCandidates([backgroundActiveUnread]),
        });

        expect(backgroundActiveUnread.awareness.operational.reasons).toContain('background_activity');
        expect(presentation.readySessions).toHaveLength(0);
        expect(presentation.markAllReadTargets).toHaveLength(0);
    });

    it('keeps concurrent actionable attention while deferring a working session read target', () => {
        const workingPermission = candidate(
            'working-permission',
            ['permission_required', 'unread'],
            'server-a',
            {
                active: true,
                presence: 'online',
                latestTurnStatus: 'in_progress',
            },
        );

        const presentation = buildInboxSessionPresentation({
            overview: buildActivityOverviewFromCandidates([workingPermission]),
        });

        expect(presentation.sessionsNeedingAttention.map((entry) => entry.candidate.sessionId))
            .toEqual(['working-permission']);
        expect(presentation.readySessions).toHaveLength(0);
        expect(presentation.markAllReadTargets).toHaveLength(0);
    });
});
