import * as React from 'react';

let version = 0;
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
}

function getSnapshot(): number {
    return version;
}

export function invalidateConnectedServiceGroupsRefreshSignal(): void {
    version += 1;
    for (const listener of listeners) listener();
}

export function useConnectedServiceGroupsRefreshSignal(): number {
    return React.useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
