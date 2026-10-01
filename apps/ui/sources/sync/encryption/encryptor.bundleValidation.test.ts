import { describe, expect, it } from 'vitest';
import { AES256Encryption } from './encryptor';

describe('AES256Encryption version-0 framing', () => {
    it('rejects a truncated bundle before the platform cipher can return a value', async () => {
        // Native cryptography is the boundary; framing admission belongs to the shared format owner.
        const reader = new AES256Encryption(new Uint8Array(32), {
            decryptString: async () => '{"message":"unframed"}',
        });
        const failures: number[] = [];
        expect(await reader.decrypt([new Uint8Array([0])], {
            onAuthenticationFailure: (index) => failures.push(index),
        })).toEqual([null]);
        expect(failures).toEqual([0]);
    });
});
