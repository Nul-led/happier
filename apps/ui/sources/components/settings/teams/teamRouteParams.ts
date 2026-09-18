/**
 * Expo Router hands a repeated segment back as an array. Team routes read one
 * exact Home, Team and membership, so the first value is the address and the
 * rest are discarded rather than being joined into an identifier that addresses
 * nothing.
 */
export function firstRouteParam(value: string | string[] | undefined): string {
    return Array.isArray(value) ? value[0] ?? '' : value ?? '';
}
