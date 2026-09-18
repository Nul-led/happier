export type HomeAdministrationVirtualizedSegment<T> = Readonly<{
    items: readonly T[];
    first: boolean;
    last: boolean;
}>;

/**
 * Keeps large Home-administration collections as cheap data descriptors.
 * ItemGroup owns the visual joining between these independently mounted
 * segments; the canonical VirtualizedList owns which segment is mounted.
 */
export function segmentHomeAdministrationRows<T>(
    rows: readonly T[],
    segmentSize: number,
): readonly HomeAdministrationVirtualizedSegment<T>[] {
    if (!Number.isInteger(segmentSize) || segmentSize <= 0) {
        throw new Error('Home Administration virtualized segment size must be a positive integer');
    }
    const segments: HomeAdministrationVirtualizedSegment<T>[] = [];
    for (let offset = 0; offset < rows.length; offset += segmentSize) {
        segments.push({
            items: rows.slice(offset, offset + segmentSize),
            first: offset === 0,
            last: offset + segmentSize >= rows.length,
        });
    }
    return segments;
}
