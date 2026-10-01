import { describe, expect, it } from 'vitest';
import { settingsDefaults } from '@/sync/domains/settings/settings';
import { resolveNewSessionModelCapabilityProbeContext } from './newSessionCapabilityProbeContext';

describe('existing session model probe context', () => {
    it('carries the opaque session runtime and partitions observations independently of account defaults', () => {
        const runtimeDescriptorV1 = { v: 1 as const, agentId: 'codex', agent: { backendMode: 'acp' } };
        const params = {
            backendTarget: { kind: 'backend' as const, backendId: 'codex' },
            runtimeCarrierAgentId: 'codex',
            settings: settingsDefaults,
            selectedProfileId: 'session-profile',
            runtimeDescriptorV1,
        };
        const first = resolveNewSessionModelCapabilityProbeContext(params);
        expect(first?.capabilityParams).toMatchObject({ runtimeDescriptorV1, profileId: 'session-profile' });
        expect(resolveNewSessionModelCapabilityProbeContext({ ...params, runtimeDescriptorV1: { ...runtimeDescriptorV1 } })).toBe(first);
        const second = resolveNewSessionModelCapabilityProbeContext({
            ...params, runtimeDescriptorV1: { ...runtimeDescriptorV1, agent: { backendMode: 'appServer' } },
        });
        expect(second?.cacheKeySuffixParts).not.toEqual(first?.cacheKeySuffixParts);
    });
});
