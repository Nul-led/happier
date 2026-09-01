import { describe, expect, it } from 'vitest';

import { computeWorkspaceSyncPolicyDigest } from '@/workspaces/sync/workspaceSyncTypes';
import { resolveSessionHandoffWorkspaceContext } from './sessionHandoffWorkspaceContext';

const policyInput = {
  v: 1 as const,
  selection: 'all_files' as const,
  extraIgnorePatterns: [],
  extraIncludePatterns: [],
  includeGitDirectory: false,
};
const contentPolicy = {
  ...policyInput,
  policyDigest: computeWorkspaceSyncPolicyDigest(policyInput),
};
const refs = [
  { id: 'source-ref', serverId: 'server-1', machineId: 'source-machine', rootPath: '/source', createdAtMs: 1 },
  { id: 'target-ref', serverId: 'server-1', machineId: 'target-machine', rootPath: '/target', createdAtMs: 1 },
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
  it('resolves copy_once only from the exact persisted WorkspaceRef identities and scopes', () => {
    expect(resolveSessionHandoffWorkspaceContext({
      action: { kind: 'copy_once', contentPolicy },
      workspaceRefs: refs,
      relationships: [],
      sourceMachineId: 'source-machine',
      sourceRootPath: '/source',
      targetMachineId: 'target-machine',
      targetRootPath: '/target',
      requestedSourceWorkspaceRefId: 'source-ref',
      requestedTargetWorkspaceRefId: 'target-ref',
    })).toEqual({
      sourceWorkspaceRefId: 'source-ref',
      targetWorkspaceRefId: 'target-ref',
      sourceRootPath: '/source',
      targetRootPath: '/target',
      controllerMachineId: 'source-machine',
      contentSelection: 'all_files',
    });
  });

  it('rejects copy_once when a caller omits exact persisted ref identities', () => {
    expect(() => resolveSessionHandoffWorkspaceContext({
      action: { kind: 'copy_once', contentPolicy },
      workspaceRefs: refs,
      relationships: [],
      sourceMachineId: 'source-machine',
      sourceRootPath: '/source',
      targetMachineId: 'target-machine',
      targetRootPath: '/target',
    })).toThrowError(expect.objectContaining({ code: 'workspace_ref_not_ready' }));
  });

  it('derives relationship endpoints from its canonical settings record and rejects a mismatched picker target', () => {
    expect(resolveSessionHandoffWorkspaceContext({
      action: { kind: 'relationship', relationshipId: 'relationship-1', flushBeforeCommit: true },
      workspaceRefs: refs,
      relationships: [relationship],
      sourceMachineId: 'source-machine',
      sourceRootPath: '/source',
      targetMachineId: 'target-machine',
    })).toMatchObject({
      sourceWorkspaceRefId: 'source-ref',
      targetWorkspaceRefId: 'target-ref',
      targetRootPath: '/target',
      controllerMachineId: 'source-machine',
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

  it('fails closed when a machine/root scope is ambiguous', () => {
    expect(() => resolveSessionHandoffWorkspaceContext({
      action: { kind: 'copy_once', contentPolicy },
      workspaceRefs: [...refs, { ...refs[0]!, id: 'duplicate-source' }],
      relationships: [],
      sourceMachineId: 'source-machine',
      sourceRootPath: '/source',
      targetMachineId: 'target-machine',
      targetRootPath: '/target',
      requestedSourceWorkspaceRefId: 'source-ref',
      requestedTargetWorkspaceRefId: 'target-ref',
    })).toThrowError(expect.objectContaining({ code: 'workspace_ref_not_ready' }));
  });
});
