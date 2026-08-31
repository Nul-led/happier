import { createServerFetchAtEndpoint } from '@/sync/http/client';

interface AuthRequestStatus {
    status: 'not_found' | 'pending' | 'authorized';
    supportsV2: boolean;
}

export type AuthApproveResult = 'approved' | 'already_authorized' | 'not_found';

type AuthRequestFetcher = (
    path: string,
    init?: RequestInit,
    options?: { includeAuth: boolean },
) => Promise<Response>;

async function readAuthRequestStatus(fetchAt: AuthRequestFetcher, publicKeyBase64: string): Promise<AuthRequestStatus> {
    const statusResponse = await fetchAt(`/v1/auth/request/status?publicKey=${encodeURIComponent(publicKeyBase64)}`, {
        method: 'GET',
    }, { includeAuth: false });
    if (!statusResponse.ok) {
        throw new Error(`Failed to check auth status: ${statusResponse.status}`);
    }
    return await statusResponse.json() as AuthRequestStatus;
}

export type AuthApproveAtEndpointParams = Readonly<{
    /** Explicit target Home endpoint; never resolved from the focused Home. */
    endpointUrl: string;
    serverId?: string;
    /** Bearer for the target Home only; it authorizes the POST and is never sent as payload. */
    token: string;
    publicKeyBase64: string;
    /** Opaque sealed response prepared by the pairing requester (carries no credential). */
    responseBase64: string;
    /** Canonical provisioning discriminant; must match the sealed v3 payload bytes. */
    responseKind: 'tokenOnly' | 'dataKey';
}>;

/**
 * Explicit-endpoint terminal approval owner. Approves a terminal pairing request on a
 * named Home without consulting or switching the focused Home. The response payload is opaque
 * sealed v3 material; the caller's bearer is used only as the request's Authorization header.
 * The retired active-server `authApprove` (untyped V1/V2 writer) was removed once
 * `useConnectTerminal` and the native SSH system task migrated here.
 */
export async function authApproveAtEndpoint(params: AuthApproveAtEndpointParams): Promise<AuthApproveResult> {
    const publicKeyBase64 = params.publicKeyBase64.trim();
    if (!publicKeyBase64) {
        throw new Error('Failed to approve auth request: missing public key');
    }
    const fetchAt = createServerFetchAtEndpoint({
        endpointUrl: params.endpointUrl,
        ...(params.serverId ? { serverId: params.serverId } : {}),
        credentials: null,
    });

    const statusData = await readAuthRequestStatus(fetchAt, publicKeyBase64);
    if (statusData.status === 'not_found') {
        return 'not_found';
    }
    if (statusData.status === 'authorized') {
        return 'already_authorized';
    }

    const response = await fetchAt('/v1/auth/response', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${params.token}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            publicKey: publicKeyBase64,
            response: params.responseBase64,
            responseKind: params.responseKind,
        }),
    }, { includeAuth: false });
    if (!response.ok) {
        throw new Error(`Failed to approve auth request: ${response.status}`);
    }
    return 'approved';
}
