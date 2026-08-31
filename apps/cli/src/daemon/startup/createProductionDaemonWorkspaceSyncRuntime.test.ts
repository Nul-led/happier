import { join } from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { describe, expect, it, vi } from 'vitest';

import {
  AccountSettingsSchema,
  computeWorkspaceSyncPolicyDigest,
} from '@happier-dev/protocol';

import type { ActiveAccountSettingsSnapshot } from '@/settings/accountSettings/activeAccountSettingsSnapshot';
import type { WorkspaceSyncLegacyStateInspection } from '@/workspaces/sync/workspaceSyncLegacyState';
import {
  createProductionDaemonWorkspaceSyncRuntime,
  type ProductionDaemonWorkspaceSyncFactories,
} from './createProductionDaemonWorkspaceSyncRuntime';

const contentPolicyInput = {
  v: 1 as const,
  selection: 'all_files' as const,
  extraIgnorePatterns: [],
  extraIncludePatterns: [],
  includeGitDirectory: false,
};
const contentPolicy = {
  ...contentPolicyInput,
  policyDigest: computeWorkspaceSyncPolicyDigest(contentPolicyInput),
};

function settingsSnapshot(): ActiveAccountSettingsSnapshot {
  return {
    source: 'network',
    settings: AccountSettingsSchema.parse({
      workspaceRefsV1: [
        {
          id: 'workspace-alpha',
          serverId: 'server-1',
          machineId: 'machine-a',
          rootPath: '/work/alpha',
          createdAtMs: 1,
        },
        {
          id: 'workspace-beta',
          serverId: 'server-1',
          machineId: 'machine-b',
          rootPath: '/work/beta',
          createdAtMs: 1,
        },
      ],
      workspaceSyncRelationshipsV1: [{
        v: 1,
        relationshipId: 'rel-1',
        controllerMachineId: 'machine-b',
        alphaWorkspaceRefId: 'workspace-alpha',
        betaWorkspaceRefId: 'workspace-beta',
        mode: 'keep_both_in_sync',
        contentPolicy,
        enabled: true,
        createdAtMs: 1,
        updatedAtMs: 1,
      }],
    }),
    settingsVersion: 1,
    loadedAtMs: 1,
    settingsSecretsReadKeys: [],
  };
}

describe('createProductionDaemonWorkspaceSyncRuntime', () => {
  it('composes one daemon-owned runtime and keeps it available after a transient engine start failure', async () => {
    const controller = Object.freeze({ marker: 'controller' });
    const handoffAdapter = Object.freeze({ marker: 'handoff' });
    const runtimeStartError = Object.assign(new Error('artifact unavailable'), { code: 'engine_unavailable' });
    const runtime = {
      handoffAdapter,
      managedWorkspaceSync: controller,
      openExternalStream: vi.fn(),
      openRootedAgent: vi.fn(),
      start: vi.fn(async () => { throw runtimeStartError; }),
      stop: vi.fn(async () => undefined),
      whenSettingsSettled: vi.fn(async () => undefined),
    };
    const prepareBootstrapAtTarget = vi.fn(async () => ({
      v: 1 as const,
      bootstrapOperationId: 'copy-op-1',
      targetWorkspaceRefId: 'workspace-beta',
      state: 'ready' as const,
      created: true,
      rootFingerprint: 'a'.repeat(64),
      policyDigest: contentPolicy.policyDigest,
      manifestDigest: 'b'.repeat(64),
    }));
    const releaseBootstrapAtTarget = vi.fn()
      .mockRejectedValueOnce(Object.assign(new Error('target temporarily unavailable'), { code: 'peer_unavailable' }))
      .mockResolvedValueOnce({ ok: true as const, released: true });
    const targetAuthority = {
      deleteConflictLoserHere: vi.fn(async () => undefined),
      readFileHere: vi.fn(),
      deleteConflictLoserAtTarget: vi.fn(async () => undefined),
      readFileAtTarget: vi.fn(),
      prepareBootstrapHere: vi.fn(),
      releaseBootstrapHere: vi.fn(),
      prepareBootstrapAtTarget,
      releaseBootstrapAtTarget,
      acquireWorkspaceSyncMachineIngress: vi.fn(),
      reconcileRetainedBootstraps: vi.fn(async () => undefined),
      releaseAllRetainedBootstraps: vi.fn(async () => undefined),
    };
    const sourceOwnership = Object.freeze({
      owner: { ownerId: 'copy-op-1', canonicalRoot: '/work/alpha', operation: 'handoff' as const },
      renew: vi.fn(async () => undefined),
      release: vi.fn(async () => undefined),
    });
    const rootOwnershipManager = Object.freeze({
      tryAcquire: vi.fn(async () => sourceOwnership),
    });
    const peerIdentityValidator = Object.freeze({
      setExpectedSidecarPid: vi.fn(),
      validate: vi.fn(async () => true),
    });
    const broker = Object.freeze({ marker: 'broker' });
    const createDaemonRuntime = vi.fn<ProductionDaemonWorkspaceSyncFactories['createDaemonRuntime']>(
      () => runtime as unknown as ReturnType<ProductionDaemonWorkspaceSyncFactories['createDaemonRuntime']>,
    );
    const createTargetAuthority = vi.fn<ProductionDaemonWorkspaceSyncFactories['createTargetAuthority']>(
      () => targetAuthority as unknown as ReturnType<ProductionDaemonWorkspaceSyncFactories['createTargetAuthority']>,
    );
    const createRootOwnershipManager = vi.fn(() => rootOwnershipManager);
    const createPeerIdentityValidator = vi.fn(() => peerIdentityValidator);
    const createBroker = vi.fn(async () => broker);
    const spawnSidecar = vi.fn();
    const launchLocalAgent = vi.fn();
    const prepareGitTarget = vi.fn(async () => undefined);
    const controllerStatus = {
      relationshipId: 'rel-1',
      controllerMachineId: 'machine-b',
      state: 'watching' as const,
      alphaPath: '/work/alpha',
      betaPath: '/work/beta',
      mode: 'keep_both_in_sync' as const,
      changedFiles: 0,
      conflictCount: 0,
      lastSuccessfulSyncAtMs: null,
    };
    const callMachineRpc = vi.fn(async (request: { method: string }) => (
      request.method.startsWith('daemon.workspaceSync.')
        ? { status: controllerStatus }
        : { ok: true }
    ));
    const unsubscribeSettings = vi.fn();
    const subscribeSettingsSnapshot = vi.fn(() => unsubscribeSettings);
    const warn = vi.fn();
    const openMachineCarrierTunnel = vi.fn();
    const activeServerDir = join('/happier-home', 'servers', 'server-1');
    const inspectLegacyState = vi.fn(async () => ({
      status: 'absent',
      path: join(activeServerDir, 'workspace-replication'),
    }) as WorkspaceSyncLegacyStateInspection);
    const factories = {
      createDaemonRuntime,
      createTargetAuthority,
      createRootOwnershipManager,
      createPeerIdentityValidator,
      createBroker,
      spawnSidecar,
      launchLocalAgent,
      prepareGitTarget,
      getSettingsSnapshot: settingsSnapshot,
      subscribeSettingsSnapshot,
      callMachineRpc,
      inspectLegacyState,
      warn,
    } as unknown as ProductionDaemonWorkspaceSyncFactories;

    const production = await createProductionDaemonWorkspaceSyncRuntime({
      happyHomeDir: '/happier-home',
      activeServerDir,
      localMachineId: 'machine-a',
      releaseChannel: 'publicdev',
      credentials: { token: 'secret-token', encryption: null },
      openMachineCarrierTunnel,
    }, factories);

    expect(inspectLegacyState).toHaveBeenCalledOnce();
    expect(inspectLegacyState).toHaveBeenCalledWith(expect.objectContaining({ activeServerDir }));
    expect(createRootOwnershipManager).toHaveBeenCalledOnce();
    expect(createRootOwnershipManager).toHaveBeenCalledWith({
      lockDirectory: join('/happier-home', 'daemon', 'workspace-sync', 'root-ownership'),
    });
    expect(createTargetAuthority).toHaveBeenCalledOnce();
    expect(createDaemonRuntime).toHaveBeenCalledOnce();
    expect(runtime.start).toHaveBeenCalledOnce();
    expect(warn).toHaveBeenCalledWith(
      '[DAEMON RUN] Workspace sync engine is initially unavailable; commands and settings changes may retry it',
      runtimeStartError,
    );
    expect(production.handoffAdapter).toBe(handoffAdapter);
    expect(production.workspaceSync.controller).toBe(controller);

    const daemonRuntimeInput = createDaemonRuntime.mock.calls[0]![0];
    expect(daemonRuntimeInput).toMatchObject({
      daemonDataRoot: join('/happier-home', 'daemon'),
      localMachineId: 'machine-a',
      releaseChannel: 'publicdev',
      rootOwnershipManager,
      spawnSidecar,
      launchLocalAgent,
      openMachineCarrierTunnel,
    });
    await expect(daemonRuntimeInput.resolveWorkspaceRef('workspace-alpha')).resolves.toEqual({
      machineId: 'machine-a',
      rootPath: '/work/alpha',
    });
    await expect(daemonRuntimeInput.resolveWorkspaceRef('workspace-missing')).resolves.toBeNull();
    await daemonRuntimeInput.prepareRelationshipTarget(settingsSnapshot().settings.workspaceSyncRelationshipsV1[0]!);
    expect(prepareBootstrapAtTarget).toHaveBeenCalledWith({
      v: 1,
      bootstrapOperationId: 'rel-1',
      owner: { kind: 'relationship', relationshipId: 'rel-1' },
      targetWorkspaceRefId: 'workspace-alpha',
      targetMachineId: 'machine-a',
      endpointRole: 'alpha',
      policyDigest: contentPolicy.policyDigest,
      createIfMissing: true,
    });
    await expect(daemonRuntimeInput.handoffRelationshipController?.flush('rel-1')).resolves.toEqual(controllerStatus);
    expect(callMachineRpc).toHaveBeenCalledWith(expect.objectContaining({
      machineId: 'machine-b',
      method: 'daemon.workspaceSync.flush.v1',
      request: { relationshipId: 'rel-1' },
    }));

    await expect(daemonRuntimeInput.createBroker({
      brokerDir: '/broker',
      brokerInstanceId: 'broker-1',
      launchNonce: 'nonce-1',
      launchSecret: new Uint8Array(32),
      openExternalStream: vi.fn(),
    })).resolves.toBe(broker);
    expect(createPeerIdentityValidator).toHaveBeenCalledOnce();
    expect(createBroker).toHaveBeenCalledWith(expect.objectContaining({ peerIdentityValidator }));

    const targetAuthorityInput = createTargetAuthority.mock.calls[0]![0];
    expect(targetAuthorityInput.bootstrap?.prepareGitTarget).toBe(prepareGitTarget);
    await targetAuthorityInput.callMachineRpc({
      machineId: 'machine-b',
      method: 'daemon.test',
      request: { value: 1 },
    });
    expect(callMachineRpc).toHaveBeenCalledWith({
      credentials: { token: 'secret-token', encryption: null },
      machineId: 'machine-b',
      method: 'daemon.test',
      request: { value: 1 },
    });

    const fence = await daemonRuntimeInput.bootstrap({
      operationId: 'copy-op-1',
      action: { kind: 'copy_once', contentPolicy },
      sourceMachineId: 'machine-a',
      targetMachineId: 'machine-b',
      sourceWorkspaceRefId: 'workspace-alpha',
      targetWorkspaceRefId: 'workspace-beta',
      sourceRootPath: '/caller/must/not/cross/the/wire',
      targetRootPath: '/caller/must/not/cross/the/wire/either',
    });
    expect(prepareBootstrapAtTarget).toHaveBeenCalledWith({
      v: 1,
      bootstrapOperationId: 'copy-op-1',
      owner: {
        kind: 'copy_once',
        operation: {
          v: 1,
          operationId: 'copy-op-1',
          controllerMachineId: 'machine-a',
          alphaWorkspaceRefId: 'workspace-alpha',
          betaWorkspaceRefId: 'workspace-beta',
          contentPolicy,
        },
      },
      targetWorkspaceRefId: 'workspace-beta',
      targetMachineId: 'machine-b',
      endpointRole: 'beta',
      policyDigest: contentPolicy.policyDigest,
      createIfMissing: true,
    });
    await expect(fence.release('commit')).rejects.toMatchObject({ code: 'peer_unavailable' });
    await expect(fence.release('commit')).resolves.toBeUndefined();
    expect(releaseBootstrapAtTarget).toHaveBeenCalledTimes(2);
    expect(releaseBootstrapAtTarget).toHaveBeenLastCalledWith({
      v: 1,
      bootstrapOperationId: 'copy-op-1',
      targetWorkspaceRefId: 'workspace-beta',
      targetMachineId: 'machine-b',
      reason: 'copy_committed',
    });
    expect(sourceOwnership.release).toHaveBeenCalledOnce();

    await production.stop();
    expect(unsubscribeSettings).toHaveBeenCalledOnce();
    expect(runtime.stop).toHaveBeenCalledOnce();
    expect(targetAuthority.releaseAllRetainedBootstraps).toHaveBeenCalledOnce();
  });

  describe('retired legacy-state gate', () => {
    type GateStatus = 'legacy_workspace_sync_state_unsupported' | 'legacy_workspace_sync_state_unknown' | 'absent';

    async function compose(status: GateStatus) {
      const activeServerDir = await mkdtemp(join(tmpdir(), 'happier-prod-ws-sync-gate-'));
      const legacyPath = join(activeServerDir, 'workspace-replication');
      const inspection: WorkspaceSyncLegacyStateInspection = status === 'absent'
        ? { status: 'absent', path: legacyPath }
        : status === 'legacy_workspace_sync_state_unknown'
          ? { status, path: legacyPath, reason: 'test-fixture' }
          : {
            status,
            classification: 'retired_v1',
            path: legacyPath,
            quarantinePath: `${legacyPath}.retired-v1-1700000000000-fixture`,
            schemaVersion: 1,
            inventoryHash: 'a'.repeat(64),
          };
      const inspectLegacyState = vi.fn(async () => inspection);
      const spawnSidecar = vi.fn(async () => {
        throw new Error('sidecar must not spawn while the legacy gate is closed');
      });
      const createBroker = vi.fn(async () => {
        throw new Error('broker must not be created while the legacy gate is closed');
      });
      const launchLocalAgent = vi.fn();
      const callMachineRpc = vi.fn(async () => undefined);
      const warn = vi.fn();
      const unsubscribe = vi.fn();
      const factories = {
        getSettingsSnapshot: settingsSnapshot,
        subscribeSettingsSnapshot: vi.fn(() => unsubscribe),
        callMachineRpc,
        createBroker,
        spawnSidecar,
        launchLocalAgent,
        inspectLegacyState,
        warn,
      } as unknown as ProductionDaemonWorkspaceSyncFactories;
      const production = await createProductionDaemonWorkspaceSyncRuntime({
        happyHomeDir: activeServerDir,
        activeServerDir,
        localMachineId: 'machine-a',
        releaseChannel: 'publicdev',
        credentials: { token: 'secret-token', encryption: null },
      }, factories);
      return {
        production,
        spawnSidecar,
        createBroker,
        launchLocalAgent,
        callMachineRpc,
        warn,
        inspectLegacyState,
        cleanup: async () => {
          await production.stop();
          await rm(activeServerDir, { recursive: true, force: true });
        },
      };
    }

    it('fail-closes controller and target-authority entry points with the exact typed code', async () => {
      for (const status of ['legacy_workspace_sync_state_unsupported', 'legacy_workspace_sync_state_unknown'] as const) {
        const composed = await compose(status);
        try {
          const { production, spawnSidecar, createBroker, launchLocalAgent, callMachineRpc, warn, inspectLegacyState } = composed;
          expect(inspectLegacyState).toHaveBeenCalledOnce();
          // Startup rehydration is refused observably, with the same typed code.
          expect(warn).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ code: status }));

          const expectTyped = (run: Promise<unknown>) => expect(run).rejects.toMatchObject({ code: status });
          await expectTyped(production.workspaceSync.controller.get('rel-1'));
          await expectTyped(production.workspaceSync.controller.list());
          await expectTyped(production.workspaceSync.controller.flush('rel-1'));
          await expectTyped(production.workspaceSync.controller.terminate('rel-1'));
          await expectTyped(production.workspaceSync.prepareBootstrapAtTarget({
            v: 1,
            bootstrapOperationId: 'boot-op-1',
            owner: { kind: 'relationship', relationshipId: 'rel-1' },
            targetWorkspaceRefId: 'workspace-alpha',
            endpointRole: 'alpha',
            policyDigest: contentPolicy.policyDigest,
            createIfMissing: true,
          }));
          await expectTyped(production.workspaceSync.deleteConflictLoserAtTarget({
            relationshipId: 'rel-1',
            workspaceRefId: 'workspace-alpha',
            path: 'src/x.ts',
            expectedKind: 'file',
          }));
          await expectTyped(production.acquireWorkspaceSyncMachineIngress({
            operationId: 'rel-1',
            sourceMachineId: 'machine-b',
            targetMachineId: 'machine-a',
          }));

          // No process, IPC, agent or machine-RPC side effect may have run.
          expect(createBroker).not.toHaveBeenCalled();
          expect(spawnSidecar).not.toHaveBeenCalled();
          expect(launchLocalAgent).not.toHaveBeenCalled();
          expect(callMachineRpc).not.toHaveBeenCalled();
        } finally {
          await composed.cleanup();
        }
      }
    });

    it('keeps current behavior when inspection reports absent legacy state', async () => {
      const composed = await compose('absent');
      try {
        const { production, spawnSidecar, createBroker, launchLocalAgent, inspectLegacyState } = composed;
        expect(inspectLegacyState).toHaveBeenCalledOnce();

        // The no-op gate lets the call reach the normal engine path.
        const error = await production.workspaceSync.controller.list()
          .then(() => null, (e) => e as { code?: string });
        expect(error).toBeTruthy();
        expect(['legacy_workspace_sync_state_unsupported', 'legacy_workspace_sync_state_unknown']).not.toContain(error!.code);
        expect(error!.code).toBe('engine_unavailable');
        expect(launchLocalAgent).not.toHaveBeenCalled();
      } finally {
        await composed.cleanup();
      }
    });
  });
});
