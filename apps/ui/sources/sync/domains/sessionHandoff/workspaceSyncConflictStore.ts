import type { WorkspaceSyncConflictListV1 } from '@happier-dev/protocol';

import { listWorkspaceSyncConflicts } from '@/sync/ops/workspaceSync';
import type { WorkspaceSyncStatusScope } from './workspaceSyncStatusStore';

export type WorkspaceSyncConflictSnapshot = Readonly<{
    phase: 'idle' | 'loading' | 'refreshing' | 'ready' | 'error';
    list: WorkspaceSyncConflictListV1 | null;
    error: unknown | null;
}>;

type Entry = {
    snapshot: WorkspaceSyncConflictSnapshot;
    listeners: Set<() => void>;
    inFlight: Promise<WorkspaceSyncConflictListV1> | null;
};

const entries = new Map<string, Entry>();
const IDLE_SNAPSHOT: WorkspaceSyncConflictSnapshot = { phase: 'idle', list: null, error: null };

function keyFor(scope: WorkspaceSyncStatusScope): string {
    return JSON.stringify([scope.serverId ?? null, scope.controllerMachineId, scope.relationshipId]);
}

function entryFor(scope: WorkspaceSyncStatusScope): Entry {
    const key = keyFor(scope);
    const current = entries.get(key);
    if (current) return current;
    const created: Entry = { snapshot: IDLE_SNAPSHOT, listeners: new Set(), inFlight: null };
    entries.set(key, created);
    return created;
}

function publish(entry: Entry, snapshot: WorkspaceSyncConflictSnapshot): void {
    entry.snapshot = snapshot;
    for (const listener of entry.listeners) listener();
}

export function getWorkspaceSyncConflictSnapshot(scope: WorkspaceSyncStatusScope): WorkspaceSyncConflictSnapshot {
    return entryFor(scope).snapshot;
}

export function subscribeWorkspaceSyncConflicts(scope: WorkspaceSyncStatusScope, listener: () => void): () => void {
    const entry = entryFor(scope);
    entry.listeners.add(listener);
    return () => entry.listeners.delete(listener);
}

export function refreshWorkspaceSyncConflicts(scope: WorkspaceSyncStatusScope): Promise<WorkspaceSyncConflictListV1> {
    const entry = entryFor(scope);
    if (entry.inFlight) return entry.inFlight;
    publish(entry, {
        phase: entry.snapshot.list ? 'refreshing' : 'loading',
        list: entry.snapshot.list,
        error: null,
    });
    const inFlight = listWorkspaceSyncConflicts(scope).then(
        (list) => {
            publish(entry, { phase: 'ready', list, error: null });
            return list;
        },
        (error: unknown) => {
            publish(entry, { phase: 'error', list: entry.snapshot.list, error });
            throw error;
        },
    ).finally(() => {
        entry.inFlight = null;
    });
    entry.inFlight = inFlight;
    return inFlight;
}

export function resetWorkspaceSyncConflictStoreForTests(): void {
    entries.clear();
}
