import { describe, expect, it } from 'vitest';
import { computeWorkspaceSyncPolicyDigest } from '@happier-dev/protocol';

import {
    projectWorkspaceSyncRelationships,
    projectWorkspaceSyncRelationshipSummaries,
    resolveWorkspaceSyncConflictCountForWorkspaceRef,
    selectWorkspaceSyncRelationshipSummariesForHandoff,
} from './workspaceSyncRelationshipModel';

const policyFields = {
    v: 1 as const,
    selection: 'git_worktree' as const,
    extraIgnorePatterns: [],
    extraIncludePatterns: [],
    includeGitDirectory: false,
};
const policy = {
    ...policyFields,
    policyDigest: computeWorkspaceSyncPolicyDigest(policyFields),
};

describe('projectWorkspaceSyncRelationships', () => {
    it('keeps one strict enabled relationship model and reports malformed entries without defaulting them', () => {
        const result = projectWorkspaceSyncRelationships([
            {
                v: 1,
                relationshipId: ' relationship-1 ',
                controllerMachineId: 'machine-1',
                alphaWorkspaceRefId: 'workspace-alpha',
                betaWorkspaceRefId: 'workspace-beta',
                mode: 'keep_both_in_sync',
                contentPolicy: policy,
                enabled: true,
                createdAtMs: 1,
                updatedAtMs: 2,
            },
            {
                v: 1,
                relationshipId: 'relationship-invalid',
                controllerMachineId: 'machine-1',
                alphaWorkspaceRefId: 'same',
                betaWorkspaceRefId: 'same',
                mode: 'unknown_mode',
                contentPolicy: policy,
                enabled: true,
                createdAtMs: 1,
                updatedAtMs: 2,
            },
        ]);

        expect(result.enabled).toEqual([
            expect.objectContaining({
                relationshipId: 'relationship-1',
                mode: 'keep_both_in_sync',
            }),
        ]);
        expect(result.byId.get('relationship-1')?.alphaWorkspaceRefId).toBe('workspace-alpha');
        expect(result.invalidCount).toBe(1);
    });

    it('keeps disabled relationships manageable without exposing them as selectable', () => {
        const result = projectWorkspaceSyncRelationships([{
            v: 1,
            relationshipId: 'relationship-disabled',
            controllerMachineId: 'machine-1',
            alphaWorkspaceRefId: 'workspace-alpha',
            betaWorkspaceRefId: 'workspace-beta',
            mode: 'keep_synced',
            contentPolicy: policy,
            enabled: false,
            createdAtMs: 1,
            updatedAtMs: 2,
        }]);

        expect(result.enabled).toEqual([]);
        expect(result.all).toEqual([expect.objectContaining({ relationshipId: 'relationship-disabled', enabled: false })]);
        expect(result.byId.size).toBe(1);
        expect(result.invalidCount).toBe(0);
    });

    it('resolves endpoint identities once and deduplicates conflict counts by relationship', () => {
        const relationships = projectWorkspaceSyncRelationships([
            {
                v: 1,
                relationshipId: 'relationship-1',
                controllerMachineId: 'machine-alpha',
                alphaWorkspaceRefId: 'workspace-alpha',
                betaWorkspaceRefId: 'workspace-beta',
                mode: 'keep_both_in_sync',
                contentPolicy: policy,
                enabled: true,
                createdAtMs: 1,
                updatedAtMs: 2,
            },
            {
                v: 1,
                relationshipId: 'relationship-2',
                controllerMachineId: 'machine-alpha',
                alphaWorkspaceRefId: 'workspace-alpha',
                betaWorkspaceRefId: 'workspace-gamma',
                mode: 'keep_synced',
                contentPolicy: policy,
                enabled: true,
                createdAtMs: 1,
                updatedAtMs: 2,
            },
        ]);
        const summaries = projectWorkspaceSyncRelationshipSummaries({
            relationships,
            workspaceRefs: [
                { id: 'workspace-alpha', serverId: 'server-1', machineId: 'machine-alpha', rootPath: '/alpha', label: 'Alpha', createdAtMs: 1 },
                { id: 'workspace-beta', serverId: 'server-1', machineId: 'machine-beta', rootPath: '/beta', label: 'Beta', createdAtMs: 1 },
                { id: 'workspace-gamma', serverId: 'server-1', machineId: 'machine-gamma', rootPath: '/gamma', label: null, createdAtMs: 1 },
            ],
            statuses: [
                { relationshipId: 'relationship-1', controllerMachineId: 'machine-alpha', state: 'conflicted', alphaPath: '/alpha', betaPath: '/beta', mode: 'keep_both_in_sync', changedFiles: 2, conflictCount: 3, lastSuccessfulSyncAtMs: 4 },
                // A repeated status observation must never double the session-header count.
                { relationshipId: 'relationship-1', controllerMachineId: 'machine-alpha', state: 'conflicted', alphaPath: '/alpha', betaPath: '/beta', mode: 'keep_both_in_sync', changedFiles: 2, conflictCount: 3, lastSuccessfulSyncAtMs: 4 },
                { relationshipId: 'relationship-2', controllerMachineId: 'machine-alpha', state: 'watching', alphaPath: '/alpha', betaPath: '/gamma', mode: 'keep_synced', changedFiles: 0, conflictCount: 2, lastSuccessfulSyncAtMs: 5 },
            ],
            machineNamesById: {
                'machine-alpha': 'Alpha Mac',
                'machine-beta': 'Beta workstation',
            },
        });

        expect(summaries.map((summary) => [summary.relationshipId, summary.alpha.label, summary.beta.label])).toEqual([
            ['relationship-1', 'Alpha', 'Beta'],
            ['relationship-2', 'Alpha', '/gamma'],
        ]);
        expect(summaries[0]).toMatchObject({
            alpha: { machineName: 'Alpha Mac' },
            beta: { machineName: 'Beta workstation' },
        });
        expect(summaries[1]?.beta.machineName).toBeNull();
        expect(resolveWorkspaceSyncConflictCountForWorkspaceRef(summaries, 'workspace-alpha')).toBe(5);
        expect(resolveWorkspaceSyncConflictCountForWorkspaceRef(summaries, 'workspace-beta')).toBe(3);
    });

    it('selects only enabled relationships that safely match the current handoff endpoint direction', () => {
        const relationships = projectWorkspaceSyncRelationships([
            {
                v: 1,
                relationshipId: 'forward-one-way',
                controllerMachineId: 'machine-source',
                alphaWorkspaceRefId: 'workspace-source',
                betaWorkspaceRefId: 'workspace-target',
                mode: 'keep_synced',
                contentPolicy: policy,
                enabled: true,
                createdAtMs: 1,
                updatedAtMs: 2,
            },
            {
                v: 1,
                relationshipId: 'reverse-one-way',
                controllerMachineId: 'machine-target',
                alphaWorkspaceRefId: 'workspace-target',
                betaWorkspaceRefId: 'workspace-source',
                mode: 'mirror_exactly',
                contentPolicy: policy,
                enabled: true,
                createdAtMs: 1,
                updatedAtMs: 2,
            },
            {
                v: 1,
                relationshipId: 'reverse-two-way',
                controllerMachineId: 'machine-target',
                alphaWorkspaceRefId: 'workspace-target',
                betaWorkspaceRefId: 'workspace-source',
                mode: 'keep_both_in_sync',
                contentPolicy: policy,
                enabled: true,
                createdAtMs: 1,
                updatedAtMs: 2,
            },
            {
                v: 1,
                relationshipId: 'disabled-match',
                controllerMachineId: 'machine-source',
                alphaWorkspaceRefId: 'workspace-source',
                betaWorkspaceRefId: 'workspace-target',
                mode: 'keep_synced',
                contentPolicy: policy,
                enabled: false,
                createdAtMs: 1,
                updatedAtMs: 2,
            },
            {
                v: 1,
                relationshipId: 'wrong-source',
                controllerMachineId: 'machine-other',
                alphaWorkspaceRefId: 'workspace-other-source',
                betaWorkspaceRefId: 'workspace-target',
                mode: 'keep_synced',
                contentPolicy: policy,
                enabled: true,
                createdAtMs: 1,
                updatedAtMs: 2,
            },
        ]);
        const summaries = projectWorkspaceSyncRelationshipSummaries({
            relationships,
            workspaceRefs: [
                { id: 'workspace-source', serverId: 'server-1', machineId: 'machine-source', rootPath: '/Users/tester/repo/', label: 'Source project', createdAtMs: 1 },
                { id: 'workspace-other-source', serverId: 'server-2', machineId: 'machine-other', rootPath: '/Users/tester/repo/', label: 'Other source', createdAtMs: 1 },
                { id: 'workspace-target', serverId: 'server-1', machineId: 'machine-target', rootPath: 'C:\\Repos\\Target\\', label: 'Destination project', createdAtMs: 1 },
            ],
            statuses: [],
        });

        expect(selectWorkspaceSyncRelationshipSummariesForHandoff(summaries, {
            source: { serverId: 'server-1', machineId: 'machine-source', rootPath: '/Users/tester/repo' },
            target: { serverId: 'server-1', machineId: 'machine-target', rootPath: 'c:/repos/target' },
        }).map((summary) => summary.relationshipId)).toEqual([
            'forward-one-way',
            'reverse-two-way',
        ]);
    });
});
