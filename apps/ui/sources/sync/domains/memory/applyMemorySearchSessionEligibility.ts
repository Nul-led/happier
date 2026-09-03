import type { MemorySearchResultV1 } from '@happier-dev/protocol';

export function normalizeMemorySearchSessionId(value: string): string {
    return value.trim();
}

/**
 * Compatibility ingress for contextual memory queries. Current providers
 * filter before limiting; a released tolerant provider may ignore the
 * additive request field, so the caller also removes ineligible rows rather
 * than presenting a result from outside its explicit session scope.
 */
export function applyMemorySearchSessionEligibility(
    result: MemorySearchResultV1,
    eligibleSessionIds: readonly string[] | undefined,
): MemorySearchResultV1 {
    if (!result.ok) return result;
    const eligible = eligibleSessionIds === undefined
        ? null
        : new Set(eligibleSessionIds.map(normalizeMemorySearchSessionId).filter(Boolean));
    let changed = false;
    const hits = result.hits.flatMap((hit) => {
        const sessionId = normalizeMemorySearchSessionId(hit.sessionId);
        if (!sessionId || (eligible && !eligible.has(sessionId))) {
            changed = true;
            return [];
        }
        if (sessionId === hit.sessionId) return [hit];
        changed = true;
        return [{ ...hit, sessionId }];
    });
    return changed ? { ...result, hits } : result;
}
