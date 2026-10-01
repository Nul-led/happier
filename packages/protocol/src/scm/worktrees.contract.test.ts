import { describe, expect, it } from 'vitest';

import {
  SCM_WORKTREE_REMOVE_AUTHORIZATION_TOKEN,
  ScmWorktreeCreateRequestSchema,
  ScmWorktreeCreateResponseSchema,
  ScmWorktreePruneRequestSchema,
  ScmWorktreeRemoveRequestSchema,
} from './worktrees.js';

describe('scmWorktrees protocol contracts', () => {
  it('accepts typed failed creation without fabricating success identities', () => {
    expect(ScmWorktreeCreateResponseSchema.safeParse({ success: false, errorCode: 'NOT_REPOSITORY' }).success).toBe(true);
    expect(ScmWorktreeCreateResponseSchema.safeParse({ success: true }).success).toBe(false);
  });
  it('accepts a cwd-only prune request', () => {
    const parsed = ScmWorktreePruneRequestSchema.parse({
      cwd: '/repo',
    });

    expect(parsed.cwd).toBe('/repo');
  });

  it('accepts optional create-worktree displayName, baseRef, and branchMode fields', () => {
    const parsed = ScmWorktreeCreateRequestSchema.parse({
      cwd: '/repo/packages/app',
      displayName: 'feature/auth',
      baseRef: 'origin/main',
      branchMode: 'existing',
    });

    expect(parsed).toMatchObject({
      cwd: '/repo/packages/app',
      displayName: 'feature/auth',
      baseRef: 'origin/main',
      branchMode: 'existing',
    });
  });

  it('requires explicit authorization for remove requests', () => {
    expect(() => ScmWorktreeRemoveRequestSchema.parse({
      cwd: '/repo',
      worktreePath: '/repo/.dev/worktree/feature-auth',
    })).toThrow();

    const parsed = ScmWorktreeRemoveRequestSchema.parse({
      cwd: '/repo',
      worktreePath: '/repo/.dev/worktree/feature-auth',
      confirmed: true,
      authorizationToken: SCM_WORKTREE_REMOVE_AUTHORIZATION_TOKEN,
    });

    expect(parsed.worktreePath).toBe('/repo/.dev/worktree/feature-auth');
    expect(parsed.confirmed).toBe(true);
    expect(parsed.authorizationToken).toBe(SCM_WORKTREE_REMOVE_AUTHORIZATION_TOKEN);
  });
});
