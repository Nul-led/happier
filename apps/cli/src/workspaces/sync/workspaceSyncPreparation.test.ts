import { describe, expect, it, vi } from 'vitest';
import { computeWorkspaceSyncPolicyDigest, type WorkspaceRefV1, type WorkspaceSyncRelationshipV1 } from '@happier-dev/protocol';

import { prepareWorkspaceSyncBetween } from './workspaceSyncPreparation';
import type { WorkspaceSyncStatusV1 } from './workspaceSyncTypes';

const basePolicy = { v: 1 as const, selection: 'all_files' as const, extraIgnorePatterns: [], extraIncludePatterns: [] };
const contentPolicy = { ...basePolicy, policyDigest: computeWorkspaceSyncPolicyDigest(basePolicy) };
const refs: readonly WorkspaceRefV1[] = [
  { id: 'a', serverId: 's', machineId: 'ma', rootPath: '/a', createdAtMs: 1 },
  { id: 'b', serverId: 's', machineId: 'mb', rootPath: '/b', createdAtMs: 1 },
  { id: 'c', serverId: 's', machineId: 'mc', rootPath: '/c', createdAtMs: 1 },
];
const relationship = (id: string, alpha: string, beta: string, mode: WorkspaceSyncRelationshipV1['mode'] = 'keep_both_in_sync'): WorkspaceSyncRelationshipV1 => ({
  v: 1, relationshipId: id, controllerMachineId: 'ma', alphaWorkspaceRefId: alpha, betaWorkspaceRefId: beta,
  mode, contentPolicy, enabled: true, createdAtMs: 1, updatedAtMs: 1,
});
const status = (id: string): WorkspaceSyncStatusV1 => ({
  relationshipId: id, controllerMachineId: 'ma', state: 'watching', alphaPath: '/a', betaPath: '/b', mode: 'keep_both_in_sync',
  endpointStates: {
    alpha: { connected: true, scanned: true, scanProblemCount: 0, transitionProblemCount: 0 },
    beta: { connected: true, scanned: true, scanProblemCount: 0, transitionProblemCount: 0 },
  }, conflictCount: 0, lastCycleObservedAtMs: null,
});

describe('prepareWorkspaceSyncBetween', () => {
  it('flushes a two-link route in source-to-target order and returns actual facts', async () => {
    const relationships = [relationship('ca', 'a', 'c'), relationship('ab', 'a', 'b', 'keep_synced')];
    const flush = vi.fn(async (id: string) => status(id));
    await expect(prepareWorkspaceSyncBetween({
      sourceWorkspaceRefId: 'c', targetWorkspaceRefId: 'b', readCurrent: async () => ({ workspaceRefs: refs, relationships }), flush,
    })).resolves.toEqual({ ok: true, traversed: [
      { relationshipId: 'ca', policyDigest: contentPolicy.policyDigest, status: status('ca') },
      { relationshipId: 'ab', policyDigest: contentPolicy.policyDigest, status: status('ab') },
    ] });
    expect(flush.mock.calls.map(([id]) => id)).toEqual(['ca', 'ab']);
  });

  it('reports first-link completion and the blocked second link without rollback', async () => {
    const relationships = [relationship('ca', 'a', 'c'), relationship('ab', 'a', 'b', 'keep_synced')];
    const blocked = { ...status('ab'), state: 'conflicted' as const, conflictCount: 1 };
    const flush = vi.fn(async (id: string) => id === 'ca' ? status(id) : blocked);
    await expect(prepareWorkspaceSyncBetween({
      sourceWorkspaceRefId: 'c', targetWorkspaceRefId: 'b', readCurrent: async () => ({ workspaceRefs: refs, relationships }), flush,
    })).resolves.toMatchObject({
      ok: false, errorCode: 'workspace_sync_not_clean',
      completed: [{ relationshipId: 'ca' }], blockedRelationshipId: 'ab', blockedStatus: blocked,
    });
    expect(flush).toHaveBeenCalledTimes(2);
  });

  it('stops when a traversed definition changes between links', async () => {
    const relationships = [relationship('ca', 'a', 'c'), relationship('ab', 'a', 'b', 'keep_synced')];
    let reads = 0;
    const flush = vi.fn(async (id: string) => status(id));
    const result = await prepareWorkspaceSyncBetween({
      sourceWorkspaceRefId: 'c', targetWorkspaceRefId: 'b',
      readCurrent: async () => ({ workspaceRefs: refs, relationships: ++reads < 3 ? relationships : [{ ...relationships[0]!, enabled: false }, relationships[1]!] }),
      flush,
    });
    expect(result).toMatchObject({ ok: false, errorCode: 'relationship_changed', completed: [{ relationshipId: 'ca' }], blockedRelationshipId: 'ab' });
    expect(flush).toHaveBeenCalledTimes(1);
  });
});
