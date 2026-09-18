import { describe, expect, it } from 'vitest';

import {
    resolveNextSessionAttentionReminderWakeAtMs,
    resolveSessionAttentionIntent,
    resolveSessionReminderPresentation,
} from './attentionStanding';

describe('session attention reminder precedence', () => {
    it('projects a reminder independently from the durable standing value', () => {
        const record = { standing: false, remindAt: 2_000, updatedAt: 1 } as const;

        expect(resolveSessionAttentionIntent(record, 1_999)).toBe('scheduled');
        expect(resolveSessionAttentionIntent(record, 2_000)).toBe('due');
        expect(resolveSessionReminderPresentation(record, 1_999)).toEqual({ state: 'scheduled', remindAt: 2_000 });
    });

    it('finds the earliest future deadline across visible and offscreen sessions', () => {
        expect(resolveNextSessionAttentionReminderWakeAtMs({
            defaultStanding: false,
            overridesBySessionKey: {
                offscreen: { standing: false, remindAt: 2_000, updatedAt: 1 },
                later: { standing: true, remindAt: 4_000, updatedAt: 1 },
                due: { standing: false, remindAt: 900, updatedAt: 1 },
            },
        }, 1_000)).toBe(2_000);
    });
});
