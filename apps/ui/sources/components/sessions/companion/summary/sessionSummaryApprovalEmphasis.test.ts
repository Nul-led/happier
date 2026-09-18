import { describe, expect, it } from 'vitest';

import { motionTokens } from '@/components/ui/motion/motionTokens';

import {
    resolveSessionSummaryApprovalEmphasisMotion,
    shouldEmphasizeNewSessionSummaryApproval,
} from './sessionSummaryApprovalEmphasis';

describe('shouldEmphasizeNewSessionSummaryApproval', () => {
    it.each([
        { previous: null, current: 1, expected: false, name: 'does not animate initial content' },
        { previous: 0, current: 1, expected: true, name: 'emphasizes a newly opened approval' },
        { previous: 1, current: 2, expected: true, name: 'emphasizes an additional approval' },
        { previous: 2, current: 2, expected: false, name: 'does not repeat for stable state' },
        { previous: 2, current: 1, expected: false, name: 'does not emphasize approval completion' },
    ])('$name', ({ previous, current, expected }) => {
        expect(shouldEmphasizeNewSessionSummaryApproval(previous, current)).toBe(expected);
    });
});

describe('resolveSessionSummaryApprovalEmphasisMotion', () => {
    it('uses the shared motion duration for the one-time emphasis', () => {
        expect(resolveSessionSummaryApprovalEmphasisMotion(false)).toEqual({
            initialOpacity: 0.72,
            durationMs: motionTokens.durationMs.base,
        });
    });

    it('suppresses emphasis entirely when reduced motion is requested', () => {
        expect(resolveSessionSummaryApprovalEmphasisMotion(true)).toEqual({
            initialOpacity: 1,
            durationMs: 0,
        });
    });
});
