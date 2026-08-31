import type { HomeConnectionDescriptorV1 } from '@happier-dev/protocol';
import type { AuthCredentials } from '@/auth/storage/tokenStorage';
import { createServerFetchAtEndpoint, type ServerFetch } from '@/sync/http/client';
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
    runtimeOrigin: string;
    carrier: 'https' | 'iroh';
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

function isLoopbackHostname(hostname: string): boolean {
    const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
    return normalized === 'localhost'
        || normalized === '127.0.0.1'
        || normalized === '::1'
        || normalized.endsWith('.localhost');
}

function approvedApplicationOrigin(rawUrl: string): string | null {
    try {
        const parsed = new URL(rawUrl);
        if (parsed.username || parsed.password || parsed.search || parsed.hash) return null;
        if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && isLoopbackHostname(parsed.hostname))) {
            return null;
        }
        return parsed.toString().replace(/\/+$/, '');
    } catch {
        return null;
    }
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
    let close = async (): Promise<void> => {};

    if (resolvedRuntimeOrigin) {
        endpointUrl = canonicalEndpointUrl ?? standardEndpoint;
        runtimeOrigin = resolvedRuntimeOrigin;
        carrier = options.runtimeCarrier ?? (irohEndpoint ? 'iroh' : 'https');
    } else if (irohEndpoint && canonicalEndpointUrl) {
        try {
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
            let closePromise: Promise<void> | null = null;
            close = () => {
                closePromise ??= lease.release();
                return closePromise;
            };
            if (!runtimeOrigin) {
                await close();
                return {
                    ok: false,
                    homeServerIdentityId: descriptor.homeServerIdentityId,
                    reason: 'iroh_transport_failed_closed',
                };
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
        }
    } else {
        endpointUrl = standardEndpoint;
        runtimeOrigin = standardEndpoint;
    }

    if (!endpointUrl || !runtimeOrigin) {
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
        createRequest: (requestOptions = {}) => {
            const serverId = requestOptions.serverId === undefined
                ? descriptor.homeServerIdentityId
                : requestOptions.serverId;
            return createServerFetchAtEndpoint({
                endpointUrl,
                runtimeOrigin,
                ...(serverId ? { serverId } : {}),
                ...('credentials' in requestOptions ? { credentials: requestOptions.credentials } : {}),
            });
        },
        close,
    };
    return { ok: true, transport };
}
