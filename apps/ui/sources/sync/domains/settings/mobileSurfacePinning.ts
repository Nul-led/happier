/**
 * The person's Session bar: which tools sit on it, in order. `null` means they have not
 * changed it, so the host's defaults apply. There is no count cap — the bar's width decides
 * what fits, and what does not fit either scrolls or waits in More (the catalog owner decides).
 */

function normalizeSurfaceId(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const normalized = value.trim();
    return normalized.length > 0 ? normalized : null;
}

/**
 * Pin or unpin one tool. The first change starts from the host defaults so pinning one more
 * tool never empties the bar. Unavailable plugin ids stay durable, so a reinstated plugin
 * comes back where the person put it; callers decide what is admitted right now.
 */
export function toggleSessionCockpitBarSurface(
    barSurfaceIds: readonly string[] | null | undefined,
    surfaceId: string,
    defaultSurfaceIds: readonly string[],
): readonly string[] {
    const seen = new Set<string>();
    const current = (barSurfaceIds ?? defaultSurfaceIds).flatMap((candidate) => {
        const normalized = normalizeSurfaceId(candidate);
        if (!normalized || seen.has(normalized)) return [];
        seen.add(normalized);
        return [normalized];
    });
    const normalizedSurfaceId = normalizeSurfaceId(surfaceId);
    if (!normalizedSurfaceId) return Object.freeze(current);
    return Object.freeze(seen.has(normalizedSurfaceId)
        ? current.filter((candidate) => candidate !== normalizedSurfaceId)
        : [...current, normalizedSurfaceId]);
}
