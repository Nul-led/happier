import { describe, expect, it } from 'vitest';

import { isProfileCompatibleWithBackendTarget } from './profileCompatibility';

describe('isProfileCompatibleWithBackendTarget', () => {
    it('honors a released flat Agent key for its qualified persisted Agent identity', () => {
        expect(isProfileCompatibleWithBackendTarget(
            {
                compatibility: {},
                compatibilityByTargetKey: { 'agent:claude': true },
                isBuiltIn: true,
            },
            {
                kind: 'agent',
                identity: {
                    pluginId: 'happier.agent.claude',
                    localId: 'claude',
                },
            },
        )).toBe(true);
    });

    it('resolves an installed external Agent named by its canonical target key instead of failing', () => {
        // The canonical key is what every catalog, settings and Voice surface
        // publishes for an installed Agent. Reading it through the Protocol's
        // bundled-only V1 conversion threw, so a compatible profile disappeared.
        expect(isProfileCompatibleWithBackendTarget(
            { compatibility: {}, isBuiltIn: false },
            'agent:acme.agent/native',
        )).toBe(true);
        expect(isProfileCompatibleWithBackendTarget(
            { compatibility: {}, isBuiltIn: true },
            'agent:acme.agent/native',
        )).toBe(false);
    });

    it('honors an explicit canonical entry for an installed external Agent', () => {
        expect(isProfileCompatibleWithBackendTarget(
            {
                compatibility: {},
                compatibilityByTargetKey: { 'agent:acme.agent/native': false },
                isBuiltIn: false,
            },
            { kind: 'agent', identity: { pluginId: 'acme.agent', localId: 'native' } },
        )).toBe(false);
    });
});
