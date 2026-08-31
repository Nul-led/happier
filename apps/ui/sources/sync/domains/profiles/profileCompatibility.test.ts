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
});
