import { describe, expect, it, vi } from 'vitest';

import { renderHook } from '@/dev/testkit';

const boundary = vi.hoisted(() => ({
    mutateAccountSettingsOnce: vi.fn(),
}));

vi.mock('@/sync/sync', () => ({
    sync: boundary,
}));

vi.mock('@/sync/store/hooks', () => ({
    useSettingsVersion: () => 7,
}));

import { useExternalSessionsAutoLinkSources } from './useExternalSessionsAutoLinkSources';

describe('useExternalSessionsAutoLinkSources', () => {
    it('keeps foreign-server Account policy controls inert at the writer owner', async () => {
        const agent = { pluginId: 'happier.agent.codex', localId: 'codex' };
        const hook = await renderHook(() => useExternalSessionsAutoLinkSources({
            rawSettings: {
                v: 1,
                keepPassivelyFollowingAfterRestart: false,
                autoLinkSourcePolicies: [{
                    machineId: 'machine-foreign',
                    qualifiedIdentity: {
                        v: 1,
                        agent,
                        source: { kind: 'codexHome', contractVersion: 1 },
                    },
                    sourcePolicyId: `es-source-policy:v1:${'d'.repeat(64)}`,
                    enabledAtMs: 100,
                }],
            },
            knownAgents: [{ agent, agentTitle: 'Codex' }],
            enabled: true,
            accountOperationsAvailable: false,
            scope: { machineId: 'machine-foreign', agent },
        }));

        expect(hook.getCurrent()).toHaveLength(1);
        expect(hook.getCurrent()[0]?.canChange).toBe(false);
        await hook.getCurrent()[0]?.setEnabled(false);
        expect(boundary.mutateAccountSettingsOnce).not.toHaveBeenCalled();
    });
});
