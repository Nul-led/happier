import * as React from 'react';

/**
 * "Back to <time>" after a navigation jump: the one place the reader was before it.
 *
 * The jump host records it at the single navigation-jump choke point (rail and pane alike); the
 * transcript's return pill reads it. It lives until the reader moves on:
 * - scrolling off the landing (the current anchor leaves the jump's target after reaching it),
 * - sending (a newer turn appears),
 * - using it, or the jump failing.
 * Anchors seen while the jump is still travelling do not count as moving on.
 */
export type TranscriptNavigationReturnPoint = Readonly<{
    entryId: string;
    /** When that turn was written, for "Back to 10:18"; null when unknown. */
    atMs: number | null;
}>;

export type TranscriptNavigationReturnTarget = Readonly<{
    returnTo: TranscriptNavigationReturnPoint;
    landingEntryId: string;
    newestEntryId: string | null;
    landed: boolean;
}>;

export type TranscriptNavigationReturnStore = Readonly<{
    get(sessionId: string): TranscriptNavigationReturnTarget | null;
    record(sessionId: string, params: Readonly<{
        returnTo: TranscriptNavigationReturnPoint | null;
        landingEntryId: string;
        newestEntryId: string | null;
    }>): TranscriptNavigationReturnTarget | null;
    observeAnchor(sessionId: string, anchorId: string | null): void;
    observeNewestEntry(sessionId: string, newestEntryId: string | null): void;
    /** Clears the session's target; with `only`, only when it is still that target. */
    clear(sessionId: string, only?: TranscriptNavigationReturnTarget | null): void;
    subscribe(sessionId: string, listener: () => void): () => void;
}>;

export function createTranscriptNavigationReturnStore(): TranscriptNavigationReturnStore {
    const targets = new Map<string, TranscriptNavigationReturnTarget>();
    const listeners = new Map<string, Set<() => void>>();

    const write = (sessionId: string, next: TranscriptNavigationReturnTarget | null) => {
        const previous = targets.get(sessionId) ?? null;
        if (previous === next) return;
        if (next) targets.set(sessionId, next);
        else targets.delete(sessionId);
        listeners.get(sessionId)?.forEach((listener) => listener());
    };

    return {
        get: (sessionId) => targets.get(sessionId) ?? null,
        record(sessionId, params) {
            if (!params.returnTo || params.returnTo.entryId === params.landingEntryId) {
                write(sessionId, null);
                return null;
            }
            const target: TranscriptNavigationReturnTarget = {
                returnTo: params.returnTo,
                landingEntryId: params.landingEntryId,
                newestEntryId: params.newestEntryId,
                landed: false,
            };
            write(sessionId, target);
            return target;
        },
        observeAnchor(sessionId, anchorId) {
            const target = targets.get(sessionId);
            if (!target || !anchorId) return;
            if (!target.landed) {
                if (anchorId === target.landingEntryId) write(sessionId, { ...target, landed: true });
                return;
            }
            if (anchorId !== target.landingEntryId) write(sessionId, null);
        },
        observeNewestEntry(sessionId, newestEntryId) {
            const target = targets.get(sessionId);
            if (!target || !newestEntryId || newestEntryId === target.newestEntryId) return;
            write(sessionId, null);
        },
        clear(sessionId, only) {
            const target = targets.get(sessionId);
            if (!target) return;
            if (only !== undefined && only !== target) return;
            write(sessionId, null);
        },
        subscribe(sessionId, listener) {
            let set = listeners.get(sessionId);
            if (!set) {
                set = new Set();
                listeners.set(sessionId, set);
            }
            set.add(listener);
            return () => {
                set?.delete(listener);
                if (set?.size === 0) listeners.delete(sessionId);
            };
        },
    };
}

export const transcriptNavigationReturnStore = createTranscriptNavigationReturnStore();

export function useTranscriptNavigationReturnTarget(
    sessionId: string,
    store: TranscriptNavigationReturnStore = transcriptNavigationReturnStore,
): TranscriptNavigationReturnTarget | null {
    const subscribe = React.useCallback((listener: () => void) => store.subscribe(sessionId, listener), [sessionId, store]);
    const read = React.useCallback(() => store.get(sessionId), [sessionId, store]);
    return React.useSyncExternalStore(subscribe, read, read);
}
