import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getWorkspaceSyncStatus, listWorkspaceSyncStatuses } = vi.hoisted(() => ({
    getWorkspaceSyncStatus: vi.fn(),
    listWorkspaceSyncStatuses: vi.fn(),
}));

vi.mock('@/sync/ops/workspaceSync', () => ({
    getWorkspaceSyncStatus: (input: unknown) => getWorkspaceSyncStatus(input),
    listWorkspaceSyncStatuses: (input: unknown) => listWorkspaceSyncStatuses(input),
}));

import {
    applyWorkspaceSyncStatusEvent,
    getWorkspaceSyncStatusSnapshot,
    refreshWorkspaceSyncStatus,
    refreshWorkspaceSyncStatuses,
    resetWorkspaceSyncStatusStoreForTests,
    subscribeWorkspaceSyncStatus,
} from './workspaceSyncStatusStore';

describe('workspaceSyncStatusStore', () => {
    beforeEach(() => {
        getWorkspaceSyncStatus.mockReset();
        listWorkspaceSyncStatuses.mockReset();
        resetWorkspaceSyncStatusStoreForTests();
    });

    it('refreshes demanded relationships once per controller and leaves absent status unknown', async () => {
        const scopes = ['relationship-1', 'relationship-2', 'relationship-3'].map((relationshipId) => ({
            serverId: 'server-1', controllerMachineId: 'machine-1', relationshipId,
        }));
        listWorkspaceSyncStatuses.mockResolvedValueOnce([{
            relationshipId: 'relationship-2', controllerMachineId: 'machine-1', state: 'conflicted',
            alphaPath: '/alpha', betaPath: '/beta', mode: 'keep_synced',
            endpointStates: { alpha: null, beta: null }, conflictCount: 1, lastCycleObservedAtMs: null,
        }]);
        await refreshWorkspaceSyncStatuses(scopes);
        expect(listWorkspaceSyncStatuses).toHaveBeenCalledOnce();
        expect(getWorkspaceSyncStatus).not.toHaveBeenCalled();
        expect(getWorkspaceSyncStatusSnapshot(scopes[0]!)).toMatchObject({ phase: 'ready', status: null });
        expect(getWorkspaceSyncStatusSnapshot(scopes[1]!)).toMatchObject({ phase: 'ready', status: { conflictCount: 1 } });
        expect(getWorkspaceSyncStatusSnapshot(scopes[2]!)).toMatchObject({ phase: 'ready', status: null });
    });

    it('coalesces reads shared by Projects, sessions, and Settings and keeps the last-known status while refreshing', async () => {
        let resolveFirst!: (value: unknown) => void;
        getWorkspaceSyncStatus.mockImplementationOnce(() => new Promise((resolve) => {
            resolveFirst = resolve;
        }));
        const scope = { serverId: 'server-1', controllerMachineId: 'machine-1', relationshipId: 'relationship-1' } as const;

        const first = refreshWorkspaceSyncStatus(scope);
        const second = refreshWorkspaceSyncStatus(scope);
        expect(getWorkspaceSyncStatus).toHaveBeenCalledTimes(1);
        expect(getWorkspaceSyncStatusSnapshot(scope)).toMatchObject({ phase: 'loading', status: null });

        resolveFirst({
            relationshipId: 'relationship-1', controllerMachineId: 'machine-1', state: 'watching',
            alphaPath: '/alpha', betaPath: '/beta', mode: 'keep_synced',
            endpointStates: { alpha: { connected: true, scanned: true, scanProblemCount: 0, transitionProblemCount: 0 }, beta: { connected: true, scanned: true, scanProblemCount: 0, transitionProblemCount: 0 } },
            conflictCount: 0, lastCycleObservedAtMs: 1,
        });
        await Promise.all([first, second]);
        const settled = getWorkspaceSyncStatusSnapshot(scope);
        expect(settled).toMatchObject({ phase: 'ready', status: { state: 'watching' } });

        getWorkspaceSyncStatus.mockImplementationOnce(() => new Promise(() => {}));
        void refreshWorkspaceSyncStatus(scope);
        expect(getWorkspaceSyncStatusSnapshot(scope)).toMatchObject({
            phase: 'refreshing',
            status: { state: 'watching' },
        });
    });

    it('applies a daemon runtime status event only to its exact Home and controller scope', () => {
        const scope = { serverId: 'server-1', controllerMachineId: 'machine-1', relationshipId: 'relationship-1' } as const;
        applyWorkspaceSyncStatusEvent(scope, {
            relationshipId: 'relationship-1', controllerMachineId: 'machine-1', state: 'paused',
            alphaPath: '/alpha', betaPath: '/beta', mode: 'keep_synced',
            endpointStates: { alpha: { connected: true, scanned: true, scanProblemCount: 0, transitionProblemCount: 0 }, beta: { connected: true, scanned: true, scanProblemCount: 0, transitionProblemCount: 0 } },
            conflictCount: 0, lastCycleObservedAtMs: 1,
        });

        expect(getWorkspaceSyncStatusSnapshot(scope)).toMatchObject({ phase: 'ready', status: { state: 'paused' } });
        expect(getWorkspaceSyncStatusSnapshot({ ...scope, serverId: 'server-2' })).toMatchObject({ phase: 'idle', status: null });
        expect(getWorkspaceSyncStatusSnapshot({ ...scope, controllerMachineId: 'machine-2' })).toMatchObject({ phase: 'idle', status: null });
    });

    it('keeps a closed summary subscriber stable when a daemon repeats the same status', () => {
        const scope = { serverId: 'server-1', controllerMachineId: 'machine-1', relationshipId: 'relationship-1' } as const;
        const status = {
            relationshipId: 'relationship-1', controllerMachineId: 'machine-1', state: 'watching' as const,
            alphaPath: '/alpha', betaPath: '/beta', mode: 'keep_synced' as const,
            endpointStates: { alpha: null, beta: null }, conflictCount: 0, lastCycleObservedAtMs: null,
        };
        const listener = vi.fn();
        subscribeWorkspaceSyncStatus(scope, listener);
        applyWorkspaceSyncStatusEvent(scope, status);
        const first = getWorkspaceSyncStatusSnapshot(scope);
        applyWorkspaceSyncStatusEvent(scope, { ...status });
        expect(listener).toHaveBeenCalledOnce();
        expect(getWorkspaceSyncStatusSnapshot(scope)).toBe(first);
    });

    it('does not let an older in-flight refresh overwrite a newer runtime status event', async () => {
        let resolveRefresh!: (value: unknown) => void;
        getWorkspaceSyncStatus.mockImplementationOnce(() => new Promise((resolve) => {
            resolveRefresh = resolve;
        }));
        const scope = { serverId: 'server-1', controllerMachineId: 'machine-1', relationshipId: 'relationship-1' } as const;

        const refresh = refreshWorkspaceSyncStatus(scope);
        applyWorkspaceSyncStatusEvent(scope, {
            relationshipId: 'relationship-1', controllerMachineId: 'machine-1', state: 'paused',
            alphaPath: '/alpha', betaPath: '/beta', mode: 'keep_synced',
            endpointStates: { alpha: { connected: true, scanned: true, scanProblemCount: 0, transitionProblemCount: 0 }, beta: { connected: true, scanned: true, scanProblemCount: 0, transitionProblemCount: 0 } },
            conflictCount: 0, lastCycleObservedAtMs: 2,
        });
        resolveRefresh({
            relationshipId: 'relationship-1', controllerMachineId: 'machine-1', state: 'watching',
            alphaPath: '/alpha', betaPath: '/beta', mode: 'keep_synced',
            endpointStates: { alpha: { connected: true, scanned: true, scanProblemCount: 0, transitionProblemCount: 0 }, beta: { connected: true, scanned: true, scanProblemCount: 0, transitionProblemCount: 0 } },
            conflictCount: 0, lastCycleObservedAtMs: 1,
        });
        await refresh;

        expect(getWorkspaceSyncStatusSnapshot(scope)).toMatchObject({
            phase: 'ready',
            status: { state: 'paused', lastCycleObservedAtMs: 2 },
        });
    });
});
