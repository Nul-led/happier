import { describe, expect, it } from 'vitest';
import { computeWorkspaceSyncPolicyDigest } from './workspaceSyncTypes';

describe('workspace sync types', () => {
  it('includes order-sensitive Git pattern semantics in the canonical digest', () => {
    const left = computeWorkspaceSyncPolicyDigest({
      v: 1, selection: 'git_worktree', extraIgnorePatterns: ['dist', 'node_modules'],
      extraIncludePatterns: [], includeGitDirectory: false,
    });
    const right = computeWorkspaceSyncPolicyDigest({
      v: 1, selection: 'git_worktree', extraIgnorePatterns: ['node_modules', 'dist'],
      extraIncludePatterns: [], includeGitDirectory: false,
    });
    expect(left).not.toBe(right);
    expect(left).toMatch(/^[a-f0-9]{64}$/);
  });
});
