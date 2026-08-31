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
            alpha: { workspaceRefId: 'workspace-alpha', label: 'Alpha' },
            beta: { workspaceRefId: 'workspace-beta', label: 'Beta' },
        } as Parameters<typeof createWorkspaceSyncConflictDetailsTab>[0];

        const fromBeta = createWorkspaceSyncConflictDetailsTab(summary, 'workspace-beta');

        expect(fromBeta.resource).toEqual(expect.objectContaining({
            localSide: 'beta',
            alphaLabel: 'Alpha',
            betaLabel: 'Beta',
        }));
    });
});
