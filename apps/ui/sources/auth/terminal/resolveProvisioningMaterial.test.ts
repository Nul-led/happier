import { describe, expect, it } from 'vitest';
import tweetnacl from 'tweetnacl';
import { encodeBase64 } from '@/encryption/base64';
import {
    LegacyProvisioningUnavailableError,
    resolveProvisioningMaterial,
} from './resolveProvisioningMaterial';

describe('resolveProvisioningMaterial', () => {
    it('returns token-only for plain credentials', () => {
        expect(resolveProvisioningMaterial({ token: 't' })).toEqual({ type: 'tokenOnly' });
    });

    it('retains a valid data key', () => {
        const key = new Uint8Array(32).fill(3);
        const publicKey = tweetnacl.box.keyPair.fromSecretKey(key).publicKey;
        expect(resolveProvisioningMaterial({
            token: 't',
            encryption: { publicKey: encodeBase64(publicKey), machineKey: encodeBase64(key) },
        })).toEqual({ type: 'dataKey', key });
    });

    it('rejects data-key credentials whose public key does not derive from the machine scalar', () => {
        const key = new Uint8Array(32).fill(3);
        expect(() => resolveProvisioningMaterial({
            token: 't',
            encryption: { publicKey: encodeBase64(new Uint8Array(32).fill(9)), machineKey: encodeBase64(key) },
        })).toThrow('public key does not match');
    });

    it('does not convert a legacy recovery secret into newly issued provisioning material', () => {
        expect(() => resolveProvisioningMaterial({
            token: 't',
            secret: encodeBase64(new Uint8Array(32).fill(4), 'base64url'),
        })).toThrow(LegacyProvisioningUnavailableError);
    });
});
