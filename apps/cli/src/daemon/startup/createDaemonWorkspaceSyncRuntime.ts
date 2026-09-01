import {
  assertMutagenEngineArtifactPayload,
  ensureInstalledFirstPartyComponent,
  MUTAGEN_ENGINE_VERSION,
  resolveInstalledFirstPartyComponentPaths,
  resolveMutagenEngineArtifactPaths,
  resolveMutagenEngineArtifactTarget,
  resolveMutagenEngineDataLayout,
  type MutagenEngineArtifactTarget,
} from '@happier-dev/cli-common/firstPartyRuntime';
import type { PublicReleaseRingId } from '@happier-dev/release-runtime/releaseRings';
import type { WorkspaceSyncCopyOnceV1, WorkspaceSyncRelationshipV1 } from '@happier-dev/protocol';
import { randomBytes, randomUUID } from 'node:crypto';
import { chmod, mkdir } from 'node:fs/promises';
import type { Duplex } from 'node:stream';

import {
  getActiveAccountSettingsSnapshot,
  subscribeActiveAccountSettingsSnapshot,
  type ActiveAccountSettingsSnapshot,
  type ActiveAccountSettingsSnapshotListener,
} from '@/settings/accountSettings/activeAccountSettingsSnapshot';
import {
  WorkspaceSyncController,
  type WorkspaceSyncLocalAgentStreamOpen,
  type WorkspaceSyncResolvedRef,
  type WorkspaceSyncTargetConflictDelete,
  type WorkspaceSyncTargetFileRead,
} from '@/workspaces/sync/workspaceSyncController';
import type { WorkspaceSyncMachineTunnelOpen } from '@/workspaces/sync/workspaceSyncMachineCarrierStream';
import {
  createWorkspaceSyncHandoffAdapter,
  type PrepareWorkspaceSyncHandoffInput,
  type WorkspaceSyncHandoffAdapter,
} from '@/workspaces/sync/workspaceSyncHandoffAdapter';
import { createWorkspaceSyncMutagenAdapter } from '@/workspaces/sync/workspaceSyncMutagenAdapter';
import {
  parseWorkspaceSyncRelationships,
  WORKSPACE_SYNC_SETTINGS_KEY,
} from '@/workspaces/sync/workspaceSyncSettings';
import type {
  WorkspaceRootOwnershipHandle,
  WorkspaceRootOwnershipManager,
} from '@/workspaces/sync/workspaceSyncRootOwnership';
import {
  WorkspaceSyncSidecarLifecycle,
  type SpawnWorkspaceSyncSidecar,
  type WorkspaceSyncSidecarLifecycleDependencies,
} from '@/workspaces/sync/workspaceSyncSidecarLifecycle';
import type { ManagedWorkspaceSync, WorkspaceSyncRelationshipPreparation } from '@/workspaces/sync/workspaceSyncTypes';
import type { WorkspaceSyncRelationshipOwner } from '@/workspaces/sync/workspaceSyncRelationshipOwner';

type InstalledPaths = Readonly<{ currentPath: string; resolvedCurrentPath: string | null }>;
type ArtifactPaths = Readonly<{ managerPath: string; agentPath: string }>;
type ArtifactManifest = Readonly<{ engineVersion: string; protocolEpoch: string }>;
type DataLayout = Readonly<{ rootDir: string; dataDir: string; brokerDir: string; stagingDir: string }>;

export type LaunchWorkspaceSyncLocalAgent = (input: Readonly<{
  executablePath: string;
  args: readonly string[];
  signal?: AbortSignal;
  environment?: never;
}>) => Promise<Duplex>;

export type DaemonWorkspaceSyncRuntimeDependencies = Readonly<{
  daemonDataRoot: string;
  localMachineId: string;
  releaseChannel: PublicReleaseRingId;
  resolveWorkspaceRef(id: string): WorkspaceSyncResolvedRef | null | Promise<WorkspaceSyncResolvedRef | null>;
  rootOwnershipManager: WorkspaceRootOwnershipManager;
  prepareRelationshipTarget(definition: WorkspaceSyncRelationshipV1, signal?: AbortSignal, preparation?: WorkspaceSyncRelationshipPreparation): Promise<Readonly<{
    ownershipHandles?: readonly WorkspaceRootOwnershipHandle[];
  }> | void>;
  recoverCopyOnceTarget?(operation: WorkspaceSyncCopyOnceV1): Promise<Readonly<{
    release(reason: 'abort' | 'commit'): Promise<void>;
  }>>;
  bootstrap(input: PrepareWorkspaceSyncHandoffInput): Promise<Readonly<{
    release(reason: 'abort' | 'commit'): Promise<void>;
    ownershipHandles?: readonly WorkspaceRootOwnershipHandle[];
  }>>;
  createBroker: WorkspaceSyncSidecarLifecycleDependencies['createBroker'];
  spawnSidecar: SpawnWorkspaceSyncSidecar;
  launchLocalAgent: LaunchWorkspaceSyncLocalAgent;
  openMachineCarrierTunnel?: WorkspaceSyncMachineTunnelOpen;
  handoffRelationshipController?: Pick<ManagedWorkspaceSync, 'flush'>;
  relationshipOwner?: Pick<WorkspaceSyncRelationshipOwner, 'materializeEndpoints' | 'prepareCreate'>;
  deleteConflictLoserAtTarget?: WorkspaceSyncTargetConflictDelete;
  readFileAtTarget?: WorkspaceSyncTargetFileRead;
  getSettingsSnapshot?: () => ActiveAccountSettingsSnapshot | null;
  subscribeSettingsSnapshot?: (listener: ActiveAccountSettingsSnapshotListener) => () => void;
  resolveInstalledComponentPaths?: (input: Readonly<{ componentId: 'mutagen-engine'; channel: PublicReleaseRingId }>) => InstalledPaths;
  ensureInstalledComponent?: typeof ensureInstalledFirstPartyComponent;
  resolveArtifactPaths?: (payloadRoot: string) => ArtifactPaths;
  assertArtifactPayload?: (input: Readonly<{ payloadRoot: string; targetTriple: MutagenEngineArtifactTarget; engineVersion?: string }>) => ArtifactManifest;
  resolveArtifactTarget?: () => MutagenEngineArtifactTarget;
  resolveDataLayout?: (input: Readonly<{ daemonDataRoot: string; stackDevTargetMutagenDataDir?: string | null }>) => DataLayout;
  ensurePrivateDirectory?: (path: string) => Promise<void>;
  randomBytes?: (length: number) => Uint8Array;
  randomId?: () => string;
  /**
   * Retired legacy-state availability assertion derived by the production
   * composition from its one startup inspection; enforced by the controller
   * before every state-touching entry point.
   */
  assertLegacyStateAvailable?: () => void;
}>;

export type DaemonWorkspaceSyncRuntime = Readonly<{
  handoffAdapter: WorkspaceSyncHandoffAdapter;
  managedWorkspaceSync: ManagedWorkspaceSync;
  openExternalStream(input: Readonly<{ endpointId: string; signal?: AbortSignal }>): Promise<Duplex>;
  openRootedAgent: WorkspaceSyncLocalAgentStreamOpen;
  start(): Promise<void>;
  stop(): Promise<void>;
  whenSettingsSettled(target?: Readonly<{
    settingsVersion: number;
    scopeKey?: string;
    signal?: AbortSignal;
  }>): Promise<void>;
}>;

async function ensurePrivateDirectory(path: string): Promise<void> {
  await mkdir(path, { recursive: true, mode: 0o700 });
  if (process.platform !== 'win32') await chmod(path, 0o700);
}

/**
 * Daemon composition root for the single workspace-sync manager, broker,
 * controller, and handoff adapter. Durable relationship authority remains in
 * Account Settings and reconciliation remains in WorkspaceSyncController.
 */
export function createDaemonWorkspaceSyncRuntime(
  dependencies: DaemonWorkspaceSyncRuntimeDependencies,
): DaemonWorkspaceSyncRuntime {
  const resolveInstalled = dependencies.resolveInstalledComponentPaths ?? resolveInstalledFirstPartyComponentPaths;
  const ensureInstalled = dependencies.ensureInstalledComponent ?? ensureInstalledFirstPartyComponent;
  const resolvePaths = dependencies.resolveArtifactPaths ?? resolveMutagenEngineArtifactPaths;
  const assertPayload = dependencies.assertArtifactPayload ?? assertMutagenEngineArtifactPayload;
  const resolveTarget = dependencies.resolveArtifactTarget ?? (() => resolveMutagenEngineArtifactTarget());
  const resolveLayout = dependencies.resolveDataLayout ?? resolveMutagenEngineDataLayout;
  const layout = resolveLayout({
    daemonDataRoot: dependencies.daemonDataRoot,
    stackDevTargetMutagenDataDir: process.env.MUTAGEN_DATA_DIRECTORY,
  });
  const getSnapshot = dependencies.getSettingsSnapshot ?? getActiveAccountSettingsSnapshot;
  const subscribeSnapshot = dependencies.subscribeSettingsSnapshot ?? subscribeActiveAccountSettingsSnapshot;
  let acceptedRelationships: readonly WorkspaceSyncRelationshipV1[] = [];

  let verifiedRuntime: Promise<Readonly<{
    managerPath: string;
    agentPath: string;
    dataDir: string;
    brokerDir: string;
    manifest: ArtifactManifest;
  }>> | null = null;
  const resolveRuntime = () => {
    if (verifiedRuntime) return verifiedRuntime;
    const pending = Promise.resolve().then(async () => {
      const validatePayload = (payloadRoot: string) => assertPayload({
        payloadRoot,
        targetTriple: resolveTarget(),
        engineVersion: MUTAGEN_ENGINE_VERSION,
      });
      let installed: InstalledPaths;
      try {
        installed = resolveInstalled({ componentId: 'mutagen-engine', channel: dependencies.releaseChannel });
        validatePayload(installed.resolvedCurrentPath ?? installed.currentPath);
      } catch {
        installed = await ensureInstalled({
          componentId: 'mutagen-engine',
          channel: dependencies.releaseChannel,
          versionId: MUTAGEN_ENGINE_VERSION,
          validatePayload,
        });
      }
      const payloadRoot = installed.resolvedCurrentPath ?? installed.currentPath;
      const paths = resolvePaths(payloadRoot);
      const manifest = assertPayload({ payloadRoot, targetTriple: resolveTarget(), engineVersion: MUTAGEN_ENGINE_VERSION });
      return { managerPath: paths.managerPath, agentPath: paths.agentPath, dataDir: layout.dataDir, brokerDir: layout.brokerDir, manifest };
    });
    verifiedRuntime = pending;
    void pending.catch(() => {
      if (verifiedRuntime === pending) verifiedRuntime = null;
    });
    return pending;
  };

  let controller!: WorkspaceSyncController;
  let reconcileAfterSidecarRestart: (() => Promise<void>) | null = null;
  const lifecycle = new WorkspaceSyncSidecarLifecycle({
    resolveRuntime,
    createBroker: dependencies.createBroker,
    openExternalStream: async (context) => await controller.openExternalStream({
      endpointId: context.endpointId,
      signal: context.signal,
    }),
    spawn: dependencies.spawnSidecar,
    ensurePrivateDirectory: dependencies.ensurePrivateDirectory ?? ensurePrivateDirectory,
    randomBytes: dependencies.randomBytes ?? ((length) => randomBytes(length)),
    randomId: dependencies.randomId ?? randomUUID,
    onRestartReady: async () => {
      if (!reconcileAfterSidecarRestart) {
        throw new Error('Workspace sync restart reconciliation is unavailable');
      }
      await reconcileAfterSidecarRestart();
    },
  });
  const adapter = createWorkspaceSyncMutagenAdapter({
    send: async (command, signal) => await lifecycle.command(command, signal),
    resolveWorkspaceRef: dependencies.resolveWorkspaceRef,
  });
  const openRootedAgent: WorkspaceSyncLocalAgentStreamOpen = async (input) => {
    const runtime = await resolveRuntime();
    return await dependencies.launchLocalAgent({
      executablePath: runtime.agentPath,
      args: ['synchronizer', '--external', '--root', input.canonicalRoot],
      ...(input.signal ? { signal: input.signal } : {}),
    });
  };
  controller = new WorkspaceSyncController({
    adapter,
    lifecycle,
    localMachineId: dependencies.localMachineId,
    resolveWorkspaceRef: dependencies.resolveWorkspaceRef,
    rootOwnershipManager: dependencies.rootOwnershipManager,
    resolveRelationshipDefinition: (relationshipId) => {
      const matches = acceptedRelationships.filter((candidate) => (
        candidate.relationshipId === relationshipId
        && candidate.enabled
        && candidate.controllerMachineId === dependencies.localMachineId
      ));
      return matches.length === 1 ? matches[0]! : null;
    },
    prepareRelationshipTarget: dependencies.prepareRelationshipTarget,
    ...(dependencies.recoverCopyOnceTarget ? { recoverCopyOnceTarget: dependencies.recoverCopyOnceTarget } : {}),
    ...(dependencies.openMachineCarrierTunnel ? { openMachineCarrierTunnel: dependencies.openMachineCarrierTunnel } : {}),
    openLocalWorkspaceAgentStream: openRootedAgent,
    ...(dependencies.deleteConflictLoserAtTarget ? { deleteConflictLoserAtTarget: dependencies.deleteConflictLoserAtTarget } : {}),
    ...(dependencies.readFileAtTarget ? { readFileAtTarget: dependencies.readFileAtTarget } : {}),
    ...(dependencies.assertLegacyStateAvailable ? { assertLegacyStateAvailable: dependencies.assertLegacyStateAvailable } : {}),
  });
  const handoffAdapter = createWorkspaceSyncHandoffAdapter({
    sync: controller,
    ...(dependencies.handoffRelationshipController
      ? { relationshipController: dependencies.handoffRelationshipController }
      : {}),
    ...(dependencies.relationshipOwner ? { relationshipOwner: dependencies.relationshipOwner } : {}),
    bootstrap: dependencies.bootstrap,
  });

  let unsubscribe: (() => void) | null = null;
  let settingsTail: Promise<void> = Promise.resolve();
  let settingsQueueRevision = 0;
  let reconciledSnapshot: ActiveAccountSettingsSnapshot | null = null;
  const settingsQueueWaiters = new Set<() => void>();
  let startPromise: Promise<void> | null = null;
  let stopPromise: Promise<void> | null = null;
  let started = false;
  let stopped = false;

  const readRelationships = (snapshot: ActiveAccountSettingsSnapshot | null): readonly WorkspaceSyncRelationshipV1[] => {
    const rawValue = snapshot?.rawSettings
      ? snapshot.rawSettings[WORKSPACE_SYNC_SETTINGS_KEY]
      : snapshot?.settings.workspaceSyncRelationshipsV1;
    try {
      return parseWorkspaceSyncRelationships(rawValue);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Invalid workspace sync settings';
      throw Object.assign(new Error(message), { code: 'workspace_sync_settings_invalid' as const });
    }
  };

  const applySnapshot = (snapshot: ActiveAccountSettingsSnapshot | null): Promise<void> => {
    const next = settingsTail.catch(() => undefined).then(async () => {
      const relationships = readRelationships(snapshot);
      acceptedRelationships = relationships;
      await lifecycle.runReconciliation(async () => {
        await controller.rehydrateFromSettings(relationships);
      });
      reconciledSnapshot = snapshot;
    });
    settingsTail = next;
    settingsQueueRevision += 1;
    for (const resolve of settingsQueueWaiters) resolve();
    settingsQueueWaiters.clear();
    void next.catch(() => undefined);
    return next;
  };
  reconcileAfterSidecarRestart = async () => await applySnapshot(getSnapshot());

  const start = (): Promise<void> => {
    if (started) return Promise.resolve();
    if (stopped) return Promise.reject(new Error('Daemon workspace sync runtime is stopped'));
    if (startPromise) return startPromise;
    const pending = (async () => {
      unsubscribe ??= subscribeSnapshot((_previous, next) => { void applySnapshot(next); });
      await applySnapshot(getSnapshot());
      started = true;
    })();
    startPromise = pending;
    void pending.finally(() => {
      if (startPromise === pending && !started) startPromise = null;
    }).catch(() => undefined);
    return pending;
  };

  const stop = (): Promise<void> => {
    if (stopPromise) return stopPromise;
    stopped = true;
    for (const resolve of settingsQueueWaiters) resolve();
    settingsQueueWaiters.clear();
    stopPromise = (async () => {
      await startPromise?.catch(() => undefined);
      unsubscribe?.();
      unsubscribe = null;
      await settingsTail.catch(() => undefined);
      await controller.shutdown();
      started = false;
    })();
    return stopPromise;
  };

  const matchesReconciliationTarget = (
    snapshot: ActiveAccountSettingsSnapshot | null,
    target: Readonly<{ settingsVersion: number; scopeKey?: string }>,
  ): boolean => snapshot !== null
    && snapshot.settingsVersion >= target.settingsVersion
    && (target.scopeKey === undefined || snapshot.scopeKey === target.scopeKey);

  const waitForSettingsQueueAdvance = (revision: number, signal?: AbortSignal): Promise<void> => {
    if (settingsQueueRevision > revision || stopped) return Promise.resolve();
    signal?.throwIfAborted();
    return new Promise<void>((resolve, reject) => {
      const finish = () => {
        signal?.removeEventListener('abort', onAbort);
        resolve();
      };
      const onAbort = () => {
        settingsQueueWaiters.delete(finish);
        reject(signal?.reason ?? Object.assign(new Error('Workspace sync settings wait cancelled'), {
          name: 'AbortError',
          code: 'cancelled',
        }));
      };
      settingsQueueWaiters.add(finish);
      signal?.addEventListener('abort', onAbort, { once: true });
      if (settingsQueueRevision > revision || stopped) {
        settingsQueueWaiters.delete(finish);
        finish();
      }
    });
  };

  const whenSettingsSettled = async (target?: Readonly<{
    settingsVersion: number;
    scopeKey?: string;
    signal?: AbortSignal;
  }>): Promise<void> => {
    if (!target) {
      await settingsTail;
      return;
    }
    while (!matchesReconciliationTarget(reconciledSnapshot, target)) {
      target.signal?.throwIfAborted();
      if (stopped) throw new Error('Daemon workspace sync runtime is stopped');
      const observedRevision = settingsQueueRevision;
      await settingsTail;
      if (matchesReconciliationTarget(reconciledSnapshot, target)) return;
      if (settingsQueueRevision > observedRevision) continue;
      const current = getSnapshot();
      if (matchesReconciliationTarget(current, target)) {
        await applySnapshot(current);
        continue;
      }
      await waitForSettingsQueueAdvance(observedRevision, target.signal);
    }
  };

  return {
    handoffAdapter,
    managedWorkspaceSync: controller,
    openExternalStream: async (input) => await controller.openExternalStream(input),
    openRootedAgent,
    start,
    stop,
    whenSettingsSettled,
  };
}
