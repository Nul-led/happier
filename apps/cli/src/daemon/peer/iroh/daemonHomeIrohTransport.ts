import { classifyIrohHomeCarrierFailure, IrohError } from '@happier-dev/iroh-native/node';
import {
  createManagedEndpointSupervisor,
  DEFAULT_MANAGED_CONNECTION_POLICY,
  type ReadinessProbeResult,
} from '@happier-dev/connection-supervisor';
import type { FeaturesResponse, HomeConnectionDescriptorV1 } from '@happier-dev/protocol';
import {
  acquireHomeCarrierByPolicy,
  readHomeApplicationCarrierEligibilityFromEnv,
  type HomeApplicationCarrierEligibility,
  type HomeCarrierAcquisitionMode,
} from '@happier-dev/cli-common/homeEnrollment';
import { assertResolvedHomeTargetIdentity, resolveHomeTarget } from '@happier-dev/cli-common/homeTarget';

import {
  createLoopbackHomeIdentityProbe,
  createLoopbackReadinessProbe,
} from '@/api/connection/createLoopbackReadinessProbe';
import { publishServerHttpRuntimeOrigin } from '@/api/client/serverHttpBaseUrl';
import { logger } from '@/ui/logger';
import {
  getActiveServerProfile,
  reconcileActiveServerProfileHomeConnectionDescriptor,
  type ServerProfile,
} from '@/server/serverProfiles';

import type { DaemonMachineIrohRuntime } from './daemonMachineIrohRuntime';

type ProbeInput = Readonly<{
  serverUrl: string;
  token: string;
  expectedServerIdentityId: string;
  signal?: AbortSignal;
}>;

type IdentityProbeInput = Readonly<{
  serverUrl: string;
  expectedServerIdentityId: string;
  signal?: AbortSignal;
}>;

export type DaemonHomeTransport = Readonly<{
  carrier: 'standard' | 'iroh';
  observedPath: 'direct' | 'relay' | 'unknown';
  release(): Promise<void>;
  reacquire(): Promise<ReadinessProbeResult>;
  verifyAuthenticated(token: string): Promise<ReadinessProbeResult>;
}>;

const noRelease = async (): Promise<void> => undefined;

type FailedReadinessProbeResult = Exclude<ReadinessProbeResult, Readonly<{ status: 'ready' }>>;

class DaemonHomeReadinessError extends Error {
  constructor(
    readonly probe: FailedReadinessProbeResult,
    readonly afterIrohAcquisition = false,
  ) {
    super(probe.errorMessage ?? `Home transport readiness failed: ${probe.status}`);
  }
}

type PrepareDaemonHomeIrohTransportInput = Readonly<{
  runtime: DaemonMachineIrohRuntime | null;
  profile: ServerProfile;
  applicationCarrierEligibility?: HomeApplicationCarrierEligibility;
  token?: string;
  readProfile?: () => Promise<ServerProfile>;
  identityProbe?: (input: IdentityProbeInput) => Promise<ReadinessProbeResult>;
  probe?: (input: ProbeInput) => Promise<ReadinessProbeResult>;
  publishRuntimeOrigin?: typeof publishServerHttpRuntimeOrigin;
  isCancelled?: () => boolean;
  signal?: AbortSignal;
}>;

type ActiveDaemonHomeTransport = Omit<DaemonHomeTransport, 'reacquire'>;

async function waitForDaemonHomeReadiness(
  probe: () => Promise<ReadinessProbeResult>,
  signal?: AbortSignal,
): Promise<ReadinessProbeResult> {
  // Startup waits before publishing a verified origin or successor control state.
  // The existing endpoint owner supplies retry/backoff; reconnect already has
  // its own supervisor and continues to consume one-attempt probes below.
  const supervisor = createManagedEndpointSupervisor({
    ...DEFAULT_MANAGED_CONNECTION_POLICY,
    probeReadiness: probe,
    onStateChange: (state) => {
      if (state.phase === 'offline') {
        logger.warn('[DAEMON RUN] Waiting for verified Home transport', {
          status: state.lastProbe?.status,
          nextRetryAt: state.nextRetryAt,
        });
      }
    },
  });
  let unsubscribe = () => {};
  let onAbort = () => {};
  try {
    return await new Promise<ReadinessProbeResult>((resolve, reject) => {
      onAbort = () => resolve({ status: 'server_unreachable', errorMessage: 'Home transport is released' });
      if (signal?.aborted) {
        onAbort();
        return;
      }
      signal?.addEventListener('abort', onAbort, { once: true });
      unsubscribe = supervisor.subscribe((state) => {
        if (state.phase === 'online') resolve({ status: 'ready' });
        if (state.phase === 'auth_failed' && state.lastProbe) resolve(state.lastProbe);
      });
      void supervisor.start().catch(reject);
    });
  } finally {
    signal?.removeEventListener('abort', onAbort);
    unsubscribe();
    await supervisor.stop();
  }
}

function withReacquisition(
  input: PrepareDaemonHomeIrohTransportInput,
  initial: ActiveDaemonHomeTransport,
): DaemonHomeTransport {
  let active = initial;
  let activeRelease = initial.release;
  const pendingReleases = new Set([initial.release]);
  let released = false;
  let closing = false;
  let releaseInFlight: Promise<void> | null = null;
  let reacquireInFlight: Promise<ReadinessProbeResult> | null = null;
  let authenticatedToken = input.token;
  let acceptedDescriptorRevision = input.profile.homeConnectionDescriptor?.revision ?? null;
  const readinessCancellation = new AbortController();
  const readinessSignal = input.signal
    ? AbortSignal.any([input.signal, readinessCancellation.signal])
    : readinessCancellation.signal;
  return {
    get carrier() {
      return active.carrier;
    },
    get observedPath() {
      return active.observedPath;
    },
    async release() {
      if (released) return;
      closing = true;
      readinessCancellation.abort();
      releaseInFlight ??= (async () => {
        await reacquireInFlight?.catch(() => undefined);
        const errors: unknown[] = [];
        for (const release of [...pendingReleases]) {
          try {
            await release();
            pendingReleases.delete(release);
          } catch (error) {
            errors.push(error);
          }
        }
        if (errors.length === 1) throw errors[0];
        if (errors.length > 1) throw new AggregateError(errors, 'Failed to release every daemon Home transport.');
        released = true;
      })().finally(() => {
        releaseInFlight = null;
      });
      return await releaseInFlight;
    },
    async reacquire() {
      if (released || closing) return { status: 'server_unreachable', errorMessage: 'Home transport is released' };
      if (reacquireInFlight) return await reacquireInFlight;
      reacquireInFlight = (async (): Promise<ReadinessProbeResult> => {
        try {
          const currentProfile = await (input.readProfile ?? getActiveServerProfile)();
          if (active.carrier === 'iroh' && !currentProfile.homeConnectionDescriptor) {
            return {
              status: 'server_unreachable',
              errorMessage: 'Selected Iroh Home transport cannot be replaced without a current connection descriptor',
            };
          }
          const currentDescriptor = currentProfile.homeConnectionDescriptor;
          // On an Iroh lease reconnect, an unchanged descriptor can still
          // contain the previous Home process's ephemeral direct address.
          // Verify the current lease first: a transient Machine socket loss
          // must not needlessly move a healthy direct path onto a relay.
          const relayOnlyRecovery = active.carrier === 'iroh'
            && Boolean(input.runtime?.endpoint?.relayUrls?.length)
            && currentDescriptor?.revision === acceptedDescriptorRevision
            && currentDescriptor.endpoints.some((endpoint) => endpoint.kind === 'iroh'
              && Boolean(endpoint.relayUrls?.length && endpoint.directAddresses?.length));
          if (relayOnlyRecovery && authenticatedToken) {
            const currentReadiness = await active.verifyAuthenticated(authenticatedToken);
            if (currentReadiness.status !== 'server_unreachable') return currentReadiness;
          }
          const replacement = await prepareDaemonHomeIrohTransportOnce(
            {
              ...input,
              ...(authenticatedToken ? { token: authenticatedToken } : {}),
              isCancelled: () => closing || released,
            },
            currentProfile,
            active.carrier === 'iroh' && (input.applicationCarrierEligibility
              ?? readHomeApplicationCarrierEligibilityFromEnv(process.env)) !== 'standard_only'
              ? 'pinned_recovery'
              : 'initial_selection',
            relayOnlyRecovery,
          );
          if (closing || released) {
            pendingReleases.add(replacement.release);
            await replacement.release();
            pendingReleases.delete(replacement.release);
            return { status: 'server_unreachable', errorMessage: 'Home transport is released' };
          }
          const predecessorRelease = activeRelease;
          active = replacement;
          activeRelease = replacement.release;
          acceptedDescriptorRevision = currentDescriptor?.revision ?? null;
          pendingReleases.add(activeRelease);
          try {
            await predecessorRelease();
            pendingReleases.delete(predecessorRelease);
          } catch {
            // Keep custody of a failed predecessor release for final teardown.
          }
          return { status: 'ready' };
        } catch (error) {
          if (closing || released) {
            return { status: 'server_unreachable', errorMessage: 'Home transport is released' };
          }
          if (error instanceof DaemonHomeReadinessError) return error.probe;
          const classification = classifyIrohHomeCarrierFailure(error);
          return {
            status: classification.failureClass === 'carrier-unavailable'
              ? 'server_unreachable'
              : 'auth_failed',
            errorMessage: error instanceof Error ? error.message : 'Home transport reacquisition failed closed',
          };
        }
      })().finally(() => {
        reacquireInFlight = null;
      });
      return await reacquireInFlight;
    },
    async verifyAuthenticated(token) {
      if (released || closing) return { status: 'server_unreachable', errorMessage: 'Home transport is released' };
      const readiness = await waitForDaemonHomeReadiness(() => active.verifyAuthenticated(token), readinessSignal);
      if (readiness.status === 'ready') authenticatedToken = token;
      return readiness;
    },
  };
}

async function defaultIdentityProbe(input: IdentityProbeInput): Promise<ReadinessProbeResult> {
  return await createLoopbackHomeIdentityProbe(input)();
}

async function defaultProbe(input: ProbeInput): Promise<ReadinessProbeResult> {
  return await createLoopbackReadinessProbe(input)();
}

async function prepareDaemonHomeIrohTransportOnce(
  input: PrepareDaemonHomeIrohTransportInput,
  profile: ServerProfile,
  mode: HomeCarrierAcquisitionMode,
  relayOnlyRecovery = false,
  superviseReadiness = false,
): Promise<ActiveDaemonHomeTransport> {
  const descriptor = profile.homeConnectionDescriptor;
  if (!descriptor) {
    return {
      carrier: 'standard',
      observedPath: 'unknown',
      release: noRelease,
      verifyAuthenticated: async () => ({ status: 'ready' }),
    };
  }
  const resolvedTarget = await resolveHomeTarget({
    input: { kind: 'descriptor', descriptor, authority: 'current_connection' },
    readSavedProfile: async () => null,
  });
  const expectedHomeServerIdentityId = resolvedTarget.homeServerIdentityId;
  if (!expectedHomeServerIdentityId) throw new Error('Resolved daemon Home target has no stable identity');

  const probe = input.probe ?? (async (probeInput: ProbeInput) => await defaultProbe({ ...probeInput, signal: input.signal }));
  const identityProbe = input.identityProbe ?? (
    input.probe
      ? async ({ serverUrl, expectedServerIdentityId }: IdentityProbeInput) => await input.probe!({
        serverUrl,
        token: input.token ?? '',
        expectedServerIdentityId,
      })
      : async (probeInput: IdentityProbeInput) => await defaultIdentityProbe({ ...probeInput, signal: input.signal })
  );
  const checkReadiness = async (check: () => Promise<ReadinessProbeResult>) => superviseReadiness
    ? await waitForDaemonHomeReadiness(check, input.signal)
    : await check();
  const publish = input.publishRuntimeOrigin ?? publishServerHttpRuntimeOrigin;
  const verifyTrustedFallback = async (serverUrl: string, token: string) => await probe({
    serverUrl,
    token,
    expectedServerIdentityId: expectedHomeServerIdentityId,
  });
  const activateTrustedFallback = (serverUrl: string): ActiveDaemonHomeTransport => {
    if (input.signal?.aborted || input.isCancelled?.()) {
      throw new DaemonHomeReadinessError({ status: 'server_unreachable', errorMessage: 'Home transport is released' });
    }
    const unpublish = publish(serverUrl, 'https');
    return {
      carrier: 'standard',
      observedPath: 'unknown',
      release: async () => unpublish(),
      verifyAuthenticated: async (token) => await verifyTrustedFallback(serverUrl, token),
    };
  };
  const acquireNativeLease = async () => {
    const ensureHomeTunnel = input.runtime?.ensureHomeTunnel;
    if (!ensureHomeTunnel) {
      throw new IrohError('unavailable', 'Native Iroh Home transport is unavailable');
    }
    return await ensureHomeTunnel({ descriptor, ...(relayOnlyRecovery ? { relayOnly: true } : {}) });
  };
  const selection = await acquireHomeCarrierByPolicy({
    mode,
    applicationCarrierEligibility: input.applicationCarrierEligibility
      ?? readHomeApplicationCarrierEligibilityFromEnv(process.env),
    descriptor,
    preferredTransport: resolvedTarget.preferredTransport,
    classifyFailure: (error) => error instanceof DaemonHomeReadinessError
      ? { fallbackAllowed: !error.afterIrohAcquisition && error.probe.status !== 'auth_failed' }
      : classifyIrohHomeCarrierFailure(error),
    acquireIroh: async ({ endpoint }) => {
      const nativeLease = await acquireNativeLease();
      try {
        const identityReadiness = await checkReadiness(async () => await identityProbe({
          serverUrl: nativeLease.runtimeOrigin,
          expectedServerIdentityId: expectedHomeServerIdentityId,
        }));
        if (identityReadiness.status !== 'ready') {
          throw new DaemonHomeReadinessError({
            ...identityReadiness,
            errorMessage: `Iroh Home verification failed: ${identityReadiness.errorMessage ?? identityReadiness.status}`,
          }, true);
        }
        if (input.token) {
          const token = input.token;
          const authenticatedReadiness = await checkReadiness(async () => await probe({
            serverUrl: nativeLease.runtimeOrigin,
            token,
            expectedServerIdentityId: expectedHomeServerIdentityId,
          }));
          if (authenticatedReadiness.status !== 'ready') {
            throw new DaemonHomeReadinessError({
              ...authenticatedReadiness,
              errorMessage: `Iroh Home verification failed: ${authenticatedReadiness.errorMessage ?? authenticatedReadiness.status}`,
            }, true);
          }
        }
        if (input.signal?.aborted || input.isCancelled?.()) {
          throw new IrohError('cancelled', 'Home transport is released');
        }
        return {
          homeServerIdentityId: expectedHomeServerIdentityId,
          endpointId: endpoint.endpointId,
          status: 'ready' as const,
          value: nativeLease,
          release: nativeLease.release,
        };
      } catch (error) {
        await nativeLease.release().catch(() => undefined);
        if (error instanceof DaemonHomeReadinessError) throw error;
        throw new IrohError(
          'unknown',
          error instanceof Error ? error.message : 'Iroh Home post-acquisition verification failed',
          { cause: error },
        );
      }
    },
  });

  if (selection.kind === 'unavailable' || selection.kind === 'fail_closed') {
    throw selection.error;
  }
  if (selection.kind === 'https') {
    const standardReadiness = await checkReadiness(async () => input.token
      ? await verifyTrustedFallback(selection.runtimeOrigin, input.token)
      : await identityProbe({
          serverUrl: selection.runtimeOrigin,
          expectedServerIdentityId: expectedHomeServerIdentityId,
        }));
    if (standardReadiness.status !== 'ready') {
      throw new DaemonHomeReadinessError({
        ...standardReadiness,
        errorMessage: `Trusted HTTPS Home verification failed: ${standardReadiness.errorMessage ?? standardReadiness.status}`,
      });
    }
    return activateTrustedFallback(selection.runtimeOrigin);
  }

  const nativeLease = selection.carrier.value;
  if (input.signal?.aborted || input.isCancelled?.()) {
    await selection.release();
    throw new DaemonHomeReadinessError({ status: 'server_unreachable', errorMessage: 'Home transport is released' });
  }
  const unpublish = publish(nativeLease.runtimeOrigin, 'iroh', {
    descriptor,
    acquire: async () => ({
      ...await acquireNativeLease(),
      homeServerIdentityId: selection.carrier.homeServerIdentityId,
      endpointId: selection.carrier.endpointId,
      status: 'ready',
    }),
  });
  let released = false;
  return {
    carrier: 'iroh',
    observedPath: nativeLease.observedPath,
    async release() {
      if (released) return;
      unpublish();
      await selection.release();
      released = true;
    },
    verifyAuthenticated: async (token) => await probe({
      serverUrl: nativeLease.runtimeOrigin,
      token,
      expectedServerIdentityId: expectedHomeServerIdentityId,
    }),
  };
}

export async function prepareDaemonHomeIrohTransport(
  input: PrepareDaemonHomeIrohTransportInput,
): Promise<DaemonHomeTransport> {
  return withReacquisition(
    input,
    await prepareDaemonHomeIrohTransportOnce(input, input.profile, 'initial_selection', false, true),
  );
}

export async function applyDaemonHomeDescriptorRefresh(input: Readonly<{
  features: FeaturesResponse;
  reconcileDescriptor?: (descriptor: HomeConnectionDescriptorV1) => Promise<Readonly<{
    outcome: 'updated' | 'unchanged' | 'stale';
  }>>;
  requestReconnect: () => Promise<void> | void;
}>): Promise<'ignored' | 'updated' | 'unchanged' | 'stale'> {
  const descriptor = input.features.homeConnectionDescriptor;
  if (!descriptor) return 'ignored';
  const observedIdentity = input.features.capabilities.serverIdentity.serverIdentityId;
  const resolvedTarget = await resolveHomeTarget({
    input: { kind: 'descriptor', descriptor, authority: 'current_connection' },
    readSavedProfile: async () => null,
  });
  assertResolvedHomeTargetIdentity(resolvedTarget, observedIdentity ?? '');
  const reconciliation = await (
    input.reconcileDescriptor
    ?? (async (nextDescriptor) => await reconcileActiveServerProfileHomeConnectionDescriptor(
      nextDescriptor,
    ))
  )(descriptor);
  if (reconciliation.outcome === 'updated') await input.requestReconnect();
  return reconciliation.outcome;
}
