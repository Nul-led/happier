import { describe, expect, it, vi } from 'vitest';

vi.mock('@/text', () => ({ t: (key: string) => key }));
vi.mock('@/sync/domains/sessionHandoff/useWorkspaceSyncRelationshipSummaries', () => ({
    resolveWorkspaceSyncStatusScope: () => ({
        relationshipId: 'relationship-1',
        controllerMachineId: 'machine-alpha',
        serverId: 'server-1',
    }),
}));

describe('createWorkspaceSyncConflictDetailsTab', () => {
    it('binds local and remote conflict actions to the workspace that opened the details tab', async () => {
        const { createWorkspaceSyncConflictDetailsTab } = await import('./workspaceSyncConflictDetailsTab');
        const summary = {
            relationshipId: 'relationship-1',
            relationship: { mode: 'keep_both_in_sync', enabled: true },
            alpha: {
                workspaceRefId: 'workspace-alpha',
                label: 'Alpha',
                workspaceRef: {
                    id: 'workspace-alpha', serverId: 'server-1', machineId: 'machine-alpha',
                    rootPath: '/work/alpha', label: 'Alpha', createdAtMs: 1,
                },
                machineName: 'Alpha Mac',
            },
            beta: {
                workspaceRefId: 'workspace-beta',
                label: 'Beta',
                workspaceRef: {
                    id: 'workspace-beta', serverId: 'server-1', machineId: 'machine-beta',
                    rootPath: '/work/beta', label: 'Beta', createdAtMs: 1,
                },
                machineName: 'Beta workstation',
            },
        } as Parameters<typeof createWorkspaceSyncConflictDetailsTab>[0];

        const fromBeta = createWorkspaceSyncConflictDetailsTab(summary, 'workspace-beta');

        expect(fromBeta.resource).toEqual(expect.objectContaining({
            localSide: 'beta',
            alpha: {
                label: 'Alpha',
                machineId: 'machine-alpha',
                machineName: 'Alpha Mac',
                rootPath: '/work/alpha',
            },
            beta: {
                label: 'Beta',
                machineId: 'machine-beta',
                machineName: 'Beta workstation',
                rootPath: '/work/beta',
            },
        }));
    });
});
