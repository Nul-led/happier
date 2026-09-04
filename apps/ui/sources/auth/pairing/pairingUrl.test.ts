import { describe, expect, it } from 'vitest';

import { classifyLegacyPairingDeepLink } from './pairingUrl';

describe('classifyLegacyPairingDeepLink', () => {
    it('recognizes the immutable released V1 shape without returning secret-bearing fields', () => {
        expect(
            classifyLegacyPairingDeepLink(
                'happier:///pair?v=1&pairId=pid123&secret=sec_abc&server=https%3A%2F%2Fstack.example.test',
            ),
        ).toEqual({ kind: 'legacy_pairing_update_required' });
    });

    it('rejects non-pair links', () => {
        expect(classifyLegacyPairingDeepLink('happier:///account?abc')).toBeNull();
    });

    it('keeps malformed and unknown-version pairing input distinct', () => {
        expect(classifyLegacyPairingDeepLink('happier:///pair?pairId=pid123&secret=sec_abc')).toBeNull();
        expect(classifyLegacyPairingDeepLink('happier:///pair?v=1&pairId=pid123')).toBeNull();
        expect(classifyLegacyPairingDeepLink('happier:///pair?v=3&pairId=pid123&secret=sec_abc')).toBeNull();
        expect(classifyLegacyPairingDeepLink('happier:///pair?v=1&v=1&pairId=pid123&secret=sec_abc')).toBeNull();
        expect(classifyLegacyPairingDeepLink('happier:///pair?v=1&pairId=pid123&pairId=other&secret=sec_abc')).toBeNull();
        expect(classifyLegacyPairingDeepLink('happier:///pair?v=1&pairId=pid123&secret=sec_abc&extra=1')).toBeNull();
        expect(classifyLegacyPairingDeepLink('happier:///pair?v=1&pairId=pid123&secret=sec_abc#ignored')).toBeNull();
        expect(classifyLegacyPairingDeepLink('happier:///pair?v=1&pairId=pid123&secret=sec_abc&server=')).toBeNull();
    });

    it('bounds compatibility classification before decoding fields', () => {
        expect(classifyLegacyPairingDeepLink(
            `happier:///pair?v=1&pairId=pid123&secret=${'s'.repeat(5_000)}`,
        )).toBeNull();
    });
});
