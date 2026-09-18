import { beforeEach, describe, expect, it, vi } from 'vitest';

const listWorkspaceSyncConflicts = vi.hoisted(() => vi.fn());

vi.mock('@/sync/ops/workspaceSync', () => ({
    listWorkspaceSyncConflicts: (input: unknown) => listWorkspaceSyncConflicts(input),
}));

import {
    getWorkspaceSyncConflictSnapshot,
    invalidateWorkspaceSyncConflicts,
    loadMoreWorkspaceSyncConflicts,
    refreshWorkspaceSyncConflicts,
    resetWorkspaceSyncConflictStoreForTests,
} from './workspaceSyncConflictStore';

describe('workspaceSyncConflictStore', () => {
    beforeEach(() => {
        listWorkspaceSyncConflicts.mockReset();
        resetWorkspaceSyncConflictStoreForTests();
    });

    it('coalesces conflict reads and preserves the daemon truncation facts', async () => {
        const scope = { relationshipId: 'relationship-1', controllerMachineId: 'machine-1' } as const;
        listWorkspaceSyncConflicts.mockResolvedValueOnce({
            status: 'page',
            relationshipId: 'relationship-1',
            totalCount: 2,
            nextCursor: 'next-page',
            conflicts: [{
                relationshipId: 'relationship-1',
                path: 'file.txt',
                alpha: { kind: 'file', digest: 'alpha' },
                beta: { kind: 'file', digest: 'beta' },
            }],
        });

        await Promise.all([
            refreshWorkspaceSyncConflicts(scope),
            refreshWorkspaceSyncConflicts(scope),
        ]);

        expect(listWorkspaceSyncConflicts).toHaveBeenCalledTimes(1);
        expect(getWorkspaceSyncConflictSnapshot(scope)).toMatchObject({
            phase: 'ready',
            list: { totalCount: 2, shownCount: 1, truncatedCount: 1 },
            nextCursor: 'next-page',
            hasMore: true,
            invalidated: false,
        });
    });

    it('appends public cursor pages and preserves loaded conflicts when the engine invalidates the cursor', async () => {
        const scope = { relationshipId: 'relationship-1', controllerMachineId: 'machine-1' } as const;
        listWorkspaceSyncConflicts
            .mockResolvedValueOnce({
                status: 'page', relationshipId: 'relationship-1', totalCount: 2, nextCursor: 'next-page',
                conflicts: [{ relationshipId: 'relationship-1', path: 'a.txt', alpha: { kind: 'file' }, beta: { kind: 'file' } }],
            })
            .mockResolvedValueOnce({ status: 'cursor_invalidated', relationshipId: 'relationship-1' });

        await refreshWorkspaceSyncConflicts(scope);
        await loadMoreWorkspaceSyncConflicts(scope);

        expect(listWorkspaceSyncConflicts).toHaveBeenNthCalledWith(2, {
            ...scope,
            cursor: 'next-page',
        });
        expect(getWorkspaceSyncConflictSnapshot(scope)).toMatchObject({
            phase: 'invalidated',
            list: { totalCount: 2, shownCount: 1, conflicts: [{ path: 'a.txt' }] },
            hasMore: false,
            invalidated: true,
        });
    });

    it('refreshes an observed conflict list after a controller status event and preserves the last-known list', async () => {
        const scope = { serverId: 'server-1', relationshipId: 'relationship-1', controllerMachineId: 'machine-1' } as const;
        listWorkspaceSyncConflicts
            .mockResolvedValueOnce({ status: 'page', relationshipId: 'relationship-1', totalCount: 1, nextCursor: null, conflicts: [] })
            .mockResolvedValueOnce({ status: 'page', relationshipId: 'relationship-1', totalCount: 0, nextCursor: null, conflicts: [] });
        await refreshWorkspaceSyncConflicts(scope);
        const unsubscribe = (await import('./workspaceSyncConflictStore')).subscribeWorkspaceSyncConflicts(scope, () => {});

        invalidateWorkspaceSyncConflicts(scope);
        expect(getWorkspaceSyncConflictSnapshot(scope)).toMatchObject({
            phase: 'refreshing',
            list: { totalCount: 1 },
        });
        await vi.waitFor(() => expect(getWorkspaceSyncConflictSnapshot(scope)).toMatchObject({
            phase: 'ready',
            list: { totalCount: 0 },
        }));
        expect(listWorkspaceSyncConflicts).toHaveBeenCalledTimes(2);
        unsubscribe();
    });

    it('rejects an in-flight page invalidated by a runtime event and refreshes observers from the first page', async () => {
        let resolveStalePage!: (value: unknown) => void;
        const scope = { serverId: 'server-1', relationshipId: 'relationship-1', controllerMachineId: 'machine-1' } as const;
        listWorkspaceSyncConflicts
            .mockResolvedValueOnce({
                status: 'page', relationshipId: 'relationship-1', totalCount: 1, nextCursor: null,
                conflicts: [{ relationshipId: 'relationship-1', path: 'known.txt', alpha: { kind: 'file' }, beta: { kind: 'file' } }],
            })
            .mockImplementationOnce(() => new Promise((resolve) => {
                resolveStalePage = resolve;
            }))
            .mockResolvedValueOnce({
                status: 'page', relationshipId: 'relationship-1', totalCount: 1, nextCursor: null,
                conflicts: [{ relationshipId: 'relationship-1', path: 'fresh.txt', alpha: { kind: 'file' }, beta: { kind: 'file' } }],
            });
        await refreshWorkspaceSyncConflicts(scope);
        const observedReadyPaths: string[][] = [];
        const unsubscribe = (await import('./workspaceSyncConflictStore')).subscribeWorkspaceSyncConflicts(scope, () => {
            const snapshot = getWorkspaceSyncConflictSnapshot(scope);
            if (snapshot.phase === 'ready') {
                observedReadyPaths.push(snapshot.list?.conflicts.map((conflict) => conflict.path) ?? []);
            }
        });

        const staleRefresh = refreshWorkspaceSyncConflicts(scope);
        invalidateWorkspaceSyncConflicts(scope);
        resolveStalePage({
            status: 'page', relationshipId: 'relationship-1', totalCount: 1, nextCursor: null,
            conflicts: [{ relationshipId: 'relationship-1', path: 'stale.txt', alpha: { kind: 'file' }, beta: { kind: 'file' } }],
        });
        await staleRefresh;
        await vi.waitFor(() => expect(getWorkspaceSyncConflictSnapshot(scope)).toMatchObject({
            phase: 'ready',
            list: { conflicts: [{ path: 'fresh.txt' }] },
        }));

        expect(observedReadyPaths).not.toContainEqual(['stale.txt']);
        expect(listWorkspaceSyncConflicts).toHaveBeenCalledTimes(3);
        expect(listWorkspaceSyncConflicts).toHaveBeenNthCalledWith(3, scope);
        unsubscribe();
    });
});
