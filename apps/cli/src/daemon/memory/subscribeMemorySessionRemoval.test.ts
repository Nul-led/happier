import { describe, expect, it, vi } from 'vitest';

import { subscribeMemorySessionRemoval } from './subscribeMemorySessionRemoval';

function createSource<T>() {
  const listeners = new Set<(change: T) => void | Promise<void>>();
  return {
    subscribe: (listener: (change: T) => void | Promise<void>) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    emit: async (change: T) => {
      for (const listener of listeners) await listener(change);
    },
    get size() {
      return listeners.size;
    },
  };
}

function createHarness(removeSessions = vi.fn(async () => {})) {
  const deleted = createSource<{ sessionId: string }>();
  const revoked = createSource<{ sessionId: string }>();
  const reset = createSource<{ cursor: number }>();
  const archived = createSource<{ sessionId: string; archived: boolean }>();
  const reconcileRetainedSessionAccess = vi.fn(async () => {});
  const applySessionArchivedState = vi.fn(async () => {});
  const dispose = subscribeMemorySessionRemoval({
    memoryWorker: { removeSessions, reconcileRetainedSessionAccess, applySessionArchivedState },
    onSessionDeletedChange: deleted.subscribe,
    onSessionAccessRevoked: revoked.subscribe,
    onSessionAccessReset: reset.subscribe,
    onSessionArchivedStateChange: archived.subscribe,
  });
  return {
    deleted,
    revoked,
    reset,
    archived,
    removeSessions,
    reconcileRetainedSessionAccess,
    applySessionArchivedState,
    dispose,
  };
}

describe('subscribeMemorySessionRemoval', () => {
  it('purges the derived memory index for deleted and access-revoked sessions', async () => {
    const harness = createHarness();

    await harness.deleted.emit({ sessionId: 'deleted-1' });
    await harness.revoked.emit({ sessionId: 'revoked-1' });

    expect(harness.removeSessions.mock.calls).toEqual([[['deleted-1']], [['revoked-1']]]);
    harness.dispose();
  });

  it('propagates a purge failure so the change cursor is never acknowledged', async () => {
    const removeSessions = vi.fn(async () => {
      throw new Error('purge_failed');
    });
    const harness = createHarness(removeSessions as never);

    await expect(harness.deleted.emit({ sessionId: 'deleted-1' })).rejects.toThrow('purge_failed');
    await expect(harness.revoked.emit({ sessionId: 'revoked-1' })).rejects.toThrow('purge_failed');
    harness.dispose();
  });

  it('routes cursor-gone reset through retained Session access reconciliation', async () => {
    const harness = createHarness();

    await harness.reset.emit({ cursor: 9 });

    expect(harness.reconcileRetainedSessionAccess).toHaveBeenCalledOnce();
    harness.dispose();
  });

  it('routes archive-state transitions to the eligibility owner rather than deciding locally', async () => {
    const harness = createHarness();

    await harness.archived.emit({ sessionId: 'archived-1', archived: true });

    expect(harness.applySessionArchivedState).toHaveBeenCalledWith({ sessionId: 'archived-1', archived: true });
    expect(harness.removeSessions).not.toHaveBeenCalled();
    harness.dispose();
  });

  it('releases every subscription on dispose', () => {
    const harness = createHarness();
    expect(harness.deleted.size + harness.revoked.size + harness.reset.size + harness.archived.size).toBe(4);

    harness.dispose();

    expect(harness.deleted.size + harness.revoked.size + harness.reset.size + harness.archived.size).toBe(0);
  });
});
