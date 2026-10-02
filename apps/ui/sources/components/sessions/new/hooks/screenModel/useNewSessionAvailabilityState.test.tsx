import { describe, expect, it, vi } from 'vitest';
import { renderHook } from '@/dev/testkit/hooks/renderHook';
import { settingsDefaults } from '@/sync/domains/settings/settings';
import { installNewSessionScreenModelCommonModuleMocks } from '../newSessionScreenModelTestHelpers';

installNewSessionScreenModelCommonModuleMocks({ storage: async (importOriginal) => importOriginal() });

const { useNewSessionAvailabilityState } = await import('./useNewSessionAvailabilityState');

describe('effective terminal host availability', () => {
    it.each(['herdr', 'zellij', 'tmux', 'none'] as const)('warns about tmux only when the effective host is tmux, not %s', async (host) => {
        const hook = await renderHook(() => useNewSessionAvailabilityState({
            selectedMachineId: null, selectedMachine: null, capabilityServerId: 'server-a',
            externalSessionsFeatureEnabled: false,
            settings: { ...settingsDefaults, sessionTerminalHost: host, sessionUseTmux: host === 'tmux' },
            staticAgentId: 'codex', resumeSessionId: null,
            backendNewSessionOptionStateByTargetKey: {}, resolvedBackendEntries: [], selectedBackendEntry: null,
            setBackendTarget: vi.fn(), machines: [], allProfiles: [],
        }));
        expect(hook.getCurrent().tmuxRequested).toBe(host === 'tmux');
        await hook.unmount();
    });
});
