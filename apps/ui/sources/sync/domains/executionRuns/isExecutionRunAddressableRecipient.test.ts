import { describe, expect, it } from 'vitest';

import { isExecutionRunAddressableRecipient } from './isExecutionRunAddressableRecipient';

describe('isExecutionRunAddressableRecipient', () => {
    it('returns true for running bounded backend runs', () => {
        expect(isExecutionRunAddressableRecipient({
            status: 'running',
            intent: 'review',
            runClass: 'bounded',
        })).toBe(true);
    });

    it('returns false for bounded runs that are no longer in flight', () => {
        expect(isExecutionRunAddressableRecipient({
            status: 'running',
            intent: 'review',
            runClass: 'bounded',
            turnInFlight: false,
        })).toBe(false);
    });

    it('returns true for running execution runs when runClass is missing for transcript backward compatibility', () => {
        expect(isExecutionRunAddressableRecipient({
            status: 'running',
            intent: 'review',
        })).toBe(true);
    });

    it('returns true for running long-lived backend runs', () => {
        expect(isExecutionRunAddressableRecipient({
            status: 'running',
            intent: 'delegate',
            runClass: 'long_lived',
        })).toBe(true);
    });

    it('returns false for running voice-agent runs', () => {
        expect(isExecutionRunAddressableRecipient({
            status: 'running',
            intent: 'voice_agent',
            runClass: 'long_lived',
        })).toBe(false);
    });

    it('returns false when the run is no longer running', () => {
        expect(isExecutionRunAddressableRecipient({
            status: 'succeeded',
            intent: 'review',
            runClass: 'bounded',
        })).toBe(false);
    });
});
