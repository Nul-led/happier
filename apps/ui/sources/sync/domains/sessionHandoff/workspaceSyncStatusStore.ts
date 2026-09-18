import type { WorkspaceSyncStatusV1 } from '@happier-dev/protocol';

import { getWorkspaceSyncStatus } from '@/sync/ops/workspaceSync';

export type WorkspaceSyncStatusScope = Readonly<{
    serverId?: string | null;
    controllerMachineId: string;
    relationshipId: string;
}>;

export type WorkspaceSyncStatusSnapshot = Readonly<{
    phase: 'idle' | 'loading' | 'refreshing' | 'ready' | 'error';
    status: WorkspaceSyncStatusV1 | null;
    error: unknown | null;
}>;

type Entry = {
    snapshot: WorkspaceSyncStatusSnapshot;
    listeners: Set<() => void>;
    inFlight: Promise<WorkspaceSyncStatusV1 | null> | null;
    admissionGeneration: number;
};

const entries = new Map<string, Entry>();
const IDLE_SNAPSHOT: WorkspaceSyncStatusSnapshot = { phase: 'idle', status: null, error: null };

function keyFor(scope: WorkspaceSyncStatusScope): string {
    return JSON.stringify([scope.serverId ?? null, scope.controllerMachineId, scope.relationshipId]);
}

function entryFor(scope: WorkspaceSyncStatusScope): Entry {
    const key = keyFor(scope);
    const existing = entries.get(key);
    if (existing) return existing;
    const entry: Entry = { snapshot: IDLE_SNAPSHOT, listeners: new Set(), inFlight: null, admissionGeneration: 0 };
    entries.set(key, entry);
    return entry;
}

function publish(entry: Entry, snapshot: WorkspaceSyncStatusSnapshot): void {
    entry.snapshot = snapshot;
    for (const listener of entry.listeners) listener();
}

export function getWorkspaceSyncStatusSnapshot(scope: WorkspaceSyncStatusScope): WorkspaceSyncStatusSnapshot {
    return entryFor(scope).snapshot;
}

export function subscribeWorkspaceSyncStatus(scope: WorkspaceSyncStatusScope, listener: () => void): () => void {
    const entry = entryFor(scope);
    entry.listeners.add(listener);
    return () => entry.listeners.delete(listener);
}

export function setWorkspaceSyncStatus(scope: WorkspaceSyncStatusScope, status: WorkspaceSyncStatusV1): void {
    const entry = entryFor(scope);
    entry.admissionGeneration += 1;
    publish(entry, { phase: 'ready', status, error: null });
}

export function applyWorkspaceSyncStatusEvent(scope: WorkspaceSyncStatusScope, status: WorkspaceSyncStatusV1): void {
    if (status.relationshipId !== scope.relationshipId || status.controllerMachineId !== scope.controllerMachineId) return;
    setWorkspaceSyncStatus(scope, status);
}

export function refreshWorkspaceSyncStatus(scope: WorkspaceSyncStatusScope): Promise<WorkspaceSyncStatusV1 | null> {
    const entry = entryFor(scope);
    if (entry.inFlight) return entry.inFlight;
    publish(entry, {
        phase: entry.snapshot.status ? 'refreshing' : 'loading',
        status: entry.snapshot.status,
        error: null,
    });
    const admissionGeneration = entry.admissionGeneration;
    const inFlight = getWorkspaceSyncStatus(scope).then(
        (status) => {
            if (entry.admissionGeneration !== admissionGeneration) return entry.snapshot.status;
            publish(entry, { phase: 'ready', status, error: null });
            return status;
        },
        (error: unknown) => {
            if (entry.admissionGeneration === admissionGeneration) {
                publish(entry, { phase: 'error', status: entry.snapshot.status, error });
            }
            throw error;
        },
    ).finally(() => {
        entry.inFlight = null;
    });
    entry.inFlight = inFlight;
    return inFlight;
}

export function resetWorkspaceSyncStatusStoreForTests(): void {
    entries.clear();
}
