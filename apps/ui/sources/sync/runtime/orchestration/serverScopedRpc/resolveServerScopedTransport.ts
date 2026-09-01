import type { AuthCredentials } from '@/auth/storage/tokenStorage';
import {
    canonicalizeServerUrl,
    resolveIndependentHttpsServerOrigin,
} from '@/sync/domains/server/url/serverUrlCanonical';
import {
    acquireIrohHomeRuntimeOrigin,
    classifyIrohHomeTunnelSwitchFailure,
} from '@/sync/runtime/nativeIrohTunnels';
import type { IrohEndpointDescriptorV1 } from '@happier-dev/protocol';

export class ServerScopedTransportUnavailableError extends Error {
    constructor() {
        super('No verified transport is available for the target Home');
        this.name = 'ServerScopedTransportUnavailableError';
    }
}

type ServerTransportProfile = Readonly<{
    serverUrl: string;
    canonicalServerUrl?: string | null;
    publicServerUrl?: string | null;
    serverIdentityId?: string | null;
    irohEndpoint?: IrohEndpointDescriptorV1;
    connectionDescriptorRevision?: number;
}>;

export type ResolvedServerScopedTransport = Readonly<{
    canonicalServerUrl: string;
    runtimeOrigin: string;
    carrier: 'https' | 'iroh';
    /** Native lifecycle identity, present only for an acquired Iroh carrier. */
    leaseId?: string;
    release: () => Promise<void>;
}>;

function onceAsync(release: () => Promise<void>): () => Promise<void> {
    let result: Promise<void> | null = null;
    return () => {
        result ??= release();
        return result;
    };
}

/**
 * Resolves one Home's stable identity/audience and acquired request carrier.
 * Canonical identity remains the reachability key; the verified runtime origin
 * is mutable transport metadata and is never persisted as the Home URL.
 */
export async function resolveServerScopedTransport(params: Readonly<{
    profile: ServerTransportProfile;
    credentials: AuthCredentials;
}>): Promise<ResolvedServerScopedTransport> {
    const canonicalServerUrl = canonicalizeServerUrl(
        String(params.profile.canonicalServerUrl ?? params.profile.serverUrl),
    );
    if (!canonicalServerUrl) throw new ServerScopedTransportUnavailableError();

    let runtimeOrigin = canonicalServerUrl;
    let carrier: 'https' | 'iroh' = 'https';
    let leaseId: string | undefined;
    let releaseCarrier = async (): Promise<void> => {};
    const identity = String(params.profile.serverIdentityId ?? '').trim();
    const endpoint = params.profile.irohEndpoint;

    if (identity && endpoint) {
        try {
            const lease = await acquireIrohHomeRuntimeOrigin({
                homeServerIdentityId: identity,
                endpoint,
                ...(params.profile.connectionDescriptorRevision === undefined
                    ? {}
                    : { descriptorRevision: params.profile.connectionDescriptorRevision }),
                canonicalServerUrl,
                verification: { kind: 'authenticated', token: params.credentials.token },
            });
            runtimeOrigin = lease.runtimeOrigin;
            carrier = 'iroh';
            leaseId = lease.leaseId;
            releaseCarrier = onceAsync(lease.release);
        } catch (error) {
            if (!classifyIrohHomeTunnelSwitchFailure(error).fallbackAllowed) throw error;
            const independentHttpsOrigin = resolveIndependentHttpsServerOrigin(
                params.profile.publicServerUrl ?? '',
            );
            if (!independentHttpsOrigin) throw new ServerScopedTransportUnavailableError();
            runtimeOrigin = independentHttpsOrigin;
        }
    }

    return {
        canonicalServerUrl,
        runtimeOrigin,
        carrier,
        ...(leaseId ? { leaseId } : {}),
        release: releaseCarrier,
    };
}
