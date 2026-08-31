import { encodeBase64 } from "@/encryption/base64";
import type { HomeQrEnrollmentTarget } from './qrStart';

export class InvalidAccountApprovalTargetError extends Error {
    readonly code = 'invalid_target' as const;

    constructor() {
        super('Account approval target does not match the bound Home identity');
        this.name = 'InvalidAccountApprovalTargetError';
    }
}

export async function authAccountApprove(params: Readonly<{
    token: string;
    target: HomeQrEnrollmentTarget;
    pairId: string;
    publicKey: Uint8Array;
    response: Uint8Array;
    homeServerIdentityId: string;
    responseKind: 'tokenOnly' | 'dataKey';
}>): Promise<'approved' | 'already_completed'> {
    if (params.target.descriptor.homeServerIdentityId !== params.homeServerIdentityId) {
        throw new InvalidAccountApprovalTargetError();
    }
    const request = params.target.createRequest({
        ...(params.target.serverId ? { serverId: params.target.serverId } : {}),
        credentials: { token: params.token },
    });
    const response = await request('/v1/auth/account/response', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            pairId: params.pairId,
            publicKey: encodeBase64(params.publicKey),
            response: encodeBase64(params.response),
            homeServerIdentityId: params.homeServerIdentityId,
            responseKind: params.responseKind,
        }),
    }, { includeAuth: true, retry: 'none' });
    if (response.ok) return 'approved';
    if (response.status === 409) {
        const body: unknown = await response.json().catch(() => null);
        if (body && typeof body === 'object' && !Array.isArray(body) && (body as Record<string, unknown>).error === 'already_completed') {
            return 'already_completed';
        }
    }
    throw new Error(`Failed to approve account auth request: ${response.status}`);
}
