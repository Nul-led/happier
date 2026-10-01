import { describe, expect, it, vi } from 'vitest';

vi.mock('@/text', () => ({ t: (key: string) => key }));

describe('createWorkspaceSyncRelationshipDetailsTab', () => {
    it('keeps the existing details identity and resource while giving routine row navigation a general title', async () => {
        const { createWorkspaceSyncRelationshipDetailsTab } = await import('./workspaceSyncRelationshipDetailsTab');
        const summary = {
            relationshipId: 'relationship-1',
            relationship: { controllerMachineId: 'machine-alpha', mode: 'keep_synced', enabled: true },
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
        } as Parameters<typeof createWorkspaceSyncRelationshipDetailsTab>[0];

        const tab = createWorkspaceSyncRelationshipDetailsTab(summary, 'workspace-alpha');

        expect(tab).toEqual(expect.objectContaining({
            key: 'workspace-sync-conflicts:workspace-alpha',
            kind: 'workspaceSyncConflicts',
            title: 'Alpha → Beta',
            resource: expect.objectContaining({
                kind: 'workspaceSyncConflicts',
                hubWorkspaceRefId: 'workspace-alpha',
                workspaceRefId: 'workspace-alpha',
                controllerMachineId: 'machine-alpha',
            }),
        }));
    });
});
