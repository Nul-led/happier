import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  coordinate: vi.fn(async () => ({ state: 'succeeded' as const })),
  recover: vi.fn(async () => {}),
  createCoordinator: vi.fn(),
  createRecovery: vi.fn(),
  createActionExecutor: vi.fn(() => ({ execute: vi.fn() })),
  createStorage: vi.fn(() => ({ execute: vi.fn() })),
  bootstrapAccountSettings: vi.fn(),
  readMachineCapabilities: vi.fn(),
}));

vi.mock('./production', () => ({
  createProductionWorkflowRunCoordinator: mocks.createCoordinator,
}));
vi.mock('./recovery', () => ({
  createWorkflowRunRecoveryReader: mocks.createRecovery,
}));
vi.mock('./workflowRunStorageClient', () => ({
  createWorkflowRunStorageClient: mocks.createStorage,
}));
vi.mock('@/api/machine/machineOperationProtocolCapabilities', () => ({
  readMachineOperationProtocolCapabilitiesV1: mocks.readMachineCapabilities,
}));
vi.mock('@/session/actions/createCliActionExecutorFromCredentials', () => ({
  createCliActionExecutorFromCredentials: mocks.createActionExecutor,
}));
vi.mock('@/daemon/automation/automationWorker', () => ({
  resolveAutomationWorkerAccountEncryption: vi.fn(),
}));
vi.mock('@/plugins/runtime/reload/runtimeLease', () => ({
  acquireAuthoritativePluginRuntimeRegistryLease: vi.fn(),
}));
vi.mock('@/settings/accountSettings/activeAccountSettingsSnapshot', () => ({
  getActiveAccountSettingsSnapshot: () => ({ settings: { workspaceRefsV1: [] } }),
}));
vi.mock('@/settings/accountSettings/bootstrapAccountSettingsContext', () => ({
  bootstrapAccountSettingsContext: mocks.bootstrapAccountSettings,
}));

import {
  createProductionDaemonWorkflowRuntime,
  createWorkflowAcceptedAuthorizationCurrentness,
  createWorkflowInvocationRecoveryObserver,
} from './daemonRuntime';

describe('production daemon Workflow bootstrap', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createCoordinator.mockReturnValue(mocks.coordinate);
    mocks.createRecovery.mockReturnValue(mocks.recover);
    mocks.bootstrapAccountSettings.mockResolvedValue({ settings: { workspaceRefsV1: [] } });
    mocks.readMachineCapabilities.mockResolvedValue(null);
  });

  it('constructs callable coordinator and recovery factories for the connected machine', async () => {
    const runtime = createProductionDaemonWorkflowRuntime({
      credentials: { token: 'token' } as never,
      accountId: 'account-1',
      serverId: 'server-1',
    });
    const machineAdmissionTransport = vi.fn();
    const coordinate = runtime.createCoordinatorForMachine({
      machineId: 'machine-1',
      machineAdmissionTransport,
      machineActionDirectTargetTransport: { machineId: 'machine-1', invoke: vi.fn() },
    });
    const recover = runtime.createRecoveryForMachine({ machineId: 'machine-1', machineAdmissionTransport });

    await coordinate({ runId: 'run-1', attempt: 0, expectedRevision: 0,
      accountCurrentness: { mode: 'plain', version: 1, contentKeyFingerprint: null } });
    await recover('startup');

    expect(mocks.createCoordinator).toHaveBeenCalledWith(expect.objectContaining({
      accountId: 'account-1',
      machineId: 'machine-1',
      execution: expect.objectContaining({ machineAdmissionTransport }),
    }));
    expect(mocks.createActionExecutor).toHaveBeenCalledWith(expect.objectContaining({
      workflowAcceptedAuthorizationCurrentness: runtime.isAcceptedAuthorizationCurrent,
    }));
    expect(mocks.coordinate).toHaveBeenCalledOnce();
    expect(mocks.createRecovery).toHaveBeenCalledWith(expect.objectContaining({
      accountId: 'account-1',
      machineId: 'machine-1',
      storage: expect.any(Object),
    }));
    expect(mocks.recover).toHaveBeenCalledWith('startup');
  });

  it('provides a force-refreshed workspace reference resolver to the process-lifetime coordinator', async () => {
    const runtime = createProductionDaemonWorkflowRuntime({
      credentials: { token: 'token' } as never,
      accountId: 'account-1',
      serverId: 'server-1',
    });
    runtime.createCoordinatorForMachine({
      machineId: 'machine-1',
      machineAdmissionTransport: vi.fn(),
      machineActionDirectTargetTransport: { machineId: 'machine-1', invoke: vi.fn() },
    });
    const currentWorkspaceRefs = [{
      id: 'workspace-1', serverId: 'server-1', machineId: 'machine-1',
      rootPath: '/current-root', createdAtMs: 2,
    }];
    mocks.bootstrapAccountSettings.mockResolvedValueOnce({
      settings: { workspaceRefsV1: currentWorkspaceRefs },
    });
    const coordinatorParams = mocks.createCoordinator.mock.calls[0]?.[0];

    await expect(coordinatorParams.resolveCurrentWorkspaceRefs()).resolves.toBe(currentWorkspaceRefs);
    expect(mocks.bootstrapAccountSettings).toHaveBeenCalledWith({
      credentials: { token: 'token' },
      mode: 'blocking',
      refresh: 'force',
    });
  });

  it('binds the coordinator to fresh exact-target capability reads instead of local advertised capabilities', async () => {
    const runtime = createProductionDaemonWorkflowRuntime({
      credentials: { token: 'token' } as never,
      accountId: 'account-1',
      serverId: 'server-1',
    });
    runtime.createCoordinatorForMachine({
      machineId: 'machine-1',
      machineAdmissionTransport: vi.fn(),
      machineActionDirectTargetTransport: { machineId: 'machine-1', invoke: vi.fn() },
    });
    const coordinatorParams = mocks.createCoordinator.mock.calls[0]?.[0];
    const supported = { sessionInputAdmission: { protocolVersions: [1, 2] } };
    mocks.readMachineCapabilities
      .mockResolvedValueOnce({ capabilities: supported, revision: 1 })
      .mockResolvedValueOnce(null);

    await expect(
      coordinatorParams.execution.resolveMachineOperationProtocolCapabilities(),
    ).resolves.toBe(supported);
    await expect(
      coordinatorParams.execution.resolveMachineOperationProtocolCapabilities(),
    ).resolves.toBeNull();
    expect(mocks.readMachineCapabilities).toHaveBeenNthCalledWith(1, {
      credentials: { token: 'token' },
      machineId: 'machine-1',
    });
    expect(mocks.readMachineCapabilities).toHaveBeenCalledTimes(2);
  });

  it('revalidates only revocable API and plugin principals at the canonical owners', async () => {
    const tokenId = '8f250f0e-4f31-4f7d-8f68-61638b73b526';
    const listAccountApiTokens = vi.fn(async () => ({
      tokens: [{
        tokenId,
        label: 'automation',
        displayPrefix: 'hap_v1_8f250f0e',
        createdAt: '2026-01-01T00:00:00.000Z',
        lastUsedAt: null,
        expiresAt: '2026-01-03T00:00:00.000Z',
        hasEncryptionAccess: false,
        hasUnattendedTeamAccess: false,
      }],
    }));
    const resolveCurrentPluginImmutableGenerationId = vi.fn(
      async (): Promise<string | null> => 'generation-1',
    );
    const isMediatedSourceCurrent = vi.fn(async (): Promise<boolean> => true);
    const isCurrent = createWorkflowAcceptedAuthorizationCurrentness({
      accountId: 'account-1',
      listAccountApiTokens,
      resolveCurrentPluginImmutableGenerationId,
      isMediatedSourceCurrent,
      now: () => Date.parse('2026-01-02T00:00:00.000Z'),
    });

    await expect(isCurrent({
      authorization: {
        admittedPermissionCeiling: 'default',
        principal: { kind: 'api', accountId: 'account-1', principalId: 'account-1', credentialId: tokenId },
      },
    })).resolves.toBe(true);
    await expect(isCurrent({
      authorization: {
        admittedPermissionCeiling: 'default',
        principal: { kind: 'api', accountId: 'account-2', principalId: 'account-2', credentialId: tokenId },
      },
    })).resolves.toBe(false);
    await expect(isCurrent({
      authorization: {
        admittedPermissionCeiling: 'default',
        principal: { kind: 'api', accountId: 'account-1', principalId: 'other-principal', credentialId: tokenId },
      },
    })).resolves.toBe(false);
    const afterExpiry = createWorkflowAcceptedAuthorizationCurrentness({
      accountId: 'account-1',
      listAccountApiTokens,
      resolveCurrentPluginImmutableGenerationId,
      isMediatedSourceCurrent,
      now: () => Date.parse('2026-01-04T00:00:00.000Z'),
    });
    await expect(afterExpiry({
      authorization: {
        admittedPermissionCeiling: 'default',
        principal: { kind: 'api', accountId: 'account-1', principalId: 'account-1', credentialId: tokenId },
      },
    })).resolves.toBe(false);
    await expect(isCurrent({
      authorization: {
        admittedPermissionCeiling: 'default',
        principal: { kind: 'plugin', pluginId: 'happier.example', immutableGenerationId: 'generation-1' },
      },
    })).resolves.toBe(true);
    await expect(isCurrent({
      authorization: {
        admittedPermissionCeiling: 'default',
        principal: { kind: 'plugin', pluginId: 'happier.example' },
      },
    })).resolves.toBe(false);
    await expect(isCurrent({
      authorization: { admittedPermissionCeiling: 'default', principal: { kind: 'host' } },
    })).resolves.toBe(true);
    await expect(isCurrent({
      authorization: {
        admittedPermissionCeiling: 'read-only',
        principal: { kind: 'host' },
        sourceAuthority: {
          mediatorPluginId: 'happier.channels',
          sourceRef: 'channels:binding:binding-1',
          sourceRevisionOrEpoch: '4:7',
          remoteApprovalMaxScope: 'session',
        },
      },
    })).resolves.toBe(true);
    isMediatedSourceCurrent.mockResolvedValueOnce(false);
    await expect(isCurrent({
      authorization: {
        admittedPermissionCeiling: 'read-only',
        principal: { kind: 'host' },
        sourceAuthority: {
          mediatorPluginId: 'happier.channels',
          sourceRef: 'channels:binding:binding-1',
          sourceRevisionOrEpoch: '4:7',
          remoteApprovalMaxScope: 'session',
        },
      },
    })).resolves.toBe(false);
    resolveCurrentPluginImmutableGenerationId.mockResolvedValueOnce(null);
    await expect(isCurrent({
      authorization: {
        admittedPermissionCeiling: 'read-only',
        principal: { kind: 'host' },
        sourceAuthority: {
          mediatorPluginId: 'happier.channels',
          sourceRef: 'channels:binding:binding-1',
          sourceRevisionOrEpoch: '4:7',
          remoteApprovalMaxScope: 'session',
        },
      },
    })).resolves.toBe(false);
    expect(listAccountApiTokens).toHaveBeenCalledTimes(2);
    expect(resolveCurrentPluginImmutableGenerationId).toHaveBeenCalledTimes(4);
    expect(isMediatedSourceCurrent).toHaveBeenCalledTimes(2);
  });

  it('observes an exact Session input without requiring an execution provider handle', async () => {
    const execute = vi.fn();
    const observeSession = vi.fn(async () => ({
      ok: true as const,
      sessionId: 'session-1',
      localId: 'input-1',
      result: { kind: 'final_text' as const, text: 'done' },
    }));
    const observe = createWorkflowInvocationRecoveryObserver({
      credentials: { token: 'token' } as never,
      machineId: 'machine-1',
      actionExecutor: { execute } as never,
      observeSession,
      cancelSession: vi.fn(),
      now: () => 123,
    });

    await expect(observe({
      terminalParent: true,
      cancellationRequested: false,
      progress: {
        kind: 'happier.workflow-progress.v1',
        invocationPath: { blockId: 'step', scope: [] },
        blockKind: 'step',
        attempt: '0',
        logicalInvocationRecordId: '2aaf1a39-4c48-4904-83a4-7eae318dfc2c',
        execution: { kind: 'session', sessionId: 'session-1', localInputId: 'input-1' },
      },
    })).resolves.toEqual({ kind: 'completed', result: 'done' });
    expect(observeSession).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: 'session-1', localId: 'input-1', deadlineMs: 123,
    }));
    expect(execute).not.toHaveBeenCalled();
  });

  it('keeps Session turn cancellation-request custody unresolved until the exact turn is terminal', async () => {
    const observeSession = vi.fn(async () => ({
      ok: true as const,
      sessionId: 'session-1',
      localId: 'input-1',
      result: { kind: 'pending' as const },
    }));
    const cancelSession = vi.fn(async () => ({ kind: 'turn_cancel_requested' as const }));
    const observe = createWorkflowInvocationRecoveryObserver({
      credentials: { token: 'token' } as never,
      machineId: 'machine-1',
      actionExecutor: { execute: vi.fn() } as never,
      observeSession,
      cancelSession,
      now: () => 123,
    });

    await expect(observe({
      terminalParent: false,
      cancellationRequested: true,
      progress: {
        kind: 'happier.workflow-progress.v1',
        invocationPath: { blockId: 'step', scope: [] },
        blockKind: 'step',
        attempt: '0',
        logicalInvocationRecordId: '2aaf1a39-4c48-4904-83a4-7eae318dfc2c',
        execution: { kind: 'session', sessionId: 'session-1', localInputId: 'input-1' },
      },
    })).resolves.toEqual({
      kind: 'unresolved',
      code: 'session_input_turn_cancel_requested',
    });
    expect(cancelSession).toHaveBeenCalledOnce();
  });

  it('uses only exact Execution Run get and stop owners for pending terminal custody', async () => {
    const execute = vi.fn()
      .mockResolvedValueOnce({ ok: true, result: { run: true } })
      .mockResolvedValueOnce({ ok: true, result: { status: 'stopped' } });
    const observeRun = vi.fn(async ({ get }: Readonly<{ get: (request: Readonly<{ runId: string; includeStructured: false }>) => Promise<unknown> }>) => {
      await get({ runId: 'execution-run-1', includeStructured: false });
      return { kind: 'pending' as const };
    });
    const observe = createWorkflowInvocationRecoveryObserver({
      credentials: { token: 'token' } as never,
      machineId: 'machine-1',
      actionExecutor: { execute } as never,
      observeRun: observeRun as never,
    });

    await expect(observe({
      terminalParent: true,
      cancellationRequested: false,
      progress: {
        kind: 'happier.workflow-progress.v1',
        invocationPath: { blockId: 'step', scope: [] },
        blockKind: 'step',
        attempt: '0',
        logicalInvocationRecordId: '2aaf1a39-4c48-4904-83a4-7eae318dfc2c',
        execution: { kind: 'attached_run', sessionId: 'session-1', runId: 'execution-run-1', localInputId: 'input-1' },
      },
    })).resolves.toEqual({ kind: 'unresolved', code: 'workflow_outcome_unresolved' });
    expect(execute.mock.calls.map(([actionId]) => actionId)).toEqual([
      'execution.run.get',
      'execution.run.stop',
      'execution.run.get',
    ]);
    expect(execute).toHaveBeenNthCalledWith(1, 'execution.run.get', {
      sessionId: 'session-1', runId: 'execution-run-1', includeStructured: false,
    }, expect.objectContaining({ executionRunTargetMachineId: 'machine-1' }));
    expect(execute).toHaveBeenNthCalledWith(2, 'execution.run.stop', {
      sessionId: 'session-1', runId: 'execution-run-1',
    }, expect.objectContaining({ executionRunTargetMachineId: 'machine-1' }));
    expect(execute.mock.calls[1]?.[2]).not.toHaveProperty('signal');
    expect(execute.mock.calls[2]?.[2]).not.toHaveProperty('signal');
  });

  it('resolves stop custody from the definitive exact-input observation after the host accepts the stop', async () => {
    const execute = vi.fn()
      .mockResolvedValueOnce({ ok: true, result: { run: 'active' } })
      .mockResolvedValueOnce({ ok: true, result: { status: 'stopped' } })
      .mockResolvedValueOnce({ ok: true, result: { run: 'cancelled' } });
    const observeRun = vi.fn(async ({ get }: Readonly<{ get: (request: Readonly<{ runId: string; includeStructured: false }>) => Promise<unknown> }>) => {
      const response = await get({ runId: 'execution-run-1', includeStructured: false });
      return response && typeof response === 'object' && (response as { run?: unknown }).run === 'cancelled'
        ? { kind: 'cancelled' as const, code: 'execution_run_input_cancelled' }
        : { kind: 'pending' as const };
    });
    const observe = createWorkflowInvocationRecoveryObserver({
      credentials: { token: 'token' } as never,
      machineId: 'machine-1',
      actionExecutor: { execute } as never,
      observeRun: observeRun as never,
    });

    await expect(observe({
      terminalParent: false,
      cancellationRequested: true,
      progress: {
        kind: 'happier.workflow-progress.v1',
        invocationPath: { blockId: 'step', scope: [] },
        blockKind: 'step',
        attempt: '0',
        logicalInvocationRecordId: '2aaf1a39-4c48-4904-83a4-7eae318dfc2c',
        execution: { kind: 'detached_run', runId: 'execution-run-1', localInputId: 'input-1', runtimeSelection: {} },
      },
    })).resolves.toEqual({ kind: 'cancelled', code: 'execution_run_input_cancelled' });
    expect(execute.mock.calls.map(([actionId]) => actionId)).toEqual([
      'execution.run.get',
      'execution.run.stop',
      'execution.run.get',
    ]);
  });
});
