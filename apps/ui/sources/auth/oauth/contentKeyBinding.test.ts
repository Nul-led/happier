import { describe, expect, it, vi } from 'vitest';
import tweetnacl from 'tweetnacl';
import {
    deriveBoxPublicKeyFromSeed,
    verifyAccountContentKeyBindingV1,
} from '@happier-dev/protocol';

const CONTENT_KEY_SEED = new Uint8Array(32).fill(3);

// Only the Account encryption boundary is faked; the binding bytes and the
// signature under test stay real.
vi.mock('@/sync/encryption/encryption', () => ({
    Encryption: {
        create: async () => ({
            contentDataKey: deriveBoxPublicKeyFromSeed(CONTENT_KEY_SEED),
        }),
    },
}));

describe('buildContentKeyBinding', () => {
    it('emits a binding the canonical protocol verifier accepts for this Account key', async () => {
        const { buildContentKeyBinding } = await import('./contentKeyBinding');
        const { decodeBase64 } = await import('@/encryption/base64');
        const accountSecret = new Uint8Array(32).fill(9);

        const result = await buildContentKeyBinding(accountSecret);

        const verified = verifyAccountContentKeyBindingV1({
            accountSigningPublicKey: tweetnacl.sign.keyPair.fromSeed(accountSecret).publicKey,
            contentPublicKey: decodeBase64(result.contentPublicKey),
            signature: decodeBase64(result.contentPublicKeySig),
        });

        expect(verified).not.toBeNull();
        expect(Array.from(verified!.contentPublicKey))
            .toEqual(Array.from(deriveBoxPublicKeyFromSeed(CONTENT_KEY_SEED)));
    });

    it('does not produce a binding another Account signing key can claim', async () => {
        const { buildContentKeyBinding } = await import('./contentKeyBinding');
        const { decodeBase64 } = await import('@/encryption/base64');

        const result = await buildContentKeyBinding(new Uint8Array(32).fill(9));

        expect(verifyAccountContentKeyBindingV1({
            accountSigningPublicKey: tweetnacl.sign.keyPair.fromSeed(
                new Uint8Array(32).fill(10),
            ).publicKey,
            contentPublicKey: decodeBase64(result.contentPublicKey),
            signature: decodeBase64(result.contentPublicKeySig),
        })).toBeNull();
    });
});
