import {
    resolveTerminalProvisioningVariantV2,
    type TerminalProvisioningV2Response,
} from '@happier-dev/protocol';
import tweetnacl from 'tweetnacl';

import {
    type AuthCredentials,
    isDataKeyAuthCredentials,
    isLegacyAuthCredentials,
    isTokenOnlyAuthCredentials,
} from '@/auth/storage/tokenStorage';
import { decodeBase64 } from '@/encryption/base64';

export class LegacyProvisioningUnavailableError extends Error {
    readonly code = 'legacy_provisioning_unavailable' as const;

    constructor() {
        super('Legacy-only credentials cannot issue current provisioning material');
        this.name = 'LegacyProvisioningUnavailableError';
    }
}

function equalBytesConstantTime(left: Uint8Array, right: Uint8Array): boolean {
    if (left.length !== right.length) return false;
    let difference = 0;
    for (let index = 0; index < left.length; index += 1) {
        difference |= left[index]! ^ right[index]!;
    }
    return difference === 0;
}

/**
 * Canonical credential-material decision for terminal/Home provisioning.
 * Plain accounts are token-only; keyed accounts retain the data key and never
 * collapse it into the legacy secret field.
 */
export function resolveProvisioningMaterial(credentials: AuthCredentials): TerminalProvisioningV2Response {
    if (isDataKeyAuthCredentials(credentials)) {
        const variant = resolveTerminalProvisioningVariantV2({
            encryptionMode: 'e2ee',
            dataKeyMaterialAvailable: true,
        });
        if (variant !== 'dataKey') throw new Error('Invalid E2EE provisioning policy result');
        const key = decodeBase64(credentials.encryption.machineKey, 'base64');
        if (key.length !== 32) throw new Error('Invalid data-key credential key length');
        const publicKey = decodeBase64(credentials.encryption.publicKey, 'base64');
        if (publicKey.length !== 32) throw new Error('Invalid data-key credential public key length');
        const derivedPublicKey = tweetnacl.box.keyPair.fromSecretKey(key).publicKey;
        if (!equalBytesConstantTime(publicKey, derivedPublicKey)) {
            throw new Error('Data-key credential public key does not match its machine scalar');
        }
        return { type: 'dataKey', key };
    }

    if (isLegacyAuthCredentials(credentials)) {
        const variant = resolveTerminalProvisioningVariantV2({
            encryptionMode: 'e2ee',
            dataKeyMaterialAvailable: false,
        });
        if (variant !== 'legacyProvisioningUnavailable') {
            throw new Error('Invalid legacy provisioning policy result');
        }
        throw new LegacyProvisioningUnavailableError();
    }

    if (isTokenOnlyAuthCredentials(credentials)) {
        const variant = resolveTerminalProvisioningVariantV2({
            encryptionMode: 'plain',
            dataKeyMaterialAvailable: false,
        });
        if (variant !== 'tokenOnly') throw new Error('Invalid plain provisioning policy result');
        return { type: 'tokenOnly' };
    }

    throw new Error('Unsupported provisioning credential shape');
}
