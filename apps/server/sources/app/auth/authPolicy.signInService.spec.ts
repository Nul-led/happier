import { describe, expect, it } from 'vitest';

import { resolveAuthPolicyFromEnv } from './authPolicy';

describe('resolveAuthPolicyFromEnv sign-in service', () => {
    it('defaults generic deployments to disabled and requires explicit self', () => {
        expect(resolveAuthPolicyFromEnv({} as NodeJS.ProcessEnv).signInService)
            .toEqual({ v: 1, mode: 'disabled' });
        expect(resolveAuthPolicyFromEnv({
            HAPPIER_AUTH_SIGN_IN_SERVICE_MODE: 'self',
        } as NodeJS.ProcessEnv).signInService).toEqual({ v: 1, mode: 'self' });
    });

    it('validates external policy and rejects mode-incompatible inputs', () => {
        expect(resolveAuthPolicyFromEnv({
            HAPPIER_AUTH_SIGN_IN_SERVICE_MODE: 'external',
            HAPPIER_AUTH_SIGN_IN_SERVICE_URL: 'https://accounts.example.test',
            HAPPIER_AUTH_SIGN_IN_SERVICE_SERVER_IDENTITY_ID: 'srv_accounts',
        } as NodeJS.ProcessEnv).signInService).toEqual({
            v: 1,
            mode: 'external',
            endpoint: 'https://accounts.example.test',
            expectedServerIdentityId: 'srv_accounts',
        });

        const malformed = resolveAuthPolicyFromEnv({
            HAPPIER_AUTH_SIGN_IN_SERVICE_MODE: 'self',
            HAPPIER_AUTH_SIGN_IN_SERVICE_URL: 'https://accounts.example.test',
        } as NodeJS.ProcessEnv);
        expect(malformed.signInService).toBeNull();
        expect(malformed.configurationErrors).toEqual(expect.arrayContaining([
            expect.stringContaining('HAPPIER_AUTH_SIGN_IN_SERVICE_URL'),
        ]));
    });
});
