import { describe, expect, it } from 'vitest';

import { resolveSessionAttentionStandingProjectionFacts } from './projection';

describe('Session personal attention standing projection', () => {
    it('projects a reminder independently from the durable standing value', () => {
        expect(resolveSessionAttentionStandingProjectionFacts(
            { standing: false, remindAt: new Date(2_000) },
            1_000,
        )).toEqual({
            attentionStanding: 'none',
            explicitAttention: true,
            reminderDue: false,
        });
        expect(resolveSessionAttentionStandingProjectionFacts(
            { standing: false, remindAt: new Date(2_000) },
            2_000,
        )).toEqual({
            attentionStanding: 'none',
            explicitAttention: true,
            reminderDue: true,
        });
    });
});
