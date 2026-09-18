export type VirtualizedSegment<T> = Readonly<{
    items: readonly T[];
    first: boolean;
    last: boolean;
}>;

/**
 * Break one logical ItemGroup into independently mountable list rows without
 * truncating the server-owned sequence. The segment size is a render batching
 * detail, not a product/data limit.
 */
export function buildVirtualizedSegments<T>(
    rows: readonly T[],
    segmentSize: number,
): readonly VirtualizedSegment<T>[] {
    if (!Number.isInteger(segmentSize) || segmentSize < 1) {
        throw new Error('segmentSize must be a positive integer');
    }
    const segments: VirtualizedSegment<T>[] = [];
    for (let offset = 0; offset < rows.length; offset += segmentSize) {
        segments.push(Object.freeze({
            items: rows.slice(offset, offset + segmentSize),
            first: offset === 0,
            last: offset + segmentSize >= rows.length,
        }));
    }
    return Object.freeze(segments);
}
