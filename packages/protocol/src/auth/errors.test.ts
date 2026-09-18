import { describe, expect, it } from 'vitest';

import {
    AUTH_ERROR_CODES,
    AUTH_KEY_CHALLENGE_V2_ERROR_CODES,
    AuthErrorCodeSchema,
} from './errors.js';

describe('auth error contract', () => {
    it('recognizes the server signup policy and proven inactive Account errors', () => {
        expect(AuthErrorCodeSchema.parse('signup-disabled')).toBe('signup-disabled');
        expect(AuthErrorCodeSchema.parse('account-disabled')).toBe('account-disabled');
    });

    it('rejects unknown auth error codes', () => {
        expect(AuthErrorCodeSchema.safeParse('signup-disable').success).toBe(false);
    });

    it('owns the key-challenge v2 requirement and availability codes', () => {
        expect(AUTH_ERROR_CODES).toContain(AUTH_KEY_CHALLENGE_V2_ERROR_CODES.required);
        expect(AUTH_ERROR_CODES).toContain(AUTH_KEY_CHALLENGE_V2_ERROR_CODES.unavailable);
        expect(AuthErrorCodeSchema.parse(AUTH_KEY_CHALLENGE_V2_ERROR_CODES.required)).toBe(
            'key_challenge_v2_required',
        );
        expect(AuthErrorCodeSchema.parse(AUTH_KEY_CHALLENGE_V2_ERROR_CODES.unavailable)).toBe(
            'key_challenge_v2_unavailable',
        );
    });
});
