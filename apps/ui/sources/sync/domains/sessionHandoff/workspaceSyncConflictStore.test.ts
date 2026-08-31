import { beforeEach, describe, expect, it, vi } from 'vitest';

const listWorkspaceSyncConflicts = vi.hoisted(() => vi.fn());

vi.mock('@/sync/ops/workspaceSync', () => ({
    listWorkspaceSyncConflicts: (input: unknown) => listWorkspaceSyncConflicts(input),
}));

import {
    getWorkspaceSyncConflictSnapshot,
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
            relationshipId: 'relationship-1',
            totalCount: 2,
            shownCount: 1,
            truncatedCount: 1,
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
        });
    });
});
