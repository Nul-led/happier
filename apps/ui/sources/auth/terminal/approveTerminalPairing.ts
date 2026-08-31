import type { AuthCredentials } from '@/auth/storage/tokenStorage';
import { authApproveAtEndpoint, type AuthApproveResult } from '@/auth/flows/approve';
import { fetchAccountEncryptionMode } from '@/sync/api/account/apiAccountEncryptionMode';
import { isRuntimeFeatureEnabled } from '@/sync/domains/features/featureDecisionInputs';
import { createServerFetchAtEndpoint } from '@/sync/http/client';
import { encodeBase64 } from '@/encryption/base64';
import { resolveProvisioningMaterial } from './resolveProvisioningMaterial';
import { buildTerminalResponseV3, buildTerminalTokenOnlyResponseV3 } from './terminalProvisioning';

export type TerminalApprovalTarget = Readonly<{
    endpointUrl: string;
    serverId?: string;
}>;

export async function approveTerminalPairing(params: Readonly<{
    target: TerminalApprovalTarget;
    requesterPublicKey: Uint8Array;
    pairingContext: Readonly<{ secret: Uint8Array; createdAtMs: number; expiresAtMs: number }>;
    targetCredentials: AuthCredentials;
    supportsTokenOnly: boolean;
}>): Promise<AuthApproveResult> {
    const material = resolveProvisioningMaterial(params.targetCredentials);
    let sealedResponse: Uint8Array;
    if (material.type === 'tokenOnly') {
        if (!params.supportsTokenOnly) {
            throw new Error('Token-only terminal pairing requires an authenticated compatible reader');
        }
        const fetchAt = createServerFetchAtEndpoint({
            endpointUrl: params.target.endpointUrl,
            ...(params.target.serverId ? { serverId: params.target.serverId } : {}),
            credentials: null,
        });
        const [accountMode, plaintextStorageEnabled, keylessAccountsEnabled] = await Promise.all([
            fetchAccountEncryptionMode(params.targetCredentials, {
                retry: 'none',
                request: async (path, init) => await fetchAt(path, init, { includeAuth: false }),
            }),
            isRuntimeFeatureEnabled({
                featureId: 'encryption.plaintextStorage',
                ...(params.target.serverId
                    ? { scope: { scopeKind: 'spawn' as const, serverId: params.target.serverId }, force: true }
                    : {}),
            }),
            isRuntimeFeatureEnabled({
                featureId: 'e2ee.keylessAccounts',
                ...(params.target.serverId
                    ? { scope: { scopeKind: 'spawn' as const, serverId: params.target.serverId }, force: true }
                    : {}),
            }),
        ]);
        if (accountMode.mode !== 'plain' || !plaintextStorageEnabled || !keylessAccountsEnabled) {
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

    return await authApproveAtEndpoint({
        ...params.target,
        token: params.targetCredentials.token,
        publicKeyBase64: encodeBase64(params.requesterPublicKey),
        responseBase64: encodeBase64(sealedResponse),
        responseKind: material.type,
    });
}
