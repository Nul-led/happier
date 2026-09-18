import { describe, expect, it } from 'vitest';
import {
    prepareE2eeAccountPasswordCredentialV1,
    preparePlainAccountPasswordCredentialV1,
    verifyPlainAccountPasswordCredentialV1,
} from './accountPasswordCredentialPreparation';

describe('account password credential preparation', () => {
    it('rejects text that the canonical acceptance owner rejects', async () => {
        expect(await preparePlainAccountPasswordCredentialV1('too short')).toEqual({
            ok: false,
            reason: 'too_few_scalars',
        });
        expect(await preparePlainAccountPasswordCredentialV1(`valid-password-${String.fromCharCode(0xd800)}`)).toEqual({
            ok: false,
            reason: 'malformed_unicode',
        });
    });

    it('produces freshly salted Plain credentials that verify only the exact accepted text', async () => {
        const password = 'cafe\u0301 password one';
        const first = await preparePlainAccountPasswordCredentialV1(password);
        const second = await preparePlainAccountPasswordCredentialV1(password);

        expect(first.ok).toBe(true);
        expect(second.ok).toBe(true);
        if (!first.ok || !second.ok) throw new Error('accepted password was rejected');

        expect(first.credential.hash.salt).not.toBe(second.credential.hash.salt);
        expect(first.credential.hash.digest).not.toBe(second.credential.hash.digest);
        await expect(verifyPlainAccountPasswordCredentialV1(first.credential, password)).resolves.toBe(true);
        await expect(verifyPlainAccountPasswordCredentialV1(first.credential, 'caf\u00e9 password one')).resolves.toBe(false);
    });

    it('rejects a malformed E2EE envelope', async () => {
        expect(await prepareE2eeAccountPasswordCredentialV1({
            envelope: {} as never,
            authKey: 'A'.repeat(43),
        })).toEqual({ ok: false, reason: 'invalid_envelope' });
    });
});
