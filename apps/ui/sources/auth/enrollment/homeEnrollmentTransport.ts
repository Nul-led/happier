import {
    HomeApplicationOriginV1Schema,
    type HomeConnectionDescriptorV1,
    type HomeCredentialDestinationSelectionV1,
} from '@happier-dev/protocol';
import type { AuthCredentials } from '@/auth/storage/tokenStorage';
import { createServerFetchAtEndpoint, type ServerFetch } from '@/sync/http/client';
import {
    acquireBrowserIrohHomeCarrier,
    resolveBrowserIrohHomeCarrierEligibility,
} from '@/sync/runtime/browserIroh/homeCarrier/browserHomeCarrier';
import { resolveBrowserIrohHostDecision } from '@/sync/runtime/browserIroh/hostEligibility';
import type { HomeCarrier } from '@/sync/runtime/homeCarrier';
import { acquireIrohHomeRuntimeOrigin } from '@/sync/runtime/nativeIrohTunnels/runtime';
import { classifyIrohHomeTunnelSwitchFailure } from '@/sync/runtime/nativeIrohTunnels/fallback';
import type { IrohHomeTunnelVerification } from '@/sync/runtime/nativeIrohTunnels/types';

export type HomeEnrollmentTransportFailureReason =
    | 'no_approved_application_origin'
    | 'iroh_transport_unavailable'
    | 'iroh_transport_failed_closed';

export type HomeEnrollmentTransport = Readonly<{
    descriptor: HomeConnectionDescriptorV1;
    canonicalServerUrl: string;
    homeServerIdentityId: string;
    endpointUrl: string;
    /** URL-addressable transport origin; null when a semantic carrier owns bytes. */
    runtimeOrigin: string | null;
    carrier: 'https' | 'iroh';
    /** Exact descriptor destination authenticated by the selected carrier, when this resolver owns that proof. */
    authenticatedCredentialDestination: HomeCredentialDestinationSelectionV1 | null;
    /** Semantic carrier for browser Iroh, where no loopback runtime origin exists. */
    homeCarrier?: HomeCarrier | null;
    createRequest: (options?: Readonly<{
        serverId?: string | null;
        credentials?: AuthCredentials | null;
    }>) => ServerFetch;
    /** Release the selected carrier. Idempotent; HTTPS owns no runtime resource. */
    close: () => Promise<void>;
}>;

export type HomeEnrollmentTransportResolution =
    | Readonly<{ ok: true; transport: HomeEnrollmentTransport }>
    | Readonly<{
        ok: false;
        homeServerIdentityId: string;
        reason: HomeEnrollmentTransportFailureReason;
    }>;

function approvedApplicationOrigin(rawUrl: string): string | null {
    const parsed = HomeApplicationOriginV1Schema.safeParse(rawUrl);
    return parsed.success
        ? new URL(parsed.data).toString().replace(/\/+$/, '')
        : null;
}

/**
 * Canonical application transport for one immutable Home descriptor. It selects an approved
 * descriptor endpoint or acquires Lane06's verified lifecycle-neutral Iroh origin, while the
 * stable canonical URL remains the request identity/audience in either case.
 */
export async function resolveHomeEnrollmentTransport(
    descriptor: HomeConnectionDescriptorV1,
    options: Readonly<{
        runtimeOrigin?: string | null;
        runtimeCarrier?: 'https' | 'iroh';
        verification?: IrohHomeTunnelVerification;
    }> = {},
): Promise<HomeEnrollmentTransportResolution> {
    const canonicalEndpointUrl = approvedApplicationOrigin(descriptor.canonicalServerUrl);
    const resolvedRuntimeOrigin = options.runtimeOrigin
        ? approvedApplicationOrigin(options.runtimeOrigin)
        : null;
    const candidates = descriptor.endpoints.flatMap((endpoint) => {
        if (endpoint.kind !== 'https') return [];
        const approved = approvedApplicationOrigin(endpoint.url);
        return approved ? [approved] : [];
    });
    const independentHttpsEndpoint = candidates.find((candidate) => candidate.startsWith('https://')) ?? null;
    const standardEndpoint = independentHttpsEndpoint ?? candidates[0] ?? null;
    const irohEndpoint = descriptor.endpoints.find((endpoint) => endpoint.kind === 'iroh') ?? null;

    let endpointUrl: string | null = null;
    let runtimeOrigin: string | null = null;
    let carrier: 'https' | 'iroh' = 'https';
    let authenticatedCredentialDestination: HomeCredentialDestinationSelectionV1 | null = null;
    let homeCarrier: HomeCarrier | null = null;
    let close = async (): Promise<void> => {};

    if (resolvedRuntimeOrigin) {
        endpointUrl = canonicalEndpointUrl ?? standardEndpoint;
        runtimeOrigin = resolvedRuntimeOrigin;
        carrier = options.runtimeCarrier ?? (irohEndpoint ? 'iroh' : 'https');
        if (carrier === 'https' && endpointUrl) {
            authenticatedCredentialDestination = { kind: 'https', applicationUrl: endpointUrl };
        }
    } else if (irohEndpoint && canonicalEndpointUrl) {
        try {
            const browserRequest = options.verification?.kind === 'authenticated'
                ? {
                    purpose: 'authenticated_home' as const,
                    credentials: { token: options.verification.token },
                    homeServerIdentityId: descriptor.homeServerIdentityId,
                    endpoint: irohEndpoint,
                    canonicalServerUrl: descriptor.canonicalServerUrl,
                }
                : {
                    purpose: 'enrollment' as const,
                    homeServerIdentityId: descriptor.homeServerIdentityId,
                    endpoint: irohEndpoint,
                    canonicalServerUrl: descriptor.canonicalServerUrl,
                };
            const browserHostDecision = resolveBrowserIrohHostDecision();
            const browserEligibility = resolveBrowserIrohHomeCarrierEligibility(
                browserRequest,
                browserHostDecision,
            );
            if (
                browserHostDecision.eligible
                && !browserEligibility.eligible
                && browserEligibility.reason !== 'relays_missing'
            ) {
                return {
                    ok: false,
                    homeServerIdentityId: descriptor.homeServerIdentityId,
                    reason: 'iroh_transport_failed_closed',
                };
            }
            if (browserEligibility.eligible) {
                const acquiredCarrier = await acquireBrowserIrohHomeCarrier(browserRequest);
                homeCarrier = acquiredCarrier;
                endpointUrl = canonicalEndpointUrl;
                runtimeOrigin = null;
                carrier = 'iroh';
                let released = false;
                let closePromise: Promise<void> | null = null;
                close = () => {
                    if (released) return Promise.resolve();
                    closePromise ??= acquiredCarrier.release().then(
                        () => {
                            released = true;
                            closePromise = null;
                        },
                        (error: unknown) => {
                            closePromise = null;
                            throw error;
                        },
                    );
                    return closePromise;
                };
                if (acquiredCarrier.endpointId !== irohEndpoint.endpointId) {
                    await close().catch(() => {});
                    return {
                        ok: false,
                        homeServerIdentityId: descriptor.homeServerIdentityId,
                        reason: 'iroh_transport_failed_closed',
                    };
                }
                authenticatedCredentialDestination = {
                    kind: 'iroh',
                    endpointId: acquiredCarrier.endpointId,
                };
            } else if (!browserHostDecision.eligible) {
                const lease = await acquireIrohHomeRuntimeOrigin({
                    homeServerIdentityId: descriptor.homeServerIdentityId,
                    endpoint: irohEndpoint,
                    descriptorRevision: descriptor.revision,
                    canonicalServerUrl: descriptor.canonicalServerUrl,
                    verification: options.verification ?? { kind: 'enrollment' },
                });
                endpointUrl = canonicalEndpointUrl;
                runtimeOrigin = approvedApplicationOrigin(lease.runtimeOrigin);
                carrier = 'iroh';
                let released = false;
                let closePromise: Promise<void> | null = null;
                close = () => {
                    if (released) return Promise.resolve();
                    closePromise ??= lease.release().then(
                        () => {
                            released = true;
                            closePromise = null;
                        },
                        (error: unknown) => {
                            closePromise = null;
                            throw error;
                        },
                    );
                    return closePromise;
                };
                if (!runtimeOrigin || lease.endpointId !== irohEndpoint.endpointId) {
                    await close().catch(() => {});
                    return {
                        ok: false,
                        homeServerIdentityId: descriptor.homeServerIdentityId,
                        reason: 'iroh_transport_failed_closed',
                    };
                }
                authenticatedCredentialDestination = { kind: 'iroh', endpointId: lease.endpointId };
            } else {
                endpointUrl = independentHttpsEndpoint;
                runtimeOrigin = independentHttpsEndpoint;
                carrier = 'https';
                if (independentHttpsEndpoint) {
                    authenticatedCredentialDestination = {
                        kind: 'https',
                        applicationUrl: independentHttpsEndpoint,
                    };
                }
            }
        } catch (error) {
            if (!classifyIrohHomeTunnelSwitchFailure(error).fallbackAllowed) {
                return {
                    ok: false,
                    homeServerIdentityId: descriptor.homeServerIdentityId,
                    reason: 'iroh_transport_failed_closed',
                };
            }
            endpointUrl = independentHttpsEndpoint;
            runtimeOrigin = independentHttpsEndpoint;
            carrier = 'https';
            if (independentHttpsEndpoint) {
                authenticatedCredentialDestination = {
                    kind: 'https',
                    applicationUrl: independentHttpsEndpoint,
                };
            }
        }
    } else {
        endpointUrl = standardEndpoint;
        runtimeOrigin = standardEndpoint;
        if (standardEndpoint) {
            authenticatedCredentialDestination = { kind: 'https', applicationUrl: standardEndpoint };
        }
    }

    if (!endpointUrl || (!runtimeOrigin && !homeCarrier)) {
        return {
            ok: false,
            homeServerIdentityId: descriptor.homeServerIdentityId,
            reason: irohEndpoint
                ? 'iroh_transport_unavailable'
                : 'no_approved_application_origin',
        };
    }

    const transport: HomeEnrollmentTransport = {
        descriptor,
        canonicalServerUrl: descriptor.canonicalServerUrl,
        homeServerIdentityId: descriptor.homeServerIdentityId,
        endpointUrl,
        runtimeOrigin,
        carrier,
        authenticatedCredentialDestination,
        homeCarrier,
        createRequest: (requestOptions = {}) => {
            const serverId = requestOptions.serverId === undefined
                ? descriptor.homeServerIdentityId
                : requestOptions.serverId;
            return createServerFetchAtEndpoint({
                endpointUrl,
                ...(runtimeOrigin ? { runtimeOrigin } : {}),
                ...(homeCarrier ? { homeCarrier } : {}),
                ...(serverId ? { serverId } : {}),
                ...('credentials' in requestOptions ? { credentials: requestOptions.credentials } : {}),
            });
        },
        close,
    };
    return { ok: true, transport };
}
