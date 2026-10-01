import { join } from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { describe, expect, it, vi } from 'vitest';

const approvalsGet = vi.hoisted(() => vi.fn());
vi.mock('@/session/actions/approvals/artifactStore', () => ({
  createCliApprovalsArtifactStore: () => ({ approvalsGet }),
}));

import {
  AccountSettingsSchema,
  computeWorkspaceSyncPolicyDigest,
  type HandoffTargetReplacementApprovalV1,
  type WorkspaceSyncConflictResolveActionInputV1,
} from '@happier-dev/protocol';

import type { ActiveAccountSettingsSnapshot } from '@/settings/accountSettings/activeAccountSettingsSnapshot';
import type { WorkspaceSyncLegacyStateInspection } from '@/workspaces/sync/workspaceSyncLegacyState';
import type {
  FiniteTransferMachineTunnel,
  WorkspaceSyncMachineTunnel,
  WorkspaceSyncMachineTunnelOpenInput,
} from '@/workspaces/sync/workspaceSyncMachineCarrierStream';
import {
  createProductionDaemonWorkspaceSyncRuntime,
  type ProductionDaemonWorkspaceSyncFactories,
} from './createProductionDaemonWorkspaceSyncRuntime';

const contentPolicyInput = {
  v: 1 as const,
  selection: 'all_files' as const,
  extraIgnorePatterns: [],
  extraIncludePatterns: [],
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
    type ProductionInput = Parameters<typeof createProductionDaemonWorkspaceSyncRuntime>[0];
    const controller = Object.freeze({
      marker: 'controller',
      resolveLocalResolutionEndpoint: vi.fn(async () => null),
      borrowSourceRootForCopy: vi.fn(async (): Promise<{ handle: unknown; release: () => Promise<void> } | null> => null),
      withAuthorizedSourceSeedExport: vi.fn(async (
        _request: Readonly<{ operationId: string }>,
        exportSource: (sourcePath: string) => Promise<unknown>,
      ) => await exportSource('/work/source')),
      withSourceSeedAuthorization: vi.fn(async (
        _operation: Readonly<{ operationId: string }>,
        _handles: readonly unknown[],
        action: () => Promise<unknown>,
      ) => await action()),
    });
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
    }));
    const releaseBootstrapAtTarget = vi.fn()
      .mockRejectedValueOnce(Object.assign(new Error('target temporarily unavailable'), { code: 'peer_unavailable' }))
      .mockResolvedValueOnce({ ok: true as const, released: true });
    const targetAuthority = {
      readFileHere: vi.fn(),
      observeEntryHere: vi.fn(),
      stageConflictResolutionHere: vi.fn(async () => undefined),
      applyStagedConflictResolutionHere: vi.fn(async () => ({ status: 'installed' as const })),
      recoverConflictResolutionHere: vi.fn(async () => ({ status: 'settled' as const })),
      stageConflictResolutionAtTarget: vi.fn(async () => undefined),
      applyStagedConflictResolutionAtTarget: vi.fn(async () => ({ status: 'installed' as const })),
      recoverConflictResolutionAtTarget: vi.fn(async () => ({ status: 'settled' as const })),
      prepareConflictResolutionExport: vi.fn(),
      readFileAtTarget: vi.fn(),
      observeEntryAtTarget: vi.fn(),
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
    const resolveRootOwnershipDirectory = vi.fn(() => '/user-home/.happier/runtime/workspace-sync-root-ownership');
    const createPeerIdentityValidator = vi.fn(() => peerIdentityValidator);
    const createBroker = vi.fn(async () => broker);
    const spawnSidecar = vi.fn();
    const launchLocalAgent = vi.fn();
    const prepareGitTarget = vi.fn(async () => undefined);
    const relationshipOwner = {
      materializeEndpoints: vi.fn(),
      prepareCreate: vi.fn(),
      setEnabled: vi.fn(async () => undefined),
      stop: vi.fn(async () => undefined),
    };
    const createRelationshipOwner = vi.fn<ProductionDaemonWorkspaceSyncFactories['createRelationshipOwner']>(
      () => relationshipOwner,
    );
    const refreshSettings = vi.fn(async () => ({
      ...settingsSnapshot(),
      settingsVersion: 7,
      scopeKey: 'scope-1',
      whenRefreshed: null,
    }));
    const controllerStatus = {
      relationshipId: 'rel-1',
      controllerMachineId: 'machine-b',
      state: 'watching' as const,
      alphaPath: '/work/alpha',
      betaPath: '/work/beta',
      mode: 'keep_both_in_sync' as const,
      endpointStates: {
        alpha: { connected: true, scanned: true, scanProblemCount: 0, transitionProblemCount: 0 },
        beta: { connected: true, scanned: true, scanProblemCount: 0, transitionProblemCount: 0 },
      },
      conflictCount: 0,
      lastCycleObservedAtMs: null,
    };
    const callMachineRpc = vi.fn(async (request: { method: string }) => (
      request.method === 'daemon.directTransfer.export.prepare'
        ? {
            success: true, transferId: 'rel-1', expiresAt: Date.now() + 60_000,
            endpointCandidates: [{
              kind: 'http', url: 'http://127.0.0.1:9999/machine-transfers/direct/source',
              expiresAt: Date.now() + 60_000,
            }],
            sizeBytes: 50, manifestHash: `sha256:${'a'.repeat(64)}`,
          }
        : request.method === 'daemon.workspaceSync.prepareBetween.v1'
        ? { ok: true, traversed: [
            { relationshipId: 'rel-2', policyDigest: contentPolicy.policyDigest, status: { ...controllerStatus, relationshipId: 'rel-2' } },
            { relationshipId: 'rel-1', policyDigest: contentPolicy.policyDigest, status: controllerStatus },
          ] }
        : request.method.startsWith('daemon.workspaceSync.')
        ? { status: controllerStatus }
        : { ok: true }
    ));
    const unsubscribeSettings = vi.fn();
    const subscribeSettingsSnapshot = vi.fn(() => unsubscribeSettings);
    const warn = vi.fn();
    const closeTunnel = vi.fn(async () => undefined);
    const openMachineCarrierTunnelCalls: WorkspaceSyncMachineTunnelOpenInput[] = [];
    async function openMachineCarrierTunnel(
      input: Extract<WorkspaceSyncMachineTunnelOpenInput, { flow: 'file_transfer' }>,
    ): Promise<FiniteTransferMachineTunnel>;
    async function openMachineCarrierTunnel(
      input: Extract<WorkspaceSyncMachineTunnelOpenInput, { flow: 'workspace_sync' }>,
    ): Promise<WorkspaceSyncMachineTunnel>;
    async function openMachineCarrierTunnel(
      input: WorkspaceSyncMachineTunnelOpenInput,
    ): Promise<FiniteTransferMachineTunnel | WorkspaceSyncMachineTunnel> {
      openMachineCarrierTunnelCalls.push(input);
      const lifecycle = {
        localPort: 48_123,
        observedPath: 'direct' as const,
        close: closeTunnel,
      };
      return input.flow === 'workspace_sync'
        ? { ...lifecycle, localCapability: 'a'.repeat(64) }
        : lifecycle;
    }
    const requestDirectTransferPayloadFile = vi.fn(async (
      _request: Parameters<NonNullable<ProductionInput['requestDirectTransferPayloadFile']>>[0],
    ) => undefined);
    const materializeSeedExport = vi.fn(async (request: Parameters<typeof import('@/workspaces/sync/workspaceSyncSeedTransfer').materializeWorkspaceSyncSeedExport>[0]) => {
      await request.requestPayload({ transferId: 'rel-1', destinationPath: '/tmp/manifest' });
      await request.requestPayload({ transferId: 'rel-1:blob:one', destinationPath: '/tmp/one', expectedSizeBytes: 3, expectedManifestHash: `sha256:${'b'.repeat(64)}` });
      await request.requestPayload({ transferId: 'rel-1:blob:two', destinationPath: '/tmp/two', expectedSizeBytes: 4, expectedManifestHash: `sha256:${'c'.repeat(64)}` });
      return { commit: async () => undefined, abort: async () => undefined };
    });
    const materializeLocalSeed = vi.fn(async () => ({
      commit: async () => undefined,
      abort: async () => undefined,
    }));
    const prepareSourceSeedExport = vi.fn(async () => ({
      payloadSource: { marker: 'payload' },
      onDemandScope: { marker: 'scope' },
    }));
    const activeServerDir = join('/happier-home', 'servers', 'server-1');
    const inspectLegacyState = vi.fn(async () => ({
      status: 'absent',
      path: join(activeServerDir, 'workspace-replication'),
    }) as WorkspaceSyncLegacyStateInspection);
    let activeSnapshot = settingsSnapshot();
    const factories = {
      createDaemonRuntime,
      createTargetAuthority,
      createRootOwnershipManager,
      resolveRootOwnershipDirectory,
      createPeerIdentityValidator,
      createBroker,
      spawnSidecar,
      launchLocalAgent,
      prepareGitTarget,
      createRelationshipOwner,
      refreshSettings,
      getSettingsSnapshot: () => activeSnapshot,
      subscribeSettingsSnapshot,
      callMachineRpc,
      inspectLegacyState,
      materializeSeedExport,
      materializeLocalSeed,
      prepareSourceSeedExport,
      warn,
    } as unknown as ProductionDaemonWorkspaceSyncFactories;
    const onReadinessPublished = vi.fn();

    const production = await createProductionDaemonWorkspaceSyncRuntime({
      happyHomeDir: '/happier-home',
      activeServerDir,
      activeServerId: 'server-1',
      localMachineId: 'machine-a',
      releaseChannel: 'publicdev',
      credentials: { token: 'secret-token', encryption: null },
      openMachineCarrierTunnel,
      requestDirectTransferPayloadFile,
      onReadinessPublished,
    }, factories);

    const approval: HandoffTargetReplacementApprovalV1 = {
      v: 1 as const,
      consequences: ['replace_nonempty_workspace_target'] as const,
      serverId: 'server-1',
      machineId: 'machine-b',
      canonicalRoot: '/work/beta',
      rootFingerprint: 'a'.repeat(64),
      operationId: 'handoff-action-1',
    };
    const approvedActionInput = {
      sessionId: 'session-1',
      targetMachineId: 'machine-b',
      targetPath: '/work/beta',
      workspaceAction: { kind: 'copy_once' as const, contentPolicy },
    };
    const approvedArtifact = {
      v: 2 as const,
      status: 'executing' as const,
      createdAtMs: 1,
      updatedAtMs: 2,
      createdBy: { surface: 'cli' as const },
      executionOriginV1: {
        v: 1 as const,
        authority: 'present_user' as const,
        surface: 'cli' as const,
        caller: { kind: 'host' as const },
        serverId: 'server-1',
        sessionId: 'session-1',
        machineId: 'machine-b',
        actionId: 'session.handoff' as const,
        requestId: 'handoff-action-1',
      },
      approval: { flow: 'deferred' as const, result: 'required' as const },
      actionId: 'session.handoff' as const,
      actionArgs: approvedActionInput,
      summary: 'Approve handoff',
      handoffTargetReplacementApproval: approval,
      decision: { kind: 'approve' as const, decidedAtMs: 2 },
    };
    approvalsGet.mockResolvedValue(approvedArtifact);
    const assertTargetReplacementAuthorized = createTargetAuthority.mock.calls[0]![0].assertTargetReplacementAuthorized;
    if (!assertTargetReplacementAuthorized) throw new Error('target replacement authorizer was not composed');
    await expect(assertTargetReplacementAuthorized('approval-receipt-1', approvedActionInput, approval)).resolves.toBeUndefined();
    expect(approvalsGet).toHaveBeenCalledWith({ artifactId: 'approval-receipt-1', serverId: 'server-1' });
    const conflictInput = {
      controllerMachineId: 'machine-b',
      hubWorkspaceRefId: 'workspace-beta',
      path: 'conflict.txt',
      source: { workspaceRefId: 'workspace-alpha', expected: { kind: 'file' as const, digest: 'a'.repeat(40), executable: false, size: 1 } },
      targets: [{ workspaceRefId: 'workspace-beta', expected: { kind: 'file' as const, digest: 'b'.repeat(40), executable: false, size: 1 } }],
      relationshipIds: ['rel-1'],
      strategy: 'use_source' as const,
    } satisfies WorkspaceSyncConflictResolveActionInputV1;
    const conflictArtifact = {
      ...approvedArtifact,
      actionId: 'workspace.sync.conflict.resolve' as const,
      executionOriginV1: {
        ...approvedArtifact.executionOriginV1,
        actionId: 'workspace.sync.conflict.resolve' as const,
        machineId: 'machine-b',
        requestId: 'conflict-request-1',
      },
      actionArgs: conflictInput,
      handoffTargetReplacementApproval: undefined,
    };
    const assertConflictResolutionAuthorized = createTargetAuthority.mock.calls[0]![0].assertConflictResolutionAuthorized;
    if (!assertConflictResolutionAuthorized) throw new Error('conflict authorizer was not composed');
    approvalsGet.mockResolvedValueOnce(conflictArtifact);
    await expect(assertConflictResolutionAuthorized('conflict-receipt-1', conflictInput)).resolves.toBeUndefined();
    approvalsGet.mockResolvedValueOnce({
      ...conflictArtifact,
      actionArgs: {
        strategy: conflictInput.strategy,
        relationshipIds: [...conflictInput.relationshipIds],
        targets: [...conflictInput.targets],
        source: { ...conflictInput.source },
        path: conflictInput.path,
        hubWorkspaceRefId: conflictInput.hubWorkspaceRefId,
        controllerMachineId: conflictInput.controllerMachineId,
      },
    });
    await expect(assertConflictResolutionAuthorized('conflict-receipt-1', conflictInput)).resolves.toBeUndefined();
    approvalsGet.mockResolvedValueOnce(conflictArtifact);
    await expect(assertConflictResolutionAuthorized('conflict-receipt-1', {
      ...conflictInput,
      source: { ...conflictInput.source, expected: { ...conflictInput.source.expected, digest: 'c'.repeat(40) } },
    })).rejects.toMatchObject({ code: 'approval_stale' });
    approvalsGet.mockResolvedValueOnce({ ...conflictArtifact, v: 1 });
    await expect(assertConflictResolutionAuthorized('conflict-receipt-1', conflictInput)).rejects.toMatchObject({ code: 'approval_stale' });
    approvalsGet.mockResolvedValueOnce({ ...conflictArtifact, status: 'approved' });
    await expect(assertConflictResolutionAuthorized('conflict-receipt-1', conflictInput)).rejects.toMatchObject({ code: 'approval_stale' });
    approvalsGet.mockResolvedValueOnce({
      ...conflictArtifact,
      executionOriginV1: { ...conflictArtifact.executionOriginV1, serverId: 'server-2' },
    });
    await expect(assertConflictResolutionAuthorized('conflict-receipt-1', conflictInput)).rejects.toMatchObject({ code: 'approval_stale' });
    approvalsGet.mockResolvedValueOnce({
      ...conflictArtifact,
      executionOriginV1: { ...conflictArtifact.executionOriginV1, machineId: 'machine-c' },
    });
    await expect(assertConflictResolutionAuthorized('conflict-receipt-1', conflictInput)).rejects.toMatchObject({ code: 'approval_stale' });
    const staleApprovalCases: Array<readonly [unknown, unknown, HandoffTargetReplacementApprovalV1]> = [
      [{ ...approvedArtifact, status: 'approved' }, approvedActionInput, approval],
      [{ ...approvedArtifact, decision: { kind: 'reject', decidedAtMs: 2 } }, approvedActionInput, approval],
      [{ ...approvedArtifact, actionId: 'session.restore', executionOriginV1: { ...approvedArtifact.executionOriginV1, actionId: 'session.restore' } }, approvedActionInput, approval],
      [{ ...approvedArtifact, executionOriginV1: { ...approvedArtifact.executionOriginV1, serverId: 'server-2' } }, approvedActionInput, approval],
      [{ ...approvedArtifact, executionOriginV1: { ...approvedArtifact.executionOriginV1, requestId: 'other-operation' } }, approvedActionInput, approval],
      [{ ...approvedArtifact, executionOriginV1: { ...approvedArtifact.executionOriginV1, sessionId: 'other-session' } }, approvedActionInput, approval],
      [approvedArtifact, { ...approvedActionInput, targetPath: '/work/other' }, approval],
      [approvedArtifact, { ...approvedActionInput, workspaceAction: { ...approvedActionInput.workspaceAction, kind: 'create_relationship' } }, approval],
      [approvedArtifact, approvedActionInput, { ...approval, canonicalRoot: '/work/other' }],
      [approvedArtifact, approvedActionInput, { ...approval, rootFingerprint: 'b'.repeat(64) }],
      [approvedArtifact, approvedActionInput, { ...approval, machineId: 'machine-c' }],
    ];
    for (const [artifact, actionInput, proof] of staleApprovalCases) {
      approvalsGet.mockResolvedValueOnce(artifact);
      await expect(assertTargetReplacementAuthorized('approval-receipt-1', actionInput, proof)).rejects.toMatchObject({ code: 'approval_stale' });
    }

    const remoteMaterialize = createTargetAuthority.mock.calls[0]![0].bootstrap?.materializeRemoteSeed;
    const remoteSeedCancellation = new AbortController();
    await remoteMaterialize?.({
      operationId: 'rel-1', sourceMachineId: 'machine-b', sourceWorkspaceRefId: 'workspace-beta',
      canonicalRoot: '/work/alpha', contentPolicy,
      materializationReceiptPath: '/work/.alpha.happier-materialization.json',
      originalTargetExists: false,
      targetFence: { state: 'missing', identity: null },
      signal: remoteSeedCancellation.signal,
    });
    expect(openMachineCarrierTunnelCalls.map((request) => request.flow)).toEqual([
      'file_transfer', 'file_transfer', 'file_transfer',
    ]);
    expect(openMachineCarrierTunnelCalls.every((request) => !('operationId' in request))).toBe(true);
    expect(requestDirectTransferPayloadFile).toHaveBeenCalledTimes(3);
    for (const [request] of requestDirectTransferPayloadFile.mock.calls) {
      expect(request.endpointCandidates).toHaveLength(1);
      expect(new URL(request.endpointCandidates[0]!.url).hostname).toBe('127.0.0.1');
      expect(new URL(request.endpointCandidates[0]!.url).port).toBe('48123');
      expect(request.fetchFn).toBeUndefined();
      expect(request.signal).toBe(remoteSeedCancellation.signal);
    }

    expect(inspectLegacyState).toHaveBeenCalledOnce();
    expect(inspectLegacyState).toHaveBeenCalledWith(expect.objectContaining({ activeServerDir }));
    expect(createRootOwnershipManager).toHaveBeenCalledOnce();
    expect(resolveRootOwnershipDirectory).toHaveBeenCalledOnce();
    expect(createRootOwnershipManager).toHaveBeenCalledWith({
      lockDirectory: '/user-home/.happier/runtime/workspace-sync-root-ownership',
    });
    expect(createTargetAuthority).toHaveBeenCalledOnce();
    expect(createDaemonRuntime).toHaveBeenCalledOnce();
    expect(createDaemonRuntime.mock.calls[0]?.[0].observeEntryAtTarget).toBe(targetAuthority.observeEntryAtTarget);
    expect(production.workspaceSync.observeEntryAtTarget).toBe(targetAuthority.observeEntryHere);
    expect(runtime.start).toHaveBeenCalledOnce();
    expect(warn).toHaveBeenCalledWith(
      '[DAEMON RUN] Workspace sync engine is initially unavailable; commands and settings changes may retry it',
      runtimeStartError,
    );
    expect(onReadinessPublished).toHaveBeenLastCalledWith({
      engine: { state: 'unavailable', errorCode: 'engine_unavailable' },
      carrier: { state: 'ready' },
    });
    expect(production.handoffAdapter).toBe(handoffAdapter);
    expect(production.workspaceSync.controller).toBe(controller);
    expect(production.workspaceSync.relationshipOwner).toEqual(expect.objectContaining({
      create: expect.any(Function),
      setEnabled: expect.any(Function),
      stop: expect.any(Function),
    }));
    await production.workspaceSync.relationshipOwner.setEnabled('rel-1', false);
    await production.workspaceSync.relationshipOwner.stop('rel-1');
    expect(relationshipOwner.setEnabled).toHaveBeenCalledWith('rel-1', false, undefined);
    expect(relationshipOwner.stop).toHaveBeenCalledWith('rel-1', undefined);
    expect(createRelationshipOwner).toHaveBeenCalledOnce();

    const relationshipOwnerInput = createRelationshipOwner.mock.calls[0]![0];
    const reconciliationSignal = new AbortController().signal;
    await relationshipOwnerInput.waitForSettingsReconciliation(7, reconciliationSignal);
    expect(refreshSettings).toHaveBeenCalledWith({
      credentials: { token: 'secret-token', encryption: null },
      minSettingsVersion: 7,
      forceRefresh: true,
    });
    expect(runtime.whenSettingsSettled).toHaveBeenCalledWith({
      settingsVersion: 7,
      scopeKey: 'scope-1',
      signal: reconciliationSignal,
    });

    const daemonRuntimeInput = createDaemonRuntime.mock.calls[0]![0];
    expect(daemonRuntimeInput.relationshipOwner).toEqual(expect.objectContaining({
      materializeEndpoints: expect.any(Function),
      prepareCreate: expect.any(Function),
    }));
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
      serverId: 'server-1',
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

    activeSnapshot = {
      ...activeSnapshot,
      settings: AccountSettingsSchema.parse({
        ...activeSnapshot.settings,
        workspaceRefsV1: [
          ...activeSnapshot.settings.workspaceRefsV1,
          { id: 'workspace-c', serverId: 'server-1', machineId: 'machine-c', rootPath: '/work/c', createdAtMs: 1 },
        ],
        workspaceSyncRelationshipsV1: [
          ...activeSnapshot.settings.workspaceSyncRelationshipsV1,
          { v: 1, relationshipId: 'rel-2', controllerMachineId: 'machine-b', alphaWorkspaceRefId: 'workspace-beta', betaWorkspaceRefId: 'workspace-c', mode: 'keep_both_in_sync', contentPolicy, enabled: true, createdAtMs: 1, updatedAtMs: 1 },
        ],
      }),
    };
    await expect(daemonRuntimeInput.handoffPrepareBetween!({
      sourceWorkspaceRefId: 'workspace-c', targetWorkspaceRefId: 'workspace-alpha',
    })).resolves.toMatchObject({ ok: true, traversed: [{ relationshipId: 'rel-2' }, { relationshipId: 'rel-1' }] });
    expect(callMachineRpc).toHaveBeenCalledWith(expect.objectContaining({
      machineId: 'machine-b', method: 'daemon.workspaceSync.prepareBetween.v1',
      request: { sourceWorkspaceRefId: 'workspace-c', targetWorkspaceRefId: 'workspace-alpha' },
    }));
    const linkedFence = await daemonRuntimeInput.bootstrap({
      operationId: 'handoff-linked', action: { kind: 'linked_workspace' },
      sourceMachineId: 'machine-c', targetMachineId: 'machine-a',
      sourceWorkspaceRefId: 'workspace-c', targetWorkspaceRefId: 'workspace-alpha',
      sourceRootPath: '/work/c', targetRootPath: '/work/alpha',
    });
    expect(prepareBootstrapAtTarget).toHaveBeenLastCalledWith(expect.objectContaining({
      owner: { kind: 'relationship', relationshipId: 'rel-1' },
      targetWorkspaceRefId: 'workspace-alpha', endpointRole: 'alpha', createIfMissing: false,
    }));
    expect(prepareBootstrapAtTarget.mock.lastCall).not.toHaveProperty('0.targetBootstrap');
    expect(prepareSourceSeedExport).not.toHaveBeenCalled();
    await linkedFence.release('commit');

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
    await targetAuthorityInput.bootstrap?.materializeLocalSeed?.({
      operationId: 'local-op',
      sourcePath: '/work/alpha',
      canonicalRoot: '/work/beta',
      contentPolicy,
      materializationReceiptPath: '/work/.beta.happier-materialization.json',
      originalTargetExists: false,
      targetFence: { state: 'missing', identity: null },
    });
    expect(materializeLocalSeed).toHaveBeenCalledWith(expect.objectContaining({
      operationId: 'local-op',
      sourcePath: '/work/alpha',
      targetPath: '/work/beta',
      // `all_files` opts out of Git selection, so the seed must not silently
      // narrow to Git's ignore rules.
      workspaceTransfer: {
        includeIgnoredMode: 'exclude',
        ignoredIncludeGlobs: [],
        includeAllIgnored: true,
        extraIgnorePatterns: [],
      },
    }));

    // A Git-selected policy carries the paths the user explicitly opted back in
    // past Git's ignore rules through to the existing SCM enumeration owner.
    const gitPolicyInput = {
      v: 1 as const,
      selection: 'git_worktree' as const,
      extraIgnorePatterns: ['coverage/**'],
      extraIncludePatterns: ['dist/**', 'packages/app/.env.local'],
    };
    const gitPolicy = { ...gitPolicyInput, policyDigest: computeWorkspaceSyncPolicyDigest(gitPolicyInput) };
    await targetAuthorityInput.bootstrap?.materializeLocalSeed?.({
      operationId: 'local-op-git',
      sourcePath: '/work/alpha',
      canonicalRoot: '/work/beta',
      contentPolicy: gitPolicy,
      materializationReceiptPath: '/work/.beta.happier-materialization.json',
      originalTargetExists: false,
      targetFence: { state: 'missing', identity: null },
    });
    expect(materializeLocalSeed).toHaveBeenLastCalledWith(expect.objectContaining({
      workspaceTransfer: {
        includeIgnoredMode: 'include_selected',
        ignoredIncludeGlobs: ['dist/**', 'packages/app/.env.local'],
        extraIgnorePatterns: ['coverage/**'],
      },
    }));

    await targetAuthorityInput.prepareSourceSeedExport?.({
      operationId: 'seed-op-git',
      sourceWorkspaceRefId: 'workspace-alpha',
      targetMachineId: 'machine-b',
      contentPolicy: gitPolicy,
    });
    expect(prepareSourceSeedExport).toHaveBeenLastCalledWith(expect.objectContaining({
      operationId: 'seed-op-git',
      sourcePath: '/work/source',
      workspaceTransfer: {
        includeIgnoredMode: 'include_selected',
        ignoredIncludeGlobs: ['dist/**', 'packages/app/.env.local'],
        extraIgnorePatterns: ['coverage/**'],
      },
    }));
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
      targetBootstrap: 'materialize_from_source_workspace',
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

    const releaseLinkedSource = vi.fn(async () => undefined);
    controller.borrowSourceRootForCopy.mockResolvedValueOnce({
      handle: sourceOwnership,
      release: releaseLinkedSource,
    });
    const acquisitionsBeforeLinkedCopy = rootOwnershipManager.tryAcquire.mock.calls.length;
    const linkedCopyFence = await daemonRuntimeInput.bootstrap({
      operationId: 'copy-linked-source',
      action: { kind: 'copy_once', contentPolicy },
      sourceMachineId: 'machine-a',
      targetMachineId: 'machine-b',
      sourceWorkspaceRefId: 'workspace-alpha',
      targetWorkspaceRefId: 'workspace-beta',
      sourceRootPath: '/caller/source',
      targetRootPath: '/caller/target',
    });
    expect(rootOwnershipManager.tryAcquire).toHaveBeenCalledTimes(acquisitionsBeforeLinkedCopy);
    await linkedCopyFence.release('commit');
    expect(releaseLinkedSource).toHaveBeenCalledOnce();
    expect(sourceOwnership.release).toHaveBeenCalledOnce();

    // Cancellation ends forward synchronization work, but must not cancel the
    // mandatory target cleanup that settles the materialization receipt and
    // discards any target created for this copy operation.
    const cancelledWork = new AbortController();
    const cancelledFence = await daemonRuntimeInput.bootstrap({
      operationId: 'copy-op-cancelled',
      action: { kind: 'copy_once', contentPolicy },
      sourceMachineId: 'machine-a',
      targetMachineId: 'machine-b',
      sourceWorkspaceRefId: 'workspace-alpha',
      targetWorkspaceRefId: 'workspace-beta',
      sourceRootPath: '/caller/must/not/cross/the/wire',
      targetRootPath: '/caller/must/not/cross/the/wire/either',
      signal: cancelledWork.signal,
    });
    releaseBootstrapAtTarget.mockImplementationOnce(async (request) => {
      request.signal?.throwIfAborted();
      return { ok: true as const, released: true };
    });
    cancelledWork.abort();
    await expect(cancelledFence.release('abort')).resolves.toBeUndefined();
    expect(releaseBootstrapAtTarget).toHaveBeenLastCalledWith({
      v: 1,
      bootstrapOperationId: 'copy-op-cancelled',
      targetWorkspaceRefId: 'workspace-beta',
      targetMachineId: 'machine-b',
      reason: 'abort',
    });
    expect(sourceOwnership.release).toHaveBeenCalledTimes(2);

    await relationshipOwnerInput.commitRelationshipTarget(settingsSnapshot().settings.workspaceSyncRelationshipsV1[0]!);
    expect(releaseBootstrapAtTarget).toHaveBeenLastCalledWith({
      v: 1,
      bootstrapOperationId: 'rel-1',
      targetWorkspaceRefId: 'workspace-alpha',
      targetMachineId: 'machine-a',
      reason: 'relationship_committed',
    });

    const runtimeStopFailure = new Error('runtime stop failed');
    const authorityStopFailure = new Error('authority stop failed');
    runtime.stop.mockRejectedValueOnce(runtimeStopFailure);
    targetAuthority.releaseAllRetainedBootstraps.mockRejectedValueOnce(authorityStopFailure);
    const stopError = await production.stop().then(() => null, (error: unknown) => error);
    expect(stopError).toBeInstanceOf(AggregateError);
    expect((stopError as AggregateError).errors).toEqual([runtimeStopFailure, authorityStopFailure]);
    expect(unsubscribeSettings).toHaveBeenCalledOnce();
    expect(runtime.stop).toHaveBeenCalledOnce();
    expect(targetAuthority.releaseAllRetainedBootstraps).toHaveBeenCalledOnce();

    await expect(production.stop()).resolves.toBeUndefined();
    expect(runtime.stop).toHaveBeenCalledTimes(2);
    expect(targetAuthority.releaseAllRetainedBootstraps).toHaveBeenCalledTimes(2);
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

    it('reinspects and reports retired state without exposing a cleanup action', async () => {
      const retired = await compose('legacy_workspace_sync_state_unsupported');
      try {
        await expect(retired.production.workspaceSync.inspectRetiredState())
          .resolves.toMatchObject({
            status: 'legacy_workspace_sync_state_unsupported',
            classification: 'retired_v1',
            schemaVersion: 1,
          });
        expect(retired.inspectLegacyState).toHaveBeenCalledTimes(2);
      } finally {
        await retired.cleanup();
      }

      const unknown = await compose('legacy_workspace_sync_state_unknown');
      try {
        await expect(unknown.production.workspaceSync.inspectRetiredState())
          .resolves.toMatchObject({ status: 'legacy_workspace_sync_state_unknown', reason: 'test-fixture' });
      } finally {
        await unknown.cleanup();
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
