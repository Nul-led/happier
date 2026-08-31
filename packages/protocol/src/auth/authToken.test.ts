import { describe, expect, it } from 'vitest';

import {
    AUTH_TOKEN_KIND_AUTHORITIES,
    AuthTokenProvenanceSchema,
} from './authToken.js';

describe('auth token provenance contract', () => {
    it('accepts exactly the canonical kind/authority pairings', () => {
        const canonicalPairings = [
            { kind: 'account', authority: 'present_user' },
            { kind: 'account_directory', authority: 'present_user' },
            { kind: 'terminal', authority: 'account_automation' },
            { kind: 'api_token', authority: 'account_automation' },
        ] as const;

        for (const pairing of canonicalPairings) {
            expect(AUTH_TOKEN_KIND_AUTHORITIES[pairing.kind]).toBe(pairing.authority);
            expect(AuthTokenProvenanceSchema.parse({ v: 1, ...pairing })).toEqual({
                v: 1,
                ...pairing,
            });
        }
    });

    it('fails closed on non-canonical pairings', () => {
        const invalidPairings = [
            { kind: 'account', authority: 'account_automation' },
            { kind: 'account_directory', authority: 'account_automation' },
            { kind: 'terminal', authority: 'present_user' },
            { kind: 'api_token', authority: 'present_user' },
        ] as const;

        for (const pairing of invalidPairings) {
            expect(
                AuthTokenProvenanceSchema.safeParse({ v: 1, ...pairing }).success,
            ).toBe(false);
        }
    });

    it('rejects unknown, future, malformed, and expanded markers', () => {
        expect(AuthTokenProvenanceSchema.safeParse({ v: 2, kind: 'account', authority: 'present_user' }).success).toBe(false);
        expect(AuthTokenProvenanceSchema.safeParse({ kind: 'account', authority: 'present_user' }).success).toBe(false);
        expect(AuthTokenProvenanceSchema.safeParse({ v: 1, kind: 'account', authority: 'present_user', extra: true }).success).toBe(false);
        expect(AuthTokenProvenanceSchema.safeParse({ v: 1, kind: 'future', authority: 'present_user' }).success).toBe(false);
        expect(AuthTokenProvenanceSchema.safeParse({ v: 1, kind: 'account', authority: 'future' }).success).toBe(false);
    });
});
