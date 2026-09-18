import { describe, expect, it } from 'vitest';
import tweetnacl from 'tweetnacl';
import { deriveBoxPublicKeyFromSeed, openEncryptedDataKeyEnvelopeV1, signAccountContentKeyBindingV1 } from '@happier-dev/protocol';
import { Encryption } from './encryption';
import { encryptDataKeyForRecipientV0 } from './directShareEncryption';
import { prepareLegacySessionShareRequest } from './prepareLegacySessionShareRequest';
import { decodeBase64, encodeBase64 } from '@/encryption/base64';
import { encodeHex } from '@/encryption/hex';

async function fixture() {
    const encryption = await Encryption.create(new Uint8Array(32).fill(3));
    const signing = tweetnacl.sign.keyPair.fromSeed(new Uint8Array(32).fill(4));
    const recipientSeed = new Uint8Array(32).fill(5);
    const contentPublicKey = deriveBoxPublicKeyFromSeed(recipientSeed);
    const dataKey = new Uint8Array(32).fill(6);
    return {
        encryption,
        recipientSeed,
        dataKey,
        callerDataKeyEnvelope: encryptDataKeyForRecipientV0(dataKey, encodeBase64(encryption.contentDataKey, 'base64')),
        recipient: {
            id: 'recipient',
            publicKey: encodeHex(signing.publicKey),
            contentPublicKey: encodeBase64(contentPublicKey, 'base64'),
            contentPublicKeySig: encodeBase64(signAccountContentKeyBindingV1({accountSigningSecretKey: signing.secretKey,contentPublicKey}), 'base64'),
        },
    };
}

describe('released direct-share request preparation', () => {
    it('reseals the captured caller envelope for the verified recipient, without relying on warm session keys', async () => {
        const input = await fixture();
        const result = await prepareLegacySessionShareRequest({...input, sessionEncryptionMode: 'e2ee',accessLevel: 'edit',canApprovePermissions: true});
        expect(result.userId).toBe('recipient');
        expect(result.canApprovePermissions).toBe(true);
        expect(openEncryptedDataKeyEnvelopeV1({envelope:decodeBase64(result.encryptedDataKey!, 'base64'),recipientSecretKeyOrSeed:input.recipientSeed})).toEqual(input.dataKey);
    });
    it('plain sharing requires no recipient or caller encryption material', async () => {
        const result = await prepareLegacySessionShareRequest({sessionEncryptionMode:'plain',callerDataKeyEnvelope:null,encryption:null,recipient:{id:'recipient',publicKey:null,contentPublicKey:null,contentPublicKeySig:null},accessLevel:'view',canApprovePermissions:false});
        expect(result).toEqual({userId:'recipient',accessLevel:'view',canApprovePermissions:false});
    });
    it('refuses a legacy account-key fallback and a forged recipient binding', async () => {
        const input = await fixture();
        await expect(prepareLegacySessionShareRequest({...input,callerDataKeyEnvelope:null,sessionEncryptionMode:'e2ee',accessLevel:'view',canApprovePermissions:false})).rejects.toThrow();
        await expect(prepareLegacySessionShareRequest({...input,recipient:{...input.recipient,publicKey:encodeHex(tweetnacl.sign.keyPair.fromSeed(new Uint8Array(32).fill(9)).publicKey)},sessionEncryptionMode:'e2ee',accessLevel:'view',canApprovePermissions:false})).rejects.toThrow();
    });
});
