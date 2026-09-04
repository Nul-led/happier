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

  it('attempts every independent abort obligation and preserves every cleanup failure for retry', async () => {
    const terminateFailure = new Error('copy termination failed');
    const fenceFailure = new Error('fence release failed');
    const terminate = vi.fn(async () => { throw terminateFailure; });
    const fenceRelease = vi.fn(async () => { throw fenceFailure; });
    const sync = managedSync({ terminate });
    const adapter = createWorkspaceSyncHandoffAdapter({
      sync,
      relationshipOwner: {
        materializeEndpoints: vi.fn(),
        prepareCreate: vi.fn(async () => {
          throw new Error('not used');
        }),
      },
      bootstrap: vi.fn(async () => ({ release: fenceRelease })),
    });
    const prepared = await adapter.prepare(copyInput('all_files'));

    const outcome = adapter.abort({ operationId: 'handoff-copy', prepared }).catch((error: unknown) => error);
    await expect(outcome).resolves.toBeInstanceOf(AggregateError);
    expect((await outcome as AggregateError).errors).toEqual([terminateFailure, fenceFailure]);
    expect(terminate).toHaveBeenCalledOnce();
    expect(fenceRelease).toHaveBeenCalledOnce();

    // Failed cleanup retains operation custody, so the same operation can
    // retry the idempotent obligations rather than losing evidence/state.
    await adapter.abort({ operationId: 'handoff-copy', prepared }).catch(() => undefined);
    expect(terminate).toHaveBeenCalledTimes(2);
    expect(fenceRelease).toHaveBeenCalledTimes(2);
  });

  it('durably publishes create_relationship during finalization before post-target cleanup', async () => {
    const relationship = {
      v: 1 as const,
      relationshipId: 'rel-created',
      controllerMachineId: 'machine-a',
      alphaWorkspaceRefId: 'workspace-created-a',
      betaWorkspaceRefId: 'workspace-created-b',
      mode: 'keep_synced' as const,
      contentPolicy: allFilesPolicy(),
      enabled: true,
      createdAtMs: 1,
      updatedAtMs: 1,
    };
    const commit = vi.fn(async () => relationship);
    const abort = vi.fn(async () => undefined);
    const prepareCreate = vi.fn(async () => ({
      relationship,
      status: { ...relationshipStatus, relationshipId: 'rel-created' },
      reused: false as const,
      commit,
      abort,
    }));
    const bootstrap = vi.fn(async () => ({ release: vi.fn(async () => undefined) }));
    const sync = managedSync({
      flush: vi.fn(async () => ({ ...relationshipStatus, relationshipId: 'rel-created' })),
    });
    const relationshipController = {
      flush: vi.fn(async () => {
        throw Object.assign(new Error('relationship is not durable yet'), { code: 'relationship_not_ready' });
      }),
    };
    const adapter = createWorkspaceSyncHandoffAdapter({
      sync,
      relationshipController,
      relationshipOwner: { materializeEndpoints: vi.fn(), prepareCreate },
      bootstrap,
    });
    const prepared = await adapter.prepare({
      operationId: 'handoff-create',
      accountServerId: 'server-a',
      action: {
        kind: 'create_relationship',
        mode: 'keep_synced',
        contentPolicy: allFilesPolicy(),
        flushBeforeCommit: true,
      },
      sourceMachineId: 'machine-a',
      targetMachineId: 'machine-b',
      sourceRootPath: '/src',
      targetRootPath: '/dst',
    });

    expect(prepareCreate).toHaveBeenCalledWith(expect.objectContaining({
      operationId: 'handoff-create',
      serverId: 'server-a',
      sourceMachineId: 'machine-a',
      sourceRootPath: '/src',
      targetMachineId: 'machine-b',
      targetRootPath: '/dst',
      mode: 'keep_synced',
    }));
    expect(bootstrap).not.toHaveBeenCalled();
    expect(commit).not.toHaveBeenCalled();

    await expect(adapter.finalize({ operationId: 'handoff-create', prepared })).resolves.toMatchObject({
      kind: 'create_relationship',
      relationshipId: 'rel-created',
    });
    expect(sync.flush).toHaveBeenCalledWith('rel-created', undefined);
    expect(relationshipController.flush).not.toHaveBeenCalled();
    expect(commit).toHaveBeenCalledOnce();
    await expect(adapter.commit({ operationId: 'handoff-create', prepared })).resolves.toMatchObject({
      kind: 'create_relationship',
      relationshipId: 'rel-created',
    });
    expect(commit).toHaveBeenCalledOnce();
    expect(abort).not.toHaveBeenCalled();
  });

  it('compensates a relationship published during finalization when the target commit later aborts', async () => {
    const relationship = {
      v: 1 as const,
      relationshipId: 'rel-created',
      controllerMachineId: 'machine-a',
      alphaWorkspaceRefId: 'workspace-created-a',
      betaWorkspaceRefId: 'workspace-created-b',
      mode: 'keep_synced' as const,
      contentPolicy: allFilesPolicy(),
      enabled: true,
      createdAtMs: 1,
      updatedAtMs: 1,
    };
    const commit = vi.fn(async () => relationship);
    const abort = vi.fn(async () => undefined);
    const adapter = createWorkspaceSyncHandoffAdapter({
      sync: managedSync(),
      relationshipController: { flush: vi.fn(async () => ({ ...relationshipStatus, relationshipId: relationship.relationshipId })) },
      relationshipOwner: { materializeEndpoints: vi.fn(), prepareCreate: vi.fn(async () => ({
        relationship,
        status: { ...relationshipStatus, relationshipId: relationship.relationshipId },
        reused: false as const,
        commit,
        abort,
      })) },
      bootstrap: vi.fn(async () => ({ release: vi.fn(async () => undefined) })),
    });
    const prepared = await adapter.prepare({
      operationId: 'handoff-create',
      accountServerId: 'server-a',
      sourceMachineId: 'machine-a',
      targetMachineId: 'machine-b',
      sourceRootPath: '/src',
      targetRootPath: '/dst',
      action: {
        kind: 'create_relationship',
        mode: 'keep_synced',
        contentPolicy: allFilesPolicy(),
        flushBeforeCommit: true,
      },
    });

    await adapter.finalize({ operationId: 'handoff-create', prepared });
    await adapter.abort({ operationId: 'handoff-create', prepared });

    expect(commit).toHaveBeenCalledOnce();
    expect(abort).toHaveBeenCalledOnce();
  });

  it('reuses the same prepared relationship transaction when publication outcome is indeterminate', async () => {
    const relationship = {
      v: 1 as const,
      relationshipId: 'rel-created',
      controllerMachineId: 'machine-a',
      alphaWorkspaceRefId: 'workspace-created-a',
      betaWorkspaceRefId: 'workspace-created-b',
      mode: 'keep_synced' as const,
      contentPolicy: allFilesPolicy(),
      enabled: true,
      createdAtMs: 1,
      updatedAtMs: 1,
    };
    const commit = vi.fn()
      .mockRejectedValueOnce(Object.assign(new Error('settings outcome unknown'), { code: 'indeterminate' }))
      .mockResolvedValueOnce(relationship);
    const prepareCreate = vi.fn(async () => ({
      relationship,
      status: { ...relationshipStatus, relationshipId: relationship.relationshipId },
      reused: false as const,
      commit,
      abort: vi.fn(async () => undefined),
    }));
    const adapter = createWorkspaceSyncHandoffAdapter({
      sync: managedSync(),
      relationshipController: { flush: vi.fn(async () => ({ ...relationshipStatus, relationshipId: relationship.relationshipId })) },
      relationshipOwner: { materializeEndpoints: vi.fn(), prepareCreate },
      bootstrap: vi.fn(async () => ({ release: vi.fn(async () => undefined) })),
    });
    const input = {
      operationId: 'handoff-create',
      accountServerId: 'server-a',
      sourceMachineId: 'machine-a',
      targetMachineId: 'machine-b',
      sourceRootPath: '/src',
      targetRootPath: '/dst',
      action: {
        kind: 'create_relationship' as const,
        mode: 'keep_synced' as const,
        contentPolicy: allFilesPolicy(),
        flushBeforeCommit: true as const,
      },
    };

    const prepared = await adapter.prepare(input);
    await expect(adapter.finalize({ operationId: input.operationId, prepared })).rejects.toMatchObject({ code: 'indeterminate' });
    const retried = await adapter.prepare(input);
    await expect(adapter.finalize({ operationId: input.operationId, prepared: retried })).resolves.toMatchObject({
      relationshipId: relationship.relationshipId,
    });

    expect(retried).toBe(prepared);
    expect(prepareCreate).toHaveBeenCalledOnce();
    expect(commit).toHaveBeenCalledTimes(2);
  });

  it('runs relationship cleanup even when the initiating operation signal is already aborted', async () => {
    const abort = vi.fn(async () => undefined);
    const adapter = createWorkspaceSyncHandoffAdapter({
      sync: managedSync(),
      relationshipController: { flush: vi.fn(async () => relationshipStatus) },
      relationshipOwner: { materializeEndpoints: vi.fn(), prepareCreate: vi.fn(async () => ({
        relationship: { v: 1 as const, relationshipId: 'rel-abort', controllerMachineId: 'machine-a', alphaWorkspaceRefId: 'workspace-a', betaWorkspaceRefId: 'workspace-b', mode: 'keep_synced' as const, contentPolicy: allFilesPolicy(), enabled: true, createdAtMs: 1, updatedAtMs: 1 },
        status: { ...relationshipStatus, relationshipId: 'rel-abort' },
        reused: false as const,
        commit: vi.fn(async () => { throw new Error('unexpected commit'); }),
        abort,
      })) },
      bootstrap: vi.fn(async () => ({ release: vi.fn(async () => undefined) })),
    });
    const prepared = await adapter.prepare({
      operationId: 'handoff-abort', accountServerId: 'server-a', sourceMachineId: 'machine-a', targetMachineId: 'machine-b',
      sourceRootPath: '/src', targetRootPath: '/dst',
      action: { kind: 'create_relationship', mode: 'keep_synced', contentPolicy: allFilesPolicy(), flushBeforeCommit: true },
    });
    const controller = new AbortController();
    controller.abort();
    await adapter.abort({ operationId: 'handoff-abort', prepared, signal: controller.signal });
    expect(abort).toHaveBeenCalledOnce();
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

  it('terminates an indeterminate copy_once operation before releasing bootstrap authority on abort', async () => {
    const order: string[] = [];
    const sync = managedSync({
      copyOnce: vi.fn(async () => { throw Object.assign(new Error('result lost'), { code: 'indeterminate' }); }),
      terminate: vi.fn(async () => { order.push('terminate'); }),
    });
    const adapter = createWorkspaceSyncHandoffAdapter({
      sync,
      bootstrap: vi.fn(async () => ({
        release: vi.fn(async () => { order.push('release'); }),
      })),
    });
    const prepared = await adapter.prepare(copyInput('all_files'));
    await expect(adapter.finalize({ operationId: 'handoff-copy', prepared })).rejects.toMatchObject({ code: 'indeterminate' });

    await adapter.abort({ operationId: 'handoff-copy', prepared });

    expect(order).toEqual(['terminate', 'release']);
    expect(sync.terminate).toHaveBeenCalledWith('handoff-copy');
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

function allFilesPolicy() {
  const input = { v: 1 as const, selection: 'all_files' as const, extraIgnorePatterns: [], extraIncludePatterns: [] };
  return { ...input, policyDigest: computeWorkspaceSyncPolicyDigest(input) };
}

function copyInput(selection: 'all_files'): PrepareWorkspaceSyncHandoffInput;
function copyInput(selection: 'future_selection'): unknown;
function copyInput(selection: 'all_files' | 'future_selection'): unknown {
  const basePolicy = { v: 1 as const, selection, extraIgnorePatterns: [], extraIncludePatterns: [] };
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
    withAuthorizedSourceSeedExport: vi.fn(async (_request, exportSource) => await exportSource('/src')),
    withSourceSeedAuthorization: vi.fn(async (_operation, _handles, action) => await action()),
    ...overrides,
  };
}

function handoffAdapter(sync: ManagedWorkspaceSync) {
  return createWorkspaceSyncHandoffAdapter({
    sync,
    bootstrap: vi.fn(async () => ({ release: vi.fn(async () => undefined) })),
  });
}
