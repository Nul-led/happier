import { describe, expect, it } from 'vitest';

import { buildVirtualizedSegments } from './directorySourceDetailVirtualization';

describe('buildVirtualizedSegments', () => {
    it('keeps every large-list row while splitting it into independently mountable segments', () => {
        const rows = Array.from({ length: 100 }, (_, index) => `row-${index}`);

        const segments = buildVirtualizedSegments(rows, 12);

        expect(segments).toHaveLength(9);
        expect(segments.flatMap((segment) => segment.items)).toEqual(rows);
        expect(segments[0]).toMatchObject({ first: true, last: false });
        expect((segments.at(-1))).toMatchObject({ first: false, last: true });
    });

    it('does not manufacture an empty segment', () => {
        expect(buildVirtualizedSegments([], 12)).toEqual([]);
    });
});
