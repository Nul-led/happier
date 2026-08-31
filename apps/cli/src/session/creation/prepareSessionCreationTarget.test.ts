import { access, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

vi.mock('@/scm/rpc/dispatch', () => ({
  notRepositoryResponse: vi.fn(),
  runScmRoute: vi.fn(),
}));
vi.mock('@/scm/workspace', () => ({
  realizeWorkspaceCheckoutWithScmWorkspaceSource: vi.fn(),
}));

import { prepareSessionCreationTarget } from './prepareSessionCreationTarget';

describe('prepareSessionCreationTarget', () => {
  it('reports a missing direct target directory without creating it', async () => {
    const root = await mkdtemp(join(tmpdir(), 'happier-session-creation-target-'));
    const directory = join(root, 'new-session-directory');

    try {
      await expect(prepareSessionCreationTarget({
        request: { directory },
        platform: 'linux',
      })).resolves.toEqual({
        ok: true,
        directory,
        directoryCreationRequired: true,
        checkout: null,
      });
      await expect(access(directory)).rejects.toThrow();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('canonicalizes target-machine home and mixed Windows separators without sibling-prefix confusion', async () => {
    await expect(prepareSessionCreationTarget({
      request: { directory: '~\\projects/acme/../repo/' },
      env: { USERPROFILE: 'C:\\Users\\alice' },
      platform: 'win32',
    })).resolves.toEqual({
      ok: true,
      directory: 'C:\\Users\\alice\\projects\\repo',
      directoryCreationRequired: true,
      checkout: null,
    });

    await expect(prepareSessionCreationTarget({
      request: { directory: 'C:\\Users\\alice2\\repo\\' },
      env: { USERPROFILE: 'C:\\Users\\alice' },
      platform: 'win32',
    })).resolves.toEqual({
      ok: true,
      directory: 'C:\\Users\\alice2\\repo',
      directoryCreationRequired: true,
      checkout: null,
    });
  });

  it('records SCM-owned checkout output as the immutable final directory', async () => {
    const createCheckout = vi.fn(async () => ({
      success: true as const,
      worktreePath: '/repo/.dev/worktree/feature-session',
      branchName: 'feature-session',
    }));

    await expect(prepareSessionCreationTarget({
      request: {
        directory: '/repo',
        checkoutCreationDraft: {
          kind: 'git_worktree',
          displayName: 'feature-session',
          baseRef: 'main',
          branchMode: 'existing',
        },
      },
      platform: 'linux',
      createCheckout,
    })).resolves.toEqual({
      ok: true,
      directory: '/repo/.dev/worktree/feature-session',
      directoryCreationRequired: false,
      checkout: {
        kind: 'git_worktree',
        finalDirectory: '/repo/.dev/worktree/feature-session',
        baseRef: 'main',
        branchMode: 'existing',
      },
    });
    expect(createCheckout).toHaveBeenCalledWith({
      sourceDirectory: '/repo',
      displayName: 'feature-session',
      baseRef: 'main',
      branchMode: 'existing',
      signal: undefined,
    });
  });

  it('rebases a nested source directory into the worktree and retains the known-created receipt', async () => {
    const createCheckout = vi.fn(async () => ({
      success: true as const,
      worktreePath: '/repo/.dev/worktree/feature-session',
      branchName: 'feature-session',
      sourceRootPath: '/repo',
      created: true,
    }));

    await expect(prepareSessionCreationTarget({
      request: {
        directory: '/repo/packages/app',
        checkoutCreationDraft: {
          kind: 'git_worktree',
          displayName: 'feature-session',
          baseRef: null,
          branchMode: 'new',
        },
      },
      platform: 'linux',
      createCheckout,
    })).resolves.toEqual({
      ok: true,
      directory: '/repo/.dev/worktree/feature-session/packages/app',
      directoryCreationRequired: false,
      checkout: {
        kind: 'git_worktree',
        finalDirectory: '/repo/.dev/worktree/feature-session',
        baseRef: null,
        branchMode: 'new',
        created: true,
      },
    });
  });

  it('rebases Windows source subpaths case-insensitively and contains sibling-prefix mismatches', async () => {
    const createCheckout = vi.fn(async () => ({
      success: true as const,
      worktreePath: 'C:\\Repo\\.dev\\worktree\\feature-session',
      branchName: 'feature-session',
      sourceRootPath: 'c:\\repo',
      created: false,
    }));
    const checkoutCreationDraft = {
      kind: 'git_worktree' as const,
      displayName: 'feature-session',
      baseRef: null,
      branchMode: 'existing' as const,
    };

    await expect(prepareSessionCreationTarget({
      request: {
        directory: 'C:\\Repo\\Packages\\App',
        checkoutCreationDraft,
      },
      platform: 'win32',
      createCheckout,
    })).resolves.toMatchObject({
      ok: true,
      directory: 'C:\\Repo\\.dev\\worktree\\feature-session\\Packages\\App',
      checkout: { created: false },
    });

    createCheckout.mockResolvedValueOnce({
      success: true as const,
      worktreePath: 'C:\\Repo\\.dev\\worktree\\feature-session',
      branchName: 'feature-session',
      sourceRootPath: 'C:\\Repo',
      created: false,
    });
    await expect(prepareSessionCreationTarget({
      request: {
        directory: 'C:\\Repo-Other\\Packages\\App',
        checkoutCreationDraft,
      },
      platform: 'win32',
      createCheckout,
    })).resolves.toMatchObject({
      ok: true,
      directory: 'C:\\Repo\\.dev\\worktree\\feature-session',
    });
  });

  it('replays the same SCM request and final path for a same-key preparation retry', async () => {
    const createCheckout = vi.fn(async () => ({
      success: true as const,
      worktreePath: '/repo/.dev/worktree/stable',
      branchName: 'stable',
    }));
    const input = {
      request: {
        directory: '/repo',
        checkoutCreationDraft: {
          kind: 'git_worktree' as const,
          displayName: 'stable',
          baseRef: null,
          branchMode: 'new' as const,
        },
      },
      platform: 'linux' as const,
      createCheckout,
    };

    expect(await prepareSessionCreationTarget(input))
      .toEqual(await prepareSessionCreationTarget(input));
    expect(createCheckout).toHaveBeenCalledTimes(2);
  });

  it('fails closed when the target path or SCM checkout cannot be prepared', async () => {
    await expect(prepareSessionCreationTarget({
      request: { directory: 'relative/repo' },
      platform: 'linux',
    })).resolves.toEqual({ ok: false, code: 'invalid_directory' });

    await expect(prepareSessionCreationTarget({
      request: {
        directory: '/repo',
        checkoutCreationDraft: {
          kind: 'git_worktree',
          displayName: 'feature',
          baseRef: null,
        },
      },
      platform: 'linux',
      createCheckout: async () => ({
        success: false,
        worktreePath: '',
        branchName: '',
        errorCode: 'FEATURE_UNSUPPORTED',
      }),
    })).resolves.toEqual({ ok: false, code: 'checkout_unavailable' });
  });
});
