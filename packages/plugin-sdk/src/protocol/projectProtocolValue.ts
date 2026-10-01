/**
 * The private declaration-projection seam. Runtime values and validation stay
 * Protocol-owned; the SDK consumes its portable public types independently of
 * generated DTO freshness. The explicit correspondence/drift gate checks those
 * projections, rather than making every SDK build depend on regeneration.
 */
export function projectProtocolValue<TProjection>(value: unknown): TProjection {
    return value as TProjection;
}
