import { join } from 'node:path';

import type { PublicReleaseRingId } from '@happier-dev/release-runtime/releaseRings';
import type {
  WorkspaceSyncStatusV1,
  WorkspaceSyncRelationshipV1,
  WorkspaceSyncTargetBootstrapPrepareV1,
  WorkspaceSyncLegacyStateInspectionV1,
} from '@happier-dev/protocol';
import { WorkspaceSyncStatusV1Schema } from '@happier-dev/protocol';
import { TransferEndpointCandidateSchema, type TransferEndpointCandidate } from '@happier-dev/protocol';
import { RPC_METHODS } from '@happier-dev/protocol/rpc';

import type { MachineWorkspaceSyncRpcService } from '@/api/machine/rpcHandlers.workspaceSync';
import type { StoredCredentials } from '@/persistence';
import { resolveWorkspaceSyncRootOwnershipDirectory } from '@/configuration/resolveWorkspaceSyncRootOwnershipDirectory';
import { configuration } from '@/configuration';
import {
  getActiveAccountSettingsSnapshot,
  subscribeActiveAccountSettingsSnapshot,
  type ActiveAccountSettingsSnapshot,
} from '@/settings/accountSettings/activeAccountSettingsSnapshot';
import { resolveWorkspaceRefById } from '@/settings/accountSettings/workspaceRefsV1';
import { refreshAccountSettingsForMinimumVersion } from '@/settings/accountSettings/refreshAccountSettingsForMinimumVersion';
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
import { prepareWorkspaceSyncGitTarget } from '@/workspaces/sync/workspaceSyncTargetBootstrap';
import { createWorkspaceSyncSeedExport, createWorkspaceSyncSeedTunnelHttpProxy, materializeLocalWorkspaceSyncSeed, materializeWorkspaceSyncSeedExport } from '@/workspaces/sync/workspaceSyncSeedTransfer';
import { materializeWorkspaceExportArtifactsWithScmWorkspace } from '@/scm/workspace/workspaceExportMaterialization';
import { buildDirectPeerTransferEndpointPath } from '@/machines/transfer/directPeerTransport';
import { createWorkspaceSyncPeerIdentityValidator } from '@/workspaces/sync/transport/workspaceSyncPeerIdentity';
import {
  createWorkspaceSyncLegacyStateGate,
  inspectRetiredWorkspaceReplicationState,
  type WorkspaceSyncLegacyStateInspection,
} from '@/workspaces/sync/workspaceSyncLegacyState';
import type { WorkspaceSyncHandoffAdapter } from '@/workspaces/sync/workspaceSyncHandoffAdapter';
import {
  createAccountSettingsWorkspaceSyncRelationshipMutation,
  createWorkspaceSyncRelationshipOwner,
  type WorkspaceSyncRelationshipOwner,
} from '@/workspaces/sync/workspaceSyncRelationshipOwner';
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
  resolveRootOwnershipDirectory: typeof resolveWorkspaceSyncRootOwnershipDirectory;
  createPeerIdentityValidator: typeof createWorkspaceSyncPeerIdentityValidator;
  createBroker: typeof createDaemonWorkspaceSyncBroker;
  spawnSidecar: typeof spawnWorkspaceSyncSidecar;
  launchLocalAgent: typeof launchWorkspaceSyncLocalAgent;
  getSettingsSnapshot: () => ActiveAccountSettingsSnapshot | null;
  subscribeSettingsSnapshot: typeof subscribeActiveAccountSettingsSnapshot;
  callMachineRpc: typeof callMachineRpc;
  inspectLegacyState: typeof inspectRetiredWorkspaceReplicationState;
  prepareGitTarget: typeof prepareWorkspaceSyncGitTarget;
  createRelationshipOwner: typeof createWorkspaceSyncRelationshipOwner;
  refreshSettings: typeof refreshAccountSettingsForMinimumVersion;
  prepareSourceSeedExport: typeof createWorkspaceSyncSeedExport;
  materializeSeedExport: typeof materializeWorkspaceSyncSeedExport;
  materializeLocalSeed: typeof materializeLocalWorkspaceSyncSeed;
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
  resolveRootOwnershipDirectory: resolveWorkspaceSyncRootOwnershipDirectory,
  createPeerIdentityValidator: createWorkspaceSyncPeerIdentityValidator,
  createBroker: createDaemonWorkspaceSyncBroker,
  spawnSidecar: spawnWorkspaceSyncSidecar,
  launchLocalAgent: launchWorkspaceSyncLocalAgent,
  getSettingsSnapshot: getActiveAccountSettingsSnapshot,
  subscribeSettingsSnapshot: subscribeActiveAccountSettingsSnapshot,
  callMachineRpc,
  inspectLegacyState: inspectRetiredWorkspaceReplicationState,
  prepareGitTarget: prepareWorkspaceSyncGitTarget,
  createRelationshipOwner: createWorkspaceSyncRelationshipOwner,
  refreshSettings: refreshAccountSettingsForMinimumVersion,
  prepareSourceSeedExport: createWorkspaceSyncSeedExport,
  materializeSeedExport: materializeWorkspaceSyncSeedExport,
  materializeLocalSeed: materializeLocalWorkspaceSyncSeed,
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
    if (!input.sourceWorkspaceRefId || !input.targetWorkspaceRefId) {
      throw compositionError('workspace_ref_not_ready', 'Workspace sync copy endpoints were not materialized');
    }
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
      // Outcome-only public actions do not expose bootstrap mechanics. The
      // target owner inspects the directory and requires host approval only
      // if source materialization would replace non-empty contents.
      targetBootstrap: 'materialize_from_source_workspace',
      ...(input.targetReplacementApproval ? { targetReplacementApproval: input.targetReplacementApproval } : {}),
      ...(input.signal ? { signal: input.signal } : {}),
    };
  }

  if (input.action.kind !== 'relationship') {
    throw compositionError('workspace_sync_unavailable', 'Workspace sync bootstrap is owned by relationship creation');
  }
  if (!input.sourceWorkspaceRefId || !input.targetWorkspaceRefId) {
    throw compositionError('workspace_ref_not_ready', 'Workspace sync relationship endpoints were not materialized');
  }
  const sourceWorkspaceRefId = input.sourceWorkspaceRefId;
  const targetWorkspaceRefId = input.targetWorkspaceRefId;

  const relationship = resolveRelationship(snapshot, input.action.relationshipId);
  const endpointRole = relationship.alphaWorkspaceRefId === targetWorkspaceRefId
    && relationship.betaWorkspaceRefId === sourceWorkspaceRefId
    ? 'alpha'
    : relationship.betaWorkspaceRefId === targetWorkspaceRefId
      && relationship.alphaWorkspaceRefId === sourceWorkspaceRefId
      ? 'beta'
      : null;
  if (!endpointRole) {
    throw compositionError('relationship_not_ready', 'Workspace sync handoff endpoints do not match the relationship');
  }
  return {
    v: 1,
    bootstrapOperationId: input.operationId,
    owner: { kind: 'relationship', relationshipId: relationship.relationshipId },
    targetWorkspaceRefId,
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
    activeServerId?: string;
    localMachineId: string;
    releaseChannel: PublicReleaseRingId;
    credentials: StoredCredentials;
    openMachineCarrierTunnel?: WorkspaceSyncMachineTunnelOpen;
    requestDirectTransferPayloadFile?: (input: Readonly<{
      transferId: string;
      endpointCandidates: readonly TransferEndpointCandidate[];
      destinationPath: string;
      expectedSizeBytes?: number;
      expectedManifestHash?: string;
      fetchFn?: typeof fetch;
    }>) => Promise<unknown>;
  }>,
  overrides: Partial<ProductionDaemonWorkspaceSyncFactories> = {},
): Promise<ProductionDaemonWorkspaceSyncRuntime> {
  const factories: ProductionDaemonWorkspaceSyncFactories = { ...defaultFactories, ...overrides };
  let inspection: WorkspaceSyncLegacyStateInspection;
  try {
    inspection = await factories.inspectLegacyState({
      activeServerDir: input.activeServerDir,
      installationId: input.localMachineId,
      nowMs: Date.now(),
    });
  } catch (error) {
    factories.warn('[DAEMON RUN] Failed to inspect retired workspace replication state', error);
    inspection = {
      status: 'legacy_workspace_sync_state_unknown',
      path: join(input.activeServerDir, 'workspace-replication'),
      reason: 'inspection_failed',
    };
  }
  const assertLegacyStateAvailable = (): void => createWorkspaceSyncLegacyStateGate(inspection)();
  const daemonDataRoot = join(input.happyHomeDir, 'daemon');
  const workspaceSyncRoot = join(daemonDataRoot, 'workspace-sync');
  const rootOwnershipManager = factories.createRootOwnershipManager({
    lockDirectory: factories.resolveRootOwnershipDirectory(),
  });
  let runtime: ReturnType<typeof createDaemonWorkspaceSyncRuntime> | null = null;
  let relationshipOwner: WorkspaceSyncRelationshipOwner | null = null;
  const targetAuthority = factories.createTargetAuthority({
    localServerId: input.activeServerId ?? configuration.activeServerId,
    localMachineId: input.localMachineId,
    getSettingsSnapshot: factories.getSettingsSnapshot,
    assertLegacyStateAvailable,
    prepareSourceSeedExport: async ({ operationId, sourcePath, contentSelection }) => await factories.prepareSourceSeedExport({
      operationId,
      activeServerDir: input.activeServerDir,
      sourcePath,
      workspaceTransfer: {
        includeIgnoredMode: contentSelection === 'all_files' ? 'include_selected' : 'exclude',
        ignoredIncludeGlobs: [],
      },
    }),
    bootstrap: {
      stagingDirectory: join(workspaceSyncRoot, 'bootstrap'),
      rootOwnershipManager,
      prepareGitTarget: factories.prepareGitTarget,
      materializeLocalSeed: async ({ operationId, sourcePath, canonicalRoot, contentSelection, materializationReceiptPath, originalTargetExists }) => await factories.materializeLocalSeed({
        operationId,
        activeServerDir: input.activeServerDir,
        sourcePath,
        targetPath: canonicalRoot,
        materializationReceiptPath,
        originalTargetExists,
        workspaceTransfer: {
          includeIgnoredMode: contentSelection === 'all_files' ? 'include_selected' : 'exclude',
          ignoredIncludeGlobs: [],
        },
      }),
      ...(input.openMachineCarrierTunnel && input.requestDirectTransferPayloadFile
        ? { materializeRemoteSeed: async (request) => {
            const preparedRaw = await factories.callMachineRpc({
                credentials: input.credentials,
                machineId: request.sourceMachineId,
                method: RPC_METHODS.DAEMON_DIRECT_TRANSFER_EXPORT_PREPARE,
                request: {
                  t: 'workspace_sync_seed_v1',
                  operationId: request.operationId,
                  sourceWorkspaceRefId: request.sourceWorkspaceRefId,
                  contentSelection: request.contentSelection,
                },
                ...(request.signal ? { signal: request.signal } : {}),
              })
              .catch(() => {
                request.signal?.throwIfAborted();
                throw compositionError('target_bootstrap_offline', 'Workspace sync source seed is unavailable');
              });
            if (!preparedRaw || typeof preparedRaw !== 'object' || (preparedRaw as { success?: unknown }).success !== true) {
              throw compositionError('target_bootstrap_offline', 'Workspace sync source seed is unavailable');
            }
            const prepared = preparedRaw as Readonly<Record<string, unknown>>;
            if (typeof prepared.transferId !== 'string' || prepared.transferId !== request.operationId
              || typeof prepared.sizeBytes !== 'number' || !Number.isSafeInteger(prepared.sizeBytes) || prepared.sizeBytes < 1
              || typeof prepared.manifestHash !== 'string' || !Array.isArray(prepared.endpointCandidates)) {
              throw compositionError('target_bootstrap_offline', 'Workspace sync source seed response is invalid');
            }
            const sourceCandidates = prepared.endpointCandidates.map((candidate) => TransferEndpointCandidateSchema.parse(candidate));
            const sourceCandidate = sourceCandidates[0];
            if (!sourceCandidate) {
              throw compositionError('target_bootstrap_offline', 'Workspace sync source seed has no finite transfer endpoint');
            }
            return await factories.materializeSeedExport({
              operationId: request.operationId,
              targetPath: request.canonicalRoot,
              stagingDirectory: join(workspaceSyncRoot, 'seed-transfer'),
              materializationReceiptPath: request.materializationReceiptPath,
              originalTargetExists: request.originalTargetExists,
              requestPayload: async ({ transferId, destinationPath, expectedSizeBytes, expectedManifestHash }) => {
                const sizeBytes = transferId === request.operationId ? prepared.sizeBytes as number : expectedSizeBytes;
                const manifestHash = transferId === request.operationId ? prepared.manifestHash as string : expectedManifestHash;
                if (typeof sizeBytes !== 'number' || !Number.isSafeInteger(sizeBytes) || sizeBytes < 0 || !manifestHash) {
                  throw compositionError('target_bootstrap_offline', 'Workspace sync seed payload commitment is invalid');
                }
                const tunnel = await input.openMachineCarrierTunnel!({
                  operationId: transferId,
                  sourceMachineId: input.localMachineId,
                  targetMachineId: request.sourceMachineId,
                  flow: 'file_transfer',
                  maxBytes: Math.max(1, sizeBytes),
                  ...(request.signal ? { signal: request.signal } : {}),
                });
                const proxy = await createWorkspaceSyncSeedTunnelHttpProxy(tunnel).catch(async (error) => {
                  await tunnel.close().catch(() => undefined);
                  throw error;
                });
                try {
                  const url = new URL(sourceCandidate.url);
                  url.protocol = 'http:';
                  url.hostname = '127.0.0.1';
                  url.port = String(proxy.localPort);
                  url.pathname = buildDirectPeerTransferEndpointPath(transferId);
                  const endpointCandidates: readonly TransferEndpointCandidate[] = [{
                    ...sourceCandidate,
                    kind: 'http' as const,
                    url: url.toString(),
                  }];
                  await input.requestDirectTransferPayloadFile!({
                    transferId,
                    endpointCandidates,
                    destinationPath,
                    expectedSizeBytes: sizeBytes,
                    expectedManifestHash: manifestHash,
                    fetchFn: async (fetchInput, fetchInit) => await fetch(fetchInput, {
                      ...fetchInit,
                      headers: {
                        ...Object.fromEntries(new Headers(fetchInit?.headers).entries()),
                        ...proxy.requestHeaders,
                      },
                    }),
                  });
                } finally {
                  await proxy.close().catch(() => undefined);
                  await tunnel.close().catch(() => undefined);
                }
              },
              materializeWorkspaceExportArtifacts: materializeWorkspaceExportArtifactsWithScmWorkspace,
            });
          },
        }
        : {}),
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
    prepareRelationshipTarget: async (relationship, signal, preparation) => {
      const target = resolveRelationshipBootstrapTarget(factories.getSettingsSnapshot(), relationship);
      const prepared = await targetAuthority.prepareBootstrapAtTarget({
        v: 1,
        bootstrapOperationId: relationship.relationshipId,
        owner: { kind: 'relationship', relationshipId: relationship.relationshipId },
        ...(preparation?.transient ? { transientRelationship: relationship } : {}),
        targetWorkspaceRefId: target.workspaceRefId,
        targetMachineId: target.machineId,
        endpointRole: target.endpointRole,
        policyDigest: relationship.contentPolicy.policyDigest,
        createIfMissing: true,
        ...(preparation ? { targetBootstrap: preparation.targetBootstrap } : {}),
        ...(preparation?.targetReplacementApproval
          ? { targetReplacementApproval: preparation.targetReplacementApproval }
          : {}),
        ...(signal ? { signal } : {}),
      });
      return prepared.ownershipHandles ? { ownershipHandles: prepared.ownershipHandles } : undefined;
    },
    recoverCopyOnceTarget: async (operation) => {
      const target = resolveWorkspaceRefById(
        factories.getSettingsSnapshot()?.settings.workspaceRefsV1 ?? [],
        operation.betaWorkspaceRefId,
      );
      if (!target) throw compositionError('peer_unavailable', 'Workspace sync copy target endpoint is unavailable');
      await targetAuthority.prepareBootstrapAtTarget({
        v: 1,
        bootstrapOperationId: operation.operationId,
        owner: { kind: 'copy_once', operation },
        targetWorkspaceRefId: operation.betaWorkspaceRefId,
        targetMachineId: target.machineId,
        endpointRole: 'beta',
        policyDigest: operation.contentPolicy.policyDigest,
        createIfMissing: false,
      });
      let released = false;
      return {
        release: async (reason) => {
          if (released) return;
          await targetAuthority.releaseBootstrapAtTarget({
            v: 1,
            bootstrapOperationId: operation.operationId,
            targetWorkspaceRefId: operation.betaWorkspaceRefId,
            targetMachineId: target.machineId,
            reason: reason === 'commit' ? 'copy_committed' : 'abort',
          });
          released = true;
        },
      };
    },
    relationshipOwner: {
      materializeEndpoints: async (request) => {
        if (!relationshipOwner) throw compositionError('workspace_sync_unavailable', 'Workspace relationship owner is unavailable');
        return await relationshipOwner.materializeEndpoints(request);
      },
      prepareCreate: async (request) => {
        if (!relationshipOwner) throw compositionError('workspace_sync_unavailable', 'Workspace relationship owner is unavailable');
        return await relationshipOwner.prepareCreate(request);
      },
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
        const sourceWorkspaceRefId = bootstrapInput.sourceWorkspaceRefId;
        if (!sourceWorkspaceRefId) {
          throw compositionError('workspace_ref_not_ready', 'Workspace sync copy source endpoint was not materialized');
        }
        const sourceRef = resolveWorkspaceRefById(
          factories.getSettingsSnapshot()?.settings.workspaceRefsV1 ?? [],
          sourceWorkspaceRefId,
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
      let targetOwnershipHandles: readonly WorkspaceRootOwnershipHandle[] = [];
      try {
        const preparedTarget = await targetAuthority.prepareBootstrapAtTarget(prepareRequest);
        targetOwnershipHandles = preparedTarget.ownershipHandles ?? [];
      } catch (error) {
        await sourceOwnership?.release();
        throw error;
      }
      let released = false;
      let sourceReleased = false;
      const targetWorkspaceRefId = prepareRequest.targetWorkspaceRefId;
      return {
        ...((sourceOwnership || targetOwnershipHandles.length > 0)
          ? { ownershipHandles: [...(sourceOwnership ? [sourceOwnership] : []), ...targetOwnershipHandles] }
          : {}),
        release: async (reason) => {
          if (released) return;
          try {
            if (reason === 'abort' || bootstrapInput.action.kind === 'copy_once' || bootstrapInput.action.kind === 'create_relationship') {
              await targetAuthority.releaseBootstrapAtTarget({
                v: 1,
                bootstrapOperationId: bootstrapInput.operationId,
                targetWorkspaceRefId,
                targetMachineId: bootstrapInput.targetMachineId,
                reason: reason === 'commit'
                  ? bootstrapInput.action.kind === 'copy_once'
                    ? 'copy_committed'
                    : 'relationship_committed'
                  : 'abort',
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

  relationshipOwner = factories.createRelationshipOwner({
    localMachineId: input.localMachineId,
    mutateSettings: createAccountSettingsWorkspaceSyncRelationshipMutation(input.credentials),
    readSettings: async () => {
      const refreshed = await factories.refreshSettings({ credentials: input.credentials, forceRefresh: true });
      return refreshed.rawSettings ?? refreshed.settings;
    },
    ensureRelationship: async (relationship, signal, preparation) => {
      if (!runtime) throw controllerUnavailable();
      return await runtime.managedWorkspaceSync.ensure(relationship, signal, preparation);
    },
    flushRelationship: async (relationshipId, signal) => {
      if (!runtime) throw controllerUnavailable();
      return await runtime.managedWorkspaceSync.flush(relationshipId, signal);
    },
    commitRelationshipTarget: async (relationship) => {
      const target = resolveRelationshipBootstrapTarget(factories.getSettingsSnapshot(), relationship);
      await targetAuthority.releaseBootstrapAtTarget({
        v: 1,
        bootstrapOperationId: relationship.relationshipId,
        targetWorkspaceRefId: target.workspaceRefId,
        targetMachineId: target.machineId,
        reason: 'relationship_committed',
      });
    },
    terminateRelationshipRuntime: async (relationship) => {
      if (!runtime) throw controllerUnavailable();
      await runtime.managedWorkspaceSync.terminate(relationship.relationshipId);
      const target = resolveRelationshipBootstrapTarget(factories.getSettingsSnapshot(), relationship);
      await targetAuthority.releaseBootstrapAtTarget({
        v: 1,
        bootstrapOperationId: relationship.relationshipId,
        targetWorkspaceRefId: target.workspaceRefId,
        targetMachineId: target.machineId,
        reason: 'abort',
      });
    },
    waitForSettingsReconciliation: async (settingsVersion, signal) => {
      if (!runtime) throw controllerUnavailable();
      signal?.throwIfAborted();
      const refreshed = await factories.refreshSettings({
        credentials: input.credentials,
        minSettingsVersion: settingsVersion,
        forceRefresh: true,
      });
      await runtime.whenSettingsSettled({
        settingsVersion,
        ...(refreshed.scopeKey ? { scopeKey: refreshed.scopeKey } : {}),
        ...(signal ? { signal } : {}),
      });
    },
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
    relationshipOwner,
    deleteConflictLoserAtTarget: targetAuthority.deleteConflictLoserHere,
    readFileAtTarget: targetAuthority.readFileHere,
    preflightHandoffTargetReplacement: targetAuthority.preflightHandoffTargetReplacementHere,
    prepareBootstrapAtTarget: targetAuthority.prepareBootstrapHere,
    releaseBootstrapAtTarget: targetAuthority.releaseBootstrapHere,
    prepareSourceSeedExport: targetAuthority.prepareSourceSeedExport,
    inspectRetiredState: async (signal): Promise<WorkspaceSyncLegacyStateInspectionV1> => {
      signal?.throwIfAborted();
      try {
        inspection = await factories.inspectLegacyState({
          activeServerDir: input.activeServerDir,
          installationId: input.localMachineId,
          nowMs: Date.now(),
        });
      } catch (error) {
        factories.warn('[DAEMON RUN] Failed to reinspect retired workspace replication state', error);
        inspection = {
          status: 'legacy_workspace_sync_state_unknown',
          path: join(input.activeServerDir, 'workspace-replication'),
          reason: 'inspection_failed',
        };
      }
      if (inspection.status === 'absent') return { status: 'absent' };
      if (inspection.status === 'legacy_workspace_sync_state_unknown') return inspection;
      return {
        status: inspection.status,
        classification: inspection.classification,
        quarantinePath: inspection.quarantinePath,
        schemaVersion: inspection.schemaVersion,
      };
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
