import { getRandomBytes } from '@/platform/cryptoRandom';
import tweetnacl from 'tweetnacl';
import { encodeBase64 } from '@/encryption/base64';
import type { HomeEnrollmentTransport } from '@/auth/enrollment/homeEnrollmentTransport';

/**
 * Explicit enrollment target. Requests are bound to this endpoint once and are never
 * re-resolved through the focused-Home selector, so changing focus cannot retarget an
 * in-flight enrollment.
 */
export type HomeQrEnrollmentTarget = HomeEnrollmentTransport & Readonly<{
    serverId?: string | null;
}>;

export interface QRAuthKeyPair {
    publicKey: Uint8Array;
    secretKey: Uint8Array;
}

export function generateAuthKeyPair(): QRAuthKeyPair {
    const secret = getRandomBytes(32);
    const keypair = tweetnacl.box.keyPair.fromSecretKey(secret);
    return {
        publicKey: keypair.publicKey,
        secretKey: keypair.secretKey,
    };
}

/**
 * Register the joining device's box public key with the explicit target Home. Enrollment
 * never consults or mutates focused-Home state.
 */
export async function authQRStart(
    keypair: QRAuthKeyPair,
    target: HomeQrEnrollmentTarget,
    options: Readonly<{ signal?: AbortSignal }> = {},
): Promise<boolean> {
    if (options.signal?.aborted) return false;
    const endpointUrl = target.endpointUrl.trim().replace(/\/+$/, '');
    if (!endpointUrl || !/^https?:\/\//i.test(endpointUrl)) return false;
    try {
        const requestAtEndpoint = target.createRequest({
            ...(target.serverId ? { serverId: target.serverId } : {}),
            credentials: null,
        });
        const response = await requestAtEndpoint(
            '/v2/auth/account/request',
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    publicKey: encodeBase64(keypair.publicKey),
                }),
                ...(options.signal ? { signal: options.signal } : {}),
            },
            { includeAuth: false, retry: 'none' },
        );
        return response.ok;
    } catch {
        // The joining device surfaces a typed failure; polling owns transient retries.
        return false;
    }
}
