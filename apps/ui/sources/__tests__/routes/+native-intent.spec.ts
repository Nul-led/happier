import { describe, expect, it } from 'vitest';

import { redirectSystemPath } from '@/app/+native-intent';
import { buildHomeQrInviteDeepLink } from '@/auth/pairing/pairingUrl';
import { encodeBase64 } from '@/encryption/base64';

describe('native system URL routing', () => {
    it.each([true, false])('normalizes account-connect URLs for initial=%s', (initial) => {
        expect(redirectSystemPath({ path: 'happier:///account?abc+123/=', initial })).toBe(
            '/account?accountConnectKey=abc%2B123%2F%3D',
        );
    });

    it('leaves unrelated system paths unchanged', () => {
        expect(redirectSystemPath({ path: 'happier:///terminal?key=abc123', initial: true })).toBe(
            'happier:///terminal?key=abc123',
        );
    });

    it('routes a strict V2 Home invite to the restore owner without consuming its payload', () => {
        const path = buildHomeQrInviteDeepLink({
            invite: {
                v: 2,
                intent: 'home_device',
                pairId: 'pair-native',
                home: {
                    v: 1,
                    homeServerIdentityId: 'srv_home_b',
                    canonicalServerUrl: 'https://home-b.test',
                    revision: 1,
                    endpoints: [{ kind: 'https', url: 'https://home-b.test' }],
                },
                qrSecretBase64Url: encodeBase64(new Uint8Array(32).fill(8), 'base64url'),
                issuedAtMs: Date.now(),
                expiresAtMs: Date.now() + 60_000,
            },
        });

        expect(redirectSystemPath({ path, initial: true })).toBe(
            `/restore?pairingLink=${encodeURIComponent(path)}`,
        );
    });
});
