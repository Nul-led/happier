import type { HomeConnectionDescriptorV1, IrohEndpointDescriptorV1 } from '@happier-dev/protocol';

type HomeIrohEndpointDescriptorV1 = Extract<
  HomeConnectionDescriptorV1['endpoints'][number],
  { kind: 'iroh' }
>;

export type HomeCarrierPolicyFailureClassification = Readonly<{ fallbackAllowed: boolean }>;
export type HomeCarrierPreferredTransport = 'iroh' | 'https';

/**
 * Canonical initial carrier preference for a normalized Home descriptor.
 * Acquisition, failure classification, and fallback remain owned by
 * acquireHomeCarrierByPolicy.
 */
export function resolveHomeCarrierPreferredTransport(
  descriptor: HomeConnectionDescriptorV1,
): HomeCarrierPreferredTransport {
  return descriptor.endpoints.some((endpoint) => endpoint.kind === 'iroh') ? 'iroh' : 'https';
}

export type HomeCarrierPolicyIrohLease<Value> = Readonly<{
  homeServerIdentityId: string;
  endpointId: string;
  status: 'ready' | 'degraded';
  value: Value;
  release(): Promise<void>;
}>;

export type HomeCarrierPolicyResult<Value> =
  | Readonly<{ kind: 'iroh'; carrier: HomeCarrierPolicyIrohLease<Value>; release(): Promise<void> }>
  | Readonly<{ kind: 'https'; runtimeOrigin: string }>
  | Readonly<{ kind: 'unavailable'; error: unknown }>
  | Readonly<{ kind: 'fail_closed'; error: unknown; fallbackAllowed: boolean }>;

export type HomeCarrierPolicyInput<Value> = Readonly<{
  descriptor: HomeConnectionDescriptorV1;
  preferredTransport: HomeCarrierPreferredTransport;
  acquireIroh(input: Readonly<{
    descriptor: HomeConnectionDescriptorV1;
    endpoint: IrohEndpointDescriptorV1;
  }>): Promise<HomeCarrierPolicyIrohLease<Value>>;
  classifyFailure(error: unknown): HomeCarrierPolicyFailureClassification;
}>;

export class HomeCarrierPolicyError extends Error {
  readonly name = 'HomeCarrierPolicyError';

  constructor(
    readonly code: 'identity_mismatch' | 'invalid_preference' | 'unavailable',
    message: string,
  ) {
    super(message);
  }
}

const retainedReleases = new Set<() => Promise<void>>();

export function createOwnedHomeCarrierRelease(
  releasePhysicalCarrier: () => Promise<void>,
): () => Promise<void> {
  let released = false;
  let inFlight: Promise<void> | null = null;
  let ownedRelease!: () => Promise<void>;
  ownedRelease = () => {
    if (released) return Promise.resolve();
    inFlight ??= releasePhysicalCarrier().then(
      () => {
        released = true;
        inFlight = null;
        retainedReleases.delete(ownedRelease);
      },
      (error: unknown) => {
        inFlight = null;
        retainedReleases.add(ownedRelease);
        throw error;
      },
    );
    return inFlight;
  };
  return ownedRelease;
}

export async function drainRetainedHomeCarrierReleases(): Promise<void> {
  await Promise.allSettled([...retainedReleases].map(async (release) => await release()));
}

function resolveDescriptorHttpsOrigin(descriptor: HomeConnectionDescriptorV1): string | null {
  for (const endpoint of descriptor.endpoints) {
    if (endpoint.kind !== 'https') continue;
    try {
      const parsed = new URL(endpoint.url);
      if (parsed.protocol !== 'https:' || parsed.username || parsed.password) continue;
      parsed.search = '';
      parsed.hash = '';
      return parsed.toString().replace(/\/+$/u, '');
    } catch {
      // Invalid descriptor values are normally rejected at the schema boundary;
      // this owner still refuses to manufacture a fallback from them.
    }
  }
  return null;
}

/**
 * Platform-neutral first-contact carrier decision. Iroh is always attempted
 * before descriptor-declared HTTPS. Only the injected failure classifier may
 * authorize fallback; identity/readiness mismatch after acquisition is always
 * fail-closed and the physical lease remains in retryable cleanup custody.
 */
export async function acquireHomeCarrierByPolicy<Value>(
  input: HomeCarrierPolicyInput<Value>,
): Promise<HomeCarrierPolicyResult<Value>> {
  const expectedPreference = resolveHomeCarrierPreferredTransport(input.descriptor);
  if (input.preferredTransport !== expectedPreference) {
    return {
      kind: 'fail_closed',
      error: new HomeCarrierPolicyError(
        'invalid_preference',
        'Home target carrier preference does not match its descriptor',
      ),
      fallbackAllowed: false,
    };
  }
  const endpoint = input.descriptor.endpoints.find(
    (candidate): candidate is HomeIrohEndpointDescriptorV1 => candidate.kind === 'iroh',
  );
  const httpsOrigin = resolveDescriptorHttpsOrigin(input.descriptor);
  if (!endpoint) {
    return httpsOrigin
      ? { kind: 'https', runtimeOrigin: httpsOrigin }
      : {
          kind: 'unavailable',
          error: new HomeCarrierPolicyError('unavailable', 'Home descriptor declares no eligible application endpoint'),
        };
  }

  try {
    const acquired = await input.acquireIroh({ descriptor: input.descriptor, endpoint });
    const release = createOwnedHomeCarrierRelease(acquired.release);
    if (
      acquired.status !== 'ready'
      || acquired.homeServerIdentityId !== input.descriptor.homeServerIdentityId
      || acquired.endpointId !== endpoint.endpointId
    ) {
      await release().catch(() => undefined);
      return {
        kind: 'fail_closed',
        error: new HomeCarrierPolicyError(
          'identity_mismatch',
          'Acquired Iroh carrier does not match the requested Home identity and EndpointId',
        ),
        fallbackAllowed: false,
      };
    }
    const carrier = { ...acquired, release };
    return { kind: 'iroh', carrier, release };
  } catch (error) {
    const classification = input.classifyFailure(error);
    if (classification.fallbackAllowed && httpsOrigin) {
      return { kind: 'https', runtimeOrigin: httpsOrigin };
    }
    return { kind: 'fail_closed', error, fallbackAllowed: classification.fallbackAllowed };
  }
}
