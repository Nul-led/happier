import { describe, expect, it, vi } from 'vitest';
import {
  REMOVE_INDEX_LOCK_CONFIRMATION_TOKEN,
  SCM_OPERATION_ERROR_CODES,
} from '@happier-dev/protocol';
import { installSessionFilesHookCommonModuleMocks } from './sessionFilesHookTestHelpers';

const modalAlert = vi.hoisted(() => vi.fn());
const modalConfirm = vi.hoisted(() => vi.fn(async () => true));
const sessionScmCommitCreate = vi.hoisted(() => vi.fn());
const sessionScmRepositoryRemoveIndexLock = vi.hoisted(() => vi.fn(async () => ({
  success: true,
  removed: true,
  lockPath: '/repo/.git/index.lock',
})));
const withSessionProjectScmOperationLock = vi.hoisted(() => vi.fn(async (input: any) => {
  await input.run();
  return { started: true, message: '' };
}));

installSessionFilesHookCommonModuleMocks({
  modal: async () => {
    const { createModalModuleMock } = await import('@/dev/testkit/mocks/modal');
        return createModalModuleMock({
          spies: {
            alert: modalAlert,
            confirm: modalConfirm,
          },
        }).module;
  },
  storage: async (importOriginal) => importOriginal(),
});

vi.mock('@/scm/operations/withOperationLock', () => ({
  withSessionProjectScmOperationLock,
}));

vi.mock('@/sync/ops', () => ({
  sessionScmCommitCreate,
  sessionScmRepositoryRemoveIndexLock,
}));

vi.mock('@/scm/scmStatusSync', () => ({
  scmStatusSync: {
    invalidateFromMutationAndAwait: vi.fn(async () => {}),
  },
}));

describe('executeScmCommit (daemon unavailable)', () => {
  it('leaves an unavailable daemon to the pane outcome line instead of raising a modal', async () => {
    modalAlert.mockReset();
    modalConfirm.mockReset();
    sessionScmCommitCreate.mockReset();
    sessionScmRepositoryRemoveIndexLock.mockClear();

    sessionScmCommitCreate.mockResolvedValueOnce({
      success: false,
      errorCode: SCM_OPERATION_ERROR_CODES.BACKEND_UNAVAILABLE,
      error: 'RPC method not available',
    });

    const { executeScmCommit } = await import('./executeScmCommit');

    const result = await executeScmCommit({
      sessionId: 's1',
      repoPath: '/repo',
      commitMessage: 'feat: test',
      scmCommitStrategy: 'git_staging',
      commitSelectionPaths: [],
      commitSelectionPatches: [],
      refreshScmData: vi.fn(async () => {}),
      loadCommitHistory: vi.fn(async () => {}),
      setScmOperationBusy: vi.fn(),
      setScmOperationStatus: vi.fn(),
      tracking: null,
    });

    expect(result.ok).toBe(false);
    expect(modalAlert).not.toHaveBeenCalled();
    expect(sessionScmCommitCreate).toHaveBeenCalledTimes(1);
  });

  it('omits a broader commit scope when atomic line-selection patches are present', async () => {
    modalAlert.mockReset();
    modalConfirm.mockReset();
    sessionScmCommitCreate.mockReset();
    sessionScmRepositoryRemoveIndexLock.mockClear();

    sessionScmCommitCreate.mockResolvedValueOnce({
      success: true,
      commitSha: 'abc123',
    });

    const { executeScmCommit } = await import('./executeScmCommit');

    const result = await executeScmCommit({
      sessionId: 's1',
      repoPath: '/repo',
      commitMessage: 'feat: test',
      scmCommitStrategy: 'atomic',
      commitSelectionPaths: ['a.txt'],
      commitSelectionPatches: [
        {
          path: 'a.txt',
          patch: [
            'diff --git a/a.txt b/a.txt',
            'index df967b9..9f0e218 100644',
            '--- a/a.txt',
            '+++ b/a.txt',
            '@@ -1 +1,2 @@',
            ' base',
            '+line-one',
            '',
          ].join('\n'),
        },
      ],
      refreshScmData: vi.fn(async () => {}),
      loadCommitHistory: vi.fn(async () => {}),
      setScmOperationBusy: vi.fn(),
      setScmOperationStatus: vi.fn(),
      tracking: null,
    });

    expect(result.ok).toBe(true);
    expect(sessionScmCommitCreate).toHaveBeenCalledTimes(1);
    expect(sessionScmCommitCreate).toHaveBeenCalledWith(
      's1',
      expect.objectContaining({
        message: 'feat: test',
        patches: expect.any(Array),
      }),
      undefined,
    );
    expect(sessionScmCommitCreate.mock.calls[0]?.[1]).not.toHaveProperty('scope');
  });

  it('offers stale Git index-lock recovery and retries commit creation once', async () => {
    modalAlert.mockReset();
    modalConfirm.mockReset();
    sessionScmCommitCreate.mockReset();
    sessionScmRepositoryRemoveIndexLock.mockClear();

    sessionScmCommitCreate
      .mockResolvedValueOnce({
        success: false,
        errorCode: SCM_OPERATION_ERROR_CODES.COMMAND_FAILED,
        error: "fatal: Unable to create '/repo/.git/index.lock': File exists.",
      })
      .mockResolvedValueOnce({
        success: true,
        commitSha: 'abc123',
      });

    const refreshScmData = vi.fn(async () => {});
    const loadCommitHistory = vi.fn(async () => {});
    const { executeScmCommit } = await import('./executeScmCommit');

    const result = await executeScmCommit({
      sessionId: 's1',
      repoPath: '/repo',
      commitMessage: 'feat: test',
      scmCommitStrategy: 'git_staging',
      commitSelectionPaths: [],
      commitSelectionPatches: [],
      refreshScmData,
      loadCommitHistory,
      setScmOperationBusy: vi.fn(),
      setScmOperationStatus: vi.fn(),
      tracking: null,
    });

    expect(result.ok).toBe(true);
    expect(modalConfirm).toHaveBeenCalledTimes(1);
    expect(sessionScmRepositoryRemoveIndexLock).toHaveBeenCalledWith('s1', {
      cwd: '/repo',
      confirmed: true,
      confirmationToken: REMOVE_INDEX_LOCK_CONFIRMATION_TOKEN,
    }, undefined);
    expect(sessionScmCommitCreate).toHaveBeenCalledTimes(2);
    expect(refreshScmData).toHaveBeenCalledTimes(1);
    expect(loadCommitHistory).toHaveBeenCalledWith({ reset: true });
  });
});
