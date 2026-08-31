import { describe, expect, it } from 'vitest';
import {
    computeWorkspaceSyncPolicyDigest,
    type WorkspaceSyncRelationshipV1,
} from '@happier-dev/protocol';

import {
    removeWorkspaceSyncRelationshipRecord,
    setWorkspaceSyncRelationshipEnabled,
    upsertWorkspaceSyncRelationshipRecord,
} from './workspaceSyncRelationshipMutations';

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

function relationship(patch: Partial<WorkspaceSyncRelationshipV1> = {}): WorkspaceSyncRelationshipV1 {
    return {
        v: 1,
        relationshipId: 'relationship-1',
        controllerMachineId: 'machine-alpha',
        alphaWorkspaceRefId: 'workspace-alpha',
        betaWorkspaceRefId: 'workspace-beta',
        mode: 'keep_synced',
        contentPolicy: policy,
        enabled: true,
        createdAtMs: 10,
        updatedAtMs: 10,
        ...patch,
    };
}

describe('workspace sync Account Settings relationship mutations', () => {
    it('creates, updates, disables, enables, and removes through one strict collection owner', () => {
        const created = upsertWorkspaceSyncRelationshipRecord([], relationship());
        expect(created).toEqual([relationship()]);

        const updated = upsertWorkspaceSyncRelationshipRecord(created, relationship({ updatedAtMs: 20 }));
        expect(updated).toEqual([expect.objectContaining({
            relationshipId: 'relationship-1',
            mode: 'keep_synced',
            createdAtMs: 10,
            updatedAtMs: 20,
        })]);

        const disabled = setWorkspaceSyncRelationshipEnabled(updated, {
            relationshipId: 'relationship-1',
            enabled: false,
            updatedAtMs: 30,
        });
        expect(disabled[0]).toMatchObject({ enabled: false, updatedAtMs: 30 });

        const enabled = setWorkspaceSyncRelationshipEnabled(disabled, {
            relationshipId: 'relationship-1',
            enabled: true,
            updatedAtMs: 40,
        });
        expect(enabled[0]).toMatchObject({ enabled: true, updatedAtMs: 40 });
        expect(removeWorkspaceSyncRelationshipRecord(enabled, 'relationship-1')).toEqual([]);
    });

    it('requires a new relationship identity when the durable definition changes', () => {
        const created = upsertWorkspaceSyncRelationshipRecord([], relationship());

        expect(() => upsertWorkspaceSyncRelationshipRecord(created, relationship({
            mode: 'keep_both_in_sync',
            updatedAtMs: 20,
        }))).toThrow('workspace_sync_relationship_definition_immutable');
    });

    it('requires explicit replacement before another definition can claim the same endpoint pair', () => {
        const created = upsertWorkspaceSyncRelationshipRecord([], relationship());

        expect(() => upsertWorkspaceSyncRelationshipRecord(created, relationship({
            relationshipId: 'relationship-2',
            mode: 'mirror_exactly',
            updatedAtMs: 20,
        }))).toThrow('workspace_sync_relationship_replacement_required');
        expect(() => upsertWorkspaceSyncRelationshipRecord(created, relationship({
            relationshipId: 'relationship-3',
            controllerMachineId: 'machine-beta',
            alphaWorkspaceRefId: 'workspace-beta',
            betaWorkspaceRefId: 'workspace-alpha',
            updatedAtMs: 20,
        }))).toThrow('workspace_sync_relationship_replacement_required');
    });

    it('fails closed instead of erasing malformed or unknown relationship state', () => {
        expect(() => upsertWorkspaceSyncRelationshipRecord([{ relationshipId: 'malformed' }], relationship()))
            .toThrow('workspace_sync_settings_invalid');
        expect(() => setWorkspaceSyncRelationshipEnabled([], {
            relationshipId: 'missing',
            enabled: false,
            updatedAtMs: 30,
        })).toThrow('workspace_sync_relationship_not_found');
        expect(removeWorkspaceSyncRelationshipRecord([], 'missing')).toEqual([]);
    });
});
