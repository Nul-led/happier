import { describe, expect, it } from 'vitest';

import { segmentHomeAdministrationRows } from './homeAdministrationVirtualizedSegments';

describe('segmentHomeAdministrationRows', () => {
    it.each([
        { size: 10_000, expectedSegments: 834 },
        { size: 1_000, expectedSegments: 84 },
    ])('keeps a $size-row administration collection as bounded lazy segments', ({ size, expectedSegments }) => {
        const source = Array.from({ length: size }, (_, index) => index);
        const segments = segmentHomeAdministrationRows(source, 12);

        expect(segments).toHaveLength(expectedSegments);
        expect(segments[0]).toEqual({ items: source.slice(0, 12), first: true, last: false });
        expect(segments.at(-1)?.last).toBe(true);
        expect(segments.every((segment) => segment.items.length <= 12)).toBe(true);
        expect(segments.flatMap((segment) => segment.items)).toEqual(source);
    });
});
