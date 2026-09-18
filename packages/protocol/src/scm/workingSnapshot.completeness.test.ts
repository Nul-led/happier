import { describe, it, expect } from 'vitest';
import { ScmPathStatsSchema } from './workingSnapshot.js';

describe('SCM statistics completeness', () => {
    it('preserves explicit incompleteness while accepting predecessor statistics', () => {
        const legacy = { includedAdded: 0, includedRemoved: 0, pendingAdded: 0, pendingRemoved: 0, isBinary: false };
        expect(ScmPathStatsSchema.parse(legacy)).toEqual(legacy);
        expect(ScmPathStatsSchema.parse({ ...legacy, isComplete: false })).toEqual({ ...legacy, isComplete: false });
    });
});
