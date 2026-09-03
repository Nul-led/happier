import { describe, expect, it, vi } from 'vitest';

describe('pairingUrl scheme override', () => {
    it('builds with the configured scheme and parses first-party Happier schemes', async () => {
        vi.resetModules();
        vi.doMock('expo-constants', () => ({
            default: {
                expoConfig: {
                    scheme: 'happier-dev',
                },
            },
        }));

        const { classifyLegacyPairingDeepLink } = await import('./pairingUrl');

        expect(
            classifyLegacyPairingDeepLink('happier-dev:///pair?v=1&pairId=pid123&secret=sec_abc&server=https%3A%2F%2Fstack.example.test'),
        ).toEqual({ kind: 'legacy_pairing_update_required' });

        expect(classifyLegacyPairingDeepLink('happier:///pair?v=1&pairId=pid123&secret=sec_abc')).toEqual({ kind: 'legacy_pairing_update_required' });

        expect(classifyLegacyPairingDeepLink('happier-internaldev:///pair?v=1&pairId=pid123&secret=sec_abc')).toEqual({ kind: 'legacy_pairing_update_required' });

        expect(classifyLegacyPairingDeepLink('happier-custom:///pair?v=1&pairId=pid123&secret=sec_abc')).toEqual({ kind: 'legacy_pairing_update_required' });

        expect(classifyLegacyPairingDeepLink('otherapp:///pair?v=1&pairId=pid123&secret=sec_abc')).toBeNull();
    });

    it('still parses the locally configured custom scheme exactly', async () => {
        vi.resetModules();
        vi.doMock('expo-constants', () => ({
            default: {
                expoConfig: {
                    scheme: 'my-team-app',
                },
            },
        }));

        const { classifyLegacyPairingDeepLink } = await import('./pairingUrl');

        expect(classifyLegacyPairingDeepLink('my-team-app:///pair?v=1&pairId=pid123&secret=sec_abc')).toEqual({ kind: 'legacy_pairing_update_required' });
    });
});
