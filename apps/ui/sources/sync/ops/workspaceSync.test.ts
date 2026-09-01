import { beforeEach, describe, expect, it, vi } from 'vitest';

import { RPC_METHODS } from '@happier-dev/protocol/rpc';

const machineRpcWithServerScope = vi.hoisted(() => vi.fn());

vi.mock('@/sync/runtime/orchestration/serverScopedRpc/serverScopedMachineRpc', () => ({
    machineRpcWithServerScope: (input: unknown) => machineRpcWithServerScope(input),
}));

import {
    deleteWorkspaceSyncConflictLoser,
    getWorkspaceSyncStatus,
    listWorkspaceSyncConflicts,
    listWorkspaceSyncStatuses,
    readWorkspaceSyncFile,
    disableWorkspaceSyncRelationship,
    enableWorkspaceSyncRelationship,
    terminatePersistedWorkspaceSyncRelationship,
    inspectWorkspaceSyncLegacyState,
} from './workspaceSync';

const status = {
    relationshipId: 'relationship-1',
    controllerMachineId: 'machine-controller',
    state: 'watching' as const,
    alphaPath: '/alpha',
    betaPath: '/beta',
    mode: 'keep_synced' as const,
    changedFiles: 2,
    conflictCount: 1,
    lastSuccessfulSyncAtMs: 42,
};

describe('workspace sync UI operations', () => {
    beforeEach(() => {
        machineRpcWithServerScope.mockReset();
    });

    it('reinspects legacy state without publishing a cleanup mutation', async () => {
        machineRpcWithServerScope.mockResolvedValueOnce({
            status: 'legacy_workspace_sync_state_unsupported',
            classification: 'retired_v1',
            quarantinePath: '/private/state/workspace-replication.retired-123',
            schemaVersion: 1,
        });

        await expect(inspectWorkspaceSyncLegacyState({ controllerMachineId: 'machine-controller' }))
            .resolves.toMatchObject({ classification: 'retired_v1', schemaVersion: 1 });
        expect(machineRpcWithServerScope).toHaveBeenCalledWith({
            machineId: 'machine-controller',
            serverId: undefined,
            method: RPC_METHODS.DAEMON_WORKSPACE_SYNC_LEGACY_INSPECT,
            payload: {},
        });
    });

    it('reads strictly validated status through the relationship controller machine', async () => {
        machineRpcWithServerScope
            .mockResolvedValueOnce({ statuses: [status] })
            .mockResolvedValueOnce({ status });

        await expect(listWorkspaceSyncStatuses({
            controllerMachineId: 'machine-controller',
            serverId: 'server-1',
        })).resolves.toEqual([status]);
        await expect(getWorkspaceSyncStatus({
            controllerMachineId: 'machine-controller',
            serverId: 'server-1',
            relationshipId: 'relationship-1',
        })).resolves.toEqual(status);

        expect(machineRpcWithServerScope).toHaveBeenNthCalledWith(1, {
            machineId: 'machine-controller',
            serverId: 'server-1',
            method: RPC_METHODS.DAEMON_WORKSPACE_SYNC_LIST,
            payload: {},
        });
        expect(machineRpcWithServerScope).toHaveBeenNthCalledWith(2, {
            machineId: 'machine-controller',
            serverId: 'server-1',
            method: RPC_METHODS.DAEMON_WORKSPACE_SYNC_GET,
            payload: { relationshipId: 'relationship-1' },
        });
    });

    it('maps transient and conflict commands without inventing client-side state', async () => {
        const paused = { ...status, state: 'paused' as const };
        machineRpcWithServerScope
            .mockResolvedValueOnce({
                relationshipId: 'relationship-1',
                totalCount: 1,
                shownCount: 1,
                truncatedCount: 0,
                conflicts: [{
                    relationshipId: 'relationship-1',
                    path: 'README.md',
                    alpha: { kind: 'file', digest: 'a'.repeat(64) },
                    beta: { kind: 'file', digest: 'b'.repeat(64) },
                }],
            })
            .mockResolvedValueOnce({ status: paused });

        await expect(listWorkspaceSyncConflicts({
            controllerMachineId: 'machine-controller',
            serverId: 'server-1',
            relationshipId: 'relationship-1',
        })).resolves.toMatchObject({ totalCount: 1, shownCount: 1 });
        await expect(deleteWorkspaceSyncConflictLoser({
            controllerMachineId: 'machine-controller',
            serverId: 'server-1',
            request: {
                relationshipId: 'relationship-1',
                path: 'README.md',
                keep: 'alpha',
                expectedDigest: 'b'.repeat(64),
                expectedKind: 'file',
            },
        })).resolves.toEqual(paused);
        expect(machineRpcWithServerScope.mock.calls.map(([input]) => input.method)).toEqual([
            RPC_METHODS.DAEMON_WORKSPACE_SYNC_CONFLICTS_LIST,
            RPC_METHODS.DAEMON_WORKSPACE_SYNC_CONFLICT_DELETE,
        ]);
    });

    it('validates bounded file previews and rejects malformed daemon responses', async () => {
        machineRpcWithServerScope
            .mockResolvedValueOnce({
                status: 'text',
                digest: 'c'.repeat(64),
                size: 5,
                text: 'hello',
            })
            .mockResolvedValueOnce({ statuses: [{ ...status, state: 'invented' }] });

        await expect(readWorkspaceSyncFile({
            controllerMachineId: 'machine-controller',
            serverId: 'server-1',
            request: {
                relationshipId: 'relationship-1',
                side: 'alpha',
                path: 'README.md',
                maxBytes: 1024,
            },
        })).resolves.toMatchObject({ status: 'text', text: 'hello' });
        await expect(listWorkspaceSyncStatuses({
            controllerMachineId: 'machine-controller',
            serverId: 'server-1',
        })).rejects.toThrow('Unsupported response');
    });

    it('routes each lifecycle intent through exactly one daemon operation', async () => {
        const scope = {
            controllerMachineId: 'machine-controller',
            serverId: 'server-1',
            relationshipId: 'relationship-1',
        };
        machineRpcWithServerScope
            .mockResolvedValueOnce({ ok: true })
            .mockResolvedValueOnce({ ok: true })
            .mockResolvedValueOnce({ ok: true });

        await expect(disableWorkspaceSyncRelationship(scope)).resolves.toBeUndefined();
        await expect(enableWorkspaceSyncRelationship(scope)).resolves.toBeUndefined();
        await expect(terminatePersistedWorkspaceSyncRelationship(scope)).resolves.toBeUndefined();
        expect(machineRpcWithServerScope.mock.calls.map(([input]) => input.method)).toEqual([
            RPC_METHODS.DAEMON_WORKSPACE_SYNC_PAUSE,
            RPC_METHODS.DAEMON_WORKSPACE_SYNC_RESUME,
            RPC_METHODS.DAEMON_WORKSPACE_SYNC_TERMINATE,
        ]);

        machineRpcWithServerScope.mockResolvedValueOnce({ status });
        await expect(disableWorkspaceSyncRelationship(scope)).rejects.toThrow('Unsupported response');
    });
});
