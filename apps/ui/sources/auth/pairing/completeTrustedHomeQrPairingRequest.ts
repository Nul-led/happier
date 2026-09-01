import { completeAccountAuthRequest } from '@/auth/flows/accountCompletion';
import type { HomeQrEnrollmentTarget } from '@/auth/flows/qrStart';
import { TokenStorage } from '@/auth/storage/tokenStorage';
import { resolveProvisioningMaterial } from '@/auth/terminal/resolveProvisioningMaterial';
import { buildTerminalResponseV3, buildTerminalTokenOnlyResponseV3 } from '@/auth/terminal/terminalProvisioning';
import { decodeBase64 } from '@/encryption/base64';
import type { PairingStatus } from '@/sync/api/account/apiPairingAuth';
import {
    deriveHomeQrBindingKeyV2,
    verifyHomeQrBindingProofV2,
    type HomeQrInviteDirectionV2,
} from '@happier-dev/protocol';

export type TrustedHomeQrCompletionContext = Readonly<{
    direction: HomeQrInviteDirectionV2;
    pairId: string;
    target: HomeQrEnrollmentTarget;
    qrSecret: Uint8Array;
    issuedAtMs: number;
    expiresAtMs: number;
    expectedRequesterPublicKeyBase64?: string;
}>;

export class InvalidTrustedHomeQrRequestError extends Error {
    readonly code = 'invalid_trusted_home_qr_request' as const;

    constructor() {
        super('The Home QR request did not match the captured invite');
        this.name = 'InvalidTrustedHomeQrRequestError';
    }
}

function decodeRequesterPublicKey(value: string): Uint8Array | null {
    try {
        const decoded = decodeBase64(value, 'base64');
        return decoded.length === 32 ? decoded : null;
    } catch {
        return null;
    }
}

/** Single trusted-device completion owner shared by both QR display directions. */
export async function completeTrustedHomeQrPairingRequest(input: Readonly<{
    context: TrustedHomeQrCompletionContext;
    status: Extract<PairingStatus, { state: 'requested' }>;
    signal?: AbortSignal;
}>): Promise<'completed' | 'already_completed'> {
    const { context, status } = input;
    const requesterPublicKey = decodeRequesterPublicKey(status.requestedPublicKey);
    const responseExpiresAtMs = Date.parse(status.expiresAt);
    const nowMs = Date.now();
    if (
        !requesterPublicKey
        || context.qrSecret.length !== 32
        || status.pairId !== context.pairId
        || status.homeServerIdentityId !== context.target.descriptor.homeServerIdentityId
        || responseExpiresAtMs !== context.expiresAtMs
        || nowMs < context.issuedAtMs
        || nowMs >= context.expiresAtMs
        || (context.expectedRequesterPublicKeyBase64 !== undefined
            && context.expectedRequesterPublicKeyBase64 !== status.requestedPublicKey)
        || !verifyHomeQrBindingProofV2({
            direction: context.direction,
            qrSecret: context.qrSecret,
            pairId: context.pairId,
            homeServerIdentityId: context.target.descriptor.homeServerIdentityId,
            requesterPublicKey,
            expiresAtMs: context.expiresAtMs,
        }, status.bindingProof)
    ) {
        throw new InvalidTrustedHomeQrRequestError();
    }

    const credentials = await TokenStorage.getCredentialsForServerUrl(
        context.target.descriptor.canonicalServerUrl,
        { serverId: context.target.serverId },
    );
    if (!credentials) throw new InvalidTrustedHomeQrRequestError();
    const material = resolveProvisioningMaterial(credentials);
    const common = {
        terminalEphemeralPublicKey: requesterPublicKey,
        pairingSecret: deriveHomeQrBindingKeyV2(context.qrSecret),
        createdAtMs: context.issuedAtMs,
        expiresAtMs: context.expiresAtMs,
    };
    const response = material.type === 'tokenOnly'
        ? buildTerminalTokenOnlyResponseV3(common)
        : buildTerminalResponseV3({ ...common, contentPrivateKey: material.key });

    return await completeAccountAuthRequest({
        token: credentials.token,
        target: context.target,
        pairId: context.pairId,
        publicKey: requesterPublicKey,
        response,
        homeServerIdentityId: context.target.descriptor.homeServerIdentityId,
        responseKind: material.type,
        signal: input.signal,
    });
}
