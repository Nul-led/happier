import type {
  IrohProviderBrokerHandshakeV1,
  ProviderBrokerAdmissionFailureCodeV1,
  ProviderBrokerApplicationBindingV1,
  ProviderBrokerRelayApplicationBindingV1,
  ProviderBrokerRequestAdmissionResponseV1,
  PeerTcpTunnelRelayAuthorizationV2,
  SignedProviderBrokerRouteGrantV1,
} from '@happier-dev/protocol';
import { encodeProviderBrokerAuthorityV1 } from '@happier-dev/protocol';
import {
  DaemonProviderTeamCredentialBrokerEligibilityResponseV1Schema,
  type DaemonProviderTeamCredentialBrokerEligibilityRequestV1,
  type DaemonProviderTeamCredentialBrokerEligibilityResponseV1,
} from '@happier-dev/protocol/rpc';

import {
  verifyProviderBrokerRouteGrantV1,
  type ProviderBrokerRouteGrantVerificationResultV1,
} from '@/daemon/peer/mediation/verifyProviderBrokerRouteGrantV1';
import type { DirectRouteGrantTrustRoot } from '@/daemon/peer/mediation/verifyRouteGrantSignature';
import { startProviderBrokerApplicationServer } from './providerBrokerApplicationServer';
import {
  createProviderBrokerRequestHandler,
  type ProviderBrokerApplicationStreamLifetime,
  type ProviderBrokerExternalRequestPolicySnapshot,
  type ProviderBrokerModelCatalogAuthorization,
  type ProviderBrokerRequestAdmission,
  type TeamCredentialRequestModelCatalog,
} from './providerBrokerRequestHandler';
import type {
  TeamCredentialExternalProviderAdmissionResponseV1,
  TeamCredentialExternalProviderTerminalUsageResponseV1,
  TeamCredentialExternalProviderTerminalUsageV1,
  TeamCredentialRequestPolicyV1,
  TeamCredentialResourceSummaryV1,
  TeamCredentialResourceTestAdmissionResponseV1,
} from '@happier-dev/protocol/teams';
import type { RunnerCredentialSelectionBindingV1 } from '@happier-dev/protocol/ephemeralRunner/review';
import type { ManagedServiceRequest, ManagedServiceResponse } from '@happier-dev/plugin-sdk/managed-services';
import type { ManagedProviderEndpointHttpAccess } from '@/plugins/runtime/invocation/services/managedServicesAdapter';
import {
  teamCredentialBrokerPlacementAcceptsMachine,
  type TeamCredentialBrokerSourceOwner,
} from './teamCredentialBrokerSourceOwner';

type SelectedProviderBrokerRequestAdmission = ProviderBrokerRequestAdmission & Readonly<{
  sourceMemberKey: string;
}>;

type VerifiedAuthority = Extract<
  ProviderBrokerRouteGrantVerificationResultV1,
  Readonly<{ valid: true }>
>;

type ProviderBrokerApplicationTargetInput = Readonly<{
  handshake: IrohProviderBrokerHandshakeV1;
  authority: SignedProviderBrokerRouteGrantV1;
  authenticatedRemoteEndpointId: string;
  localEndpointId: string;
  signal: AbortSignal;
}>;

/** Receiver-side resource check for the exact daemon addressed by the signed
 * relay request. Pool selection and membership currentness remain Home-owned;
 * this boundary only permits that selected Machine to reach fresh admission. */
export function daemonExternalProviderRequestPolicyAcceptsResource(input: Readonly<{
  resource: Pick<
    TeamCredentialResourceSummaryV1,
    'enabled' | 'teamId' | 'brokerPlacement' | 'source'
  > | null;
  bindingTeamId: string;
  registeredMachineId: string;
}>): boolean {
  const { resource } = input;
  return resource !== null
    && resource.enabled
    && resource.teamId === input.bindingTeamId
    && teamCredentialBrokerPlacementAcceptsMachine(
      resource.brokerPlacement,
      input.registeredMachineId,
    )
    && resource.source !== null;
}

type RunnerCredentialSelectionCurrentnessInput = Readonly<{
  registeredMachineId: string;
  selection: RunnerCredentialSelectionBindingV1;
  modelId: string;
  signal: AbortSignal;
  readResource(
    resourceId: string,
    signal: AbortSignal,
  ): Promise<TeamCredentialResourceSummaryV1 | null>;
  resolveEligibility(
    request: DaemonProviderTeamCredentialBrokerEligibilityRequestV1,
    signal?: AbortSignal,
  ): Promise<DaemonProviderTeamCredentialBrokerEligibilityResponseV1>;
}>;

/** Rechecks one Runner's already frozen exact broker Machine against that
 * Machine's canonical current-only source eligibility owner. Pool membership
 * selected the Machine on the Home; it is intentionally neither enumerated nor
 * ranked again here. */
export async function resolveRunnerCredentialSelectionCurrentness(
  input: RunnerCredentialSelectionCurrentnessInput,
): Promise<'available' | 'source_unavailable' | 'update_required'> {
  input.signal.throwIfAborted();
  if (input.selection.brokerMachineId !== input.registeredMachineId) {
    return 'source_unavailable';
  }
  const resource = await input.readResource(input.selection.resourceId, input.signal);
  input.signal.throwIfAborted();
  if (
    !resource
    || !resource.enabled
    || resource.revision !== input.selection.revision
    || !resource.source
    || !teamCredentialBrokerPlacementAcceptsMachine(
      resource.brokerPlacement,
      input.selection.brokerMachineId,
    )
  ) return 'source_unavailable';

  let rawEligibility: DaemonProviderTeamCredentialBrokerEligibilityResponseV1;
  try {
    rawEligibility = await input.resolveEligibility({
      machineId: input.selection.brokerMachineId,
      teamId: resource.teamId,
      resourceId: resource.id,
      expectedResourceRevision: resource.revision,
      source: resource.source,
      application: input.selection.application,
      modelId: input.modelId,
      sourceRevision: input.selection.sourceRevision,
    }, input.signal);
  } catch {
    input.signal.throwIfAborted();
    return 'source_unavailable';
  }
  input.signal.throwIfAborted();
  const eligibility = DaemonProviderTeamCredentialBrokerEligibilityResponseV1Schema.safeParse(rawEligibility);
  if (!eligibility.success) return 'source_unavailable';
  if (eligibility.data.status === 'eligible') return 'available';
  return eligibility.data.reason === 'application_unavailable'
    ? 'update_required'
    : 'source_unavailable';
}

export type DaemonProviderBrokerRuntime = Readonly<{
  checkRunnerCredentialSelectionCurrentness(
    input: Readonly<{
      selection: RunnerCredentialSelectionBindingV1;
      modelId: string;
    }>,
    signal: AbortSignal,
  ): Promise<'available' | 'source_unavailable' | 'update_required'>;
  resolveProviderBrokerApplicationTarget(
    input: ProviderBrokerApplicationTargetInput,
  ): Promise<Readonly<{ port: number; localCapability: string }> | null>;
  resolveExternalProviderBrokerApplicationTarget(input: Readonly<{
    binding: ProviderBrokerRelayApplicationBindingV1;
    relayAuthorization?: PeerTcpTunnelRelayAuthorizationV2;
  }>): Promise<Readonly<{ port: number; localCapability: string }> | null>;
  close(): Promise<void>;
}>;

function expectedBinding(authority: SignedProviderBrokerRouteGrantV1) {
  return {
    teamId: authority.payload.teamId,
    resourceId: authority.payload.resourceId,
    expectedResourceRevision: authority.payload.expectedResourceRevision,
    modelId: authority.payload.modelId,
    sourceRevision: authority.payload.sourceRevision,
    initiator: authority.payload.initiator,
    target: authority.payload.target,
    consumer: authority.payload.consumer,
    application: authority.payload.application,
  } as const;
}

async function responseWithCleanup(
  response: ManagedServiceResponse,
  cleanup: () => Promise<void>,
): Promise<ManagedServiceResponse> {
  if (!response.body) {
    await cleanup().catch(() => undefined);
    return response;
  }
  const source = response.body;
  const reader = source.getReader();
  let finalized = false;
  const finalize = async (): Promise<void> => {
    if (finalized) return;
    finalized = true;
    reader.releaseLock();
    await cleanup().catch(() => undefined);
  };
  return {
    ...response,
    body: new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          const next = await reader.read();
          if (next.done) {
            controller.close();
            await finalize();
            return;
          }
          controller.enqueue(next.value);
        } catch (error) {
          controller.error(error);
          await finalize();
        }
      },
      async cancel(reason) {
        await reader.cancel(reason).catch(() => undefined);
        await finalize();
      },
    }),
  };
}

/** One private application stream owns one operation-scoped managed Provider
 * projection. Home still admits every request. Connected Pools re-enter their
 * canonical selector before each admission so normal source-owner switching
 * does not strand the stream on a stale member. */
export function createPrivateProviderBrokerStreamLifetime(input: Readonly<{
  sourceOwner: TeamCredentialBrokerSourceOwner;
  application: ProviderBrokerApplicationBindingV1;
}>): ProviderBrokerApplicationStreamLifetime {
  const lifetimeController = new AbortController();
  let bindingKey: string | null = null;
  let projectionPromise: Promise<Awaited<ReturnType<TeamCredentialBrokerSourceOwner['acquire']>> | null> | null = null;
  let currentPoolSource: Extract<Awaited<ReturnType<TeamCredentialBrokerSourceOwner['acquire']>>, { ok: true }> | null = null;
  let poolRefreshChain: Promise<void> = Promise.resolve();
  let selectedResult: Readonly<{ access: ManagedProviderEndpointHttpAccess; sourceMemberKey: string }> | null = null;
  let retired = false;
  let released = false;
  let closeInFlight: Promise<void> | null = null;

  const retireAcquired = async (
    acquired: Extract<Awaited<ReturnType<TeamCredentialBrokerSourceOwner['acquire']>>, { ok: true }> | null,
  ): Promise<void> => {
    if (!acquired) return;
    try {
      await acquired.retire();
    } finally {
      await acquired.projection.cleanup();
    }
  };

  const releaseProjection = async (
    acquired: Extract<Awaited<ReturnType<TeamCredentialBrokerSourceOwner['acquire']>>, { ok: true }> | null,
  ): Promise<void> => {
    if (acquired) await acquired.projection.cleanup();
  };

  const close = (): Promise<void> => {
    if (released) return Promise.resolve();
    retired = true;
    lifetimeController.abort();
    closeInFlight ??= (async () => {
      await poolRefreshChain.catch(() => undefined);
      if (currentPoolSource) {
        const acquired = currentPoolSource;
        currentPoolSource = null;
        await retireAcquired(acquired);
        return;
      }
      const acquired = await projectionPromise?.catch(() => null);
      if (acquired?.ok) await retireAcquired(acquired);
    })().then(
      () => {
        released = true;
        closeInFlight = null;
      },
      (error: unknown) => {
        closeInFlight = null;
        throw error;
      },
    );
    return closeInFlight;
  };

  return Object.freeze({
    async acquireSource({ source, resourceId, brokerMachineId, operation, expectedResourceRevision, application, modelId, sourceRevision }) {
      if (retired) return null;
      const nextBindingKey = JSON.stringify([
        resourceId,
        expectedResourceRevision,
        brokerMachineId,
        operation,
        source,
        application,
        modelId,
        sourceRevision,
      ]);
      if (bindingKey !== null && bindingKey !== nextBindingKey) {
        await close();
        return null;
      }
      if (source.kind === 'connected_pool') {
        bindingKey ??= nextBindingKey;
        let result: Readonly<{ access: ManagedProviderEndpointHttpAccess; sourceMemberKey: string }> | null = null;
        const refresh = async (): Promise<void> => {
          if (retired) return;
          let acquired = await input.sourceOwner.acquire({
            source,
            resourceId,
            resourceRevision: expectedResourceRevision,
            brokerMachineId,
            operation,
            application: input.application,
            modelId,
            sourceRevision,
            signal: lifetimeController.signal,
          }).catch(() => null);

          // A changed purpose-binding equality key makes the incumbent
          // managed-service owner retire A and reject that first B join. Drop
          // the old joined view, then re-enter the same source owner once so it
          // can establish the selector's still-current B. No request is
          // admitted with A after this refresh has failed.
          if (!acquired?.ok && currentPoolSource) {
            const previous = currentPoolSource;
            currentPoolSource = null;
            await retireAcquired(previous).catch(() => undefined);
            if (retired) return;
            acquired = await input.sourceOwner.acquire({
              source,
              resourceId,
              resourceRevision: expectedResourceRevision,
              brokerMachineId,
              operation,
              application: input.application,
              modelId,
              sourceRevision,
              signal: lifetimeController.signal,
            }).catch(() => null);
          }
          if (retired || !acquired?.ok || !acquired.projection.isCurrent()) {
            if (acquired?.ok) await retireAcquired(acquired).catch(() => undefined);
            return;
          }
          const previous = currentPoolSource;
          currentPoolSource = acquired;
          if (previous) await releaseProjection(previous);
          result = Object.freeze({
            access: acquired.projection.access,
            sourceMemberKey: acquired.sourceMemberKey,
          });
        };
        const queued = poolRefreshChain.then(refresh, refresh);
        poolRefreshChain = queued.then(() => undefined, () => undefined);
        await queued;
        return result;
      }
      if (!projectionPromise) {
        bindingKey = nextBindingKey;
        projectionPromise = input.sourceOwner.acquire({
          source,
          resourceId,
          resourceRevision: expectedResourceRevision,
          brokerMachineId,
          operation,
          application: input.application,
          modelId,
          sourceRevision,
          signal: lifetimeController.signal,
        }).catch(() => null);
      }
      const acquired = await projectionPromise;
      if (retired || !acquired?.ok || !acquired.projection.isCurrent()) {
        await close();
        return null;
      }
      selectedResult ??= Object.freeze({
        access: acquired.projection.access,
        sourceMemberKey: acquired.sourceMemberKey,
      });
      return selectedResult;
    },
    close,
  });
}

/**
 * Installs the target daemon's one Provider-broker application handler.
 * Mutable Home authority is resolved for every request; the only stream-local
 * state retained here is the transport-authenticated endpoint plus the exact
 * signed application binding admitted by machine/1.
 */
export async function startDaemonProviderBrokerRuntime(input: Readonly<{
  machineId: string;
  resolveTrustRoots: () => readonly DirectRouteGrantTrustRoot[];
  nowMs: () => number;
  verifyAuthority?: (input: Readonly<{
    authority: unknown;
    authenticatedRemoteEndpointId: string;
    expected: ReturnType<typeof expectedBinding>;
  }>) => ProviderBrokerRouteGrantVerificationResultV1;
  resolveRequestPolicy(input: Readonly<{
    authority: SignedProviderBrokerRouteGrantV1['payload'];
    request: ManagedServiceRequest;
  }>): Promise<Readonly<{
    resourceRevision: number;
    sourceRevision: string;
    application: ProviderBrokerApplicationBindingV1;
    policy: TeamCredentialRequestPolicyV1 | null;
    modelCatalog: TeamCredentialRequestModelCatalog;
    source: import('@happier-dev/protocol/teams').TeamCredentialSourceBindingV1;
  }> | null>;
  admitRequest(input: SelectedProviderBrokerRequestAdmission): Promise<ProviderBrokerRequestAdmissionResponseV1>;
  authorizeModelCatalog(input: Readonly<{
    authorization: ProviderBrokerModelCatalogAuthorization;
    expectedResourceRevision: number;
    request: ManagedServiceRequest;
  }>): Promise<Readonly<{ ok: true }> | Readonly<{
    ok: false;
    reasonCode: ProviderBrokerAdmissionFailureCodeV1;
  }>>;
  resolveExternalRequestPolicy?(input: Readonly<{
    binding: Extract<ProviderBrokerRelayApplicationBindingV1, { kind: 'external_api_key' }>;
    request: ManagedServiceRequest;
  }>): Promise<ProviderBrokerExternalRequestPolicySnapshot | null>;
  admitExternalRequest?(input: Readonly<{
    binding: Extract<ProviderBrokerRelayApplicationBindingV1, { kind: 'external_api_key' }>;
    expectedResourceRevision: number;
    application: ProviderBrokerApplicationBindingV1;
    requestFacts: ProviderBrokerRequestAdmission['requestFacts'];
    request: ManagedServiceRequest;
  }>): Promise<TeamCredentialExternalProviderAdmissionResponseV1>;
  revalidateExternalAuthorization?(input: Readonly<{
    binding: Extract<ProviderBrokerRelayApplicationBindingV1, { kind: 'external_api_key' }>;
    expectedResourceRevision: number;
    application: ProviderBrokerApplicationBindingV1;
    signal?: AbortSignal;
  }>): Promise<boolean>;
  retireExternalApiKey?(input: Readonly<{
    externalApiKeyId: string;
    application: ProviderBrokerApplicationBindingV1;
  }>): Promise<boolean>;
  recordExternalTerminalUsage?(
    request: TeamCredentialExternalProviderTerminalUsageV1,
  ): Promise<TeamCredentialExternalProviderTerminalUsageResponseV1>;
  resolveResourceTestRequestPolicy?(input: Readonly<{
    binding: Extract<ProviderBrokerRelayApplicationBindingV1, { kind: 'resource_test' }>;
    request: ManagedServiceRequest;
  }>): Promise<Readonly<{
    resourceRevision: number;
    policy: TeamCredentialRequestPolicyV1 | null;
    application: ProviderBrokerApplicationBindingV1;
    modelCatalog: TeamCredentialRequestModelCatalog;
  }> | null>;
  admitResourceTestRequest?(input: Readonly<{
    binding: Extract<ProviderBrokerRelayApplicationBindingV1, { kind: 'resource_test' }>;
    relayAuthorization: PeerTcpTunnelRelayAuthorizationV2;
    expectedResourceRevision: number;
    application: ProviderBrokerApplicationBindingV1;
    requestFacts: ProviderBrokerRequestAdmission['requestFacts'];
    request: ManagedServiceRequest;
  }>): Promise<TeamCredentialResourceTestAdmissionResponseV1>;
  sourceOwner: TeamCredentialBrokerSourceOwner;
  checkRunnerCredentialSelectionCurrentness?(input: Readonly<{
    selection: RunnerCredentialSelectionBindingV1;
    modelId: string;
    signal: AbortSignal;
  }>): Promise<'available' | 'source_unavailable' | 'update_required'>;
  createRequestId: () => string;
}>): Promise<DaemonProviderBrokerRuntime> {
  const verify = input.verifyAuthority ?? ((request): ProviderBrokerRouteGrantVerificationResultV1 =>
    verifyProviderBrokerRouteGrantV1({
      authority: request.authority,
      trustRoots: input.resolveTrustRoots(),
      nowMs: input.nowMs(),
      enforceExpiry: false,
      expected: request.expected,
      authenticatedRemoteEndpointId: request.authenticatedRemoteEndpointId,
    }));
  const retireExternalApiKey = async (request: Readonly<{
    binding: Extract<ProviderBrokerRelayApplicationBindingV1, { kind: 'external_api_key' }>;
    application: ProviderBrokerApplicationBindingV1;
  }>): Promise<void> => {
    const retire = input.retireExternalApiKey;
    if (!retire) return;
    await retire({
      externalApiKeyId: request.binding.externalApiKeyId,
      application: request.application,
    }).catch(() => false);
  };

  const handler = createProviderBrokerRequestHandler({
    resolveTrustRoots: input.resolveTrustRoots,
    nowMs: input.nowMs,
    verifyAuthority: (request) => verify({
      authority: request.authority,
      authenticatedRemoteEndpointId: request.authenticatedRemoteEndpointId,
      expected: request.expected,
    }),
    resolveRequestPolicy: input.resolveRequestPolicy,
    authorizeModelCatalog: async (request) => {
      const authorization = await input.authorizeModelCatalog(request);
      if (!authorization.ok && request.authorization.kind === 'external_api_key') {
        await retireExternalApiKey({
          binding: request.authorization.binding,
          application: request.authorization.application,
        });
      }
      return authorization;
    },
    ...(input.resolveExternalRequestPolicy ? {
      resolveExternalRequestPolicy: input.resolveExternalRequestPolicy,
    } : {}),
    ...(input.resolveResourceTestRequestPolicy ? {
      resolveResourceTestRequestPolicy: input.resolveResourceTestRequestPolicy,
    } : {}),
    createRequestId: input.createRequestId,
    admit: async (request) => {
      const selected = await request.streamLifetime?.acquireSource({
        source: request.selectedSource,
        resourceId: request.authority.payload.resourceId,
        brokerMachineId: request.authority.payload.target.machineId,
        operation: request.authority.payload.consumer,
        expectedResourceRevision: request.expectedResourceRevision,
        application: request.authority.payload.application,
        modelId: request.requestFacts.modelId,
        sourceRevision: request.expectedSourceRevision,
      });
      if (!selected) {
        return {
          ok: false as const,
          reasonCode: 'resource_unavailable' as const,
        };
      }
      const admitted = await input.admitRequest({ ...request, sourceMemberKey: selected.sourceMemberKey });
      if (!admitted.ok) return admitted;
      if (
        admitted.resourceId !== request.authority.payload.resourceId
        || admitted.brokerMachineId !== input.machineId
        || JSON.stringify(admitted.source) !== JSON.stringify(request.selectedSource)
        || JSON.stringify(admitted.operation) !== JSON.stringify(request.authority.payload.consumer)
      ) return { ok: false as const, reasonCode: 'resource_unavailable' as const };
      return {
        ok: true as const,
        access: selected.access,
      };
    },
    ...(input.admitExternalRequest ? {
      admitExternal: async (request) => {
        const admitted = await input.admitExternalRequest!(request);
        if (!admitted.ok) {
          await retireExternalApiKey({
            binding: request.binding,
            application: request.application,
          });
          return admitted;
        }
        const admissionUsageEventId = admitted.usageEventId;
        const terminalRequestId = admitted.terminalRequestId;
        const terminalUsage = admissionUsageEventId && terminalRequestId
          && input.recordExternalTerminalUsage
          ? {
              record: async ({ outcome }: Readonly<{ outcome: 'succeeded' | 'failed' | 'cancelled' }>) => {
                const result = await input.recordExternalTerminalUsage!({
                  v: 1,
                  admissionUsageEventId,
                  requestId: terminalRequestId,
                  brokerMachineId: admitted.brokerMachineId,
                  completedAtMs: input.nowMs(),
                  outcome,
                  measurement: 'unavailable',
                });
                if (!result.ok) throw new Error(`External terminal usage rejected: ${result.reasonCode}`);
              },
            }
          : undefined;
        const acquired = await input.sourceOwner.acquire({
          source: admitted.source,
          resourceId: admitted.resourceId,
          resourceRevision: request.expectedResourceRevision,
          brokerMachineId: admitted.brokerMachineId,
          operation: admitted.operation,
          application: request.application,
          ...(input.revalidateExternalAuthorization
            ? {
                revalidateOperationAuthorization: async (signal) =>
                  await input.revalidateExternalAuthorization!({
                    binding: request.binding,
                    expectedResourceRevision: request.expectedResourceRevision,
                    application: request.application,
                    ...(signal ? { signal } : {}),
                  }),
              }
            : {}),
          signal: request.request.signal ?? new AbortController().signal,
        });
        if (!acquired.ok) {
          await terminalUsage?.record({
            outcome: request.request.signal?.aborted ? 'cancelled' : 'failed',
          }).catch(() => undefined);
          return {
            ok: false as const,
            reasonCode: acquired.reasonCode === 'broker_machine_mismatch'
              ? 'broker_unavailable' as const
              : 'resource_unavailable' as const,
          };
        }
        let cleaned = false;
        const cleanup = async () => { if (!cleaned) { cleaned = true; await acquired.projection.cleanup(); } };
        return {
          ok: true as const,
          ...(terminalUsage ? { terminalUsage } : {}),
          access: {
            endpointUrl: acquired.projection.access.endpointUrl,
            async request(providerRequest: ManagedServiceRequest) {
              try {
                const response = await acquired.projection.access.request(providerRequest);
                return await responseWithCleanup(response, cleanup);
              } catch (error) {
                await cleanup().catch(() => undefined);
                throw error;
              }
            },
          },
        };
      },
    } : {}),
    ...(input.admitResourceTestRequest ? {
      admitResourceTest: async (request) => {
        const admitted = await input.admitResourceTestRequest!(request);
        if (!admitted.ok) return admitted;
        const acquired = await input.sourceOwner.acquire({
          source: admitted.source,
          resourceId: admitted.resourceId,
          resourceRevision: admitted.resourceRevision,
          brokerMachineId: admitted.brokerMachineId,
          operation: {
            ...admitted.operation,
            requestId: request.binding.requestId,
          },
          application: request.application,
          signal: request.request.signal ?? new AbortController().signal,
        });
        if (!acquired.ok) return {
          ok: false as const,
          reasonCode: acquired.reasonCode === 'broker_machine_mismatch'
            ? 'broker_unavailable' as const
            : 'resource_unavailable' as const,
        };
        let cleaned = false;
        const cleanup = async (): Promise<void> => {
          if (cleaned) return;
          cleaned = true;
          await acquired.projection.cleanup();
        };
        return {
          ok: true as const,
          access: {
            endpointUrl: acquired.projection.access.endpointUrl,
            async request(providerRequest: ManagedServiceRequest) {
              try {
                return await responseWithCleanup(
                  await acquired.projection.access.request(providerRequest),
                  cleanup,
                );
              } catch (error) {
                await cleanup().catch(() => undefined);
                throw error;
              }
            },
          },
        };
      },
    } : {}),
  });
  const application = await startProviderBrokerApplicationServer({ handler });

  return Object.freeze({
    async checkRunnerCredentialSelectionCurrentness(currentness, signal) {
      return await input.checkRunnerCredentialSelectionCurrentness?.({ ...currentness, signal }) ?? 'update_required';
    },
    async resolveExternalProviderBrokerApplicationTarget({ binding, relayAuthorization }) {
      if (binding.kind === 'external_api_key') {
        if (!input.resolveExternalRequestPolicy || !input.admitExternalRequest || !input.recordExternalTerminalUsage) return null;
      } else if (!input.resolveResourceTestRequestPolicy || !input.admitResourceTestRequest) {
        return null;
      }
      if (binding.kind === 'resource_test') {
        if (relayAuthorization === undefined) return null;
        return await application.createStreamTarget({ kind: 'external', binding, relayAuthorization });
      }
      return await application.createStreamTarget({ kind: 'external', binding });
    },
    async resolveProviderBrokerApplicationTarget(request) {
      request.signal.throwIfAborted();
      if (
        encodeProviderBrokerAuthorityV1(request.handshake.authority)
          !== encodeProviderBrokerAuthorityV1(request.authority)
        || request.authority.payload.target.machineId !== input.machineId
        || request.authority.payload.target.endpointId !== request.localEndpointId
      ) return null;
      const expected = expectedBinding(request.authority);
      const verified: ProviderBrokerRouteGrantVerificationResultV1 = verify({
        authority: request.authority,
        authenticatedRemoteEndpointId: request.authenticatedRemoteEndpointId,
        expected,
      });
      if (!verified.valid) return null;
      const authoritative = verified as VerifiedAuthority;
      if (
        authoritative.authority.payload.application.agentTargetKey
          !== expected.application.agentTargetKey
        || authoritative.authority.payload.application.implementationIdentity.pluginId
          !== expected.application.implementationIdentity.pluginId
        || authoritative.authority.payload.application.implementationIdentity.localId
          !== expected.application.implementationIdentity.localId
        || authoritative.authority.payload.application.endpointTemplateId
          !== expected.application.endpointTemplateId
        || authoritative.authority.payload.application.protocol
          !== expected.application.protocol
      ) return null;
      request.signal.throwIfAborted();
      return await application.createStreamTarget({
        authenticatedRemoteEndpointId: request.authenticatedRemoteEndpointId,
        authority: authoritative.authority,
        expected,
        streamLifetime: createPrivateProviderBrokerStreamLifetime({
          sourceOwner: input.sourceOwner,
          application: authoritative.authority.payload.application,
        }),
      }, request.signal);
    },
    close: application.close,
  });
}
