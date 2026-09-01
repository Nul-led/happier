import { AccountSettingsSchema } from '@happier-dev/protocol';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';

import { deriveWorkspaceSyncEndpointId } from '@/workspaces/sync/transport/workspaceSyncBrokerProtocol';
import { computeWorkspaceSyncPolicyDigest } from '@/workspaces/sync/workspaceSyncTypes';
import {
  createDaemonWorkspaceSyncRuntime,
  type DaemonWorkspaceSyncRuntimeDependencies,
} from './createDaemonWorkspaceSyncRuntime';

const policyInput = { v: 1 as const, selection: 'all_files' as const, extraIgnorePatterns: [], extraIncludePatterns: [], includeGitDirectory: false };
const relationship = {
  v: 1 as const,
  relationshipId: 'relationship-1',
  controllerMachineId: 'machine-1',
  alphaWorkspaceRefId: 'alpha-ref',
  betaWorkspaceRefId: 'beta-ref',
  mode: 'keep_synced' as const,
  contentPolicy: { ...policyInput, policyDigest: computeWorkspaceSyncPolicyDigest(policyInput) },
  enabled: true,
  createdAtMs: 1,
  updatedAtMs: 1,
};

function session(overrides: Readonly<Record<string, unknown>> = {}) {
  return {
    identifier: 'mutagen-1', name: relationship.relationshipId,
    labels: {
      'external.owner': 'happier-workspace-sync',
      'external.relationship_id': relationship.relationshipId,
      'external.endpoint_role': 'alpha|beta',
      'external.schema': 'workspace-sync-v1',
      'external.policy_digest': relationship.contentPolicy.policyDigest,
      'external.alpha_workspace_ref_id': relationship.alphaWorkspaceRefId,
      'external.beta_workspace_ref_id': relationship.betaWorkspaceRefId,
      'external.controller_machine_id': relationship.controllerMachineId,
      'external.operation_kind': 'relationship',
      'external.policy_selection': relationship.contentPolicy.selection,
      'external.include_git_directory': 'false',
    },
    alpha: { protocol: 'external', host: deriveWorkspaceSyncEndpointId(relationship.relationshipId, 'alpha'), path: '', connected: true, scanned: true },
    beta: { protocol: 'external', host: deriveWorkspaceSyncEndpointId(relationship.relationshipId, 'beta'), path: '', connected: true, scanned: true },
    mode: 'one-way-safe', paused: false, status: 'watching', successfulCycles: 1, conflicts: [], excludedConflicts: 0,
    ignore: { paths: ['.git/'] },
    ...overrides,
  };
}

function snapshot(
  relationships = [relationship],
  rawRelationships: unknown = relationships,
  settingsVersion = 1,
) {
  return {
    source: 'network' as const,
    settings: AccountSettingsSchema.parse({ workspaceSyncRelationshipsV1: relationships }),
    rawSettings: { workspaceSyncRelationshipsV1: rawRelationships },
    settingsVersion,
    loadedAtMs: 1,
    settingsSecretsReadKeys: [],
    scopeKey: 'account-1',
  };
}

function boundaries(options: Readonly<{
  artifactFailure?: Error;
  artifactFailureCount?: number;
  spawnFailure?: Error;
}> = {}) {
  let remainingArtifactFailures = options.artifactFailureCount ?? (options.artifactFailure ? Number.POSITIVE_INFINITY : 0);
  let activeRelationships = false;
  let relationshipPaused = false;
  let listener: ((previous: ReturnType<typeof snapshot> | null, next: ReturnType<typeof snapshot> | null) => void) | undefined;
  let terminateActiveSidecar: ((event: { type: 'exited'; code: number }) => void) | null = null;
  const command = vi.fn(async (input: Readonly<{ t: string }>) => {
    if (input.t === 'shutdown') {
      terminateActiveSidecar?.({ type: 'exited', code: 0 });
      return [];
    }
    if (!activeRelationships && input.t === 'create') {
      activeRelationships = true;
      relationshipPaused = true;
      return session({ paused: true, status: 'disconnected' });
    }
    if (!activeRelationships) return [];
    if (input.t === 'terminate') {
      activeRelationships = false;
      return null;
    }
    if (input.t === 'pause') relationshipPaused = true;
    if (input.t === 'resume') relationshipPaused = false;
    if (input.t === 'list') return [session({ paused: relationshipPaused })];
    if (input.t === 'get' || input.t === 'pause' || input.t === 'resume') {
      return session({ paused: relationshipPaused });
    }
    return [];
  });
  const closeBroker = vi.fn(async () => undefined);
  const stopSidecar = vi.fn(async () => terminateActiveSidecar?.({ type: 'exited', code: 0 }));
  const spawnSidecar = vi.fn<DaemonWorkspaceSyncRuntimeDependencies['spawnSidecar']>(async () => {
    if (options.spawnFailure) throw options.spawnFailure;
    const termination = new Promise<{ type: 'exited'; code: number }>((resolve) => {
      terminateActiveSidecar = resolve;
    });
    return { pid: 42, waitForTermination: async () => await termination, stop: stopSidecar };
  });
  const brokerBootstrapDescriptor = new Uint8Array([1, 2, 3]);
  const createBroker = vi.fn<DaemonWorkspaceSyncRuntimeDependencies['createBroker']>(async () => ({ bootstrapDescriptor: brokerBootstrapDescriptor, waitForReady: async () => undefined, command, close: closeBroker }));
  const deleteConflictLoserAtTarget = vi.fn(async () => undefined);
  const readFileAtTarget = vi.fn(async () => ({ status: 'missing' as const }));
  const resolveInstalledComponentPaths = vi.fn(() => ({ currentPath: '/installed/current', resolvedCurrentPath: '/installed/version' }));
  const resolveArtifactPaths = vi.fn(() => ({ managerPath: '/installed/version/bin/happier-mutagen', agentPath: '/installed/version/bin/happier-mutagen-agent' }));
  const assertArtifactPayload = vi.fn(() => {
    if (remainingArtifactFailures > 0) {
      remainingArtifactFailures -= 1;
      throw options.artifactFailure ?? new Error('invalid signed payload');
    }
    return { engineVersion: '0.18.1', protocolEpoch: 'external-stream-v1' };
  });
  const ensureInstalledComponent = vi.fn(async (input: Readonly<{ validatePayload(payloadRoot: string): void }>) => {
    input.validatePayload('/installed/version');
    return { currentPath: '/installed/current', resolvedCurrentPath: '/installed/version' } as any;
  });
  const resolveDataLayout = vi.fn(() => ({ rootDir: '/daemon/workspace-sync/mutagen', dataDir: '/daemon/workspace-sync/mutagen/data', brokerDir: '/daemon/workspace-sync/mutagen/broker', stagingDir: '/daemon/workspace-sync/mutagen/staging' }));
  const unsubscribeSettings = vi.fn();
  const prepareRelationshipTarget = vi.fn(async () => undefined);
  return {
    deps: {
      daemonDataRoot: '/daemon', localMachineId: 'machine-1', releaseChannel: 'publicdev' as const,
      resolveWorkspaceRef: (id: string) => id === 'alpha-ref'
        ? { machineId: 'machine-1', rootPath: '/canonical/alpha' }
        : { machineId: 'machine-2', rootPath: '/canonical/beta' },
      rootOwnershipManager: {
        tryAcquire: vi.fn(async (owner) => ({
          owner: { ...owner, rootFingerprint: null },
          bindCurrentRootIdentity: async () => undefined,
          renew: async () => undefined,
          release: async () => undefined,
        })),
      },
      prepareRelationshipTarget,
      bootstrap: vi.fn(async () => ({ release: async () => undefined })),
      deleteConflictLoserAtTarget,
      readFileAtTarget,
      createBroker, spawnSidecar,
      launchLocalAgent: vi.fn(async () => new PassThrough()),
      ensurePrivateDirectory: vi.fn(async () => undefined),
      randomBytes: () => new Uint8Array(32).fill(7), randomId: () => 'opaque-id',
      getSettingsSnapshot: () => null,
      subscribeSettingsSnapshot: (nextListener: typeof listener) => { listener = nextListener; return unsubscribeSettings; },
      resolveInstalledComponentPaths, ensureInstalledComponent, resolveArtifactPaths, assertArtifactPayload, resolveDataLayout,
    } satisfies DaemonWorkspaceSyncRuntimeDependencies,
    activateRelationships: () => { activeRelationships = true; relationshipPaused = false; listener?.(null, snapshot()); },
    publishSnapshot: (next: ReturnType<typeof snapshot>) => { listener?.(null, next); },
    command, closeBroker, stopSidecar, spawnSidecar, createBroker, unsubscribeSettings,
    resolveInstalledComponentPaths, ensureInstalledComponent, resolveArtifactPaths, assertArtifactPayload, resolveDataLayout,
    deleteConflictLoserAtTarget, readFileAtTarget, brokerBootstrapDescriptor,
    prepareRelationshipTarget,
  };
}

describe('createDaemonWorkspaceSyncRuntime', () => {
  it('keeps disabled settings relationships as paused sessions, resumes them, and terminates only on removal', async () => {
    const harness = boundaries();
    const runtime = createDaemonWorkspaceSyncRuntime(harness.deps);
    await runtime.start();
    harness.activateRelationships();
    await runtime.whenSettingsSettled();
    harness.command.mockClear();

    harness.publishSnapshot(snapshot([{ ...relationship, enabled: false, updatedAtMs: 2 }], undefined, 2));
    await runtime.whenSettingsSettled({ settingsVersion: 2, scopeKey: 'account-1' });
    expect(harness.command).toHaveBeenCalledWith(expect.objectContaining({ t: 'pause' }), undefined);
    expect(harness.command).not.toHaveBeenCalledWith(expect.objectContaining({ t: 'terminate' }), expect.anything());
    await expect(runtime.managedWorkspaceSync.get(relationship.relationshipId)).resolves.toMatchObject({ state: 'paused' });

    harness.command.mockClear();
    harness.publishSnapshot(snapshot([{ ...relationship, updatedAtMs: 3 }], undefined, 3));
    await runtime.whenSettingsSettled({ settingsVersion: 3, scopeKey: 'account-1' });
    expect(harness.command).toHaveBeenCalledWith(expect.objectContaining({ t: 'resume' }), undefined);

    harness.command.mockClear();
    harness.publishSnapshot(snapshot([], undefined, 4));
    await runtime.whenSettingsSettled({ settingsVersion: 4, scopeKey: 'account-1' });
    expect(harness.command).toHaveBeenCalledWith(expect.objectContaining({ t: 'terminate' }), undefined);
    await runtime.stop();
  });

  it('waits for the requested settings version even when its subscription callback is queued later', async () => {
    const harness = boundaries();
    const runtime = createDaemonWorkspaceSyncRuntime(harness.deps);
    await runtime.start();

    let settled = false;
    const waiting = runtime.whenSettingsSettled({ settingsVersion: 2, scopeKey: 'account-1' })
      .then(() => { settled = true; });
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(settled).toBe(false);

    harness.publishSnapshot(snapshot([], undefined, 2));
    await waiting;
    expect(settled).toBe(true);
    await runtime.stop();
  });

  it('recreates a missing session for a disabled restart record without starting synchronization', async () => {
    const harness = boundaries();
    const disabledSnapshot = snapshot([{ ...relationship, enabled: false, updatedAtMs: 2 }], undefined, 2);
    const runtime = createDaemonWorkspaceSyncRuntime({
      ...harness.deps,
      getSettingsSnapshot: () => disabledSnapshot,
    });

    await runtime.start();
    expect(harness.command).toHaveBeenCalledWith(expect.objectContaining({ t: 'create' }), undefined);
    expect(harness.command).not.toHaveBeenCalledWith(expect.objectContaining({ t: 'resume' }), expect.anything());
    await expect(runtime.managedWorkspaceSync.get(relationship.relationshipId)).resolves.toMatchObject({ state: 'paused' });
    await runtime.stop();
  });

  it('composes one shared lifecycle/controller/adapter, applies settings updates, and stops once', async () => {
    const harness = boundaries();
    const runtime = createDaemonWorkspaceSyncRuntime(harness.deps);

    await Promise.all([runtime.start(), runtime.start()]);
    expect(harness.spawnSidecar).toHaveBeenCalledTimes(1);
    expect(harness.spawnSidecar).toHaveBeenCalledWith({
      executablePath: '/installed/version/bin/happier-mutagen',
      args: ['--daemon', '--data-directory', '/daemon/workspace-sync/mutagen/data', '--broker-descriptor', '3'],
      inheritedBrokerDescriptor: harness.brokerBootstrapDescriptor,
      onSpawned: expect.any(Function),
    });
    expect(harness.spawnSidecar.mock.calls[0]?.[0].environment).toBeUndefined();
    harness.activateRelationships();
    await runtime.whenSettingsSettled();
    expect(harness.prepareRelationshipTarget).toHaveBeenCalledWith(relationship, undefined);
    expect(await runtime.managedWorkspaceSync.get(relationship.relationshipId)).toMatchObject({ relationshipId: relationship.relationshipId });

    await Promise.all([runtime.stop(), runtime.stop()]);
    expect(harness.stopSidecar).not.toHaveBeenCalled();
    expect(harness.closeBroker).toHaveBeenCalledTimes(1);
    expect(harness.unsubscribeSettings).toHaveBeenCalledTimes(1);
  });

  it('carries bootstrap root custody into the production controller without reacquiring the exact root', async () => {
    const harness = boundaries();
    const active = new Map<string, Readonly<{
      owner: { ownerId: string; canonicalRoot: string; operation: 'sync' | 'bootstrap' | 'handoff'; rootFingerprint: null };
      bindCurrentRootIdentity(): Promise<void>;
      release(): Promise<void>;
    }>>();
    const releases = new Map<string, ReturnType<typeof vi.fn>>();
    const tryAcquire = vi.fn(async (request: { ownerId: string; canonicalRoot: string; operation: 'sync' | 'bootstrap' | 'handoff' }) => {
      const existing = active.get(request.canonicalRoot);
      if (existing) return { kind: 'overlap' as const, existing: existing.owner };
      const release = vi.fn(async () => { active.delete(request.canonicalRoot); });
      releases.set(request.canonicalRoot, release);
      const handle = Object.freeze({
        owner: { ...request, rootFingerprint: null as null },
        bindCurrentRootIdentity: async () => undefined,
        release,
      });
      active.set(request.canonicalRoot, handle);
      return handle;
    });
    const rootOwnershipManager = { tryAcquire };
    const prepareRelationshipTarget = vi.fn(async () => {
      const target = await rootOwnershipManager.tryAcquire({
        ownerId: relationship.relationshipId,
        canonicalRoot: '/canonical/beta',
        operation: 'bootstrap',
      });
      if ('kind' in target) throw new Error('target bootstrap unexpectedly overlapped');
      return { ownershipHandles: [target] };
    });
    const runtime = createDaemonWorkspaceSyncRuntime({
      ...harness.deps,
      resolveWorkspaceRef: (id) => ({
        machineId: 'machine-1',
        rootPath: id === 'alpha-ref' ? '/canonical/alpha' : '/canonical/beta',
      }),
      rootOwnershipManager,
      prepareRelationshipTarget,
    });

    await runtime.start();
    harness.activateRelationships();
    await runtime.whenSettingsSettled();

    expect(tryAcquire.mock.calls.map(([request]) => [request.canonicalRoot, request.operation])).toEqual([
      ['/canonical/beta', 'bootstrap'],
      ['/canonical/alpha', 'sync'],
    ]);
    await runtime.stop();
    expect(releases.get('/canonical/alpha')).toHaveBeenCalledTimes(1);
    expect(releases.get('/canonical/beta')).not.toHaveBeenCalled();
    await active.get('/canonical/beta')?.release();
    expect(releases.get('/canonical/beta')).toHaveBeenCalledTimes(1);
  });

  it('does not issue a Mutagen list/create command for a settings relationship before target preparation finishes', async () => {
    const harness = boundaries();
    let releaseTarget!: () => void;
    let markTargetStarted!: () => void;
    const targetReady = new Promise<void>((resolve) => { releaseTarget = resolve; });
    const targetStarted = new Promise<void>((resolve) => { markTargetStarted = resolve; });
    harness.prepareRelationshipTarget.mockImplementationOnce(async () => {
      markTargetStarted();
      await targetReady;
    });
    const runtime = createDaemonWorkspaceSyncRuntime(harness.deps);
    await runtime.start();
    const commandsBeforeUpdate = harness.command.mock.calls.length;

    harness.activateRelationships();
    await targetStarted;
    expect(harness.prepareRelationshipTarget).toHaveBeenCalledWith(relationship, undefined);
    expect(harness.command.mock.calls).toHaveLength(commandsBeforeUpdate);

    releaseTarget();
    await runtime.whenSettingsSettled();
    expect(harness.command.mock.calls.length).toBeGreaterThan(commandsBeforeUpdate);
    await runtime.stop();
  });

  it('preserves the last-known-good relationships when the raw settings field is malformed', async () => {
    const harness = boundaries();
    const runtime = createDaemonWorkspaceSyncRuntime(harness.deps);
    await runtime.start();
    harness.activateRelationships();
    await runtime.whenSettingsSettled();
    harness.command.mockClear();

    harness.publishSnapshot(snapshot([], [{ ...relationship, mode: 'unsupported-mode' }]));

    await expect(runtime.whenSettingsSettled()).rejects.toMatchObject({
      code: 'workspace_sync_settings_invalid',
    });
    expect(harness.command).not.toHaveBeenCalledWith(
      expect.objectContaining({ t: 'terminate' }),
      expect.anything(),
    );
    await expect(runtime.managedWorkspaceSync.get(relationship.relationshipId)).resolves.toMatchObject({
      relationshipId: relationship.relationshipId,
    });
    await runtime.stop();
  });

  it('verifies the canonical installed payload before creating a broker or process', async () => {
    const harness = boundaries({ artifactFailure: new Error('invalid signed payload') });
    const runtime = createDaemonWorkspaceSyncRuntime(harness.deps);

    await expect(runtime.start()).rejects.toMatchObject({ code: 'engine_unavailable' });
    expect(harness.resolveInstalledComponentPaths).toHaveBeenCalledWith({ componentId: 'mutagen-engine', channel: 'publicdev' });
    expect(harness.ensureInstalledComponent).toHaveBeenCalledTimes(1);
    expect(harness.assertArtifactPayload).toHaveBeenCalledWith(expect.objectContaining({
      payloadRoot: '/installed/version',
      engineVersion: '0.18.1',
    }));
    expect(harness.resolveArtifactPaths).not.toHaveBeenCalled();
    expect(harness.createBroker).not.toHaveBeenCalled();
    expect(harness.spawnSidecar).not.toHaveBeenCalled();
    await runtime.stop();
    expect(harness.unsubscribeSettings).toHaveBeenCalledTimes(1);
  });

  it('acquires and validates a transiently missing artifact before starting', async () => {
    const harness = boundaries({ artifactFailureCount: 1 });
    const runtime = createDaemonWorkspaceSyncRuntime(harness.deps);

    await expect(runtime.start()).resolves.toBeUndefined();
    expect(harness.ensureInstalledComponent).toHaveBeenCalledTimes(1);
    expect(harness.spawnSidecar).toHaveBeenCalledTimes(1);

    await runtime.stop();
    expect(harness.unsubscribeSettings).toHaveBeenCalledTimes(1);
  });

  it('closes a partial broker start while retaining the one recoverable settings subscription', async () => {
    const harness = boundaries({ spawnFailure: new Error('spawn refused') });
    const runtime = createDaemonWorkspaceSyncRuntime(harness.deps);

    await expect(runtime.start()).rejects.toMatchObject({ code: 'engine_unavailable' });
    expect(harness.createBroker).toHaveBeenCalledTimes(1);
    expect(harness.closeBroker).toHaveBeenCalledTimes(1);
    expect(harness.unsubscribeSettings).not.toHaveBeenCalled();
    await runtime.stop();
    expect(harness.unsubscribeSettings).toHaveBeenCalledTimes(1);
  });

  it('reconciles the current settings through the controller after a supervised sidecar restart', async () => {
    vi.useFakeTimers();
    const harness = boundaries();
    let currentSnapshot: ReturnType<typeof snapshot> | null = null;
    const exits: Array<(event: { type: 'exited'; code: number }) => void> = [];
    const brokerEvents: string[] = [];
    const brokerCommands: Array<ReturnType<typeof vi.fn>> = [];
    let activeSidecars = 0;
    let maximumActiveSidecars = 0;
    const spawnSidecar = vi.fn<DaemonWorkspaceSyncRuntimeDependencies['spawnSidecar']>(async (input) => {
      activeSidecars += 1;
      maximumActiveSidecars = Math.max(maximumActiveSidecars, activeSidecars);
      const generation = exits.length + 1;
      input.onSpawned?.(40 + generation);
      let settled = false;
      let resolveTermination!: (event: { type: 'exited'; code: number }) => void;
      const termination = new Promise<{ type: 'exited'; code: number }>((resolve) => {
        resolveTermination = resolve;
      });
      const terminate = (event: { type: 'exited'; code: number }) => {
        if (settled) return;
        settled = true;
        activeSidecars -= 1;
        resolveTermination(event);
      };
      exits.push(terminate);
      return {
        pid: 40 + generation,
        waitForTermination: async () => await termination,
        stop: async () => terminate({ type: 'exited', code: 0 }),
      };
    });
    const createBroker = vi.fn<DaemonWorkspaceSyncRuntimeDependencies['createBroker']>(async () => {
      const generation = brokerCommands.length + 1;
      const command = vi.fn(async (input: Readonly<{ t: string }>) => {
        brokerEvents.push(`${generation}:${input.t}`);
        if (input.t === 'shutdown') {
          exits[generation - 1]?.({ type: 'exited', code: 0 });
          return [];
        }
        if (input.t === 'create' || input.t === 'resume') return session();
        return [];
      });
      brokerCommands.push(command);
      return {
        bootstrapDescriptor: new Uint8Array([generation]),
        waitForReady: async () => { brokerEvents.push(`${generation}:ready`); },
        command,
        close: async () => undefined,
      };
    });
    const runtime = createDaemonWorkspaceSyncRuntime({
      ...harness.deps,
      getSettingsSnapshot: () => currentSnapshot,
      spawnSidecar,
      createBroker,
    });
    let restartReconciled = false;

    try {
      await runtime.start();
      expect(spawnSidecar).toHaveBeenCalledTimes(1);
      expect(brokerCommands[0]).not.toHaveBeenCalledWith(expect.objectContaining({ t: 'create' }), expect.anything());

      exits[0]?.({ type: 'exited', code: 1 });
      currentSnapshot = snapshot();
      harness.activateRelationships();
      const settingsSettled = runtime.whenSettingsSettled();
      await vi.advanceTimersByTimeAsync(20_000);

      expect(spawnSidecar).toHaveBeenCalledTimes(2);
      expect(maximumActiveSidecars).toBe(1);
      expect(brokerCommands[1]).toHaveBeenCalledWith(expect.objectContaining({ t: 'create' }), undefined);
      expect(brokerEvents.indexOf('2:ready')).toBeLessThan(brokerEvents.indexOf('2:create'));
      await settingsSettled;
      restartReconciled = true;
    } finally {
      if (restartReconciled) await runtime.stop();
      else void runtime.stop();
      vi.useRealTimers();
    }
  });

  it('launches local agents from the verified artifact with an explicit canonical root', async () => {
    const harness = boundaries();
    const root = await mkdtemp(join(tmpdir(), 'daemon-workspace-sync-runtime-'));
    try {
      const runtime = createDaemonWorkspaceSyncRuntime({
        ...harness.deps,
        resolveWorkspaceRef: (id: string) => id === 'alpha-ref'
          ? { machineId: 'machine-1', rootPath: root }
          : { machineId: 'machine-2', rootPath: '/canonical/beta' },
      });
      await runtime.start();
      harness.activateRelationships();
      await runtime.whenSettingsSettled();

      await runtime.openExternalStream({ endpointId: deriveWorkspaceSyncEndpointId(relationship.relationshipId, 'alpha') });
      expect(harness.deps.launchLocalAgent).toHaveBeenCalledWith({
        executablePath: '/installed/version/bin/happier-mutagen-agent',
        args: ['synchronizer', '--external', '--root', root],
      });
      await runtime.stop();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('forwards broker open cancellation into the controller machine-carrier path', async () => {
    const harness = boundaries();
    const stopped = Object.assign(new Error('test transport stopped'), { code: 'cancelled' });
    const openMachineCarrierTunnel = vi.fn(async () => { throw stopped; });
    const runtime = createDaemonWorkspaceSyncRuntime({
      ...harness.deps,
      openMachineCarrierTunnel,
    });
    await runtime.start();
    harness.activateRelationships();
    await runtime.whenSettingsSettled();
    const brokerConfig = harness.createBroker.mock.calls[0]?.[0];
    if (!brokerConfig) throw new Error('broker was not created');
    const abort = new AbortController();

    await expect(brokerConfig.openExternalStream({
      endpointId: deriveWorkspaceSyncEndpointId(relationship.relationshipId, 'beta'),
      requestId: 'request-cancel-1',
      expiresAtMs: Date.now() + 1_000,
      signal: abort.signal,
    })).rejects.toBe(stopped);
    expect(openMachineCarrierTunnel).toHaveBeenCalledWith(expect.objectContaining({ signal: abort.signal }));
    await runtime.stop();
  });

  it('uses the daemon target authority for root-free remote previews', async () => {
    const harness = boundaries();
    const runtime = createDaemonWorkspaceSyncRuntime(harness.deps);
    await runtime.start();
    harness.activateRelationships();
    await runtime.whenSettingsSettled();

    await expect(runtime.managedWorkspaceSync.readFile({
      relationshipId: relationship.relationshipId,
      side: 'beta',
      path: 'src/index.ts',
      maxBytes: 1024,
    })).resolves.toEqual({ status: 'missing' });
    expect(harness.readFileAtTarget).toHaveBeenCalledWith({
      relationshipId: relationship.relationshipId,
      targetMachineId: 'machine-2',
      targetWorkspaceRefId: 'beta-ref',
      path: 'src/index.ts',
      maxBytes: 1024,
      signal: undefined,
    });
    await runtime.stop();
  });
});
