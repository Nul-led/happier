import { describe, expect, it } from 'vitest';
import tweetnacl from 'tweetnacl';
import { encodeBase64 } from '@/encryption/base64';
import { createEncryptionFromAuthCredentials } from '@/auth/encryption/createEncryptionFromAuthCredentials';
import { resolveProvisioningMaterial } from './resolveProvisioningMaterial';

describe('resolveProvisioningMaterial', () => {
    it('returns token-only for plain credentials', async () => {
        await expect(resolveProvisioningMaterial({ token: 't' })).resolves.toEqual({ type: 'tokenOnly' });
    });

    it('retains a valid data key', async () => {
        const key = new Uint8Array(32).fill(3);
        const publicKey = tweetnacl.box.keyPair.fromSecretKey(key).publicKey;
        await expect(resolveProvisioningMaterial({
            token: 't',
            encryption: { publicKey: encodeBase64(publicKey), machineKey: encodeBase64(key) },
        })).resolves.toEqual({ type: 'dataKey', key });
    });

    it('rejects data-key credentials whose public key does not derive from the machine scalar', async () => {
        const key = new Uint8Array(32).fill(3);
        await expect(resolveProvisioningMaterial({
            token: 't',
            encryption: { publicKey: encodeBase64(new Uint8Array(32).fill(9)), machineKey: encodeBase64(key) },
        })).rejects.toThrow('public key does not match');
    });

    it('resolves secret credentials to the same dataKey material as the canonical encryption owner', async () => {
        const secret = new Uint8Array(32).fill(4);
        const credentials = { token: 't', secret: encodeBase64(secret, 'base64url') } as const;
        const canonical = (await createEncryptionFromAuthCredentials(credentials)).getContentPrivateKey();
        expect(canonical).not.toEqual(secret);
        await expect(resolveProvisioningMaterial(credentials)).resolves.toEqual({ type: 'dataKey', key: canonical });
    });

    it('rejects malformed secret credentials instead of issuing material', async () => {
        await expect(resolveProvisioningMaterial({
            token: 't',
            secret: encodeBase64(new Uint8Array(16).fill(4), 'base64url'),
        })).rejects.toThrow('Invalid secret key length');
    });
});
