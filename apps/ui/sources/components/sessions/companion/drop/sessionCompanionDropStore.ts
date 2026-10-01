import * as React from 'react';

/**
 * Drag a Board card onto the Companion (lab CM, desktop): the one piece of
 * shared state between a Board card being dragged and the Companion rail beside
 * the chat of the same Session. It holds no content — a drop only hands the
 * Board item id to the Companion's ordinary add path, which stays canonical
 * through the menu ("Add to Companion") as well.
 *
 * High-frequency pointer movement stays here: the rail's drop slot subscribes
 * to a boolean (dragging / hovering) and re-renders only when that flips.
 */

export type SessionCompanionDropRect = Readonly<{ x: number; y: number; width: number; height: number }>;

type DropTarget = Readonly<{
    measure: () => Promise<SessionCompanionDropRect | null>;
    accept: (itemId: string) => void;
}>;

export type SessionCompanionDropView = Readonly<{ dragging: boolean; hovering: boolean }>;

type SessionDropState = {
    target: DropTarget | null;
    rect: SessionCompanionDropRect | null;
    itemId: string | null;
    view: SessionCompanionDropView;
    listeners: Set<() => void>;
};

const IDLE_VIEW: SessionCompanionDropView = Object.freeze({ dragging: false, hovering: false });
const DRAGGING_VIEW: SessionCompanionDropView = Object.freeze({ dragging: true, hovering: false });
const HOVERING_VIEW: SessionCompanionDropView = Object.freeze({ dragging: true, hovering: true });

const sessions = new Map<string, SessionDropState>();

function stateFor(sessionId: string): SessionDropState {
    let state = sessions.get(sessionId);
    if (!state) {
        state = { target: null, rect: null, itemId: null, view: IDLE_VIEW, listeners: new Set() };
        sessions.set(sessionId, state);
    }
    return state;
}

function releaseIfUnused(sessionId: string, state: SessionDropState): void {
    if (state.target === null && state.listeners.size === 0 && sessions.get(sessionId) === state) {
        sessions.delete(sessionId);
    }
}

function setView(state: SessionDropState, view: SessionCompanionDropView): void {
    if (state.view === view) return;
    state.view = view;
    for (const listener of state.listeners) listener();
}

function contains(rect: SessionCompanionDropRect | null, x: number, y: number): boolean {
    return rect !== null && x >= rect.x && x <= rect.x + rect.width && y >= rect.y && y <= rect.y + rect.height;
}

/** The rail registers while it is shown; a drag with no registered rail does nothing. */
export function registerSessionCompanionDropTarget(sessionId: string, target: DropTarget): () => void {
    const state = stateFor(sessionId);
    state.target = target;
    for (const listener of state.listeners) listener();
    return () => {
        if (state.target !== target) return;
        state.target = null;
        state.rect = null;
        state.itemId = null;
        state.view = IDLE_VIEW;
        for (const listener of state.listeners) listener();
        releaseIfUnused(sessionId, state);
    };
}

/** Whether a Board card should offer the drag at all: only when a rail is there to catch it. */
export function hasSessionCompanionDropTarget(sessionId: string): boolean {
    return sessions.get(sessionId)?.target != null;
}

export function beginSessionCompanionDrag(sessionId: string, itemId: string): void {
    const state = stateFor(sessionId);
    if (!state.target) return;
    state.itemId = itemId;
    state.rect = null;
    setView(state, DRAGGING_VIEW);
    // Measured once per drag, so a resized or scrolled window never uses a stale rect.
    const target = state.target;
    void target.measure().then((rect) => {
        if (state.target === target && state.itemId === itemId) state.rect = rect;
    });
}

export function moveSessionCompanionDrag(sessionId: string, x: number, y: number): void {
    const state = sessions.get(sessionId);
    if (!state || state.itemId === null) return;
    setView(state, contains(state.rect, x, y) ? HOVERING_VIEW : DRAGGING_VIEW);
}

/** Ends the drag; returns whether the card was dropped on the Companion (and hands it over). */
export function endSessionCompanionDrag(sessionId: string, drop: Readonly<{ x: number; y: number }> | null): boolean {
    const state = sessions.get(sessionId);
    if (!state || state.itemId === null) return false;
    const itemId = state.itemId;
    const dropped = drop !== null && contains(state.rect, drop.x, drop.y) && state.target !== null;
    state.itemId = null;
    setView(state, IDLE_VIEW);
    if (dropped) state.target?.accept(itemId);
    return dropped;
}

function useDropSubscription(sessionId: string) {
    return React.useCallback((listener: () => void) => {
        const state = stateFor(sessionId);
        state.listeners.add(listener);
        return () => {
            state.listeners.delete(listener);
            releaseIfUnused(sessionId, state);
        };
    }, [sessionId]);
}

export function useSessionCompanionDropTargetAvailable(sessionId: string): boolean {
    const subscribe = useDropSubscription(sessionId);
    const read = React.useCallback(() => hasSessionCompanionDropTarget(sessionId), [sessionId]);
    return React.useSyncExternalStore(subscribe, read, read);
}

export function useSessionCompanionDropView(sessionId: string): SessionCompanionDropView {
    const subscribe = useDropSubscription(sessionId);
    const read = React.useCallback(() => sessions.get(sessionId)?.view ?? IDLE_VIEW, [sessionId]);
    return React.useSyncExternalStore(subscribe, read, read);
}
