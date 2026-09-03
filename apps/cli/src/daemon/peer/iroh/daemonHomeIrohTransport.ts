import { classifyIrohHomeCarrierFailure } from '@happier-dev/iroh-native';
import type { ReadinessProbeResult } from '@happier-dev/connection-supervisor';
import type { FeaturesResponse, HomeConnectionDescriptorV1 } from '@happier-dev/protocol';

import {
  createLoopbackHomeIdentityProbe,
  createLoopbackReadinessProbe,
} from '@/api/connection/createLoopbackReadinessProbe';
import { publishServerHttpRuntimeOrigin } from '@/api/client/serverHttpBaseUrl';
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
}>;

type IdentityProbeInput = Readonly<{
  serverUrl: string;
  expectedServerIdentityId: string;
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
  constructor(readonly probe: FailedReadinessProbeResult) {
    super(probe.errorMessage ?? `Home transport readiness failed: ${probe.status}`);
  }
}

type PrepareDaemonHomeIrohTransportInput = Readonly<{
  runtime: DaemonMachineIrohRuntime | null;
  profile: ServerProfile;
  token?: string;
  readProfile?: () => Promise<ServerProfile>;
  identityProbe?: (input: IdentityProbeInput) => Promise<ReadinessProbeResult>;
  probe?: (input: ProbeInput) => Promise<ReadinessProbeResult>;
  publishRuntimeOrigin?: typeof publishServerHttpRuntimeOrigin;
}>;

type ActiveDaemonHomeTransport = Omit<DaemonHomeTransport, 'reacquire'>;

function withReacquisition(
  input: PrepareDaemonHomeIrohTransportInput,
  initial: ActiveDaemonHomeTransport,
): DaemonHomeTransport {
  let active = initial;
  let activeRelease = initial.release;
  const pendingReleases = new Set([initial.release]);
  let released = false;
  let authenticatedToken = input.token;
  return {
    get carrier() {
      return active.carrier;
    },
    get observedPath() {
      return active.observedPath;
    },
    async release() {
      if (released) return;
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
    },
    async reacquire() {
      if (released) return { status: 'server_unreachable', errorMessage: 'Home transport is released' };
      try {
        await activeRelease();
        pendingReleases.delete(activeRelease);
      } catch {
        // Keep custody of a failed predecessor release for final teardown.
      }
      try {
        const currentProfile = await (input.readProfile ?? getActiveServerProfile)();
        const replacement = await prepareDaemonHomeIrohTransportOnce(
          { ...input, ...(authenticatedToken ? { token: authenticatedToken } : {}) },
          currentProfile,
        );
        active = replacement;
        activeRelease = replacement.release;
        pendingReleases.add(activeRelease);
        return { status: 'ready' };
      } catch (error) {
        if (error instanceof DaemonHomeReadinessError) return error.probe;
        return {
          status: classifyIrohHomeCarrierFailure(error).fallbackAllowed ? 'server_unreachable' : 'auth_failed',
          errorMessage: error instanceof Error ? error.message : 'Home transport reacquisition failed closed',
        };
      }
    },
    async verifyAuthenticated(token) {
      if (released) return { status: 'server_unreachable', errorMessage: 'Home transport is released' };
      const readiness = await active.verifyAuthenticated(token);
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
): Promise<ActiveDaemonHomeTransport> {
  const descriptor = profile.homeConnectionDescriptor;
  const hasIrohEndpoint = descriptor?.endpoints.some((endpoint) => endpoint.kind === 'iroh') === true;
  if (!descriptor || !hasIrohEndpoint) {
    return {
      carrier: 'standard',
      observedPath: 'unknown',
      release: noRelease,
      verifyAuthenticated: async () => ({ status: 'ready' }),
    };
  }

  const probe = input.probe ?? defaultProbe;
  const identityProbe = input.identityProbe ?? (
    input.probe
      ? async ({ serverUrl, expectedServerIdentityId }: IdentityProbeInput) => await input.probe!({
        serverUrl,
        token: input.token ?? '',
        expectedServerIdentityId,
      })
      : defaultIdentityProbe
  );
  const publish = input.publishRuntimeOrigin ?? publishServerHttpRuntimeOrigin;
  const trustedHttpsOrigin = descriptor.endpoints.find((endpoint) => endpoint.kind === 'https')?.url;
  const verifyTrustedFallback = async (serverUrl: string, token: string) => await probe({
    serverUrl,
    token,
    expectedServerIdentityId: descriptor.homeServerIdentityId,
  });
  const activateTrustedFallback = (serverUrl: string): ActiveDaemonHomeTransport => {
    const unpublish = publish(serverUrl, 'https');
    return {
      carrier: 'standard',
      observedPath: 'unknown',
      release: async () => unpublish(),
      verifyAuthenticated: async (token) => await verifyTrustedFallback(serverUrl, token),
    };
  };
  const ensureHomeTunnel = input.runtime?.ensureHomeTunnel;
  if (!ensureHomeTunnel) {
    if (!trustedHttpsOrigin) {
      throw new Error('Iroh Home transport is required and no independently trusted HTTPS fallback is declared');
    }
    const standardReadiness = input.token
      ? await verifyTrustedFallback(trustedHttpsOrigin, input.token)
      : await identityProbe({
          serverUrl: trustedHttpsOrigin,
          expectedServerIdentityId: descriptor.homeServerIdentityId,
        });
    if (standardReadiness.status !== 'ready') {
      throw new DaemonHomeReadinessError({
        ...standardReadiness,
        errorMessage: `Trusted HTTPS Home verification failed: ${standardReadiness.errorMessage ?? standardReadiness.status}`,
      });
    }
    return activateTrustedFallback(trustedHttpsOrigin);
  }
  try {
    const nativeLease = await ensureHomeTunnel({ descriptor });
    const identityReadiness = await identityProbe({
      serverUrl: nativeLease.runtimeOrigin,
      expectedServerIdentityId: descriptor.homeServerIdentityId,
    });
    if (identityReadiness.status !== 'ready') {
      await nativeLease.release().catch(() => undefined);
      if (identityReadiness.status === 'auth_failed') {
        throw new DaemonHomeReadinessError({
          ...identityReadiness,
          errorMessage: `Iroh Home verification failed: ${identityReadiness.errorMessage ?? 'identity rejected'}`,
        });
      }
      if (trustedHttpsOrigin) {
        const standardReadiness = await identityProbe({
          serverUrl: trustedHttpsOrigin,
          expectedServerIdentityId: descriptor.homeServerIdentityId,
        });
        if (standardReadiness.status === 'ready') {
          return activateTrustedFallback(trustedHttpsOrigin);
        }
      }
      throw new DaemonHomeReadinessError({
        ...identityReadiness,
        errorMessage: `Iroh Home verification failed: ${identityReadiness.errorMessage ?? identityReadiness.status}`,
      });
    }

    const unpublish = publish(nativeLease.runtimeOrigin, 'iroh');
    let released = false;
    const active: ActiveDaemonHomeTransport = {
      carrier: 'iroh',
      observedPath: nativeLease.observedPath,
      async release() {
        if (released) return;
        unpublish();
        await nativeLease.release();
        released = true;
      },
      verifyAuthenticated: async (token) => await probe({
        serverUrl: nativeLease.runtimeOrigin,
        token,
        expectedServerIdentityId: descriptor.homeServerIdentityId,
      }),
    };
    if (!input.token) return active;

    const authenticatedReadiness = await active.verifyAuthenticated(input.token);
    if (authenticatedReadiness.status === 'ready') return active;
    await active.release().catch(() => undefined);
    if (authenticatedReadiness.status === 'auth_failed') {
      throw new DaemonHomeReadinessError({
        ...authenticatedReadiness,
        errorMessage: `Iroh Home verification failed: ${authenticatedReadiness.errorMessage ?? 'authentication rejected'}`,
      });
    }
    if (trustedHttpsOrigin) {
      const standardReadiness = await verifyTrustedFallback(trustedHttpsOrigin, input.token);
      if (standardReadiness.status === 'ready') return activateTrustedFallback(trustedHttpsOrigin);
    }
    throw new DaemonHomeReadinessError({
      ...authenticatedReadiness,
      errorMessage: `Iroh Home verification failed: ${authenticatedReadiness.errorMessage ?? authenticatedReadiness.status}`,
    });
  } catch (error) {
    if (!classifyIrohHomeCarrierFailure(error).fallbackAllowed) throw error;
    if (!trustedHttpsOrigin) throw error;
    const standardReadiness = input.token
      ? await verifyTrustedFallback(trustedHttpsOrigin, input.token)
      : await identityProbe({
        serverUrl: trustedHttpsOrigin,
        expectedServerIdentityId: descriptor.homeServerIdentityId,
      });
    if (standardReadiness.status !== 'ready') throw error;
    return activateTrustedFallback(trustedHttpsOrigin);
  }
}

export async function prepareDaemonHomeIrohTransport(
  input: PrepareDaemonHomeIrohTransportInput,
): Promise<DaemonHomeTransport> {
  return withReacquisition(input, await prepareDaemonHomeIrohTransportOnce(input, input.profile));
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
  if (!observedIdentity || observedIdentity !== descriptor.homeServerIdentityId) {
    throw new Error('Home connection descriptor identity does not match the observed server identity');
  }
  const reconciliation = await (
    input.reconcileDescriptor
    ?? (async (nextDescriptor) => await reconcileActiveServerProfileHomeConnectionDescriptor(
      nextDescriptor,
      { observation: 'public' },
    ))
  )(descriptor);
  if (reconciliation.outcome === 'updated') await input.requestReconnect();
  return reconciliation.outcome;
}
