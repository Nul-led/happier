import * as React from 'react';

const NONE: ReadonlySet<string> = new Set();

/**
 * Which Board items arrived while this Board was on screen (lab WA, the signature moment): an item
 * the agent (or someone else) added appears with the frame's one-shot ring. What the Board shows on
 * first sight is never an arrival, and a new mount starts over, so a remounted Board never replays
 * old rings. `null` means the items are not known yet (still hydrating).
 *
 * The returned set keeps its identity while nothing new arrives, so unchanged cards do not re-render.
 */
export function useSessionBoardArrivals(itemIds: readonly string[] | null): ReadonlySet<string> {
    const baseline = React.useRef<Set<string> | null>(null);
    const arrivals = React.useRef<ReadonlySet<string>>(NONE);
    if (itemIds !== null) {
        if (baseline.current === null) {
            baseline.current = new Set(itemIds);
        } else {
            const fresh = itemIds.filter((id) => !baseline.current?.has(id) && !arrivals.current.has(id));
            if (fresh.length > 0) arrivals.current = new Set([...arrivals.current, ...fresh]);
        }
    }
    return arrivals.current;
}
