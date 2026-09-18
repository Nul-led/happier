import { describe, expect, it } from 'vitest';

import { computePoolMembershipDiff } from './poolMembershipDiff';

describe('computePoolMembershipDiff', () => {
    it('returns the additions and removals required to reach the target membership', () => {
        expect(computePoolMembershipDiff(['work', 'backup'], ['work', 'extra'])).toEqual({
            toAdd: ['extra'],
            toRemove: ['backup'],
        });
    });

    it('does not treat ordering changes as membership changes', () => {
        expect(computePoolMembershipDiff(['work', 'backup'], ['backup', 'work'])).toEqual({
            toAdd: [],
            toRemove: [],
        });
    });

    it('deduplicates ids before diffing', () => {
        expect(computePoolMembershipDiff(['work', 'work'], ['work', 'extra', 'extra'])).toEqual({
            toAdd: ['extra'],
            toRemove: [],
        });
    });

    it('supports removing every member', () => {
        expect(computePoolMembershipDiff(['work', 'backup'], [])).toEqual({
            toAdd: [],
            toRemove: ['work', 'backup'],
        });
    });
});
