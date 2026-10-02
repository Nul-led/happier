import { encodeBase64 } from '@happier-dev/protocol';
import { parseTerminalAuthApprovalRequestPacket, type TerminalConnectPairingContext } from '@happier-dev/cli-common/links';
import { isLegacyAuthCredentials, type AuthCredentials } from '@/auth/storage/tokenStorage';
import { decodeBase64 } from '@/encryption/base64';
import { fetchAccountEncryptionMode } from '@/sync/api/account/apiAccountEncryptionMode';
import { isRuntimeFeatureEnabled } from '@/sync/domains/features/featureDecisionInputs';
import { resolveProvisioningMaterial } from './resolveProvisioningMaterial';
import { buildTerminalResponseV1, buildTerminalResponseV2, buildTerminalResponseV3, buildTerminalTokenOnlyResponseV3 } from './terminalProvisioning';

export class TokenOnlyTerminalApprovalReaderRequiredError extends Error {
    constructor() {
        super('Token-only terminal pairing requires an authenticated compatible reader');
        this.name = 'TokenOnlyTerminalApprovalReaderRequiredError';
    }
}

/** Native QR and SSH approval share credential, capability and Account policy decisions. */
export async function buildTerminalApprovalResponses(params: Readonly<{
    credentials: AuthCredentials;
    publicKey: Uint8Array;
    pairing?: TerminalConnectPairingContext;
    supportsTokenOnly?: boolean;
    allowLegacySecretExportEnabled: boolean;
}>): Promise<Readonly<{ responseV1: Uint8Array | (() => Uint8Array); responseV2: Uint8Array }>> {
    const request = parseTerminalAuthApprovalRequestPacket({
        publicKey: encodeBase64(params.publicKey),
        ...(params.pairing ? { pairing: params.pairing } : {}),
        supportsTokenOnly: params.supportsTokenOnly,
    }, []);
    const material = resolveProvisioningMaterial(params.credentials);
    let responseV2: Uint8Array;
    if (material.type === 'tokenOnly') {
        if (!request.pairing || request.supportsTokenOnly !== true) {
            throw new TokenOnlyTerminalApprovalReaderRequiredError();
        }
        const [accountMode, plaintextStorageEnabled, keylessAccountsEnabled] = await Promise.all([
            fetchAccountEncryptionMode(params.credentials, { retry: 'none' }),
            isRuntimeFeatureEnabled({ featureId: 'encryption.plaintextStorage' }),
            isRuntimeFeatureEnabled({ featureId: 'e2ee.keylessAccounts' }),
        ]);
        if (accountMode.mode !== 'plain' || !plaintextStorageEnabled || !keylessAccountsEnabled) {
            throw new Error('Token-only terminal pairing is not permitted by the active account policy');
        }
        responseV2 = buildTerminalTokenOnlyResponseV3({
            terminalEphemeralPublicKey: params.publicKey,
            pairingSecret: decodeBase64(request.pairing.secretB64Url, 'base64url'),
            createdAtMs: request.pairing.createdAtMs,
            expiresAtMs: request.pairing.expiresAtMs,
        });
    } else {
        responseV2 = request.pairing
            ? buildTerminalResponseV3({
                contentPrivateKey: material.key,
                terminalEphemeralPublicKey: params.publicKey,
                pairingSecret: decodeBase64(request.pairing.secretB64Url, 'base64url'),
                createdAtMs: request.pairing.createdAtMs,
                expiresAtMs: request.pairing.expiresAtMs,
            })
            : buildTerminalResponseV2({ contentPrivateKey: material.key, terminalEphemeralPublicKey: params.publicKey });
    }
    // Relay capability flags choose transport only; authenticated readers always receive v3.
    const legacyCredentials = isLegacyAuthCredentials(params.credentials) ? params.credentials : null;
    const responseV1 = request.pairing
        ? responseV2
        : params.allowLegacySecretExportEnabled && legacyCredentials
            ? () => buildTerminalResponseV1({ legacySecretB64Url: legacyCredentials.secret, terminalEphemeralPublicKey: params.publicKey })
            : new Uint8Array();
    return { responseV1, responseV2 };
}
