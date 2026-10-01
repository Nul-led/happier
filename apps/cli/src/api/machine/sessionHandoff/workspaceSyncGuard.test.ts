import { describe, expect, it } from 'vitest';

import { hasUnsupportedWorkspaceAction } from './workspaceSyncGuard';
import { computeWorkspaceSyncPolicyDigest } from '@happier-dev/protocol';

const policyInput = {
  v: 1 as const,
  selection: 'all_files' as const,
  extraIgnorePatterns: [],
  extraIncludePatterns: [],
};
const policy = { ...policyInput, policyDigest: computeWorkspaceSyncPolicyDigest(policyInput) };

describe('workspace sync handoff admission', () => {
  it('admits each canonical action instead of blanket-rejecting non-none actions', () => {
    for (const workspaceAction of [
      { kind: 'none' },
      { kind: 'copy_once', contentPolicy: policy },
      {
        kind: 'create_relationship',
        mode: 'keep_synced',
        contentPolicy: policy,
        flushBeforeCommit: true,
      },
      { kind: 'relationship', relationshipId: 'relationship-1', flushBeforeCommit: true },
    ]) {
      expect(hasUnsupportedWorkspaceAction({ workspaceAction })).toBe(false);
    }
  });

  it('reserves update-required only for the deliberately retired workspace corridor', () => {
    expect(hasUnsupportedWorkspaceAction({
      workspaceTransfer: { enabled: true, strategy: 'sync_changes' },
    })).toBe(true);
    expect(hasUnsupportedWorkspaceAction({
      workspaceReplicationReverseSourceRootPath: '/old/source',
    })).toBe(true);
  });

  it('leaves malformed canonical input to the strict request schema', () => {
    expect(hasUnsupportedWorkspaceAction({ workspaceAction: { kind: 'future_mode' } })).toBe(false);
  });
});
