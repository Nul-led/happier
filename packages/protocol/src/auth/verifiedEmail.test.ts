import { describe, expect, it, vi } from 'vitest';

import { normalizeVerifiedEmail } from './verifiedEmail.js';

describe('normalizeVerifiedEmail', () => {
    it('canonicalizes IDNs identically when the native URL constructor does not implement IDNA', () => {
        vi.stubGlobal('URL', class { hostname = 'BÜCHER.Example'; });
        try {
            expect(normalizeVerifiedEmail('a@BÜCHER.Example')?.normalizedEmail).toBe('a@xn--bcher-kva.example');
        } finally {
            vi.unstubAllGlobals();
        }
    });
    it('keeps presentation and one case-insensitive IDN matching address without provider rewrites', () => {
        expect(normalizeVerifiedEmail('  Alice.Tag+Work@BÜCHER.Example  ')).toEqual({
            address: 'Alice.Tag+Work@xn--bcher-kva.example',
            normalizedEmail: 'alice.tag+work@xn--bcher-kva.example',
        });
        expect(normalizeVerifiedEmail('a.b+tag@gmail.com')?.normalizedEmail).toBe('a.b+tag@gmail.com');
    });

    it('accepts the full 320-scalar ceiling and rejects either overlong representation', () => {
        const domain = `${'b'.repeat(63)}.${'c'.repeat(63)}.${'d'.repeat(63)}.${'e'.repeat(63)}`;
        const address = `${'a'.repeat(64)}@${domain}`;
        expect(address.length).toBe(320);
        expect(normalizeVerifiedEmail(address)?.normalizedEmail).toBe(address);
        expect(normalizeVerifiedEmail(`a${address}`)).toBeNull();
        expect(normalizeVerifiedEmail(`${'a'.repeat(65)}@${'ü'.repeat(57)}.${'b'.repeat(63)}.${'c'.repeat(63)}.${'d'.repeat(63)}`)).toBeNull();
    });

    it.each([
        'Alice <alice@example.com>', 'a@example.com,b@example.com',
        'a@@example.com', '.a@example.com', 'a..b@example.com',
        'a@-example.com', 'a@example-.com', 'a@example.com/path',
        'a@example.com:80', 'a@example.com#x', 'a@%65xample.com',
        'a\n@example.com', 'a\u0000@example.com', 'a\ud800@example.com',
    ])('rejects malformed or unsafe input %j', (input) => {
        expect(normalizeVerifiedEmail(input)).toBeNull();
    });
});
