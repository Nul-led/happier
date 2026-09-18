import { describe, expect, it } from 'vitest';

import { resolveSessionCompanionHeaderPlacement } from './sessionCompanionHeaderPlacement';

const readyPreference = {
    availability: 'ready' as const,
    preferenceExists: true,
    visible: true,
    itemCount: 2,
};

describe('resolveSessionCompanionHeaderPlacement', () => {
    it('uses the incumbent overflow when constrained and a dedicated action otherwise', () => {
        expect(resolveSessionCompanionHeaderPlacement({
            ...readyPreference,
            headerActionsFolded: true,
        })).toBe('overflow');
        expect(resolveSessionCompanionHeaderPlacement({
            ...readyPreference,
            headerActionsFolded: false,
        })).toBe('direct');
    });

    it('keeps first use discoverable without spending a dedicated header slot', () => {
        expect(resolveSessionCompanionHeaderPlacement({
            ...readyPreference,
            preferenceExists: false,
            visible: false,
            itemCount: 0,
            headerActionsFolded: false,
        })).toBe('overflow');
    });

    it('depends only on the exact preference realm, not Board readiness', () => {
        expect(resolveSessionCompanionHeaderPlacement({
            ...readyPreference,
            availability: 'realm_unavailable',
            headerActionsFolded: true,
        })).toBeNull();
    });
});
