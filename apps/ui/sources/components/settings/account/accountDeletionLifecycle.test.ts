import { beforeEach, describe, expect, it, vi } from 'vitest';

const runnerCustody = vi.hoisted(() => ({
  removeAccount: vi.fn(async () => undefined),
}));
vi.mock('@/sync/domains/ephemeralRunner/runnerCreatorDraftRemoval', () => ({
  removeRunnerCreatorCustodyForAccount: runnerCustody.removeAccount,
}));

import { AccountDeletedLocalCleanupError, completeAccountDeletion } from './accountDeletionLifecycle';
describe('completeAccountDeletion', () => {
  const scope = { serverId: 'home-a', accountId: 'account-a' } as const;
  beforeEach(() => runnerCustody.removeAccount.mockReset().mockResolvedValue(undefined));
  it('deletes remotely, erases exact Runner custody, then removes local credentials', async () => {
    const remote = vi.fn(async () => ({ status: 'deleted' as const }));
    const local = vi.fn();
    await completeAccountDeletion({ scope, deleteCurrentAccount: remote, replace: vi.fn(), logout: async (o) => { await o?.beforeMutation?.(); local(); return { kind: 'completed' }; } });
    expect(remote.mock.invocationCallOrder[0]).toBeLessThan(runnerCustody.removeAccount.mock.invocationCallOrder[0]!);
    expect(runnerCustody.removeAccount.mock.invocationCallOrder[0]).toBeLessThan(local.mock.invocationCallOrder[0]!);
    expect(runnerCustody.removeAccount).toHaveBeenCalledWith(scope);
  });
  it('retains local state when remote deletion fails', async () => { const replace = vi.fn(); await expect(completeAccountDeletion({ scope, deleteCurrentAccount: async () => { throw new Error('failed'); }, replace, logout: async (o) => { await o?.beforeMutation?.(); return { kind: 'completed' }; } })).rejects.toThrow('failed'); expect(replace).not.toHaveBeenCalled(); expect(runnerCustody.removeAccount).not.toHaveBeenCalled(); });
  it('distinguishes Runner cleanup failure after confirmed deletion and never removes credentials', async () => {
    let credentialsRemoved = false;
    const logout = vi.fn(async (o?: Readonly<{ beforeMutation?: () => void | Promise<void> }>) => {
      await o?.beforeMutation?.();
      credentialsRemoved = true;
      return { kind: 'completed' as const };
    });
    runnerCustody.removeAccount.mockRejectedValueOnce(new Error('staged file busy'));
    const remote = vi.fn(async () => ({ status: 'deleted' as const }));
    const failure = await completeAccountDeletion({ scope, deleteCurrentAccount: remote, replace: vi.fn(), logout })
      .then(() => null, (error: unknown) => error);
    expect(failure).toBeInstanceOf(AccountDeletedLocalCleanupError);
    expect(logout).toHaveBeenCalledOnce();
    expect(credentialsRemoved).toBe(false);

    runnerCustody.removeAccount.mockResolvedValueOnce(undefined);
    await expect((failure as AccountDeletedLocalCleanupError).retryLocalCleanup()).resolves.toEqual({ kind: 'completed' });
    expect(remote).toHaveBeenCalledOnce();
    expect(logout).toHaveBeenCalledTimes(2);
    expect(credentialsRemoved).toBe(true);
  });
  it('distinguishes credential cleanup failure after confirmed deletion', async () => { await expect(completeAccountDeletion({ scope, deleteCurrentAccount: async () => ({ status: 'deleted' }), replace: vi.fn(), logout: async (o) => { await o?.beforeMutation?.(); throw new Error('cleanup'); } })).rejects.toBeInstanceOf(AccountDeletedLocalCleanupError); });
});
