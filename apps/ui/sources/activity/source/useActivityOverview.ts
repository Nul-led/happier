import * as React from 'react';

import type { ActivityOverviewSnapshot } from '@/activity/attention/activityAttentionTypes';
import { readSessionPersonalAttentionExpirationsForViewer } from '@/sync/domains/session/readState/sessionViewerAttention';

import type { ActivityAttentionSource } from './activityAttentionSourceTypes';
import {
    buildActivityOverviewFromSource,
    readActivitySourceAttentionMessages,
} from './buildActivityOverviewFromSource';
import { useActivityAttentionSource } from './useActivityAttentionSource';

export type MountedActivityOverview = Readonly<{
    source: ActivityAttentionSource;
    overview: ActivityOverviewSnapshot;
}>;

/**
 * The soonest instant at which this projection stops being true on its own.
 *
 * Only pre-viewer candidates have one; the attention owner decides which, and
 * returns nothing for the rest. Each candidate is asked with the same stored
 * messages the overview decided it with, because a message-backed pending
 * request is what carries the expiring `user_action_required` in the first
 * place.
 */
function readNextAttentionBoundaryMs(
    source: ActivityAttentionSource,
    overview: ActivityOverviewSnapshot,
    nowMs: number,
): number | null {
    let nextMs: number | null = null;
    for (const candidate of overview.candidates) {
        const expirations = readSessionPersonalAttentionExpirationsForViewer(
            candidate.session,
            nowMs,
            readActivitySourceAttentionMessages(source, candidate.address),
        );
        for (const expiresAtMs of expirations) {
            if (expiresAtMs <= nowMs) continue;
            if (nextMs === null || expiresAtMs < nextMs) nextMs = expiresAtMs;
        }
    }
    return nextMs;
}

/**
 * The mounted Activity projection: one canonical overview plus the clock that
 * keeps it honest while nothing arrives.
 *
 * A store change is a render, so a source-keyed projection is correct for every
 * fact the server pushes. Pre-viewer `user_action_required` is the exception —
 * it retires on a freshness budget rather than on an event — so a surface that
 * only re-projects on source identity keeps a retired row and an uncleanable
 * dot indefinitely. The boundary timer is local to the mounted consumer (the
 * `FaviconPermissionIndicator` pattern): no global scheduler, and no second
 * opinion about what attention means, only about when to look again.
 */
export function useActivityOverview(): MountedActivityOverview {
    const source = useActivityAttentionSource();
    const [boundaryVersion, advanceBoundary] = React.useReducer((value: number) => value + 1, 0);
    // Both inputs matter: the store moved, or a freshness budget elapsed.
    const nowMs = React.useMemo(() => Date.now(), [boundaryVersion, source]);
    const overview = React.useMemo(
        () => buildActivityOverviewFromSource({
            source,
            nowMs,
            includeWarmSourceWhenNotReady: true,
        }),
        [nowMs, source],
    );

    const nextBoundaryMs = readNextAttentionBoundaryMs(source, overview, nowMs);
    React.useEffect(() => {
        if (nextBoundaryMs === null) return undefined;
        const timeoutId = setTimeout(advanceBoundary, Math.max(0, nextBoundaryMs - Date.now()));
        return () => clearTimeout(timeoutId);
    }, [nextBoundaryMs]);

    return React.useMemo(() => ({ source, overview }), [overview, source]);
}
