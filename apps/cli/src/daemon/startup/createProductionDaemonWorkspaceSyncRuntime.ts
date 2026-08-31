import { join } from 'node:path';

import type { PublicReleaseRingId } from '@happier-dev/release-runtime/releaseRings';
import type {
  WorkspaceSyncStatusV1,
  WorkspaceSyncRelationshipV1,
  WorkspaceSyncTargetBootstrapPrepareV1,
} from '@happier-dev/protocol';
import { WorkspaceSyncStatusV1Schema } from '@happier-dev/protocol';
import { RPC_METHODS } from '@happier-dev/protocol/rpc';

import type { MachineWorkspaceSyncRpcService } from '@/api/machine/rpcHandlers.workspaceSync';
import type { StoredCredentials } from '@/persistence';
import {
  getActiveAccountSettingsSnapshot,
  subscribeActiveAccountSettingsSnapshot,
  type ActiveAccountSettingsSnapshot,
} from '@/settings/accountSettings/activeAccountSettingsSnapshot';
import { resolveWorkspaceRefById } from '@/settings/accountSettings/workspaceRefsV1';
import { callMachineRpc } from '@/session/transport/rpc/machineRpc';
import { logger } from '@/ui/logger';
import {
  createWorkspaceRootOwnershipManager,
  type WorkspaceRootOwnershipHandle,
} from '@/workspaces/sync/workspaceSyncRootOwnership';
import {
  createWorkspaceSyncTargetAuthority,
  type AcquireWorkspaceSyncMachineIngressRequest,
  type WorkspaceSyncMachineIngress,
} from '@/workspaces/sync/workspaceSyncTargetAuthority';
import { prepareExistingGitWorkspaceSyncTarget } from '@/workspaces/sync/workspaceSyncTargetBootstrap';
import { createWorkspaceSyncPeerIdentityValidator } from '@/workspaces/sync/transport/workspaceSyncPeerIdentity';
import {
  cleanupRetiredWorkspaceReplicationState,
  createWorkspaceSyncLegacyStateGate,
  inspectRetiredWorkspaceReplicationState,
  type WorkspaceSyncLegacyStateInspection,
} from '@/workspaces/sync/workspaceSyncLegacyState';
import type { WorkspaceSyncHandoffAdapter } from '@/workspaces/sync/workspaceSyncHandoffAdapter';
import type { WorkspaceSyncMachineTunnelOpen } from '@/workspaces/sync/workspaceSyncMachineCarrierStream';
import { createDaemonWorkspaceSyncBroker } from './createDaemonWorkspaceSyncBroker';
import {
  createDaemonWorkspaceSyncRuntime,
  type DaemonWorkspaceSyncRuntimeDependencies,
} from './createDaemonWorkspaceSyncRuntime';
import {
  launchWorkspaceSyncLocalAgent,
  spawnWorkspaceSyncSidecar,
} from './workspaceSyncNativeProcessLaunchers';

export type ProductionDaemonWorkspaceSyncFactories = Readonly<{
  createDaemonRuntime: typeof createDaemonWorkspaceSyncRuntime;
  createTargetAuthority: typeof createWorkspaceSyncTargetAuthority;
  createRootOwnershipManager: typeof createWorkspaceRootOwnershipManager;
  createPeerIdentityValidator: typeof createWorkspaceSyncPeerIdentityValidator;
  createBroker: typeof createDaemonWorkspaceSyncBroker;
  spawnSidecar: typeof spawnWorkspaceSyncSidecar;
  launchLocalAgent: typeof launchWorkspaceSyncLocalAgent;
  getSettingsSnapshot: () => ActiveAccountSettingsSnapshot | null;
  subscribeSettingsSnapshot: typeof subscribeActiveAccountSettingsSnapshot;
  callMachineRpc: typeof callMachineRpc;
  inspectLegacyState: typeof inspectRetiredWorkspaceReplicationState;
  prepareGitTarget: typeof prepareExistingGitWorkspaceSyncTarget;
  warn(message: string, error: unknown): void;
}>;

export type ProductionDaemonWorkspaceSyncRuntime = Readonly<{
  handoffAdapter: WorkspaceSyncHandoffAdapter;
  workspaceSync: MachineWorkspaceSyncRpcService;
  acquireWorkspaceSyncMachineIngress(request: AcquireWorkspaceSyncMachineIngressRequest): Promise<WorkspaceSyncMachineIngress>;
  stop(): Promise<void>;
}>;

const defaultFactories: ProductionDaemonWorkspaceSyncFactories = {
  createDaemonRuntime: createDaemonWorkspaceSyncRuntime,
  createTargetAuthority: createWorkspaceSyncTargetAuthority,
  createRootOwnershipManager: createWorkspaceRootOwnershipManager,
  createPeerIdentityValidator: createWorkspaceSyncPeerIdentityValidator,
  createBroker: createDaemonWorkspaceSyncBroker,
  spawnSidecar: spawnWorkspaceSyncSidecar,
  launchLocalAgent: launchWorkspaceSyncLocalAgent,
  getSettingsSnapshot: getActiveAccountSettingsSnapshot,
  subscribeSettingsSnapshot: subscribeActiveAccountSettingsSnapshot,
  callMachineRpc,
  inspectLegacyState: inspectRetiredWorkspaceReplicationState,
  prepareGitTarget: prepareExistingGitWorkspaceSyncTarget,
  warn: (message, error) => logger.warn(message, error),
};

function compositionError(code: string, message: string): Error {
  return Object.assign(new Error(message), { code });
}

function controllerUnavailable(cause?: unknown): Error {
  return Object.assign(new Error('Workspace sync controller machine is unavailable', { cause }), {
    code: 'controller_unavailable',
  });
}

function parseControllerStatusResponse(value: unknown): WorkspaceSyncStatusV1 {
  if (!value || typeof value !== 'object' || Array.isArray(value) || !('status' in value)) {
    throw controllerUnavailable();
  }
  const status = (value as { status: unknown }).status;
  const parsed = WorkspaceSyncStatusV1Schema.safeParse(status);
  if (!parsed.success) throw controllerUnavailable(parsed.error);
  return parsed.data;
}

function resolveRelationship(
  snapshot: ActiveAccountSettingsSnapshot | null,
  relationshipId: string,
): WorkspaceSyncRelationshipV1 {
  const matches = (snapshot?.settings.workspaceSyncRelationshipsV1 ?? []).filter((candidate) => (
    candidate.relationshipId === relationshipId && candidate.enabled
  ));
  if (matches.length !== 1) {
    throw compositionError('relationship_not_ready', 'Workspace sync relationship is not ready');
  }
  return matches[0]!;
}

function resolveRelationshipBootstrapTarget(
  snapshot: ActiveAccountSettingsSnapshot | null,
  relationship: WorkspaceSyncRelationshipV1,
): Readonly<{ workspaceRefId: string; machineId: string; endpointRole: 'alpha' | 'beta' }> {
  const refs = snapshot?.settings.workspaceRefsV1 ?? [];
  const alpha = resolveWorkspaceRefById(refs, relationship.alphaWorkspaceRefId);
  const beta = resolveWorkspaceRefById(refs, relationship.betaWorkspaceRefId);
  if (!alpha || !beta) {
    throw compositionError('peer_unavailable', 'Workspace sync relationship endpoint is unavailable');
  }
  if (relationship.mode !== 'keep_both_in_sync') {
    if (alpha.machineId !== relationship.controllerMachineId) {
      throw compositionError('relationship_definition_conflict', 'One-way workspace sync controller must own the alpha endpoint');
    }
    return { workspaceRefId: beta.id, machineId: beta.machineId, endpointRole: 'beta' };
  }
  if (alpha.machineId === relationship.controllerMachineId && beta.machineId !== relationship.controllerMachineId) {
    return { workspaceRefId: beta.id, machineId: beta.machineId, endpointRole: 'beta' };
  }
  if (beta.machineId === relationship.controllerMachineId && alpha.machineId !== relationship.controllerMachineId) {
    return { workspaceRefId: alpha.id, machineId: alpha.machineId, endpointRole: 'alpha' };
  }
  if (alpha.machineId === relationship.controllerMachineId && beta.machineId === relationship.controllerMachineId) {
    return { workspaceRefId: beta.id, machineId: beta.machineId, endpointRole: 'beta' };
  }
  throw compositionError('relationship_definition_conflict', 'Workspace sync controller does not own a relationship endpoint');
}

function resolveBootstrapPrepareRequest(
  input: Parameters<DaemonWorkspaceSyncRuntimeDependencies['bootstrap']>[0],
  snapshot: ActiveAccountSettingsSnapshot | null,
): WorkspaceSyncTargetBootstrapPrepareV1 & Readonly<{ targetMachineId: string; signal?: AbortSignal }> {
  if (input.action.kind === 'none') {
    throw compositionError('workspace_sync_unavailable', 'Workspace sync bootstrap is not required for a none action');
  }
  if (input.action.kind === 'copy_once') {
    return {
      v: 1,
      bootstrapOperationId: input.operationId,
      owner: {
        kind: 'copy_once',
        operation: {
          v: 1,
          operationId: input.operationId,
          controllerMachineId: input.sourceMachineId,
          alphaWorkspaceRefId: input.sourceWorkspaceRefId,
          betaWorkspaceRefId: input.targetWorkspaceRefId,
          contentPolicy: input.action.contentPolicy,
        },
      },
      targetWorkspaceRefId: input.targetWorkspaceRefId,
      targetMachineId: input.targetMachineId,
      endpointRole: 'beta',
      policyDigest: input.action.contentPolicy.policyDigest,
      createIfMissing: true,
      ...(input.signal ? { signal: input.signal } : {}),
    };
  }

  const relationship = resolveRelationship(snapshot, input.action.relationshipId);
  const endpointRole = relationship.alphaWorkspaceRefId === input.targetWorkspaceRefId
    && relationship.betaWorkspaceRefId === input.sourceWorkspaceRefId
    ? 'alpha'
    : relationship.betaWorkspaceRefId === input.targetWorkspaceRefId
      && relationship.alphaWorkspaceRefId === input.sourceWorkspaceRefId
      ? 'beta'
      : null;
  if (!endpointRole) {
    throw compositionError('relationship_not_ready', 'Workspace sync handoff endpoints do not match the relationship');
  }
  return {
    v: 1,
    bootstrapOperationId: input.operationId,
    owner: { kind: 'relationship', relationshipId: relationship.relationshipId },
    targetWorkspaceRefId: input.targetWorkspaceRefId,
    targetMachineId: input.targetMachineId,
    endpointRole,
    policyDigest: relationship.contentPolicy.policyDigest,
    createIfMissing: true,
    ...(input.signal ? { signal: input.signal } : {}),
  };
}

/**
 * The production composition boundary for Lane 08. It constructs one root
 * owner, target authority, broker/manager lifecycle, controller, and handoff
 * adapter for the registered daemon machine. The retired legacy-state root is
 * inspected exactly once here, and the resulting availability assertion is
 * threaded into the controller and target authority so unknown or retired v1
 * state fails closed before any mutation. Engine startup is best-effort: the
 * same runtime remains installed so a later command or settings update can
 * retry after an artifact or process failure.
 */
export async function createProductionDaemonWorkspaceSyncRuntime(
  input: Readonly<{
    happyHomeDir: string;
    activeServerDir: string;
    localMachineId: string;
    releaseChannel: PublicReleaseRingId;
    credentials: StoredCredentials;
    openMachineCarrierTunnel?: WorkspaceSyncMachineTunnelOpen;
  }>,
  overrides: Partial<ProductionDaemonWorkspaceSyncFactories> = {},
): Promise<ProductionDaemonWorkspaceSyncRuntime> {
  const factories: ProductionDaemonWorkspaceSyncFactories = { ...defaultFactories, ...overrides };
  let inspection: WorkspaceSyncLegacyStateInspection;
  try {
    inspection = await factories.inspectLegacyState({ activeServerDir: input.activeServerDir, nowMs: Date.now() });
  } catch (error) {
    factories.warn('[DAEMON RUN] Failed to inspect retired workspace replication state', error);
    inspection = {
      status: 'legacy_workspace_sync_state_unknown',
      path: join(input.activeServerDir, 'workspace-replication'),
      reason: 'inspection_failed',
    };
  }
  const assertLegacyStateAvailable = createWorkspaceSyncLegacyStateGate(inspection);
  const daemonDataRoot = join(input.happyHomeDir, 'daemon');
  const workspaceSyncRoot = join(daemonDataRoot, 'workspace-sync');
  const rootOwnershipManager = factories.createRootOwnershipManager({
    lockDirectory: join(workspaceSyncRoot, 'root-ownership'),
  });
  let runtime: ReturnType<typeof createDaemonWorkspaceSyncRuntime> | null = null;
  const targetAuthority = factories.createTargetAuthority({
    localMachineId: input.localMachineId,
    getSettingsSnapshot: factories.getSettingsSnapshot,
    assertLegacyStateAvailable,
    bootstrap: {
      stagingDirectory: join(workspaceSyncRoot, 'bootstrap'),
      rootOwnershipManager,
      prepareGitTarget: factories.prepareGitTarget,
    },
    openRootedAgent: async (request) => {
      if (!runtime) {
        throw compositionError('agent_unavailable', 'Workspace sync runtime is not ready to launch a rooted agent');
      }
      return await runtime.openRootedAgent(request);
    },
    callMachineRpc: async (request) => await factories.callMachineRpc({
      credentials: input.credentials,
      machineId: request.machineId,
      method: request.method,
      request: request.request,
      ...(request.signal ? { signal: request.signal } : {}),
    }),
  });

  runtime = factories.createDaemonRuntime({
    daemonDataRoot,
    localMachineId: input.localMachineId,
    releaseChannel: input.releaseChannel,
    resolveWorkspaceRef: async (workspaceRefId) => {
      const ref = resolveWorkspaceRefById(
        factories.getSettingsSnapshot()?.settings.workspaceRefsV1 ?? [],
        workspaceRefId,
      );
      return ref ? { machineId: ref.machineId, rootPath: ref.rootPath } : null;
    },
    rootOwnershipManager,
    prepareRelationshipTarget: async (relationship, signal) => {
      const target = resolveRelationshipBootstrapTarget(factories.getSettingsSnapshot(), relationship);
      await targetAuthority.prepareBootstrapAtTarget({
        v: 1,
        bootstrapOperationId: relationship.relationshipId,
        owner: { kind: 'relationship', relationshipId: relationship.relationshipId },
        targetWorkspaceRefId: target.workspaceRefId,
        targetMachineId: target.machineId,
        endpointRole: target.endpointRole,
        policyDigest: relationship.contentPolicy.policyDigest,
        createIfMissing: true,
        ...(signal ? { signal } : {}),
      });
    },
    handoffRelationshipController: {
      flush: async (relationshipId, signal) => {
        const relationship = resolveRelationship(factories.getSettingsSnapshot(), relationshipId);
        if (relationship.controllerMachineId === input.localMachineId) {
          if (!runtime) throw controllerUnavailable();
          return await runtime.managedWorkspaceSync.flush(relationshipId, signal);
        }
        try {
          const response = await factories.callMachineRpc({
            credentials: input.credentials,
            machineId: relationship.controllerMachineId,
            method: RPC_METHODS.DAEMON_WORKSPACE_SYNC_FLUSH,
            request: { relationshipId },
            ...(signal ? { signal } : {}),
          });
          return parseControllerStatusResponse(response);
        } catch (error) {
          if (signal?.aborted) throw error;
          if (error && typeof error === 'object' && 'code' in error) throw error;
          throw controllerUnavailable(error);
        }
      },
    },
    bootstrap: async (bootstrapInput) => {
      const prepareRequest = resolveBootstrapPrepareRequest(
        bootstrapInput,
        factories.getSettingsSnapshot(),
      );
      let sourceOwnership: WorkspaceRootOwnershipHandle | null = null;
      if (bootstrapInput.action.kind === 'copy_once') {
        const sourceRef = resolveWorkspaceRefById(
          factories.getSettingsSnapshot()?.settings.workspaceRefsV1 ?? [],
          bootstrapInput.sourceWorkspaceRefId,
        );
        if (!sourceRef || sourceRef.machineId !== input.localMachineId) {
          throw compositionError('peer_unavailable', 'Workspace sync source endpoint is unavailable on this daemon');
        }
        const acquired = await rootOwnershipManager.tryAcquire({
          ownerId: bootstrapInput.operationId,
          canonicalRoot: sourceRef.rootPath,
          operation: 'handoff',
        });
        if ('kind' in acquired) {
          throw compositionError('workspace_root_in_use', 'Workspace sync source root overlaps an active operation');
        }
        sourceOwnership = acquired;
      }
      try {
        await targetAuthority.prepareBootstrapAtTarget(prepareRequest);
      } catch (error) {
        await sourceOwnership?.release();
        throw error;
      }
      let released = false;
      let sourceReleased = false;
      return {
        ...(sourceOwnership ? { ownershipHandles: [sourceOwnership] } : {}),
        release: async (reason) => {
          if (released) return;
          try {
            if (reason === 'abort' || bootstrapInput.action.kind === 'copy_once') {
              await targetAuthority.releaseBootstrapAtTarget({
                v: 1,
                bootstrapOperationId: bootstrapInput.operationId,
                targetWorkspaceRefId: bootstrapInput.targetWorkspaceRefId,
                targetMachineId: bootstrapInput.targetMachineId,
                reason: reason === 'commit' ? 'copy_committed' : 'abort',
                ...(bootstrapInput.signal ? { signal: bootstrapInput.signal } : {}),
              });
            }
          } finally {
            if (!sourceReleased) {
              await sourceOwnership?.release();
              sourceReleased = true;
            }
          }
          released = true;
        },
      };
    },
    createBroker: async (brokerInput) => await factories.createBroker({
      ...brokerInput,
      peerIdentityValidator: factories.createPeerIdentityValidator(),
    }),
    spawnSidecar: factories.spawnSidecar,
    launchLocalAgent: factories.launchLocalAgent,
    ...(input.openMachineCarrierTunnel
      ? { openMachineCarrierTunnel: input.openMachineCarrierTunnel }
      : {}),
    deleteConflictLoserAtTarget: targetAuthority.deleteConflictLoserAtTarget,
    readFileAtTarget: targetAuthority.readFileAtTarget,
    getSettingsSnapshot: factories.getSettingsSnapshot,
    assertLegacyStateAvailable,
  });

  let authorityTail = Promise.resolve();
  const reconcileAuthority = (): void => {
    authorityTail = authorityTail
      .catch(() => undefined)
      .then(async () => await targetAuthority.reconcileRetainedBootstraps());
    void authorityTail.catch((error) => {
      factories.warn('[DAEMON RUN] Failed to reconcile workspace sync target bootstrap ownership', error);
    });
  };
  const unsubscribe = factories.subscribeSettingsSnapshot(() => reconcileAuthority());
  reconcileAuthority();
  await authorityTail.catch(() => undefined);
  await runtime.start().catch((error) => {
    factories.warn(
      '[DAEMON RUN] Workspace sync engine is initially unavailable; commands and settings changes may retry it',
      error,
    );
  });

  const workspaceSync: MachineWorkspaceSyncRpcService = {
    controller: runtime.managedWorkspaceSync,
    deleteConflictLoserAtTarget: targetAuthority.deleteConflictLoserHere,
    readFileAtTarget: targetAuthority.readFileHere,
    prepareBootstrapAtTarget: targetAuthority.prepareBootstrapHere,
    releaseBootstrapAtTarget: targetAuthority.releaseBootstrapHere,
    cleanupRetiredState: async (signal) => {
      signal?.throwIfAborted();
      if (inspection.status === 'absent') return { removed: false, restartRequired: false };
      if (inspection.status !== 'legacy_workspace_sync_state_unsupported') {
        throw compositionError(inspection.status, 'Workspace sync legacy state cannot be safely removed');
      }
      const result = await cleanupRetiredWorkspaceReplicationState(inspection);
      return { removed: result.removed, restartRequired: result.removed };
    },
  };
  let stopPromise: Promise<void> | null = null;
  return {
    handoffAdapter: runtime.handoffAdapter,
    workspaceSync,
    acquireWorkspaceSyncMachineIngress: targetAuthority.acquireWorkspaceSyncMachineIngress,
    stop: () => {
      stopPromise ??= (async () => {
        unsubscribe();
        await authorityTail.catch(() => undefined);
        await runtime.stop();
        await targetAuthority.releaseAllRetainedBootstraps();
      })();
      return stopPromise;
    },
  };
}
