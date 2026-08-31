import { describe, expect, it, vi } from 'vitest';

import { createWorkspaceSyncHandoffAdapter, type PrepareWorkspaceSyncHandoffInput } from './workspaceSyncHandoffAdapter';
import { computeWorkspaceSyncPolicyDigest, type ManagedWorkspaceSync, type WorkspaceSyncStatusV1 } from './workspaceSyncTypes';

const relationshipStatus: WorkspaceSyncStatusV1 = {
  relationshipId: 'rel-1', controllerMachineId: 'machine-a', state: 'watching',
  alphaPath: '/src', betaPath: '/dst', mode: 'keep_synced', changedFiles: 0,
  conflictCount: 0, lastSuccessfulSyncAtMs: null,
};

describe('WorkspaceSyncHandoffAdapter', () => {
  it('requires and initially flushes an exact relationship during prepare, then finalizes after source stop', async () => {
    const sync = managedSync({
      flush: vi.fn(async () => relationshipStatus),
    });
    const adapter = handoffAdapter(sync);
    const prepared = await adapter.prepare(relationshipInput());

    expect(prepared).toMatchObject({ kind: 'relationship', relationshipId: 'rel-1', status: relationshipStatus });
    expect(sync.ensure).not.toHaveBeenCalled();
    expect(sync.flush).toHaveBeenCalledTimes(1);
    await adapter.finalize({ operationId: 'handoff-1', prepared });
    expect(sync.flush).toHaveBeenCalledTimes(2);
    await adapter.commit({ operationId: 'handoff-1', prepared });
  });

  it('rejects a missing relationship rather than inventing one with default mode/policy', async () => {
    const sync = managedSync({
      flush: vi.fn(async () => { throw Object.assign(new Error('missing'), { code: 'relationship_not_ready' }); }),
    });
    const adapter = handoffAdapter(sync);
    await expect(adapter.prepare(relationshipInput())).rejects.toMatchObject({ code: 'relationship_not_ready' });
    expect(sync.ensure).not.toHaveBeenCalled();
  });

  it('uses the fixed relationship controller route instead of the daemon-local engine', async () => {
    const sync = managedSync();
    const relationshipController = {
      flush: vi.fn(async () => relationshipStatus),
    };
    const adapter = createWorkspaceSyncHandoffAdapter({
      sync,
      relationshipController,
      bootstrap: vi.fn(async () => ({ release: vi.fn(async () => undefined) })),
    });

    const prepared = await adapter.prepare(relationshipInput());
    await adapter.finalize({ operationId: 'handoff-1', prepared });

    expect(relationshipController.flush).toHaveBeenCalledTimes(2);
    expect(sync.get).not.toHaveBeenCalled();
    expect(sync.flush).not.toHaveBeenCalled();
  });

  it('runs one copyOnce only after the source has stopped and never broadens an unknown selection', async () => {
    const sync = managedSync();
    const adapter = handoffAdapter(sync);
    const prepared = await adapter.prepare(copyInput('all_files'));
    expect(sync.copyOnce).not.toHaveBeenCalled();
    await adapter.finalize({ operationId: 'handoff-copy', prepared });
    expect(sync.copyOnce).toHaveBeenCalledTimes(1);
    await adapter.commit({ operationId: 'handoff-copy', prepared });
    expect(sync.copyOnce).toHaveBeenCalledWith(expect.objectContaining({
      operationId: 'handoff-copy',
      contentPolicy: expect.objectContaining({ selection: 'all_files' }),
    }), undefined, undefined);

    // Boundary fixture deliberately represents an untrusted future wire value.
    await expect(adapter.prepare(copyInput('future_selection') as unknown as PrepareWorkspaceSyncHandoffInput)).rejects.toThrow(/selection/i);
    expect(sync.copyOnce).toHaveBeenCalledTimes(1);
  });

  it('does not terminate a pre-existing relationship during compensation', async () => {
    const sync = managedSync({ get: vi.fn(async () => relationshipStatus) });
    const adapter = handoffAdapter(sync);
    const prepared = await adapter.prepare(relationshipInput());
    await adapter.abort({ operationId: 'handoff-1', prepared });
    expect(sync.terminate).not.toHaveBeenCalled();
  });

  it('fails closed when copy commit has lost its prepared endpoint authority', async () => {
    const sync = managedSync();
    const adapter = handoffAdapter(sync);
    const prepared = await handoffAdapter(sync).prepare(copyInput('all_files'));

    await expect(adapter.finalize({ operationId: 'handoff-copy', prepared })).rejects.toMatchObject({
      code: 'workspace_sync_prepare_missing',
    });
    expect(sync.copyOnce).not.toHaveBeenCalled();
  });

  it('bootstraps before relationship readiness and holds the fence until abort', async () => {
    const order: string[] = [];
    const release = vi.fn(async () => { order.push('release'); });
    const sync = managedSync({ flush: vi.fn(async () => { order.push('flush'); return relationshipStatus; }) });
    const bootstrap = vi.fn(async () => { order.push('bootstrap'); return { release }; });
    const adapter = createWorkspaceSyncHandoffAdapter({ sync, bootstrap });

    const prepared = await adapter.prepare(relationshipInput());
    expect(order).toEqual(['bootstrap', 'flush']);
    await adapter.abort({ operationId: 'handoff-1', prepared });
    expect(release).toHaveBeenCalledTimes(1);
    expect(release).toHaveBeenCalledWith('abort');
  });

  it('distinguishes successful commit from abort when releasing target bootstrap authority', async () => {
    const release = vi.fn(async (_reason: 'abort' | 'commit') => undefined);
    const sync = managedSync();
    const adapter = createWorkspaceSyncHandoffAdapter({
      sync,
      bootstrap: vi.fn(async () => ({ release })),
    });

    const prepared = await adapter.prepare(copyInput('all_files'));
    await adapter.finalize({ operationId: 'handoff-copy', prepared });
    await adapter.commit({ operationId: 'handoff-copy', prepared });

    expect(release).toHaveBeenCalledOnce();
    expect(release).toHaveBeenCalledWith('commit');
  });

  it('retains committed bootstrap authority until release succeeds so cleanup can be retried', async () => {
    const release = vi.fn()
      .mockRejectedValueOnce(Object.assign(new Error('release unavailable'), { code: 'peer_unavailable' }))
      .mockResolvedValueOnce(undefined);
    const adapter = createWorkspaceSyncHandoffAdapter({
      sync: managedSync(),
      bootstrap: vi.fn(async () => ({ release })),
    });

    const prepared = await adapter.prepare(copyInput('all_files'));
    await adapter.finalize({ operationId: 'handoff-copy', prepared });
    await expect(adapter.commit({ operationId: 'handoff-copy', prepared })).rejects.toMatchObject({ code: 'peer_unavailable' });
    await expect(adapter.commit({ operationId: 'handoff-copy', prepared })).resolves.toMatchObject({
      operationId: 'handoff-copy',
      kind: 'copy_once',
    });

    expect(release).toHaveBeenCalledTimes(2);
    expect(release).toHaveBeenNthCalledWith(1, 'commit');
    expect(release).toHaveBeenNthCalledWith(2, 'commit');
  });

  it('transfers the prepared fence handles into copyOnce without reacquiring roots', async () => {
    const sync = managedSync();
    const ownershipHandles = [{
      owner: { ownerId: 'handoff-copy', canonicalRoot: '/dst', operation: 'handoff' as const, rootFingerprint: null },
      bindCurrentRootIdentity: vi.fn(),
      renew: vi.fn(),
      release: vi.fn(),
    }];
    const adapter = createWorkspaceSyncHandoffAdapter({
      sync,
      bootstrap: vi.fn(async () => ({ release: vi.fn(async () => undefined), ownershipHandles })),
    });
    const prepared = await adapter.prepare(copyInput('all_files'));
    expect(sync.copyOnce).not.toHaveBeenCalled();
    await adapter.finalize({ operationId: 'handoff-copy', prepared });
    expect(sync.copyOnce).toHaveBeenCalledWith(expect.any(Object), undefined, ownershipHandles);
    await adapter.commit({ operationId: 'handoff-copy', prepared });
  });

  it('fails non-none prepare closed when bootstrap/fence authority is unavailable', async () => {
    const sync = managedSync();
    const adapter = createWorkspaceSyncHandoffAdapter({ sync } as Parameters<typeof createWorkspaceSyncHandoffAdapter>[0]);
    await expect(adapter.prepare(relationshipInput())).rejects.toMatchObject({ code: 'workspace_sync_unavailable' });
  });
});

function relationshipInput() {
  return {
    operationId: 'handoff-1',
    action: { kind: 'relationship' as const, relationshipId: 'rel-1', flushBeforeCommit: true },
    sourceMachineId: 'machine-a', targetMachineId: 'machine-b',
    sourceWorkspaceRefId: 'workspace-a', targetWorkspaceRefId: 'workspace-b',
    sourceRootPath: '/src', targetRootPath: '/dst',
  };
}

function copyInput(selection: 'all_files'): PrepareWorkspaceSyncHandoffInput;
function copyInput(selection: 'future_selection'): unknown;
function copyInput(selection: 'all_files' | 'future_selection'): unknown {
  const basePolicy = { v: 1 as const, selection, extraIgnorePatterns: [], extraIncludePatterns: [], includeGitDirectory: false };
  return {
    operationId: 'handoff-copy',
    action: { kind: 'copy_once' as const, contentPolicy: { ...basePolicy, policyDigest: selection === 'all_files' ? computeWorkspaceSyncPolicyDigest({ ...basePolicy, selection: 'all_files' }) : '0'.repeat(64) } },
    sourceMachineId: 'machine-a', targetMachineId: 'machine-b',
    sourceWorkspaceRefId: 'workspace-a', targetWorkspaceRefId: 'workspace-b',
    sourceRootPath: '/src', targetRootPath: '/dst',
  };
}

function managedSync(overrides: Partial<ManagedWorkspaceSync> = {}): ManagedWorkspaceSync {
  const copyStatus: WorkspaceSyncStatusV1 = { ...relationshipStatus, relationshipId: 'handoff-copy', mode: 'copy_once' };
  return {
    get: vi.fn(async () => null), list: vi.fn(async () => []), subscribe: vi.fn(() => ({ async *[Symbol.asyncIterator]() {} })),
    ensure: vi.fn(async () => relationshipStatus), copyOnce: vi.fn(async () => copyStatus),
    flush: vi.fn(async () => relationshipStatus), pause: vi.fn(async () => ({ ...relationshipStatus, state: 'paused' as const })),
    resume: vi.fn(async () => relationshipStatus), terminate: vi.fn(async () => undefined),
    listConflicts: vi.fn(async () => ({ relationshipId: 'rel-1', totalCount: 0, shownCount: 0, truncatedCount: 0, conflicts: [] })),
    deleteConflictLoser: vi.fn(async () => relationshipStatus), readFile: vi.fn(async () => ({ status: 'missing' as const })),
    ...overrides,
  };
}

function handoffAdapter(sync: ManagedWorkspaceSync) {
  return createWorkspaceSyncHandoffAdapter({
    sync,
    bootstrap: vi.fn(async () => ({ release: vi.fn(async () => undefined) })),
  });
}
