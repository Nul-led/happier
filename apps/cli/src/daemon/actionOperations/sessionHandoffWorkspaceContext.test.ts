import { describe, expect, it } from 'vitest';

import { computeWorkspaceSyncPolicyDigest } from '@/workspaces/sync/workspaceSyncTypes';
import { resolveSessionHandoffWorkspaceContext } from './sessionHandoffWorkspaceContext';

const policyInput = {
  v: 1 as const,
  selection: 'all_files' as const,
  extraIgnorePatterns: [],
  extraIncludePatterns: [],
};
const contentPolicy = {
  ...policyInput,
  policyDigest: computeWorkspaceSyncPolicyDigest(policyInput),
};
const refs = [
  { id: 'source-ref', serverId: 'server-1', machineId: 'source-machine', rootPath: '/source', createdAtMs: 1 },
  { id: 'target-ref', serverId: 'server-1', machineId: 'target-machine', rootPath: '/target', createdAtMs: 1 },
  { id: 'hub-ref', serverId: 'server-1', machineId: 'hub-machine', rootPath: '/hub', createdAtMs: 1 },
];
const relationship = {
  v: 1 as const,
  relationshipId: 'relationship-1',
  controllerMachineId: 'source-machine',
  alphaWorkspaceRefId: 'source-ref',
  betaWorkspaceRefId: 'target-ref',
  mode: 'keep_synced' as const,
  contentPolicy,
  enabled: true,
  createdAtMs: 1,
  updatedAtMs: 1,
};

describe('resolveSessionHandoffWorkspaceContext', () => {
  it('derives relationship endpoints from its canonical settings record and rejects a mismatched picker target', () => {
    expect(resolveSessionHandoffWorkspaceContext({
      action: { kind: 'relationship', relationshipId: 'relationship-1', flushBeforeCommit: true },
      workspaceRefs: refs,
      relationships: [relationship],
      sourceMachineId: 'source-machine',
      sourceRootPath: '/source',
      targetMachineId: 'target-machine',
    })).toEqual({
      sourceWorkspaceRefId: 'source-ref',
      targetWorkspaceRefId: 'target-ref',
      sourceRootPath: '/source',
      targetRootPath: '/target',
      controllerMachineId: 'source-machine',
      contentSelection: 'all_files',
      relationshipIds: ['relationship-1'],
      contentSelections: ['all_files'],
    });

    expect(() => resolveSessionHandoffWorkspaceContext({
      action: { kind: 'relationship', relationshipId: 'relationship-1', flushBeforeCommit: true },
      workspaceRefs: refs,
      relationships: [relationship],
      sourceMachineId: 'source-machine',
      sourceRootPath: '/source',
      targetMachineId: 'target-machine',
      targetRootPath: '/somewhere-else',
    })).toThrowError(expect.objectContaining({ code: 'relationship_target_mismatch' }));
  });

  it('fails closed when the source machine/root scope is ambiguous', () => {
    expect(() => resolveSessionHandoffWorkspaceContext({
      action: { kind: 'relationship', relationshipId: 'relationship-1', flushBeforeCommit: true },
      workspaceRefs: [...refs, { ...refs[0]!, id: 'duplicate-source' }],
      relationships: [relationship],
      sourceMachineId: 'source-machine',
      sourceRootPath: '/source',
      targetMachineId: 'target-machine',
    })).toThrowError(expect.objectContaining({ code: 'relationship_source_mismatch' }));
  });

  it('derives a linked-spoke destination and ordered route from current settings', () => {
    const sourceHub = {
      ...relationship,
      relationshipId: 'source-hub',
      controllerMachineId: 'hub-machine',
      alphaWorkspaceRefId: 'hub-ref',
      betaWorkspaceRefId: 'source-ref',
      mode: 'keep_both_in_sync' as const,
    };
    const hubTarget = {
      ...relationship,
      relationshipId: 'hub-target',
      controllerMachineId: 'hub-machine',
      alphaWorkspaceRefId: 'hub-ref',
      betaWorkspaceRefId: 'target-ref',
    };
    expect(resolveSessionHandoffWorkspaceContext({
      action: { kind: 'linked_workspace' },
      workspaceRefs: refs,
      relationships: [sourceHub, hubTarget],
      sourceMachineId: 'source-machine',
      sourceRootPath: '/source',
      targetMachineId: 'target-machine',
      targetRootPath: '/target',
    })).toMatchObject({
      sourceWorkspaceRefId: 'source-ref',
      targetWorkspaceRefId: 'target-ref',
      controllerMachineId: 'hub-machine',
      relationshipIds: ['source-hub', 'hub-target'],
      contentSelections: ['all_files', 'all_files'],
    });
  });
});
