import * as React from 'react';

/**
 * Whether the session bar is currently scrolling its tools sideways.
 *
 * The bar owns the decision (its measured width against its tools and the "Always swipe between
 * sessions" setting); the bottom-chrome host only needs the answer, because a scrolling bar owns
 * the horizontal axis and the sideways session swipe must then stay out of its way. One boolean,
 * published by the one bar on screen, read by the one band gesture.
 */
let scrolls = false;
const listeners = new Set<() => void>();

export function publishCockpitBarScrolls(next: boolean): void {
    if (scrolls === next) return;
    scrolls = next;
    for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
}

const read = () => scrolls;

export function useCockpitBarScrolls(): boolean {
    return React.useSyncExternalStore(subscribe, read, read);
}
