import { describe, expect, it } from 'vitest';

import sodium from '@/encryption/libsodium.lib';
import { encodeBase64 } from '@/encryption/base64';
import type { AuthCredentials, LegacyAuthCredentials } from '@/auth/storage/tokenStorage';
import {
    deriveSettingsSecretsKeySet,
    encryptSecretString,
    type SecretString,
} from '@/sync/encryption/secretSettings';

import { createRunnerCreatorSecretReader } from './runnerCreatorSecretReader';

const SCOPE = { serverId: 'srv-runner', accountId: 'account-a' } as const;

function legacyCredentials(secret: Uint8Array): AuthCredentials {
    return { token: 'token-a', secret: encodeBase64(secret, 'base64url') } satisfies LegacyAuthCredentials;
}

function sealedForAccount(secret: Uint8Array, value: string): SecretString {
    return {
        _isSecretValue: true,
        encryptedValue: encryptSecretString(
            value,
            deriveSettingsSecretsKeySet({ type: 'legacy', secret }).writeKey,
        ),
    };
}

describe('Temporary computer creator settings-secret reader', () => {
    it('opens the exact target Account secret and refuses another Account material', async () => {
        const targetSecret = new Uint8Array(32).fill(7);
        const sealed = sealedForAccount(targetSecret, 'sk-reviewed-value');

        const readForTarget = await createRunnerCreatorSecretReader({
            credentials: legacyCredentials(targetSecret),
            scope: SCOPE,
        });
        const readForAnotherAccount = await createRunnerCreatorSecretReader({
            credentials: legacyCredentials(new Uint8Array(32).fill(9)),
            scope: SCOPE,
        });

        expect(readForTarget(sealed)).toBe('sk-reviewed-value');
        expect(readForAnotherAccount(sealed)).toBeNull();
    });

    it('does not open a settings secret with the Account content public key', async () => {
        // `Encryption.contentDataKey` is the content key *pair's public key*, not
        // the derived settings-secret key, so reading reviewed Profile/MCP or
        // Connected Service secrets through it yields nothing at all — a launch
        // built that way ships an empty environment instead of failing loudly.
        const targetSecret = new Uint8Array(32).fill(7);
        const sealed = sealedForAccount(targetSecret, 'sk-reviewed-value');
        const contentPublicKey = sodium.crypto_box_seed_keypair(targetSecret).publicKey;

        const read = await createRunnerCreatorSecretReader({
            credentials: legacyCredentials(contentPublicKey),
            scope: SCOPE,
        });

        expect(read(sealed)).toBeNull();
    });

    it('passes an unencrypted reviewed value straight through', async () => {
        const read = await createRunnerCreatorSecretReader({
            credentials: legacyCredentials(new Uint8Array(32).fill(7)),
            scope: SCOPE,
        });

        expect(read({ _isSecretValue: true, value: 'not-a-secret' })).toBe('not-a-secret');
        expect(read(null)).toBeNull();
    });
});
