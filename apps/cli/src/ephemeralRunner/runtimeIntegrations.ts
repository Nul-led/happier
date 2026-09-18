import { join } from 'node:path';

import { resolvePlatformFromNodePlatform } from '@happier-dev/cli-common/agents';
import { readIrohRelayConfigFromEnv } from '@happier-dev/iroh-native/node';
import { decodeBase64 } from '@happier-dev/protocol/crypto/base64';
import { openBoxBundleWithSecretKey } from '@happier-dev/protocol/crypto/boxBundle';
import { signRunnerEndpointProjectionProofV1 } from '@happier-dev/protocol/ephemeralRunner/endpointProjection';
import { signRunnerActivationProgressUpdateV1 } from '@happier-dev/protocol/ephemeralRunner/progressProof';
import type { RunnerLaunchManifestV1 } from '@happier-dev/protocol/ephemeralRunner/launchManifest';
import { filterRunnerReviewedEnvironmentVariablesV1 } from '@happier-dev/protocol/ephemeralRunner/runnerEnvironment';
import { VerifiedEphemeralSessionRunnerPrincipalSchema } from '@happier-dev/protocol/ephemeralRunner/principal';

import { openTeamCredentialProviderBroker } from '@/api/client/providerBrokerApi';
import { acquireTerminalAuthEnrollmentRuntime } from '@/auth/terminalAuthEnrollmentRuntime';
import { SessionHostBridge } from '@/agent/runtime/bridges/session/SessionHostBridge';
import { createReadyNotificationDispatcher } from '@/agent/runtime/notifications/createReadyNotificationDispatcher';
import { createSessionFollowSourceMaterialResolver } from '@/agent/runtime/session/follow/sessionFollowSourceMaterialResolver';
import { publishSessionFollowWakeInvalidation } from '@/agent/runtime/session/follow/sessionFollowWakeSignal';
import { runHostSessionRuntimePlan } from '@/agent/runtime/session/loop/lifecycle';
import { runWithServerHttpBaseUrl } from '@/api/client/serverHttpBaseUrl';
import { prepareManagedAgentCliLaunch } from '@/packagedRuntime/managedTools/prepareManagedAgentCliLaunch';
import { bindAgentCliLaunchSpec } from '@/packagedRuntime/managedTools/agentCliLaunchSpec';
import { createScopedRuntimeActionSettingsProvider } from '@/settings/scopedRuntimeActionSettingsProvider';
import { createDaemonMachineIrohRuntime } from '@/daemon/peer/iroh/daemonMachineIrohRuntime';
import { createProviderBrokerMachineCarrierTunnelOpen } from '@/daemon/peer/iroh/providerBrokerMachineCarrierTunnelOpen';
import { resolvePeerMediationTrustRoots } from '@/daemon/peer/mediation/resolvePeerMediationTrustRoots';
import { fetchServerFeaturesSnapshot } from '@/features/serverFeaturesClient';
import { openExactSessionTeamCredentialProviderBinding } from '@/providers/broker/sessionTeamCredentialProviderBinding';
import { isSameTeamCredentialBrokerApplication } from '@/providers/broker/teamCredentialModelCatalog';
import { materializeRunnerMcpMaterial } from '@/mcp/servers/materializeRunnerMcpMaterial';
import {
  prepareSessionCreationTarget,
  rollbackSessionCreationTargetCheckout,
} from '@/session/creation/prepareSessionCreationTarget';

import {
  createEphemeralRunnerHttpControlConnection,
  EphemeralRunnerControlHttpError,
} from './controlClient';
import type { EphemeralRunnerDependencies } from './controlPlane';
import { createEphemeralRunnerTerminalUi } from './endpointTerminalUi';
import { createEphemeralRunnerNativeShellUi } from './endpointNativeShellUi';
import { createEphemeralRunnerNativeShellStdioTransport } from './nativeShellStdioTransport';
import { readStrictEphemeralRunnerActivationDocument } from './activationFile';
import { openVerifiedRunnerRuntimeBootstrap, type VerifiedRunnerRuntimeBootstrap } from './runtimeBootstrap';
import { createRestrictedMachineRpcClient } from './createRestrictedMachineRpcClient';
import { registerRestrictedSessionFollowSourceKeyReceiver } from './registerRestrictedSessionFollowSourceKeyReceiver';
import {
  acquireReviewedRunnerPluginRuntimeLease,
  type ReviewedRunnerPluginRuntimeHandle,
} from './runnerPluginRuntimeLease';
import {
  createRestrictedSessionBackendApiContextInitializer,
  terminateRestrictedMaterializedSession,
} from './createRestrictedSessionBackendApi';
import { checkProductionRunnerBrokerReadiness } from './productionRunnerBrokerReadiness';
import { createRunnerConnectedAccountsAuthorityV1 } from './runnerConnectedAccountsOwner';
import { resolveQualifiedPurposeBindingSnapshotForAgentSpawn } from '@/daemon/connectedServices/requestAuth/prepareConnectedAccountRequestAuthForSpawn';
import { materializeQualifiedConnectedAccountLaunchUses } from '@/daemon/connectedServices/materialize/materializeQualifiedConnectedAccountLaunchUses';
import { resolveAgentContributionQualifiedId } from '@/plugins/projection/registry/agentRoutingIdentity';
import { registerRestrictedRunnerMachineServices } from './registerRestrictedRunnerMachineServices';
import { startRestrictedRunnerMachineIrohIngress } from './startRestrictedRunnerMachineIrohIngress';

type ManagedAgentPreparation = Awaited<ReturnType<typeof prepareManagedAgentCliLaunch>> & { ok: true };
type Preparation = Readonly<{
  managed: ManagedAgentPreparation;
  pluginRuntime: ReviewedRunnerPluginRuntimeHandle;
  homeDirectory: string;
}>;
type Materialized = Readonly<{
  runtimeOrigin: string;
  runtimeToken: string;
  installationProof: Parameters<typeof createRestrictedMachineRpcClient>[0]['installationProof'];
  bootstrap: VerifiedRunnerRuntimeBootstrap;
  principal: ReturnType<typeof VerifiedEphemeralSessionRunnerPrincipalSchema.parse>;
  pluginRuntime: ReviewedRunnerPluginRuntimeHandle;
  connectedAccountsAuthority: ReturnType<typeof createRunnerConnectedAccountsAuthorityV1>;
}>;

function resolveReviewedTerminalRuntime(
  terminal: RunnerLaunchManifestV1['preparedAuthoring']['authoring']['terminal'],
) {
  if (!terminal?.mode || terminal.mode === 'integrated') return null;
  return {
    mode: terminal.mode,
    requested: terminal.mode,
    ...(terminal.mode === 'tmux' && terminal.tmux?.sessionName !== undefined
      ? { tmuxTarget: terminal.tmux.sessionName }
      : {}),
    ...(terminal.mode === 'tmux' && terminal.tmux?.tmpDir
      ? { tmuxTmpDir: terminal.tmux.tmpDir }
      : {}),
  } as const;
}

/**
 * Pre-materialization cancellation must stay classified as cancellation even
 * when the activation producer aborted with an ordinary Error reason; session
 * consumers and the endpoint UI key on `name === 'AbortError'`. Existing
 * AbortError reasons pass through verbatim; any other reason keeps its message
 * and is preserved as `cause` under the ordinary abort classification.
 */
function throwIfCancelled(signal: AbortSignal): void {
  if (!signal.aborted) return;
  const reason = signal.reason;
  if (reason instanceof Error && reason.name === 'AbortError') throw reason;
  throw Object.assign(
    new Error(reason instanceof Error ? reason.message : 'The operation was aborted'),
    { name: 'AbortError', cause: reason },
  );
}

async function requestJson(origin: string, path: string, init: RequestInit, signal: AbortSignal): Promise<unknown> {
  const response = await fetch(new URL(path, origin), { ...init, signal, redirect: 'error' });
  if (!response.ok) throw new EphemeralRunnerControlHttpError(response.status);
  return await response.json();
}

/** Real standalone composition over the reviewed activation, readiness, and ordinary Session owners. */
export async function createProductionEphemeralRunnerApplication(input: Readonly<{
  activationFilePath: string;
  signal?: AbortSignal;
}>) {
  const document = await readStrictEphemeralRunnerActivationDocument(input.activationFilePath);
  let activeConnection: ReturnType<typeof createEphemeralRunnerHttpControlConnection> | null = null;
  let activeRuntimeOrigin: string | null = null;
  const dependencies: EphemeralRunnerDependencies<RunnerLaunchManifestV1, Materialized, Preparation> = {
    createConnection: async ({ home, homeDirectory, binding, activationSecretKey, installation, signal }) => {
      const acquired = await acquireTerminalAuthEnrollmentRuntime(
        home,
        undefined,
        signal,
        { happyHomeDir: homeDirectory },
      );
      if (!acquired.ok) throw new Error(`runner_home_${acquired.reason}`);
      const installationSecretKey = decodeBase64(installation.privateKey, 'base64url');
      let handedOff = false;
      try {
        const connection = createEphemeralRunnerHttpControlConnection({
          activationId: binding.activationId,
          expectedBinding: binding,
          request: async (path, init, requestSignal) => await requestJson(acquired.runtime.runtimeOrigin, path, init, requestSignal),
          createProjectionProof: (launchManifestCommitment) => signRunnerEndpointProjectionProofV1({
            payload: {
              v: 1,
              purpose: 'happier.ephemeral-session-runner.endpoint-projection',
              activationId: binding.activationId,
              sessionId: binding.sessionId,
              machineId: binding.machineId,
              launchManifestCommitment,
              creatorTokenEpoch: binding.creatorTokenEpoch,
            },
            activationSecretKey,
            installationSecretKey,
          }),
          createProgressProof: (phase) => signRunnerActivationProgressUpdateV1({
            payload: {
              v: 1,
              purpose: 'happier.ephemeral-session-runner.activation-progress',
              activationId: binding.activationId,
              sessionId: binding.sessionId,
              machineId: binding.machineId,
              creatorTokenEpoch: binding.creatorTokenEpoch,
              phase,
            },
            activationSecretKey,
            installationSecretKey,
          }),
          closeTransport: async () => {
            installationSecretKey.fill(0);
            await acquired.close();
          },
        });
        signal.throwIfAborted();
        activeConnection = connection;
        activeRuntimeOrigin = acquired.runtime.runtimeOrigin;
        handedOff = true;
        return connection;
      } finally {
        if (!handedOff) {
          installationSecretKey.fill(0);
          await acquired.close().catch(() => undefined);
        }
      }
    },
    prepareAgent: async ({ manifest, environment, homeDirectory, signal }) => {
      const platform = resolvePlatformFromNodePlatform(process.platform);
      if (!platform) throw new Error('runner_platform_unsupported');
      const target = manifest.preparedAuthoring.authoring.agentTarget!;
      const pluginRuntime = await acquireReviewedRunnerPluginRuntimeLease({
        happyHomeDir: homeDirectory,
        target,
        scopedActionRuntime: {
          credentials: null,
          actionsSettingsProvider: createScopedRuntimeActionSettingsProvider(
            manifest.preparedAuthoring.actionsSettings,
          ),
        },
        signal,
      });
      try {
        const managed = await prepareManagedAgentCliLaunch({
          runtimeSpec: pluginRuntime.selected.runtimeSpec,
          platform,
          processEnv: environment,
          signal,
        });
        if (!managed.ok) throw new Error(`runner_agent_preparation_${managed.errorCode}`);
        return Object.freeze({ managed, pluginRuntime, homeDirectory });
      } catch (error) {
        await pluginRuntime.release().catch(() => undefined);
        throw error;
      }
    },
    releasePreparation: async ({ preparation }) => await preparation.pluginRuntime.release(),
    checkNonInferenceReadiness: async ({
      binding,
      claim,
      manifest,
      launchManifestCommitment,
      activationSecretKey,
      installationSecretKey,
      homeDirectory,
      preparation,
      signal,
    }) => {
      const projection = activeConnection?.readBrokerReadinessProjection() ?? null;
      if (!projection) return { status: 'unavailable', reason: 'broker_readiness_projection_unavailable' };
      return await checkProductionRunnerBrokerReadiness({
        binding,
        claim,
        manifest,
        launchManifestCommitment,
        activationSecretKey,
        installationSecretKey,
        preparation,
        projection,
        happyHomeDir: homeDirectory,
        signal,
      });
    },
    materialize: async ({ binding, claim, manifest, launchManifestCommitment, runnerBoxSecretKey, preparation, signal }) => {
      if (!activeConnection || !activeRuntimeOrigin) throw new Error('runner_control_connection_unavailable');
      const projected = await activeConnection.waitForMaterialization({ launchManifestCommitment, signal });
      const sealed = openBoxBundleWithSecretKey({
        bundle: decodeBase64(projected.sealedBootstrap, 'base64url'),
        recipientSecretKey: runnerBoxSecretKey,
      });
      if (!sealed) throw new Error('runner_runtime_bootstrap_invalid');
      let bootstrapDocument: unknown;
      try {
        bootstrapDocument = JSON.parse(new TextDecoder().decode(sealed));
      } catch {
        throw new Error('runner_runtime_bootstrap_invalid');
      } finally {
        sealed.fill(0);
      }
      const bootstrap = openVerifiedRunnerRuntimeBootstrap({
        bootstrap: bootstrapDocument,
        expected: {
          homeServerIdentityId: binding.homeServerIdentityId,
          activationId: binding.activationId,
          creatorAccountId: binding.creatorAccountId,
          sessionId: binding.sessionId,
          machineId: binding.machineId,
          installationId: claim.payload.installation.installationId,
          launchManifestCommitment,
          reviewedMachineContentKeyBinding: manifest.machineContentKeyBinding,
          ...(binding.endpointFactsRecipient.mode === 'e2ee'
            ? { accountSigningPublicKeyBase64Url: binding.endpointFactsRecipient.accountSigningPublicKey }
            : {}),
        },
      });
      const connectedAccountsAuthority = createRunnerConnectedAccountsAuthorityV1({
        sessionId: binding.sessionId,
        bindings: manifest.preparedAuthoring.authoring.connectedServices ?? { v: 2, bindingsByServiceId: {} },
      });
      const actionsSettingsProvider = createScopedRuntimeActionSettingsProvider(
        manifest.preparedAuthoring.actionsSettings,
      );
      let pluginRuntime: ReviewedRunnerPluginRuntimeHandle | null = null;
      try {
        pluginRuntime = await acquireReviewedRunnerPluginRuntimeLease({
          happyHomeDir: preparation.homeDirectory,
          target: manifest.preparedAuthoring.authoring.agentTarget!,
          connectedAccounts: connectedAccountsAuthority.owner,
          scopedActionRuntime: {
            credentials: { token: projected.runtimeToken, encryption: null },
            actionsSettingsProvider,
          },
          signal,
        });
        if (pluginRuntime.selected.immutableGenerationId !== preparation.pluginRuntime.selected.immutableGenerationId) {
          throw new Error('runner_reviewed_plugin_generation_changed');
        }
        connectedAccountsAuthority.bind({
          registry: pluginRuntime.lease.registry,
          agentId: pluginRuntime.selected.agentId,
        });
        const principal = VerifiedEphemeralSessionRunnerPrincipalSchema.parse({
          kind: 'ephemeral_session_runner',
          authority: 'session_runtime',
          accountId: binding.creatorAccountId,
          activationId: binding.activationId,
          sessionId: binding.sessionId,
          machineId: binding.machineId,
          installationId: claim.payload.installation.installationId,
          installationPublicKey: claim.payload.installation.publicKey,
          creatorTokenEpoch: binding.creatorTokenEpoch,
        });
        return Object.freeze({
          runtimeOrigin: activeRuntimeOrigin,
          runtimeToken: projected.runtimeToken,
          installationProof: claim.payload.installation.proof,
          bootstrap,
          principal,
          pluginRuntime,
          connectedAccountsAuthority,
        });
      } catch (error) {
        connectedAccountsAuthority.dispose();
        await pluginRuntime?.release().catch(() => undefined);
        if (bootstrap.mode === 'e2ee') {
          bootstrap.machineContentKey.fill(0);
          bootstrap.sessionDataEncryptionKey.fill(0);
        }
        throw error;
      }
    },
    startSession: async ({ binding, manifest, materialized, preparation, localState, signal, onRuntimeStopReady }) => {
      const executionTarget = manifest.preparedAuthoring.authoring.executionTarget;
      if (executionTarget?.kind !== 'temporary_computer') {
        throw new Error('runner_execution_target_invalid');
      }
      const runnerServerId = executionTarget.serverId;
      // Once materialization has committed, cancellation is an ordinary
      // Session/process Stop. This controller cancels only construction work;
      // semantic Session end remains owned by the ordinary Session client.
      const postMaterializationStartupAbortController = new AbortController();
      const postMaterializationSignal = postMaterializationStartupAbortController.signal;
      const connectedAccountMaterializationAbortController = new AbortController();
      let requestRuntimeStop: (() => Promise<void>) | null = null;
      let runtimeEnded = false;
      let terminalForStop: Promise<Readonly<{ status: 'completed' }> | Readonly<{ status: 'failed'; error: Error }>> | null = null;
      let stopPromise: Promise<void> | null = null;
      let terminalizeBeforeHostPromise: Promise<void> | null = null;
      const actionsSettingsProvider = createScopedRuntimeActionSettingsProvider(
        manifest.preparedAuthoring.actionsSettings,
      );
      const terminalizeBeforeHostOnce = (): Promise<void> => {
        terminalizeBeforeHostPromise ??= terminateRestrictedMaterializedSession({
          principal: materialized.principal,
          serverId: runnerServerId,
          runtimeOrigin: materialized.runtimeOrigin,
          runtimeToken: materialized.runtimeToken,
          transportEnvironment: localState.environment,
          actionsSettingsProvider,
          workingDirectory: manifest.endpointFacts.directory,
          homeDirectory: localState.homeDirectory,
          sessionAttachSecret: materialized.bootstrap.mode === 'plain'
            ? { encryptionMode: 'plain' }
            : {
                encryptionMode: 'e2ee',
                encryptionKey: materialized.bootstrap.sessionDataEncryptionKey,
                encryptionVariant: 'dataKey',
              },
        });
        return terminalizeBeforeHostPromise;
      };
      const stopOrdinarySessionOnce = (): Promise<void> => {
        if (runtimeEnded) return terminalizeBeforeHostPromise ?? Promise.resolve();
        stopPromise ??= (async () => {
          postMaterializationStartupAbortController.abort(
            new Error('Ephemeral Runner ordinary Session Stop requested'),
          );
          connectedAccountMaterializationAbortController.abort();
          const runtimeStop = requestRuntimeStop;
          if (runtimeStop === null) {
            await terminalizeBeforeHostOnce();
            return;
          }
          await runtimeStop();
          await terminalForStop;
        })();
        return stopPromise;
      };
      onRuntimeStopReady(stopOrdinarySessionOnce);
      const requestStopAfterMaterialization = () => {
        postMaterializationStartupAbortController.abort(signal.reason);
        connectedAccountMaterializationAbortController.abort(signal.reason);
        void stopOrdinarySessionOnce().catch(() => undefined);
      };
      signal.addEventListener('abort', requestStopAfterMaterialization, { once: true });
      if (signal.aborted) requestStopAfterMaterialization();

      try {
      throwIfCancelled(postMaterializationSignal);
      const reviewedProviderSelection = manifest.reviewedProviderModel.selection;
      if (reviewedProviderSelection.deliveryMode !== 'brokered') {
        // Temporary-computer execution is defined around Lane 10's exact
        // Machine brokerage. Never reinterpret a creator-reviewed direct
        // disclosure as brokered execution at the endpoint.
        throw new Error('runner_provider_delivery_mode_changed');
      }
      if (manifest.preparedAuthoring.authoring.checkoutCreationDraft) throwIfCancelled(postMaterializationSignal);
      const preparedTarget = await prepareSessionCreationTarget({
        request: {
          directory: manifest.endpointFacts.directory,
          checkoutCreationDraft: manifest.preparedAuthoring.authoring.checkoutCreationDraft,
        },
      });
      if (!preparedTarget.ok) throw new Error(`runner_checkout_preparation_${preparedTarget.code}`);
      if (postMaterializationSignal.aborted && preparedTarget.checkout) {
        await rollbackSessionCreationTargetCheckout(preparedTarget.checkout);
        throwIfCancelled(postMaterializationSignal);
      }
      const runtimeDirectory = preparedTarget.directory;
      const sourceMaterial = createSessionFollowSourceMaterialResolver();
      const providerMachineRuntime = await createDaemonMachineIrohRuntime({
        happyHomeDir: localState.homeDirectory,
        relayConfig: readIrohRelayConfigFromEnv(localState.environment),
      }).catch((error) => {
        sourceMaterial.dispose();
        throw error;
      });
      if (!providerMachineRuntime.available) {
        try { sourceMaterial.dispose(); } finally { await providerMachineRuntime.shutdown(); }
        throw new Error('runner_provider_machine_runtime_unavailable');
      }
      const disposeBeforeMachineClient = async () => {
        try { sourceMaterial.dispose(); } finally { await providerMachineRuntime.shutdown(); }
      };
      const featureSnapshot = await fetchServerFeaturesSnapshot({
        serverUrl: materialized.runtimeOrigin,
        token: materialized.runtimeToken,
        signal: postMaterializationSignal,
      }).catch(async (error) => {
        await disposeBeforeMachineClient().catch(() => undefined);
        throw error;
      });
      if (featureSnapshot.status !== 'ready' || featureSnapshot.provenance !== 'authenticated') {
        await disposeBeforeMachineClient();
        throw new Error('runner_provider_trust_roots_unavailable');
      }
      const trustRoots = resolvePeerMediationTrustRoots(featureSnapshot, Date.now());
      let openProviderTunnel: ReturnType<typeof createProviderBrokerMachineCarrierTunnelOpen>;
      try {
        openProviderTunnel = createProviderBrokerMachineCarrierTunnelOpen({
          accountId: materialized.principal.accountId,
          localMachineId: materialized.principal.machineId,
          runtime: providerMachineRuntime,
          resolveTrustRoots: () => trustRoots,
        });
      } catch (error) {
        await disposeBeforeMachineClient().catch(() => undefined);
        throw error;
      }
      let providerBindingCleanup: (() => Promise<void>) | null = null;
      const machineServicesRegistration: {
        current: ReturnType<typeof registerRestrictedRunnerMachineServices> | null;
      } = { current: null };
      const disposeMachineServicesIfCreated = async () => {
        const acquired = machineServicesRegistration.current;
        if (acquired !== null) await acquired.dispose();
      };
      let machineRpc: ReturnType<typeof createRestrictedMachineRpcClient>;
      try {
        machineRpc = createRestrictedMachineRpcClient({
          principal: materialized.principal,
          homeServerIdentityId: binding.homeServerIdentityId,
          runtimeOrigin: materialized.runtimeOrigin,
          runtimeToken: materialized.runtimeToken,
          transportEnvironment: localState.environment,
          irohEndpointId: providerMachineRuntime.endpoint.endpointId,
          installationProof: materialized.installationProof,
          transport: materialized.bootstrap.mode === 'plain'
            ? { encryptionMode: 'plain' }
            : { encryptionMode: 'e2ee', encryptionKey: materialized.bootstrap.machineContentKey, encryptionVariant: 'dataKey' },
          registerHandlers: (rpc) => {
            machineServicesRegistration.current = registerRestrictedRunnerMachineServices({
              rpcHandlerManager: rpc,
              workingDirectory: runtimeDirectory,
              machineId: binding.machineId,
              sessionId: binding.sessionId,
              runtimeOrigin: materialized.runtimeOrigin,
              runtimeToken: materialized.runtimeToken,
              stopSession: async (sessionId) => {
                if (sessionId !== binding.sessionId) return { status: 'not_found' };
                if (runtimeEnded) return { status: 'stopped' };
                // Stop owns cancellation, terminalization and cleanup. The
                // restricted Machine RPC only requests it: awaiting readiness
                // would make pre-host startup unstoppable, while awaiting full
                // terminalization can deadlock on this in-flight RPC manager.
                void stopOrdinarySessionOnce().catch(() => undefined);
                return { status: 'requested' };
              },
            });
            registerRestrictedSessionFollowSourceKeyReceiver({
              destinationSessionId: binding.sessionId,
              rpc,
              sourceMaterial,
              onSourceMaterialInstalled: publishSessionFollowWakeInvalidation,
            });
          },
          onTerminalConnectionFailure: requestStopAfterMaterialization,
        });
      } catch (error) {
        await disposeMachineServicesIfCreated().catch(() => undefined);
        sourceMaterial.dispose();
        await providerMachineRuntime.shutdown();
        throw error;
      }
      const installedMachineServices = machineServicesRegistration.current;
      if (installedMachineServices === null) {
        await machineRpc.close().catch(() => undefined);
        sourceMaterial.dispose();
        await providerMachineRuntime.shutdown();
        throw new Error('runner_machine_services_not_registered');
      }
      let machineIrohIngress: Awaited<ReturnType<typeof startRestrictedRunnerMachineIrohIngress>> | null = null;
      let machineResourcesDisposed = false;
      const disposeMachineResources = async () => {
        if (machineResourcesDisposed) return;
        machineResourcesDisposed = true;
        try {
          await providerBindingCleanup?.();
        } finally {
          try {
            await machineIrohIngress?.stop();
          } finally {
            try {
              await machineRpc.close();
            } finally {
              try {
                await machineServicesRegistration.current?.dispose();
              } finally {
                try { sourceMaterial.dispose(); } finally { await providerMachineRuntime.shutdown(); }
              }
            }
          }
        }
      };
      try {
        machineIrohIngress = await startRestrictedRunnerMachineIrohIngress({
          accountId: materialized.principal.accountId,
          machineId: materialized.principal.machineId,
          serverFeatures: featureSnapshot.features,
          runtime: providerMachineRuntime,
          rpcHandlerManager: machineRpc.rpc,
          ensureDirectTransferListening: installedMachineServices.ensureDirectTransferListening,
        });
        await machineRpc.connect({ signal: postMaterializationSignal });
        throwIfCancelled(postMaterializationSignal);
      } catch (error) {
        await disposeMachineResources().catch(() => undefined);
        throw error;
      }
      const agentId = materialized.pluginRuntime.selected.agentId;
      const backendId = materialized.pluginRuntime.selected.backendId;
      const connectedAccountSnapshot = resolveQualifiedPurposeBindingSnapshotForAgentSpawn({
        agentId,
        bindings: manifest.preparedAuthoring.authoring.connectedServices ?? { v: 2, bindingsByServiceId: {} },
        contributions: materialized.pluginRuntime.lease.registry.contributes,
      });
      const connectedAccountCredentialFileCleanups: Array<() => void | Promise<void>> = [];
      let plan: Awaited<ReturnType<SessionHostBridge['createSessionRuntime']>>;
      try {
        plan = await runWithServerHttpBaseUrl(materialized.runtimeOrigin, async () => await new SessionHostBridge().createSessionRuntime(backendId, {
        credentials: { token: materialized.runtimeToken, encryption: null },
        happyHomeDir: localState.homeDirectory,
        agentCliLaunch: bindAgentCliLaunchSpec({
          localAgentId: materialized.pluginRuntime.selected.localId,
          spec: preparation.managed.launch,
        }),
        directory: runtimeDirectory,
        backendTarget: manifest.preparedAuthoring.authoring.agentTarget,
        startedBy: 'terminal',
        terminalRuntime: resolveReviewedTerminalRuntime(manifest.preparedAuthoring.authoring.terminal),
        startingMode: 'remote',
        permissionMode: manifest.preparedAuthoring.authoring.permissionMode,
        profileId: manifest.preparedAuthoring.authoring.profileId,
        ...(manifest.preparedAuthoring.authoring.resumeSessionId
          ? { resume: manifest.preparedAuthoring.authoring.resumeSessionId }
          : {}),
        ...(manifest.preparedAuthoring.authoring.modelSelection ? { modelSelection: manifest.preparedAuthoring.authoring.modelSelection } : {}),
        ...(manifest.preparedAuthoring.authoring.acpSessionModeId
          ? { sessionModeId: manifest.preparedAuthoring.authoring.acpSessionModeId }
          : {}),
        ...(manifest.preparedAuthoring.authoring.sessionConfigOptionOverrides
          ? { sessionConfigOptionOverrides: manifest.preparedAuthoring.authoring.sessionConfigOptionOverrides }
          : {}),
        teamCredentialBindings: [{
          v: 1,
          slot: { kind: 'provider_model' },
          resourceId: manifest.credentialSelectionBinding.resourceId,
          expectedResourceRevision: manifest.credentialSelectionBinding.revision,
          deliveryMode: reviewedProviderSelection.deliveryMode,
        }],
        // Materialization has already atomically applied the reviewed audience
        // while creating this Session. This runtime attaches to that exact
        // Session and must never present a second initial-access create path.
        primaryTeamId: manifest.preparedAuthoring.authoring.primaryTeamId,
        ...(manifest.preparedAuthoring.authoring.organizationPlacement ? { organizationPlacement: manifest.preparedAuthoring.authoring.organizationPlacement } : {}),
        existingSessionId: binding.sessionId,
        sessionAttachSecret: materialized.bootstrap.mode === 'plain'
          ? { encryptionMode: 'plain' }
          : { encryptionMode: 'e2ee', encryptionKey: materialized.bootstrap.sessionDataEncryptionKey, encryptionVariant: 'dataKey' },
        environmentVariables: {
          ...Object.fromEntries(
            Object.entries(localState.environment).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
          ),
          ...filterRunnerReviewedEnvironmentVariablesV1(
            manifest.preparedAuthoring.authoring.environmentVariables ?? {},
          ),
        },
        unsetEnvironmentVariables: localState.unsetEnvironmentVariables,
        ...(connectedAccountSnapshot ? {
          resolveLateEnvironment: async () => {
            const credentialFileOwner = materialized.pluginRuntime.lease.registry
              .resolveManagedServiceCredentialFileOwner?.();
            const environmentVariables = await materializeQualifiedConnectedAccountLaunchUses({
              connectedAccountsOwner: materialized.connectedAccountsAuthority.owner,
              credentialFileOwner,
              snapshot: connectedAccountSnapshot,
              sessionId: binding.sessionId,
              signal: connectedAccountMaterializationAbortController.signal,
              credentialFileScope: {
                generation: materialized.pluginRuntime.selected.immutableGenerationId ?? 'bundled',
                pluginId: materialized.pluginRuntime.selected.pluginId,
                contributionQualifiedId: resolveAgentContributionQualifiedId({
                  pluginId: materialized.pluginRuntime.selected.pluginId,
                  localId: materialized.pluginRuntime.selected.localId,
                }),
                operationId: binding.activationId,
              },
              retainCredentialFileCleanup(cleanup) {
                connectedAccountCredentialFileCleanups.push(() => cleanup.dispose());
              },
            });
            return Object.freeze({
              environmentVariables,
              unsetEnvironmentVariables: Object.freeze([]),
              sensitiveEnvironmentVariableNames: Object.freeze(Object.keys(environmentVariables)),
              sessionConnectedAccounts: materialized.connectedAccountsAuthority.resolveSessionConnectedAccounts(),
            });
          },
        } : {}),
      }, {
        pluginRuntimeRegistryLease: materialized.pluginRuntime.lease,
        prepareTeamCredentialProviderBinding: async ({
          sessionId,
          resourceId,
          expectedResourceRevision,
          agentTargetKey,
          modelId,
          signal: bindingSignal,
        }) => {
          if (providerBindingCleanup) throw new Error('runner_provider_binding_already_open');
          const reviewed = manifest.reviewedProviderModel;
          if (
            sessionId !== binding.sessionId
            || resourceId !== manifest.credentialSelectionBinding.resourceId
            || expectedResourceRevision !== manifest.credentialSelectionBinding.revision
            || reviewed.selection.resourceId !== manifest.credentialSelectionBinding.resourceId
            || reviewed.selection.expectedResourceRevision !== manifest.credentialSelectionBinding.revision
            || reviewed.selection.agentTargetKey !== agentTargetKey
            || reviewed.selection.modelId !== modelId
            || reviewed.sourceRevision !== manifest.credentialSelectionBinding.sourceRevision
            || !isSameTeamCredentialBrokerApplication(
              reviewed.application,
              manifest.credentialSelectionBinding.application,
            )
          ) throw new Error('runner_provider_model_selection_changed');
          const opened = await openExactSessionTeamCredentialProviderBinding({
            sessionId,
            machineId: materialized.principal.machineId,
            agentId,
            selection: {
              resourceId: manifest.credentialSelectionBinding.resourceId,
              brokerMachineId: manifest.credentialSelectionBinding.brokerMachineId,
              expectedResourceRevision: manifest.credentialSelectionBinding.revision,
              agentTargetKey: reviewed.selection.agentTargetKey,
              modelId: reviewed.selection.modelId,
              descriptor: reviewed.descriptor,
              application: manifest.credentialSelectionBinding.application,
              sourceRevision: manifest.credentialSelectionBinding.sourceRevision,
            },
            lease: materialized.pluginRuntime.lease,
            materializationBaseDir: join(localState.homeDirectory, 'providers', 'materialized'),
            signal: bindingSignal,
            openBroker: async (request, requestSignal) =>
              await openTeamCredentialProviderBroker({
                serverBaseUrl: materialized.runtimeOrigin,
                token: materialized.runtimeToken,
                request,
                signal: requestSignal,
              }),
            openTunnel: openProviderTunnel,
          });
          providerBindingCleanup = opened.cleanup;
          return opened;
        },
      }));
      } catch (error) {
        await disposeMachineResources().catch(() => undefined);
        throw error;
      }
      // The creator-reviewed policy is sealed into the launch manifest. The
      // endpoint cannot replace it with ambient Account settings or environment.
      const resolvedMcpServers = await materializeRunnerMcpMaterial({
        material: manifest.preparedAuthoring.mcpMaterial,
        directory: runtimeDirectory,
        processEnv: localState.environment,
        tmpDir: join(localState.homeDirectory, 'tmp'),
      }).catch(async (error) => {
        await disposeMachineResources().catch(() => undefined);
        throw error;
      });
      try {
        throwIfCancelled(postMaterializationSignal);
      } catch (error) {
        await disposeMachineResources().catch(() => undefined);
        throw error;
      }
      const terminal = runWithServerHttpBaseUrl(materialized.runtimeOrigin, async () => {
        try {
          await runHostSessionRuntimePlan({
            ...plan,
            config: {
              ...plan.config,
              processLifecycleOwnership: 'caller',
              runtimeActionSettingsProvider: actionsSettingsProvider,
              resolvedMcpServers,
              sessionFollowSourceMaterialResolver: sourceMaterial,
              // A restricted Runner receives only the shared Session metadata
              // projection, which deliberately omits the owner-private path.
              // The endpoint-reviewed directory remains the runtime authority.
              resolveRuntimeDirectory: () => runtimeDirectory,
              startupBootstrap: {
                create: async ({ opts, seed, createPreparedDeferredStartupBootstrap }) =>
                  await createPreparedDeferredStartupBootstrap({
                    credentials: opts.credentials,
                    flavor: plan.config.flavor,
                    workingDirectory: opts.directory ?? manifest.endpointFacts.directory,
                    startedBy: opts.startedBy === 'daemon' ? 'daemon' : 'terminal',
                    initialMachineId: materialized.principal.machineId,
                    machineMetadata: plan.config.machineMetadata,
                    uiLogPrefix: plan.config.uiLogPrefix,
                    timingLogPrefix: `${plan.config.uiLogPrefix} Runner startup`,
                    initialPermissionMode: seed.permissionMode,
                    explicitPermissionMode: seed.permissionMode,
                    explicitPermissionModeUpdatedAt: seed.permissionModeUpdatedAt,
                    sessionModeId: opts.sessionModeId,
                    sessionModeUpdatedAt: opts.sessionModeUpdatedAt,
                    modelSelection: seed.modelSelection ?? undefined,
                    terminalRuntime: opts.terminalRuntime ?? null,
                    launchControlMetadata: opts.launchControlMetadata,
                    existingSessionId: binding.sessionId,
                    sessionAttachSecret: opts.sessionAttachSecret,
                    startupSideEffectsOrder: 'persist-first',
                    initializeBackendApiContext:
                      createRestrictedSessionBackendApiContextInitializer({
                        principal: materialized.principal,
                        serverId: runnerServerId,
                        runtimeOrigin: materialized.runtimeOrigin,
                        runtimeToken: materialized.runtimeToken,
                        transportEnvironment: localState.environment,
                        actionsSettingsProvider,
                        onSessionFollowInvalidated: publishSessionFollowWakeInvalidation,
                        installSessionFollowWakeReceiver: machineRpc.installSessionFollowWakeReceiver,
                      }),
                  }),
              },
              createSendReady: ({ session }) => createReadyNotificationDispatcher({
                session,
                pushSender: null,
                waitingForCommandLabel: plan.config.waitingForCommandLabel,
                logPrefix: plan.config.uiLogPrefix,
                includeAssistantPreviewText: false,
              }),
              onRuntimeStopReady: (stop) => {
                requestRuntimeStop = stop;
              },
            },
          });
          return { status: 'completed' as const };
        } catch (error) {
          const runtimeError = error instanceof Error ? error : new Error('Runner Session failed');
          try {
            const runtimeStop = requestRuntimeStop;
            if (runtimeStop) {
              await runtimeStop();
            } else {
              await terminalizeBeforeHostOnce();
            }
            return { status: 'failed' as const, error: runtimeError };
          } catch (terminalError) {
            return {
              status: 'failed' as const,
              error: terminalError instanceof Error
                ? terminalError
                : new Error('Runner Session terminalization failed'),
            };
          }
        } finally {
          runtimeEnded = true;
          connectedAccountMaterializationAbortController.abort();
          signal.removeEventListener('abort', requestStopAfterMaterialization);
          await disposeMachineResources().catch(() => undefined);
          await Promise.allSettled(connectedAccountCredentialFileCleanups.splice(0).map(async (cleanup) => await cleanup()));
        }
      });
      terminalForStop = terminal;
      const handle = Object.freeze({
        terminal,
        stop: stopOrdinarySessionOnce,
      });
      return handle;
      } catch (error) {
        postMaterializationStartupAbortController.abort(error);
        runtimeEnded = true;
        signal.removeEventListener('abort', requestStopAfterMaterialization);
        try {
          await terminalizeBeforeHostOnce();
        } catch (terminalError) {
          throw terminalError;
        }
        throw error;
      }
    },
    releaseMaterialized: async ({ materialized }) => {
      materialized.connectedAccountsAuthority.dispose();
      await materialized.pluginRuntime.release().catch(() => undefined);
      if (materialized.bootstrap.mode === 'e2ee') {
        materialized.bootstrap.machineContentKey.fill(0);
        materialized.bootstrap.sessionDataEncryptionKey.fill(0);
      }
    },
  };
  return Object.freeze({
    artifact: document.activation.artifact,
    dependencies,
    ui: process.env.HAPPIER_RUNNER_NATIVE_SHELL === 'stdio'
      ? createEphemeralRunnerNativeShellUi(createEphemeralRunnerNativeShellStdioTransport())
      : createEphemeralRunnerTerminalUi({
      activation: {
        homeServerIdentityId: document.home.homeServerIdentityId,
        creatorAccountId: document.activation.creatorAccountId,
        artifact: document.activation.artifact,
      },
    }),
  });
}
