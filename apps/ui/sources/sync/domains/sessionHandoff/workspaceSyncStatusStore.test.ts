import { beforeEach, describe, expect, it, vi } from 'vitest';

const getWorkspaceSyncStatus = vi.hoisted(() => vi.fn());

vi.mock('@/sync/ops/workspaceSync', () => ({
    getWorkspaceSyncStatus: (input: unknown) => getWorkspaceSyncStatus(input),
}));

import {
    applyWorkspaceSyncStatusEvent,
    getWorkspaceSyncStatusSnapshot,
    refreshWorkspaceSyncStatus,
    resetWorkspaceSyncStatusStoreForTests,
} from './workspaceSyncStatusStore';

describe('workspaceSyncStatusStore', () => {
    beforeEach(() => {
        getWorkspaceSyncStatus.mockReset();
        resetWorkspaceSyncStatusStoreForTests();
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
            alphaPath: '/alpha', betaPath: '/beta', mode: 'keep_synced', changedFiles: 0,
            conflictCount: 0, lastSuccessfulSyncAtMs: 1,
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
            alphaPath: '/alpha', betaPath: '/beta', mode: 'keep_synced', changedFiles: 0,
            conflictCount: 0, lastSuccessfulSyncAtMs: 1,
        });

        expect(getWorkspaceSyncStatusSnapshot(scope)).toMatchObject({ phase: 'ready', status: { state: 'paused' } });
        expect(getWorkspaceSyncStatusSnapshot({ ...scope, serverId: 'server-2' })).toMatchObject({ phase: 'idle', status: null });
        expect(getWorkspaceSyncStatusSnapshot({ ...scope, controllerMachineId: 'machine-2' })).toMatchObject({ phase: 'idle', status: null });
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
            alphaPath: '/alpha', betaPath: '/beta', mode: 'keep_synced', changedFiles: 0,
            conflictCount: 0, lastSuccessfulSyncAtMs: 2,
        });
        resolveRefresh({
            relationshipId: 'relationship-1', controllerMachineId: 'machine-1', state: 'watching',
            alphaPath: '/alpha', betaPath: '/beta', mode: 'keep_synced', changedFiles: 0,
            conflictCount: 0, lastSuccessfulSyncAtMs: 1,
        });
        await refresh;

        expect(getWorkspaceSyncStatusSnapshot(scope)).toMatchObject({
            phase: 'ready',
            status: { state: 'paused', lastSuccessfulSyncAtMs: 2 },
        });
    });
});
