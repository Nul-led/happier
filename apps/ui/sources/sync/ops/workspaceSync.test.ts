import { beforeEach, describe, expect, it, vi } from 'vitest';

import { RPC_METHODS } from '@happier-dev/protocol/rpc';
import { computeWorkspaceSyncPolicyDigest } from '@happier-dev/protocol';

const machineRpcWithServerScope = vi.hoisted(() => vi.fn());
const mutateAccountSettingsOnce = vi.hoisted(() => vi.fn());
const settingsState = vi.hoisted(() => ({ settingsVersion: 7 as number | null }));

vi.mock('@/sync/runtime/orchestration/serverScopedRpc/serverScopedMachineRpc', () => ({
    machineRpcWithServerScope: (input: unknown) => machineRpcWithServerScope(input),
}));
vi.mock('@/sync/sync', () => ({ sync: { mutateAccountSettingsOnce } }));
vi.mock('@/sync/domains/state/storageStore', () => ({
    storage: { getState: () => ({ settingsVersion: settingsState.settingsVersion }) },
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
        settingsState.settingsVersion = 7;
        mutateAccountSettingsOnce.mockReset();
        mutateAccountSettingsOnce.mockImplementation(async (input: Readonly<{
            expectedSettingsVersion: number;
            mutate: (raw: Readonly<Record<string, unknown>>) => Readonly<{
                settings: Record<string, unknown>;
                value: unknown;
            }>;
        }>) => {
            const mutation = input.mutate(settingsRaw);
            settingsRaw = mutation.settings;
            settingsState.settingsVersion = (settingsState.settingsVersion ?? 0) + 1;
            return {
                status: 'applied' as const,
                settingsVersion: settingsState.settingsVersion,
                value: mutation.value,
            };
        });
        settingsRaw = { workspaceSyncRelationshipsV1: [relationship] };
    });

    let settingsRaw: Record<string, unknown>;
    const relationshipPolicyFields = {
        v: 1 as const,
        selection: 'all_files' as const,
        extraIgnorePatterns: [],
        extraIncludePatterns: [],
        includeGitDirectory: false,
    };
    const relationship = {
        v: 1 as const,
        relationshipId: 'relationship-1',
        controllerMachineId: 'machine-controller',
        alphaWorkspaceRefId: 'workspace-alpha',
        betaWorkspaceRefId: 'workspace-beta',
        mode: 'keep_synced' as const,
        contentPolicy: {
            ...relationshipPolicyFields,
            policyDigest: computeWorkspaceSyncPolicyDigest(relationshipPolicyFields),
        },
        enabled: true,
        createdAtMs: 1,
        updatedAtMs: 1,
    };

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

    it('writes lifecycle desired state only through Account Settings and leaves reconciliation to the daemon', async () => {
        const scope = {
            controllerMachineId: 'machine-controller',
            serverId: 'server-1',
            relationshipId: 'relationship-1',
        };
        await expect(disableWorkspaceSyncRelationship(scope)).resolves.toBeUndefined();
        expect((settingsRaw.workspaceSyncRelationshipsV1 as any[])[0]?.enabled).toBe(false);

        await expect(enableWorkspaceSyncRelationship(scope)).resolves.toBeUndefined();
        expect((settingsRaw.workspaceSyncRelationshipsV1 as any[])[0]?.enabled).toBe(true);

        await expect(terminatePersistedWorkspaceSyncRelationship(scope)).resolves.toBeUndefined();
        expect(settingsRaw.workspaceSyncRelationshipsV1).toEqual([]);
        expect(machineRpcWithServerScope).not.toHaveBeenCalled();
    });

    it('removes a relationship without requiring the controller to be online', async () => {
        await expect(terminatePersistedWorkspaceSyncRelationship({
            controllerMachineId: 'machine-controller',
            serverId: 'server-1',
            relationshipId: 'relationship-1',
        })).resolves.toBeUndefined();

        expect(settingsRaw.workspaceSyncRelationshipsV1).toEqual([]);
        expect(machineRpcWithServerScope).not.toHaveBeenCalled();
    });
});
