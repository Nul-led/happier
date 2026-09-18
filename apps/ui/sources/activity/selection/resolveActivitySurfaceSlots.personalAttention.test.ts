import { describe, expect, it } from 'vitest';
import { createSessionFixture } from '@/dev/testkit/fixtures/sessionFixtures';
import { buildSessionActivityAttention } from '@/activity/attention/buildSessionActivityAttention';
import type { SessionActivityAttention } from '@/activity/attention/activityAttentionTypes';
import { resolveActivitySurfacePolicy } from '@/activity/attention/resolveActivitySurfacePolicy';
import { createLiveActivitySelectionSpec } from './activitySurfaceSelectionTypes';
import { resolveActivitySurfaceSlots } from './resolveActivitySurfaceSlots';

describe('personal Activity selection', () => {
    it('includes personally eligible failure and ready signals without admitting operational-only urgency', () => {
        const candidate: SessionActivityAttention = {
            ...buildSessionActivityAttention({ session: createSessionFixture(), nowMs: 1_000 }),
            sessionId: 'base',
        };
        const base = { counts: { unread: 0, permissionRequired: 0, actionRequired: 0, thinking: 0, totalAttention: 0 } };
        const overview = { ...base, candidates: [
            { ...candidate, sessionId: 'failed', attentionState: 'failed' as const, hasAttention: true },
            { ...candidate, sessionId: 'ready', attentionState: 'ready' as const, hasAttention: true },
            { ...candidate, sessionId: 'untracked', attentionState: 'permission_required' as const, hasAttention: false },
        ] };
        const slots = resolveActivitySurfaceSlots({
            overview,
            selection: { ...createLiveActivitySelectionSpec(resolveActivitySurfacePolicy({ liveActivitiesMode: 'focused' })),
                mode: 'attention', activeOnly: false, includeReady: true, includeUrgent: true },
            applyCap: false,
        });
        expect(slots.eligibleSessions.map((entry) => entry.sessionId)).toEqual(['failed', 'ready']);
    });

});
