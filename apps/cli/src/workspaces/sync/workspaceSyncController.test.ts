import { describe, expect, it, vi } from 'vitest';
import { WorkspaceSyncController } from './workspaceSyncController';
import { computeWorkspaceSyncPolicyDigest, type WorkspaceSyncStatusV1 } from './workspaceSyncTypes';
import { deriveWorkspaceSyncEndpointId } from './transport/workspaceSyncBrokerProtocol';
import { mkdir, mkdtemp, realpath, rename, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { createWorkspaceRootOwnershipManager } from './workspaceSyncRootOwnership';

const policy = { v: 1 as const, selection: 'all_files' as const, extraIgnorePatterns: [], extraIncludePatterns: [], includeGitDirectory: false };
const definition = { v: 1 as const, relationshipId: 'r1', controllerMachineId: 'm1', alphaWorkspaceRefId: 'a', betaWorkspaceRefId: 'b', mode: 'keep_synced' as const, contentPolicy: { ...policy, policyDigest: computeWorkspaceSyncPolicyDigest(policy) }, enabled: true, createdAtMs: 1, updatedAtMs: 1 };
const status: WorkspaceSyncStatusV1 = { relationshipId: 'r1', controllerMachineId: 'm1', state: 'watching', alphaPath: '/a', betaPath: '/b', mode: 'keep_synced', changedFiles: 0, conflictCount: 0, lastSuccessfulSyncAtMs: null };

describe('WorkspaceSyncController', () => {
  it('serializes relationship commands, accepts metadata refresh, and rejects definition mutation', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const ensure = vi.fn(async () => { await gate; return status; });
    const controller = new WorkspaceSyncController({ adapter: completeAdapter({ ensure }), lifecycle: lifecycle(), rootOwnershipManager: rootOwnership(), localMachineId: 'm1', resolveWorkspaceRef: (id) => ({ machineId: 'other', rootPath: `/${id}` }) });
    const first = controller.ensure(definition);
    const second = controller.ensure({ ...definition, createdAtMs: 2, updatedAtMs: 3 });
    release();
    await Promise.all([first, second]);
    expect(ensure).toHaveBeenCalledTimes(2);
    await expect(controller.ensure({ ...definition, mode: 'mirror_exactly' })).rejects.toMatchObject({ code: 'relationship_definition_conflict' });
  });

  it('requires the fixed controller and never starts a target-side manager', async () => {
    const ensure = vi.fn(async () => status);
    const controller = new WorkspaceSyncController({ adapter: completeAdapter({ ensure }), lifecycle: lifecycle(), rootOwnershipManager: rootOwnership(), localMachineId: 'm2', resolveWorkspaceRef: () => null });
    await expect(controller.ensure(definition)).rejects.toMatchObject({ code: 'controller_unavailable' });
    expect(ensure).not.toHaveBeenCalled();
  });

  it('fails closed when a required adapter operation is absent', async () => {
    expect(() => new WorkspaceSyncController({ adapter: {} as never, lifecycle: lifecycle(), rootOwnershipManager: rootOwnership(), localMachineId: 'm1', resolveWorkspaceRef: () => null })).toThrowError(expect.objectContaining({ code: 'workspace_sync_unavailable' }));
  });

  it('pauses Mutagen when persistent root ownership renewal is lost', async () => {
    vi.useFakeTimers();
    const pause = vi.fn(async () => ({ ...status, state: 'paused' as const }));
    const controller = new WorkspaceSyncController({
      adapter: completeAdapter({ pause }), lifecycle: lifecycle(), localMachineId: 'm1',
      rootOwnershipManager: { tryAcquire: vi.fn(async (owner) => ({
        owner: { ...owner, rootFingerprint: null },
        bindCurrentRootIdentity: vi.fn(async () => undefined),
        renew: vi.fn(async () => { throw new Error('lost'); }),
        release: vi.fn(async () => undefined),
      })) },
      resolveWorkspaceRef: (id) => ({ machineId: 'm1', rootPath: `/tmp/controller-renew-${id}-${process.pid}` }),
      ownershipRenewIntervalMs: 15_000,
    });
    await controller.ensure(definition);
    await vi.advanceTimersByTimeAsync(15_000);
    expect(pause).toHaveBeenCalledWith('r1');
    await controller.terminate('r1');
    vi.useRealTimers();
  });

  it('rehydrates enabled relationships from settings without persisted Mutagen IDs', async () => {
    const events: string[] = [];
    const ensure = vi.fn(async () => status);
    const rehydrate = vi.fn(async () => { events.push('rehydrate'); return []; });
    const lifecycleOwner = lifecycle();
    lifecycleOwner.start.mockImplementation(async () => { events.push('start'); });
    const controller = new WorkspaceSyncController({
      adapter: completeAdapter({ ensure, rehydrate }), lifecycle: lifecycleOwner, localMachineId: 'm1',
      prepareRelationshipTarget: vi.fn(async () => { events.push('target'); }),
      rootOwnershipManager: {
        tryAcquire: vi.fn(async (owner) => {
          events.push('fence');
          return {
            owner: { ...owner, rootFingerprint: null },
            bindCurrentRootIdentity: vi.fn(async () => undefined),
            renew: vi.fn(async () => undefined),
            release: vi.fn(async () => undefined),
          };
        }),
      },
      resolveWorkspaceRef: (id) => ({ machineId: 'm1', rootPath: `/${id}` }),
    });
    await controller.rehydrateFromSettings([definition]);
    expect(events.slice(0, 5)).toEqual(['fence', 'fence', 'target', 'start', 'rehydrate']);
    expect(rehydrate).toHaveBeenCalledWith([definition]);
    expect(ensure).toHaveBeenCalledTimes(1);
    expect(ensure).toHaveBeenCalledWith(definition, undefined);
    await controller.shutdown();
  });

  it('uses the canonical queued ensure before a handoff flush can start a newly-written relationship', async () => {
    const events: string[] = [];
    const ensure = vi.fn(async () => { events.push('ensure'); return status; });
    const flush = vi.fn(async () => { events.push('flush'); return status; });
    const lifecycleOwner = lifecycle();
    lifecycleOwner.start.mockImplementation(async () => { events.push('start'); });
    const controller = new WorkspaceSyncController({
      adapter: completeAdapter({ ensure, flush }),
      lifecycle: lifecycleOwner,
      localMachineId: 'm1',
      rootOwnershipManager: {
        tryAcquire: vi.fn(async (owner) => {
          events.push('fence');
          return {
            owner: { ...owner, rootFingerprint: null },
            bindCurrentRootIdentity: vi.fn(async () => undefined),
            renew: vi.fn(async () => undefined),
            release: vi.fn(async () => undefined),
          };
        }),
      },
      resolveWorkspaceRef: (id) => ({ machineId: 'm1', rootPath: `/${id}` }),
      resolveRelationshipDefinition: (relationshipId) => relationshipId === definition.relationshipId ? definition : null,
      prepareRelationshipTarget: vi.fn(async () => { events.push('target'); }),
    });

    await controller.flush(definition.relationshipId);

    expect(events).toEqual(['fence', 'fence', 'target', 'start', 'ensure', 'start', 'flush']);
    await controller.shutdown();
  });

  it('releases root ownership when settings remove a previously adopted relationship', async () => {
    const releases: Array<ReturnType<typeof vi.fn>> = [];
    const rootOwnershipManager = {
      tryAcquire: vi.fn(async (owner) => {
        const release = vi.fn(async () => undefined);
        releases.push(release);
        return {
          owner: { ...owner, rootFingerprint: null },
          bindCurrentRootIdentity: vi.fn(async () => undefined),
          renew: vi.fn(async () => undefined),
          release,
        };
      }),
    };
    const rehydrate = vi.fn()
      .mockResolvedValueOnce([status])
      .mockResolvedValueOnce([]);
    const controller = new WorkspaceSyncController({
      adapter: completeAdapter({ rehydrate }), lifecycle: lifecycle(), localMachineId: 'm1',
      rootOwnershipManager,
      resolveWorkspaceRef: (id) => ({ machineId: 'm1', rootPath: `/tmp/rehydrate-${id}-${process.pid}` }),
    });

    await controller.rehydrateFromSettings([definition]);
    await controller.rehydrateFromSettings([]);

    expect(rehydrate).toHaveBeenNthCalledWith(1, [definition]);
    expect(rehydrate).toHaveBeenNthCalledWith(2, []);
    expect(releases).toHaveLength(2);
    expect(releases.every((release) => release.mock.calls.length === 1)).toBe(true);
    await controller.shutdown();
  });

  it('maps an opaque endpoint to the lifecycle-owned machine tunnel loopback port', async () => {
    const applicationServer = createServer({ allowHalfOpen: true }, (socket) => socket.pipe(socket));
    applicationServer.listen({ host: '127.0.0.1', port: 0 });
    await once(applicationServer, 'listening');
    const applicationAddress = applicationServer.address();
    if (!applicationAddress || typeof applicationAddress === 'string') throw new Error('test application port unavailable');
    const close = vi.fn(async () => undefined);
    const openMachineCarrierTunnel = vi.fn(async () => ({
      localPort: applicationAddress.port,
      observedPath: 'direct' as const,
      close,
    }));
    const controller = new WorkspaceSyncController({
      adapter: completeAdapter(), lifecycle: lifecycle(), rootOwnershipManager: rootOwnership(),
      localMachineId: 'm1', openMachineCarrierTunnel,
      resolveWorkspaceRef: (id) => ({ machineId: id === 'a' ? 'm1' : 'm2', rootPath: `/${id}` }),
    });
    await controller.ensure(definition);
    const stream = await controller.openExternalStream({ endpointId: deriveWorkspaceSyncEndpointId('r1', 'beta') });
    expect(openMachineCarrierTunnel).toHaveBeenCalledWith(expect.objectContaining({
      operationId: 'r1', sourceMachineId: 'm1', targetMachineId: 'm2', flow: 'workspace_sync',
    }));
    const echoed = once(stream, 'data') as Promise<[Buffer]>;
    stream.write(Buffer.from('native-tunnel-loopback'));
    await expect(echoed).resolves.toEqual([Buffer.from('native-tunnel-loopback')]);
    stream.destroy();
    await once(stream, 'close');
    expect(close).toHaveBeenCalledOnce();
    await controller.terminate('r1');
    applicationServer.close();
  });

  it('opens a local endpoint through the verified rooted agent seam, not machine carrier', async () => {
    const localRoot = await mkdtemp(join(tmpdir(), 'workspace-sync-local-agent-'));
    const openLocalWorkspaceAgentStream = vi.fn(async () => new PassThrough());
    const openMachineCarrierTunnel = vi.fn();
    const controller = new WorkspaceSyncController({
      adapter: completeAdapter(), lifecycle: lifecycle(), rootOwnershipManager: rootOwnership(),
      localMachineId: 'm1', openLocalWorkspaceAgentStream, openMachineCarrierTunnel,
      resolveWorkspaceRef: (id) => id === 'a'
        ? { machineId: 'm1', rootPath: localRoot }
        : { machineId: 'm2', rootPath: '/remote/b' },
    });
    await controller.ensure(definition);

    const stream = await controller.openExternalStream({ endpointId: deriveWorkspaceSyncEndpointId('r1', 'alpha') });

    expect(openLocalWorkspaceAgentStream).toHaveBeenCalledWith({
      operationId: 'r1', role: 'alpha', workspaceRefId: 'a', canonicalRoot: await realpath(localRoot),
    });
    expect(openMachineCarrierTunnel).not.toHaveBeenCalled();
    stream.destroy();
    await controller.terminate('r1');
    await rm(localRoot, { recursive: true, force: true });
  });

  it('rejects a local endpoint when the filesystem object no longer matches its held fence', async () => {
    const fixture = await mkdtemp(join(tmpdir(), 'workspace-sync-controller-root-'));
    const localRoot = join(fixture, 'workspace');
    await mkdir(localRoot);
    const openLocalWorkspaceAgentStream = vi.fn(async () => new PassThrough());
    const controller = new WorkspaceSyncController({
      adapter: completeAdapter(),
      lifecycle: lifecycle(),
      rootOwnershipManager: createWorkspaceRootOwnershipManager({ lockDirectory: join(fixture, 'locks') }),
      localMachineId: 'm1',
      openLocalWorkspaceAgentStream,
      resolveWorkspaceRef: (id) => id === 'a'
        ? { machineId: 'm1', rootPath: localRoot }
        : { machineId: 'm2', rootPath: '/remote/b' },
    });
    await controller.ensure(definition);
    await rename(localRoot, `${localRoot}-old`);
    await mkdir(localRoot);

    await expect(controller.openExternalStream({
      endpointId: deriveWorkspaceSyncEndpointId('r1', 'alpha'),
    })).rejects.toMatchObject({ code: 'root_changed' });
    expect(openLocalWorkspaceAgentStream).not.toHaveBeenCalled();
    await controller.shutdown();
    await rm(fixture, { recursive: true, force: true });
  });

  it('wakes and closes a status subscription immediately when its signal aborts', async () => {
    const controller = new WorkspaceSyncController({
      adapter: completeAdapter(),
      lifecycle: lifecycle(),
      rootOwnershipManager: rootOwnership(),
      localMachineId: 'm1',
      resolveWorkspaceRef: () => null,
    });
    const abort = new AbortController();
    const iterator = controller.subscribe('r1', abort.signal)[Symbol.asyncIterator]();
    const waiting = iterator.next();
    abort.abort();

    await expect(Promise.race([
      waiting,
      new Promise((resolve) => setTimeout(() => resolve('still-waiting'), 100)),
    ])).resolves.toEqual({ done: true, value: undefined });
  });

  it('deletes the losing target with digest/type preconditions and flushes Mutagen', async () => {
    const deleteConflictLoserAtTarget = vi.fn(async () => undefined);
    const flush = vi.fn(async () => status);
    const controller = new WorkspaceSyncController({
      adapter: completeAdapter({ flush }), lifecycle: lifecycle(), rootOwnershipManager: rootOwnership(),
      localMachineId: 'm1', deleteConflictLoserAtTarget,
      resolveWorkspaceRef: (id) => ({ machineId: id === 'a' ? 'm1' : 'm2', rootPath: `/${id}` }),
    });
    await controller.ensure(definition);

    await controller.deleteConflictLoser({
      relationshipId: 'r1', path: 'src/file.ts', keep: 'alpha', expectedKind: 'file', expectedDigest: 'sha1-digest',
    });

    expect(deleteConflictLoserAtTarget).toHaveBeenCalledWith({
      relationshipId: 'r1', targetMachineId: 'm2', targetWorkspaceRefId: 'b',
      path: 'src/file.ts', expectedKind: 'file', expectedDigest: 'sha1-digest', signal: undefined,
    });
    expect(flush).toHaveBeenCalledWith('r1', undefined);
    await controller.terminate('r1');
  });

  it('preserves conflict_changed from the authenticated target and does not flush', async () => {
    const changed = Object.assign(new Error('target changed'), { code: 'conflict_changed' });
    const deleteConflictLoserAtTarget = vi.fn(async () => { throw changed; });
    const flush = vi.fn(async () => status);
    const controller = new WorkspaceSyncController({
      adapter: completeAdapter({ flush }), lifecycle: lifecycle(), rootOwnershipManager: rootOwnership(),
      localMachineId: 'm1', deleteConflictLoserAtTarget,
      resolveWorkspaceRef: (id) => ({ machineId: id === 'a' ? 'm1' : 'm2', rootPath: `/${id}` }),
    });
    await controller.ensure(definition);

    await expect(controller.deleteConflictLoser({
      relationshipId: 'r1', path: 'src/file.ts', keep: 'alpha', expectedKind: 'file', expectedDigest: 'old',
    })).rejects.toBe(changed);
    expect(flush).not.toHaveBeenCalled();
    await controller.terminate('r1');
  });

  it('routes bounded file reads to the selected authenticated WorkspaceRef without sending a root path', async () => {
    const readFileAtTarget = vi.fn(async () => ({
      status: 'text' as const, text: 'hello', digest: 'sha1-digest', size: 5,
    }));
    const controller = new WorkspaceSyncController({
      adapter: completeAdapter(), lifecycle: lifecycle(), rootOwnershipManager: rootOwnership(),
      localMachineId: 'm1', readFileAtTarget,
      resolveWorkspaceRef: (id) => ({ machineId: id === 'a' ? 'm1' : 'm2', rootPath: `/${id}` }),
    });
    await controller.ensure(definition);

    await expect(controller.readFile({
      relationshipId: 'r1', side: 'beta', path: 'src/file.ts',
      expectedDigest: 'old-digest', maxBytes: 1024,
    })).resolves.toMatchObject({ status: 'text', text: 'hello' });

    expect(readFileAtTarget).toHaveBeenCalledWith({
      relationshipId: 'r1', targetMachineId: 'm2', targetWorkspaceRefId: 'b',
      path: 'src/file.ts', expectedDigest: 'old-digest', maxBytes: 1024, signal: undefined,
    });
    await controller.terminate('r1');
  });
  it('fail-closes every state-touching entry point with the exact typed legacy-state code', async () => {
    for (const code of ['legacy_workspace_sync_state_unsupported', 'legacy_workspace_sync_state_unknown'] as const) {
      const adapter = completeAdapter();
      const lifecycle = { start: vi.fn(async () => undefined), stop: vi.fn(async () => undefined) };
      const controller = new WorkspaceSyncController({
        adapter, lifecycle, rootOwnershipManager: rootOwnership(), localMachineId: 'm1',
        resolveWorkspaceRef: (id) => ({ machineId: 'm1', rootPath: `/${id}` }),
        assertLegacyStateAvailable: () => { throw Object.assign(new Error('legacy workspace sync state'), { code }); },
      });
      const expectTyped = (run: Promise<unknown>) => expect(run).rejects.toMatchObject({ code });
      await expectTyped(controller.get('r1'));
      await expectTyped(controller.list());
      await expectTyped(controller.ensure(definition));
      await expectTyped(controller.copyOnce({
        v: 1, operationId: 'op-1', controllerMachineId: 'm1', alphaWorkspaceRefId: 'a', betaWorkspaceRefId: 'b',
        contentPolicy: { ...policy, policyDigest: computeWorkspaceSyncPolicyDigest(policy) },
      }));
      await expectTyped(controller.flush('r1'));
      await expectTyped(controller.pause('r1'));
      await expectTyped(controller.resume('r1'));
      await expectTyped(controller.terminate('r1'));
      await expectTyped(controller.listConflicts('r1'));
      await expectTyped(controller.deleteConflictLoser({ relationshipId: 'r1', path: 'src/x.ts', keep: 'alpha', expectedKind: 'file' }));
      await expectTyped(controller.readFile({ relationshipId: 'r1', side: 'beta', path: 'src/x.ts', maxBytes: 64 }));
      await expectTyped(controller.rehydrateFromSettings([definition]));
      await expectTyped(controller.openExternalStream({ endpointId: deriveWorkspaceSyncEndpointId('r1', 'beta') }));
      // No engine command, lifecycle start, or target RPC may have run.
      expect(lifecycle.start).not.toHaveBeenCalled();
      for (const method of ['rehydrate', 'ensure', 'copyOnce', 'get', 'list', 'flush', 'pause', 'resume', 'terminate', 'listConflicts'] as const) {
        expect(adapter[method]).not.toHaveBeenCalled();
      }
    }
  });

  it('keeps current behavior when the availability assertion passes', async () => {
    const ensure = vi.fn(async () => status);
    const controller = new WorkspaceSyncController({
      adapter: completeAdapter({ ensure }), lifecycle: lifecycle(), rootOwnershipManager: rootOwnership(),
      localMachineId: 'm1', resolveWorkspaceRef: (id) => ({ machineId: 'm1', rootPath: `/${id}` }),
      assertLegacyStateAvailable: () => undefined,
    });
    await controller.ensure(definition);
    expect(ensure).toHaveBeenCalledOnce();
    await controller.terminate('r1');
  });
});

function completeAdapter(overrides: Record<string, unknown> = {}) {
  return {
    rehydrate: vi.fn(async () => [status]), ensure: vi.fn(async () => status), copyOnce: vi.fn(async () => status), get: vi.fn(async () => status),
    list: vi.fn(async () => [status]), flush: vi.fn(async () => status), pause: vi.fn(async () => status),
    resume: vi.fn(async () => status), terminate: vi.fn(async () => undefined),
    listConflicts: vi.fn(async () => ({ relationshipId: 'r1', totalCount: 0, shownCount: 0, truncatedCount: 0, conflicts: [] })),
    deleteConflictLoser: vi.fn(async () => status),
    ...overrides,
  };
}

function lifecycle() { return { start: vi.fn(async () => undefined), stop: vi.fn(async () => undefined) }; }
function rootOwnership() {
  return { tryAcquire: vi.fn(async (owner) => ({
    owner: { ...owner, rootFingerprint: null },
    bindCurrentRootIdentity: vi.fn(async () => undefined),
    renew: vi.fn(async () => undefined),
    release: vi.fn(async () => undefined),
  })) };
}
