import type { WorkspaceSyncStatusV1 } from '@happier-dev/protocol';

import { getWorkspaceSyncStatus, listWorkspaceSyncStatuses } from '@/sync/ops/workspaceSync';

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
type ControllerRead = {
    scopes: Map<string, Readonly<{ scope: WorkspaceSyncStatusScope; generation: number }>>;
    inFlight: Promise<void>;
};

const controllerReads = new Map<string, ControllerRead>();
const IDLE_SNAPSHOT: WorkspaceSyncStatusSnapshot = { phase: 'idle', status: null, error: null };

function keyFor(scope: WorkspaceSyncStatusScope): string {
    return JSON.stringify([scope.serverId ?? null, scope.controllerMachineId, scope.relationshipId]);
}

function controllerKeyFor(scope: WorkspaceSyncStatusScope): string {
    return JSON.stringify([scope.serverId ?? null, scope.controllerMachineId]);
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

function statusesEqual(left: WorkspaceSyncStatusV1 | null, right: WorkspaceSyncStatusV1 | null): boolean {
    return left === right || JSON.stringify(left) === JSON.stringify(right);
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
    if (entry.snapshot.phase === 'ready' && statusesEqual(entry.snapshot.status, status)) return;
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

/** One daemon list read serves every demanded relationship on this controller. */
export async function refreshWorkspaceSyncStatuses(scopes: readonly WorkspaceSyncStatusScope[]): Promise<void> {
    const controllers = new Map<string, WorkspaceSyncStatusScope>();
    for (const scope of scopes) controllers.set(controllerKeyFor(scope), scope);
    await Promise.all([...controllers].map(async ([key, controller]) => {
        const current = controllerReads.get(key);
        const read: ControllerRead = current ?? { scopes: new Map(), inFlight: Promise.resolve() };
        for (const scope of scopes.filter((candidate) => controllerKeyFor(candidate) === key)) {
            if (read.scopes.has(keyFor(scope))) continue;
            const entry = entryFor(scope);
            read.scopes.set(keyFor(scope), { scope, generation: entry.admissionGeneration });
            if (entry.snapshot.phase === 'idle') {
                publish(entry, { phase: 'loading', status: null, error: null });
            }
        }
        if (current) return await current.inFlight;
        read.inFlight = listWorkspaceSyncStatuses(controller).then((statuses) => {
            const byId = new Map(statuses
                .filter((status) => status.controllerMachineId === controller.controllerMachineId)
                .map((status) => [status.relationshipId, status] as const));
            for (const { scope, generation } of read.scopes.values()) {
                const entry = entryFor(scope);
                if (entry.admissionGeneration !== generation) continue;
                const status = byId.get(scope.relationshipId) ?? null;
                if (entry.snapshot.phase === 'ready' && statusesEqual(entry.snapshot.status, status)) continue;
                publish(entry, { phase: 'ready', status, error: null });
            }
        }, (error: unknown) => {
            for (const { scope, generation } of read.scopes.values()) {
                const entry = entryFor(scope);
                if (entry.admissionGeneration === generation) {
                    publish(entry, { phase: 'error', status: entry.snapshot.status, error });
                }
            }
            throw error;
        }).finally(() => {
            if (controllerReads.get(key) === read) controllerReads.delete(key);
        });
        controllerReads.set(key, read);
        await read.inFlight;
    }));
}

export function resetWorkspaceSyncStatusStoreForTests(): void {
    entries.clear();
    controllerReads.clear();
}
