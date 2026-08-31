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

function session() {
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
    },
    alpha: { protocol: 'external', host: deriveWorkspaceSyncEndpointId(relationship.relationshipId, 'alpha'), path: '', connected: true, scanned: true },
    beta: { protocol: 'external', host: deriveWorkspaceSyncEndpointId(relationship.relationshipId, 'beta'), path: '', connected: true, scanned: true },
    mode: 'one-way-safe', paused: false, status: 'watching', successfulCycles: 1, conflicts: [], excludedConflicts: 0,
  };
}

function snapshot(relationships = [relationship]) {
  return {
    source: 'network' as const,
    settings: AccountSettingsSchema.parse({ workspaceSyncRelationshipsV1: relationships }),
    settingsVersion: 1,
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
  let listener: ((previous: ReturnType<typeof snapshot> | null, next: ReturnType<typeof snapshot> | null) => void) | undefined;
  const command = vi.fn(async (input: Readonly<{ t: string }>) => {
    if (!activeRelationships) return [];
    if (input.t === 'list') return [session()];
    if (input.t === 'get') return session();
    return [];
  });
  const closeBroker = vi.fn(async () => undefined);
  const stopSidecar = vi.fn(async () => undefined);
  const spawnSidecar = vi.fn<DaemonWorkspaceSyncRuntimeDependencies['spawnSidecar']>(async () => {
    if (options.spawnFailure) throw options.spawnFailure;
    return { pid: 42, waitForTermination: async () => new Promise<never>(() => undefined), stop: stopSidecar };
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
      resolveInstalledComponentPaths, resolveArtifactPaths, assertArtifactPayload, resolveDataLayout,
    } satisfies DaemonWorkspaceSyncRuntimeDependencies,
    activateRelationships: () => { activeRelationships = true; listener?.(null, snapshot()); },
    command, closeBroker, stopSidecar, spawnSidecar, createBroker, unsubscribeSettings,
    resolveInstalledComponentPaths, resolveArtifactPaths, assertArtifactPayload, resolveDataLayout,
    deleteConflictLoserAtTarget, readFileAtTarget, brokerBootstrapDescriptor,
    prepareRelationshipTarget,
  };
}

describe('createDaemonWorkspaceSyncRuntime', () => {
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
    expect(harness.stopSidecar).toHaveBeenCalledTimes(1);
    expect(harness.closeBroker).toHaveBeenCalledTimes(1);
    expect(harness.unsubscribeSettings).toHaveBeenCalledTimes(1);
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

  it('verifies the canonical installed payload before creating a broker or process', async () => {
    const harness = boundaries({ artifactFailure: new Error('invalid signed payload') });
    const runtime = createDaemonWorkspaceSyncRuntime(harness.deps);

    await expect(runtime.start()).rejects.toMatchObject({ code: 'engine_unavailable' });
    expect(harness.resolveInstalledComponentPaths).toHaveBeenCalledWith({ componentId: 'mutagen-engine', channel: 'publicdev' });
    expect(harness.resolveArtifactPaths).toHaveBeenCalledWith('/installed/version');
    expect(harness.assertArtifactPayload).toHaveBeenCalledWith(expect.objectContaining({ payloadRoot: '/installed/version' }));
    expect(harness.createBroker).not.toHaveBeenCalled();
    expect(harness.spawnSidecar).not.toHaveBeenCalled();
    await runtime.stop();
    expect(harness.unsubscribeSettings).toHaveBeenCalledTimes(1);
  });

  it('keeps one settings subscription and retries after a transient artifact failure', async () => {
    const harness = boundaries({ artifactFailureCount: 1 });
    const runtime = createDaemonWorkspaceSyncRuntime(harness.deps);

    await expect(runtime.start()).rejects.toMatchObject({ code: 'engine_unavailable' });
    expect(harness.unsubscribeSettings).not.toHaveBeenCalled();

    await expect(runtime.start()).resolves.toBeUndefined();
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
        args: ['synchronizer', '--root', root],
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
