import type { AuthCredentials } from '@/auth/storage/tokenStorage';
import { authApproveWithTransport, type AuthApproveResult } from '@/auth/flows/approve';
import type { HomeEnrollmentTransport } from '@/auth/enrollment/homeEnrollmentTransport';
import { fetchAccountEncryptionMode } from '@/sync/api/account/apiAccountEncryptionMode';
import { isRuntimeFeatureEnabled } from '@/sync/domains/features/featureDecisionInputs';
import { encodeBase64 } from '@/encryption/base64';
import { resolveProvisioningMaterial } from './resolveProvisioningMaterial';
import { buildTerminalResponseV3, buildTerminalTokenOnlyResponseV3 } from './terminalProvisioning';

/** Pairing disclosure and issuance read the persisted mode from the exact target Home. */
export async function resolveTerminalPairingStorageMode(params: Readonly<{
    target: HomeEnrollmentTransport;
    targetCredentials: AuthCredentials;
}>): Promise<'plain' | 'e2ee'> {
    const fetchAt = params.target.createRequest({ credentials: null });
    const accountMode = await fetchAccountEncryptionMode(params.targetCredentials, {
        retry: 'none',
        request: async (path, init) => await fetchAt(path, init, { includeAuth: false }),
    });
    return accountMode.mode;
}

export async function approveTerminalPairing(params: Readonly<{
    target: HomeEnrollmentTransport;
    requesterPublicKey: Uint8Array;
    pairingContext: Readonly<{ secret: Uint8Array; createdAtMs: number; expiresAtMs: number }>;
    targetCredentials: AuthCredentials;
    supportsTokenOnly: boolean;
}>): Promise<AuthApproveResult> {
    const [storageMode, material] = await Promise.all([
        resolveTerminalPairingStorageMode(params),
        resolveProvisioningMaterial(params.targetCredentials),
    ]);
    if ((storageMode === 'plain') !== (material.type === 'tokenOnly')) {
        throw new Error('Terminal pairing credential material does not match the target Account storage mode');
    }
    let sealedResponse: Uint8Array;
    if (material.type === 'tokenOnly') {
        if (!params.supportsTokenOnly) {
            throw new Error('Token-only terminal pairing requires an authenticated compatible reader');
        }
        const [plaintextStorageEnabled, keylessAccountsEnabled] = await Promise.all([
            isRuntimeFeatureEnabled({
                featureId: 'encryption.plaintextStorage',
                scope: { scopeKind: 'spawn' as const, serverId: params.target.homeServerIdentityId },
                force: true,
            }),
            isRuntimeFeatureEnabled({
                featureId: 'e2ee.keylessAccounts',
                scope: { scopeKind: 'spawn' as const, serverId: params.target.homeServerIdentityId },
                force: true,
            }),
        ]);
        if (!plaintextStorageEnabled || !keylessAccountsEnabled) {
            throw new Error('Token-only terminal pairing is not permitted by the target Home policy');
        }
        sealedResponse = buildTerminalTokenOnlyResponseV3({
            terminalEphemeralPublicKey: params.requesterPublicKey,
            pairingSecret: params.pairingContext.secret,
            createdAtMs: params.pairingContext.createdAtMs,
            expiresAtMs: params.pairingContext.expiresAtMs,
        });
    } else {
        sealedResponse = buildTerminalResponseV3({
            contentPrivateKey: material.key,
            terminalEphemeralPublicKey: params.requesterPublicKey,
            pairingSecret: params.pairingContext.secret,
            createdAtMs: params.pairingContext.createdAtMs,
            expiresAtMs: params.pairingContext.expiresAtMs,
        });
    }

    return await authApproveWithTransport({
        transport: params.target,
        token: params.targetCredentials.token,
        publicKeyBase64: encodeBase64(params.requesterPublicKey),
        responseBase64: encodeBase64(sealedResponse),
        responseKind: material.type,
    });
}
