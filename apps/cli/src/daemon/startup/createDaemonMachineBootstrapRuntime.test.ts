import { describe, expect, it, vi } from 'vitest';

import {
  SessionServerStartIngressRequestV1Schema,
  type MachineLiveStreamFrameV1,
  type WorkspaceSyncRuntimeReadinessV1,
  type WorkspaceSyncStatusV1,
} from '@happier-dev/protocol';
import type { DaemonState } from '@/api/types';

import type { MachineLiveStreamCaptureAdapter } from '../peer/mediation/stream/captureAdapter';
import { createMachineLiveStreamCaptureRegistry } from '../peer/mediation/stream/captureRegistry';
import type {
  AutomationWorkerHandle,
  startAutomationWorker,
} from '../automation/automationWorker';
import { cleanupAndShutdown } from '../lifecycle/cleanupAndShutdown';
import { createServerFeaturesSnapshotStore } from '@/features/serverFeaturesSnapshotStore';
import { isWorkflowRuntimeEnabled } from '../automation/workflowFeatureGate';
import type { WorkflowCoordinatorResult } from '../workflows/coordinator';

import { createDaemonMachineBootstrapRuntime } from './createDaemonMachineBootstrapRuntime';

const automationWorkerMocks = vi.hoisted(() => ({
  startAutomationWorker: vi.fn(),
}));
const voiceInferenceWorkerMocks = vi.hoisted(() => ({
  startVoiceInferenceWorker: vi.fn(async () => ({ stop: vi.fn(async () => {}) })),
}));

vi.mock('../automation/automationWorker', () => ({
  startAutomationWorker: automationWorkerMocks.startAutomationWorker,
}));
vi.mock('../voiceInference/voiceInferenceWorker', () => ({
  startVoiceInferenceWorker: voiceInferenceWorkerMocks.startVoiceInferenceWorker,
}));

const deviceLocalSecretStorage = {
  sealJson: vi.fn(() => 'sealed'),
  openJson: vi.fn(() => null),
  deriveOpaqueIdentity: vi.fn(() => 'a'.repeat(64)),
} as never;

function createBaseRuntimeParams(overrides: Partial<Parameters<typeof createDaemonMachineBootstrapRuntime>[0]> = {}) {
  const workspaceSyncHandoffAdapter = {
    prepare: vi.fn(),
    finalize: vi.fn(),
    commit: vi.fn(),
    abort: vi.fn(),
  };
  return {
    // Test fixture boundary: this test only inspects returned PMS config; API methods are not invoked.
    api: {
      machineSyncClient: vi.fn(),
    } as never,
    credentials: {
      token: 'token',
      encryption: { type: 'legacy', secret: new Uint8Array(32).fill(7) },
    },
    deviceLocalSecretStorage,
    workspaceSyncHandoffAdapter,
    diagnosticSubsystemGates: {
      disableMachineSync: false,
      disableAutomationWorker: false,
    },
    runtimeId: 'runtime_1',
    publicReleaseChannel: 'dev' as const,
    startupSource: 'manual',
    serviceLabel: undefined,
    transferRuntimeStatePublisher: null,
    spawnSession: vi.fn(),
    stopSession: vi.fn(),
    awaitAgentSessionOpen: vi.fn(),
    isSessionAlreadyRunning: vi.fn(),
    loadLocalSessionMetadataForHandoff: vi.fn(),
    beforeShutdown: vi.fn(),
    requestShutdown: vi.fn(),
    directPeerServerLifecycle: null,
    // Test fixture boundary: transfer registries are pass-through values and are not invoked by this test.
    directTransferPromptAssetAdapterRegistry: {} as never,
    directTransferPromptRegistryRegistry: {} as never,
    daemonServerWorkScheduler: {} as never,
    setDaemonServerWorkOnline: vi.fn(),
    onMachineConnectionOnline: vi.fn(),
    reconcileConnectedServicesProjection: vi.fn(),
    isShuttingDown: () => false,
    ...overrides,
  } satisfies Parameters<typeof createDaemonMachineBootstrapRuntime>[0];
}

describe('createDaemonMachineBootstrapRuntime', () => {
  it('authorizes the exact Runner broker readiness request before publishing the fixed application target', async () => {
    const request = {
      v: 1 as const,
      kind: 'provider_broker_readiness' as const,
      homeServerIdentityId: 'srv_home',
      activationId: '00000000-0000-4000-8000-000000000010',
      launchManifestCommitment: 'A'.repeat(43),
      resourceId: 'resource-1',
      agentTargetKey: 'agent:happier.agent.codex/codex',
      protocol: 'openai-responses' as const,
      modelId: 'gpt-5',
      initiator: { installationId: 'installation-1', endpointId: 'a'.repeat(64) },
      target: { machineId: 'broker-machine', endpointId: 'b'.repeat(64) },
      activationSignature: 'A'.repeat(86),
      installationSignature: 'A'.repeat(86),
    };
    const authorization = {
      v: 1 as const,
      binding: {
        homeServerIdentityId: request.homeServerIdentityId,
        activationId: request.activationId,
        launchManifestCommitment: request.launchManifestCommitment,
        resourceId: request.resourceId,
        agentTargetKey: request.agentTargetKey,
        protocol: request.protocol,
        modelId: request.modelId,
        initiator: request.initiator,
        target: request.target,
      },
      credentialSelectionBinding: {
        v: 1 as const,
        resourceId: request.resourceId,
        brokerMachineId: request.target.machineId,
        revision: 7,
        application: {
          agentTargetKey: request.agentTargetKey,
          implementationIdentity: { pluginId: 'happier.provider.openai', localId: 'openai' },
          endpointTemplateId: 'responses',
          protocol: request.protocol,
        },
        sourceRevision: 'source-revision-7',
      },
      readiness: { kind: 'available' as const },
    };
    const authorizeRunnerBrokerReadiness = vi.fn()
      .mockResolvedValueOnce(authorization)
      .mockResolvedValueOnce({
        ...authorization,
        binding: {
          ...authorization.binding,
          activationId: '00000000-0000-4000-8000-000000000011',
        },
      })
      .mockResolvedValueOnce({ ...authorization, readiness: { kind: 'resource_unavailable' as const } })
      .mockRejectedValueOnce(new Error('home unavailable'));
    const runtime = createDaemonMachineBootstrapRuntime(createBaseRuntimeParams({
      api: { machineSyncClient: vi.fn(), authorizeRunnerBrokerReadiness } as never,
    }));
    const resolve = runtime.peerMediationMachineRpc?.resolveRunnerBrokerReadinessApplicationTarget;
    expect(resolve).toBeDefined();
    const signal = new AbortController().signal;

    try {
      await expect(resolve?.({
        request,
        authenticatedRemoteEndpointId: request.initiator.endpointId,
        localEndpointId: request.target.endpointId,
        signal,
      } as never)).resolves.toEqual({ port: expect.any(Number) });
      expect(authorizeRunnerBrokerReadiness).toHaveBeenCalledWith(request, signal);
      await expect(resolve?.({
        request,
        authenticatedRemoteEndpointId: request.initiator.endpointId,
        localEndpointId: request.target.endpointId,
        signal,
      } as never)).resolves.toBeNull();
      await expect(resolve?.({
        request,
        authenticatedRemoteEndpointId: request.initiator.endpointId,
        localEndpointId: request.target.endpointId,
        signal,
      } as never)).resolves.toBeNull();
      await expect(resolve?.({
        request,
        authenticatedRemoteEndpointId: request.initiator.endpointId,
        localEndpointId: request.target.endpointId,
        signal,
      } as never)).resolves.toBeNull();
    } finally {
      await runtime.beforeShutdown();
    }
  });

  it('installs the broker application for the registered machine, advertises it only while live, and shuts it down', async () => {
    const resolveProviderBrokerApplicationTarget = vi.fn(async () => ({ port: 47_001, localCapability: 'local-capability' }));
    const resolveExternalProviderBrokerApplicationTarget = vi.fn(async () => ({ port: 47_002, localCapability: 'external-capability' }));
    const checkRunnerCredentialSelectionCurrentness = vi.fn(async () => 'available' as const);
    const close = vi.fn(async () => undefined);
    const setProviderBrokerIngressLive = vi.fn(async () => undefined);
    const startProviderBrokerApplication = vi.fn(async () => ({
      resolveProviderBrokerApplicationTarget,
      resolveExternalProviderBrokerApplicationTarget,
      checkRunnerCredentialSelectionCurrentness,
      close,
    }));
    const withOwner = createDaemonMachineBootstrapRuntime(createBaseRuntimeParams({
      api: {
        machineSyncClient: vi.fn(() => ({ setProviderBrokerIngressLive })),
      } as never,
      startProviderBrokerApplication,
    }));
    const input = {
      handshake: { v: 1, kind: 'provider_broker' },
      authority: {},
      authenticatedRemoteEndpointId: 'a'.repeat(64),
      localEndpointId: 'b'.repeat(64),
      signal: new AbortController().signal,
    } as never;
    await expect(withOwner.peerMediationMachineRpc?.resolveProviderBrokerApplicationTarget?.(input))
      .resolves.toBeNull();
    await withOwner.createConnectedApiMachine({ id: 'registered-machine' } as never);
    expect(startProviderBrokerApplication).toHaveBeenCalledWith({
      machineId: 'registered-machine',
      apiMachine: expect.anything(),
    });
    expect(setProviderBrokerIngressLive).toHaveBeenCalledWith(true);
    await expect(withOwner.peerMediationMachineRpc?.resolveProviderBrokerApplicationTarget?.(input))
      .resolves.toEqual({ port: 47_001, localCapability: 'local-capability' });
    expect(resolveProviderBrokerApplicationTarget).toHaveBeenCalledWith(input);
    const externalInput = { binding: { v: 1, requestId: 'request-1' } } as never;
    await expect(withOwner.peerMediationMachineRpc?.resolveExternalProviderBrokerApplicationTarget?.(externalInput))
      .resolves.toEqual({ port: 47_002, localCapability: 'external-capability' });
    expect(resolveExternalProviderBrokerApplicationTarget).toHaveBeenCalledWith(externalInput);
    await withOwner.beforeShutdown();
    expect(setProviderBrokerIngressLive).toHaveBeenLastCalledWith(false);
    expect(close).toHaveBeenCalledTimes(1);
    expect(setProviderBrokerIngressLive.mock.invocationCallOrder.at(-1))
      .toBeLessThan(close.mock.invocationCallOrder[0]!);

    const withoutOwner = createDaemonMachineBootstrapRuntime(createBaseRuntimeParams());
    expect(withoutOwner.peerMediationMachineRpc?.resolveProviderBrokerApplicationTarget).toBeUndefined();
  });

  it('does not start the daemon inference worker while its canonical feature decision is disabled', async () => {
    const previous = process.env.HAPPIER_FEATURE_VOICE_DAEMON_INFERENCE__ENABLED;
    delete process.env.HAPPIER_FEATURE_VOICE_DAEMON_INFERENCE__ENABLED;
    try {
      const runtime = createDaemonMachineBootstrapRuntime(createBaseRuntimeParams());
      await expect(runtime.startVoiceInferenceWorkerForMachine('machine_1', 'account_1'))
        .resolves.toBeNull();
      expect(voiceInferenceWorkerMocks.startVoiceInferenceWorker).not.toHaveBeenCalled();
    } finally {
      if (previous === undefined) delete process.env.HAPPIER_FEATURE_VOICE_DAEMON_INFERENCE__ENABLED;
      else process.env.HAPPIER_FEATURE_VOICE_DAEMON_INFERENCE__ENABLED = previous;
    }
  });

  it('keeps daemon quiescence out of ownership metadata and forwards the daemon feature refresh owner as a lifecycle dependency', async () => {
    const machineSyncClient = vi.fn((
      _machine: unknown,
      _metadata: unknown,
      _lifecycleDependencies: Readonly<{
        resolveServerFeaturesSnapshot?: () => Promise<unknown>;
      }>,
    ) => ({}));
    const isShuttingDown = vi.fn(() => false);
    const workspaceSyncHandoffAdapter = {
      prepare: vi.fn(),
      finalize: vi.fn(),
      commit: vi.fn(),
      abort: vi.fn(),
    };
    const workspaceSync = {
      controller: {},
      deleteConflictLoserAtTarget: vi.fn(),
      readFileAtTarget: vi.fn(),
    } as never;
    const serverFeaturesSnapshot = { status: 'ready', features: { capabilities: {} } } as const;
    const refreshServerFeaturesSnapshot = vi.fn(async () => serverFeaturesSnapshot as never);
    const runtime = createDaemonMachineBootstrapRuntime(createBaseRuntimeParams({
      // Test fixture boundary: only machineSyncClient call arguments are observed.
      api: { machineSyncClient } as never,
      isShuttingDown,
      workspaceSyncHandoffAdapter,
      workspaceSync,
      getServerFeaturesSnapshot: () => serverFeaturesSnapshot as never,
      refreshServerFeaturesSnapshot,
    }));
    expect(runtime.deviceLocalSecretStorage).toBe(
      deviceLocalSecretStorage,
    );
    const machine = {
      id: 'machine_1',
      encryptionKey: new Uint8Array(32),
      encryptionVariant: 'legacy' as const,
      metadata: null,
      metadataVersion: 0,
      daemonState: null,
      daemonStateVersion: 0,
    };

    runtime.createConnectedApiMachine(machine);

    expect(machineSyncClient).toHaveBeenCalledWith(
      machine,
      expect.not.objectContaining({ isDaemonQuiescing: expect.any(Function) }),
      {
        isDaemonQuiescing: isShuttingDown,
        workspaceSyncHandoffAdapter,
        workspaceSync,
        resolveServerFeaturesSnapshot: expect.any(Function),
      },
    );
    const lifecycleDependencies = machineSyncClient.mock.calls[0]?.[2];
    await expect(lifecycleDependencies?.resolveServerFeaturesSnapshot?.()).resolves.toBe(serverFeaturesSnapshot);
    expect(refreshServerFeaturesSnapshot).toHaveBeenCalledOnce();
  });

  it('constructs workspace sync from the registered machine identity before publishing the machine client', async () => {
    const updateDaemonState = vi.fn(async (_updater: (state: DaemonState | null) => DaemonState) => {});
    const machineSyncClient = vi.fn(() => ({ updateDaemonState }));
    const handoffAdapter = {
      prepare: vi.fn(),
      finalize: vi.fn(),
      commit: vi.fn(),
      abort: vi.fn(),
    };
    const workspaceSync = {
      controller: {},
      deleteConflictLoserAtTarget: vi.fn(),
      readFileAtTarget: vi.fn(),
    } as never;
    const createWorkspaceSyncRuntime = vi.fn(async ({ machineId, onReadinessPublished, onStatusPublished }: Readonly<{
      machineId: string;
      onReadinessPublished(readiness: WorkspaceSyncRuntimeReadinessV1): void;
      onStatusPublished(status: WorkspaceSyncStatusV1): void;
    }>) => {
      onReadinessPublished({
        engine: { state: 'ready' },
        carrier: { state: 'unavailable', errorCode: 'machine_carrier_unavailable' },
      });
      onStatusPublished({
        relationshipId: 'relationship_1',
        controllerMachineId: machineId,
        state: 'watching',
        alphaPath: '/alpha',
        betaPath: '/beta',
        mode: 'keep_synced',
        changedFiles: 0,
        conflictCount: 0,
        lastSuccessfulSyncAtMs: null,
      });
      return {
        handoffAdapter,
        workspaceSync,
      };
    });
    const runtime = createDaemonMachineBootstrapRuntime(createBaseRuntimeParams({
      api: { machineSyncClient } as never,
      workspaceSyncHandoffAdapter: undefined,
      workspaceSync: undefined,
      createWorkspaceSyncRuntime,
    }));
    const machine = {
      id: 'registered-machine',
      encryptionKey: new Uint8Array(32),
      encryptionVariant: 'legacy' as const,
      metadata: null,
      metadataVersion: 0,
      daemonState: null,
      daemonStateVersion: 0,
    };

    await runtime.createConnectedApiMachine(machine);

    expect(createWorkspaceSyncRuntime).toHaveBeenCalledWith({
      machineId: 'registered-machine',
      onReadinessPublished: expect.any(Function),
      onStatusPublished: expect.any(Function),
    });
    expect(machineSyncClient).toHaveBeenCalledWith(
      machine,
      expect.any(Object),
      expect.objectContaining({
        workspaceSyncHandoffAdapter: handoffAdapter,
        workspaceSync,
      }),
    );
    await vi.waitFor(() => expect(updateDaemonState).toHaveBeenCalledOnce());
    const update = updateDaemonState.mock.calls[0]?.[0];
    expect(update?.(null)).toEqual({
      status: 'running',
      workspaceSync: {
        v: 1,
        readiness: {
          engine: { state: 'ready' },
          carrier: { state: 'unavailable', errorCode: 'machine_carrier_unavailable' },
        },
        status: {
          relationshipId: 'relationship_1',
          controllerMachineId: 'registered-machine',
          state: 'watching',
          alphaPath: '/alpha',
          betaPath: '/beta',
          mode: 'keep_synced',
          changedFiles: 0,
          conflictCount: 0,
          lastSuccessfulSyncAtMs: null,
        },
      },
    });
  });

  it('forwards the daemon-owned inventory snapshot reader without creating a second scanner', () => {
    const readLocalServiceInventorySnapshot = vi.fn();
    const getServerFeaturesSnapshot = vi.fn();
    const resolvePeerMediationTrustRoots = vi.fn(() => []);
    const runtime = createDaemonMachineBootstrapRuntime(createBaseRuntimeParams({
      readLocalServiceInventorySnapshot,
      getServerFeaturesSnapshot,
      resolvePeerMediationTrustRoots,
    }));
    expect(runtime.readLocalServiceInventorySnapshot).toBe(readLocalServiceInventorySnapshot);
    expect(runtime.getServerFeaturesSnapshot).toBe(getServerFeaturesSnapshot);
    expect(runtime.resolvePeerMediationTrustRoots).toBe(resolvePeerMediationTrustRoots);
  });

  it('forwards the durable connected-services projection reconciler into machine cursor composition', () => {
    const reconcileConnectedServicesProjection = vi.fn();
    const runtime = createDaemonMachineBootstrapRuntime(createBaseRuntimeParams({
      reconcileConnectedServicesProjection,
    }));

    expect(runtime.reconcileConnectedServicesProjection).toBe(reconcileConnectedServicesProjection);
  });

  it('constructs one workflow recovery reader for the connected machine and forwards lifecycle triggers', async () => {
    const recover = vi.fn(async () => {});
    const createWorkflowRecoveryForMachine = vi.fn(() => recover);
    const enqueueSessionPendingByMachine = vi.fn();
    const runtime = createDaemonMachineBootstrapRuntime(createBaseRuntimeParams({
      api: {
        machineSyncClient: vi.fn(() => ({ enqueueSessionPendingByMachine })),
      } as never,
      isWorkflowFeatureEnabled: () => true,
      createWorkflowRecoveryForMachine,
    }));
    const machine = {
      id: 'machine_1',
      encryptionKey: new Uint8Array(32),
      encryptionVariant: 'legacy' as const,
      metadata: null,
      metadataVersion: 0,
      daemonState: null,
      daemonStateVersion: 0,
    };

    await runtime.createConnectedApiMachine(machine);
    await runtime.recoverWorkflowRuns?.('startup');

    expect(createWorkflowRecoveryForMachine).toHaveBeenCalledWith(expect.objectContaining({
      machineId: machine.id,
      machineAdmissionTransport: expect.any(Function),
    }));
    expect(recover).toHaveBeenCalledWith('startup');
  });

  it('forwards the daemon runtime-open attestation reader into machine bootstrap', () => {
    const awaitAgentSessionOpen = vi.fn();
    const runtime = createDaemonMachineBootstrapRuntime(createBaseRuntimeParams({
      awaitAgentSessionOpen,
    }));

    expect(runtime.awaitAgentSessionOpen).toBe(awaitAgentSessionOpen);
  });

  it('does not publish an automation worker when the diagnostic gate disables it', () => {
    const onAutomationWorkerStarted = vi.fn();
    const runtime = createDaemonMachineBootstrapRuntime(createBaseRuntimeParams({
      diagnosticSubsystemGates: {
        disableMachineSync: false,
        disableAutomationWorker: true,
      },
      onAutomationWorkerStarted,
    }));

    expect(runtime.startAutomationWorkerForMachine('machine_1')).toBeNull();
    expect(onAutomationWorkerStarted).not.toHaveBeenCalled();
  });

  it('publishes the worker to shutdown ownership before downstream bootstrap can continue', async () => {
    const worker: AutomationWorkerHandle = {
      stop: vi.fn(),
      refreshAssignments: vi.fn(async () => {}),
      pause: vi.fn(),
      resume: vi.fn(),
      handleServerUpdate: vi.fn(),
    };
    automationWorkerMocks.startAutomationWorker.mockReturnValueOnce(worker);
    let shutdownOwnedWorker: AutomationWorkerHandle | null = null;
    const runtime = createDaemonMachineBootstrapRuntime(createBaseRuntimeParams({
      onAutomationWorkerStarted: (startedWorker) => {
        shutdownOwnedWorker = startedWorker;
      },
    }));

    const startedWorker = runtime.startAutomationWorkerForMachine('machine_1');
    expect(startedWorker).toBe(worker);
    expect(shutdownOwnedWorker).toBe(worker);

    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(
      (() => undefined as never) as typeof process.exit,
    );
    try {
      // This is the barrier between factory publication and the next bootstrap
      // action (Memory/onMachineSyncRuntime). Shutdown must retain this exact
      // early handle rather than wait for the later runtime result.
      await cleanupAndShutdown({
        source: 'happier-cli',
        processEnv: {},
        resolvePositiveIntEnv: (_raw, fallback) => fallback,
        restartOnStaleVersionAndHeartbeat: null,
        connectedServiceRefreshLoopHandle: null,
        connectedServiceQuotasLoopHandle: null,
        apiMachine: null,
        machineConnectionStateCleanup: null,
        automationWorker: shutdownOwnedWorker,
        memoryWorker: null,
        voiceInferenceWorker: null,
        trackedSessionCount: 0,
        stopDirectPeerServer: async () => {},
        stopTailscaleTransferServeLifecycle: async () => {},
        stopControlServer: async () => {},
        stopCaffeinate: async () => {},
        daemonLockHandle: null,
        releaseDaemonLock: async () => {},
      });
      expect(worker.stop).toHaveBeenCalledOnce();
      expect(exitSpy).toHaveBeenCalledWith(0);
    } finally {
      exitSpy.mockRestore();
    }
  });

  it('injects the production workflow coordinator into the existing Automation worker after Machine sync exists', async () => {
    const enqueueSessionPendingByMachine = vi.fn();
    const apiMachine = { enqueueSessionPendingByMachine, dispatchSessionServerStart: vi.fn() } as never;
    const coordinateWorkflowRun = vi.fn();
    const createWorkflowRunCoordinatorForMachine = vi.fn(() => coordinateWorkflowRun);
    automationWorkerMocks.startAutomationWorker.mockReturnValueOnce({
      stop: vi.fn(), refreshAssignments: vi.fn(), pause: vi.fn(), resume: vi.fn(), handleServerUpdate: vi.fn(),
    });
    const runtime = createDaemonMachineBootstrapRuntime(createBaseRuntimeParams({
      api: { machineSyncClient: vi.fn(() => apiMachine) } as never,
      isWorkflowFeatureEnabled: () => true,
      createWorkflowRunCoordinatorForMachine,
    }));

    await runtime.createConnectedApiMachine({ id: 'machine_1' } as never);
    runtime.startAutomationWorkerForMachine('machine_1');

    expect(createWorkflowRunCoordinatorForMachine).toHaveBeenCalledWith({
      machineId: 'machine_1',
      machineAdmissionTransport: expect.any(Function),
      machineActionDirectTargetTransport: {
        machineId: 'machine_1',
        invoke: expect.any(Function),
      },
    });
    const workerParams = automationWorkerMocks.startAutomationWorker.mock.calls.at(-1)?.[0] as
      | Parameters<typeof startAutomationWorker>[0]
      | undefined;
    await expect(workerParams?.coordinateWorkflowRun?.({} as never)).resolves.toBeUndefined();
    expect(coordinateWorkflowRun).toHaveBeenCalledOnce();
  });

  it('uses the live server feature decision for the existing Workflow coordinator without restarting Automation', async () => {
    const enabledFeatures = {
      status: 'ready' as const,
      provenance: 'authenticated' as const,
      features: {
        features: {
          automations: { enabled: true },
          workflows: { enabled: true },
        },
        capabilities: {},
      },
    };
    const disabledFeatures = {
      ...enabledFeatures,
      features: {
        ...enabledFeatures.features,
        features: {
          automations: { enabled: true },
          workflows: { enabled: false },
        },
      },
    };
    const fetchSnapshot = vi.fn()
      .mockRejectedValueOnce(new Error('Home unavailable'))
      .mockResolvedValueOnce(enabledFeatures)
      .mockResolvedValueOnce(disabledFeatures);
    const featureStore = createServerFeaturesSnapshotStore({ fetchSnapshot });
    const coordinatedOutcome: WorkflowCoordinatorResult = { state: 'succeeded' };
    const coordinateWorkflowRun = vi.fn(async () => coordinatedOutcome);
    const recoverWorkflowRuns = vi.fn(async () => {});
    const runtime = createDaemonMachineBootstrapRuntime(createBaseRuntimeParams({
      api: {
        machineSyncClient: vi.fn(() => ({
          enqueueSessionPendingByMachine: vi.fn(),
          dispatchSessionServerStart: vi.fn(),
        })),
      } as never,
      isWorkflowFeatureEnabled: () => isWorkflowRuntimeEnabled({}, featureStore.getSnapshot()),
      createWorkflowRunCoordinatorForMachine: vi.fn(() => coordinateWorkflowRun),
      createWorkflowRecoveryForMachine: vi.fn(() => recoverWorkflowRuns),
    }));
    automationWorkerMocks.startAutomationWorker.mockReturnValueOnce({
      stop: vi.fn(), refreshAssignments: vi.fn(), pause: vi.fn(), resume: vi.fn(), handleServerUpdate: vi.fn(),
    });

    await runtime.createConnectedApiMachine({ id: 'machine_1' } as never);
    runtime.startAutomationWorkerForMachine('machine_1');
    const workerParams = automationWorkerMocks.startAutomationWorker.mock.calls.at(-1)?.[0] as
      | Parameters<typeof startAutomationWorker>[0]
      | undefined;
    const coordinate = workerParams?.coordinateWorkflowRun;
    expect(coordinate).toBeDefined();

    await expect(coordinate?.({} as never)).rejects.toThrow('Workflow Run coordinator is unavailable');
    await runtime.recoverWorkflowRuns?.('startup');
    expect(recoverWorkflowRuns).not.toHaveBeenCalled();
    await featureStore.refresh();
    await expect(coordinate?.({} as never)).rejects.toThrow('Workflow Run coordinator is unavailable');
    await featureStore.refresh();
    await expect(coordinate?.({} as never)).resolves.toEqual(coordinatedOutcome);
    await runtime.recoverWorkflowRuns?.('reconnect');
    expect(coordinateWorkflowRun).toHaveBeenCalledOnce();
    expect(recoverWorkflowRuns).toHaveBeenCalledOnce();
    await featureStore.refresh();
    await expect(coordinate?.({} as never)).rejects.toThrow('Workflow Run coordinator is unavailable');
    await runtime.recoverWorkflowRuns?.('reconnect');
    expect(coordinateWorkflowRun).toHaveBeenCalledOnce();
    expect(recoverWorkflowRuns).toHaveBeenCalledOnce();
  });

  it('supplies the connected Session-start ingress to the Automation worker', async () => {
    const worker: AutomationWorkerHandle = {
      stop: vi.fn(),
      refreshAssignments: vi.fn(async () => {}),
      pause: vi.fn(),
      resume: vi.fn(),
      handleServerUpdate: vi.fn(),
    };
    const dispatched = {
      type: 'success' as const,
      disposition: 'created' as const,
      sessionId: 'session-automation',
      executionTarget: { serverId: 'server-1', machineId: 'machine_1' },
      organizationPlacement: { folderId: null, tagIds: [] },
      initialInput: { status: 'accepted' as const, localId: 'automation:run:run-1' },
    };
    const dispatchSessionServerStart = vi.fn(async () => dispatched);
    const connectedApiMachine = {
      enqueueSessionPendingByMachine: vi.fn(),
      dispatchSessionServerStart,
    };
    const machineSyncClient = vi.fn(() => connectedApiMachine);
    automationWorkerMocks.startAutomationWorker.mockReturnValueOnce(worker);
    const runtime = createDaemonMachineBootstrapRuntime(createBaseRuntimeParams({
      api: { machineSyncClient } as never,
    }));
    const machine = {
      id: 'machine_1',
      encryptionKey: new Uint8Array(32),
      encryptionVariant: 'legacy' as const,
      metadata: null,
      metadataVersion: 0,
      daemonState: null,
      daemonStateVersion: 0,
    };

    runtime.createConnectedApiMachine(machine);
    runtime.startAutomationWorkerForMachine(machine.id);

    const workerParams = automationWorkerMocks.startAutomationWorker.mock.calls.at(-1)?.[0] as
      | Parameters<typeof startAutomationWorker>[0]
      | undefined;
    const request = SessionServerStartIngressRequestV1Schema.parse({
      v: 1,
      kind: 'session.serverStart.ingress',
      runId: 'run-1',
      attempt: 1,
      requestEnvelope: {
        t: 'plain',
        v: {
          creationKey: 'automation-run:run-1',
          executionTarget: { serverId: 'server-1', machineId: 'machine_1' },
          directory: '/workspace/project',
          organizationPlacement: { folderId: null, tagIds: [] },
          agentTarget: {
            kind: 'agent',
            identity: { pluginId: 'happier.agent.codex', localId: 'codex' },
          },
          initialMessage: 'Start the automation task.',
        },
      },
    });

    expect(workerParams?.dispatchSessionServerStart).toEqual(expect.any(Function));
    await expect(workerParams?.dispatchSessionServerStart?.(request)).resolves.toEqual(dispatched);
    expect(dispatchSessionServerStart).toHaveBeenCalledWith(request, undefined);
  });

  it('wires the production peer-mediation live-stream capture adapter into machine bootstrap config', () => {
    const cancelConnectedServiceRuntimeAuthRecovery = vi.fn();
    const runtime = createDaemonMachineBootstrapRuntime(createBaseRuntimeParams({
      cancelConnectedServiceRuntimeAuthRecovery,
    }));

    expect(runtime.peerMediationMachineRpc?.stream?.captureAdapter).toEqual({
      start: expect.any(Function),
    });
    expect(runtime.cancelConnectedServiceRuntimeAuthRecovery).toBe(cancelConnectedServiceRuntimeAuthRecovery);
  });

  it('uses the shared PMS capture registry for relayed live-stream capture sources', async () => {
    const registry = createMachineLiveStreamCaptureRegistry();
    const offeredFrames: MachineLiveStreamFrameV1[] = [];
    const sourceAdapter: MachineLiveStreamCaptureAdapter = {
      start: async (input) => {
        input.offerFrame({
          v: 1,
          streamId: input.streamId,
          sequence: 1,
          timestampMs: 1_000,
          payloadKind: 'image_keyframe',
          payloadEncoding: 'binary_base64',
          payloadBase64: 'AQID',
          payloadSizeBytes: 3,
        });
        return { ok: true, session: { stop: () => undefined } };
      },
    };
    registry.register({
      sourceId: 'ios-simulator:A1B2-C3D4:screen',
      streamFamily: 'ios-simulator:A1B2-C3D4:screen',
      adapter: sourceAdapter,
      capabilities: {
        v: 1,
        sourceId: 'ios-simulator:A1B2-C3D4:screen',
        sourceKind: 'simulator',
        supportedCodecs: ['image.mjpeg'],
        maxFramesPerSecond: 30,
        inputMode: 'exclusive',
        sidebands: ['capture_health'],
        health: { status: 'available' },
      },
    });

    const runtime = createDaemonMachineBootstrapRuntime(createBaseRuntimeParams({
      liveStreamCaptureRegistry: registry,
    }));
    const captureAdapter = runtime.peerMediationMachineRpc?.stream?.captureAdapter;
    expect(captureAdapter).toBeDefined();
    if (!captureAdapter) throw new Error('expected live-stream capture adapter');

    const result = await captureAdapter.start({
      streamId: 'stream_1',
      streamFamily: 'ios-simulator:A1B2-C3D4:screen',
      sourceMachineId: 'machine_source',
      targetMachineId: 'machine_target',
      caps: {
        maxBitrateBps: 64_000,
        maxFramesPerSecond: 12,
        maxFrameBytes: 8_192,
        maxDurationMs: 60_000,
        maxTotalBytes: 128_000,
      },
      startRequest: {
        v: 1,
        streamId: 'stream_1',
        streamFamily: 'ios-simulator:A1B2-C3D4:screen',
        routeKind: 'server_relay',
        sourceMachineId: 'machine_source',
        targetMachineId: 'machine_target',
        maxBitrateBps: 64_000,
        maxFramesPerSecond: 12,
        maxFrameBytes: 8_192,
        maxDurationMs: 60_000,
        maxTotalBytes: 128_000,
      },
      startedAtMs: 1_000,
      expiresAtMs: 61_000,
      nowMs: () => 1_000,
      offerFrame: (frame) => {
        offeredFrames.push(frame);
        return { ok: true };
      },
      applyControl: () => ({ ok: true }),
      emitReceipt: () => undefined,
    });

    expect(result).toMatchObject({ ok: true });
    expect(offeredFrames.map((frame) => frame.sequence)).toEqual([1]);
  });
});
