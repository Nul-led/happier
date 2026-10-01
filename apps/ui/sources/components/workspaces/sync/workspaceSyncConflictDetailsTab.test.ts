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
    it('opens the canonical set resource from either endpoint without persisting root authority', async () => {
        const { createWorkspaceSyncConflictDetailsTab } = await import('./workspaceSyncConflictDetailsTab');
        const summary = {
            relationshipId: 'relationship-1',
            relationship: { mode: 'keep_both_in_sync', controllerMachineId: 'machine-alpha', enabled: true },
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
        const fromAlpha = createWorkspaceSyncConflictDetailsTab(summary, 'workspace-alpha');

        expect(fromBeta.key).toBe(fromAlpha.key);
        expect(fromBeta.resource).toEqual({
            kind: 'workspaceSyncConflicts',
            hubWorkspaceRefId: 'workspace-alpha',
            workspaceRefId: 'workspace-beta',
            controllerMachineId: 'machine-alpha',
            serverId: 'server-1',
        });
    });
});
