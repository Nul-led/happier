import { encodeBase64 } from '@/encryption/base64';
import type { HomeQrEnrollmentTarget } from './qrStart';

export class InvalidAccountCompletionTargetError extends Error {
    readonly code = 'invalid_target' as const;

    constructor() {
        super('Account completion target does not match the bound Home identity');
        this.name = 'InvalidAccountCompletionTargetError';
    }
}

export class AccountCompletionError extends Error {
    readonly code = 'account_completion_failed' as const;

    constructor(readonly status: number, readonly retryable: boolean) {
        super(`Failed to complete account auth request: ${status}`);
        this.name = 'AccountCompletionError';
    }
}

export async function completeAccountAuthRequest(params: Readonly<{
    token: string;
    target: HomeQrEnrollmentTarget;
    pairId: string;
    publicKey: Uint8Array;
    response: Uint8Array;
    homeServerIdentityId: string;
    responseKind: 'tokenOnly' | 'dataKey';
    signal?: AbortSignal;
}>): Promise<'completed' | 'already_completed'> {
    if (params.target.descriptor.homeServerIdentityId !== params.homeServerIdentityId) {
        throw new InvalidAccountCompletionTargetError();
    }
    if (params.signal?.aborted) throw new AccountCompletionError(0, true);
    const request = params.target.createRequest({
        ...(params.target.serverId ? { serverId: params.target.serverId } : {}),
        credentials: { token: params.token },
    });
    let response: Response;
    try {
        response = await request('/v1/auth/account/response', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            ...(params.signal ? { signal: params.signal } : {}),
            body: JSON.stringify({
                pairId: params.pairId,
                publicKey: encodeBase64(params.publicKey),
                response: encodeBase64(params.response),
                homeServerIdentityId: params.homeServerIdentityId,
                responseKind: params.responseKind,
            }),
        }, { includeAuth: true, retry: 'none' });
    } catch {
        throw new AccountCompletionError(0, true);
    }
    if (response.ok) return 'completed';
    if (response.status === 409) {
        const body: unknown = await response.json().catch(() => null);
        if (body && typeof body === 'object' && !Array.isArray(body) && (body as Record<string, unknown>).error === 'already_completed') {
            return 'already_completed';
        }
    }
    throw new AccountCompletionError(
        response.status,
        response.status === 408 || response.status === 429 || response.status >= 500,
    );
}
