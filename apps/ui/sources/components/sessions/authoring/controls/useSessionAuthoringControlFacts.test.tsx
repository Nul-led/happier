import { describe, expect, it, vi } from 'vitest';

import { renderHook } from '@/dev/testkit';

const capabilityState = vi.hoisted(() => ({
    value: { status: 'idle' } as Record<string, unknown>,
}));

vi.mock('@/hooks/server/useDaemonScopedMachineCapabilitiesCache', () => ({
    useDaemonScopedMachineCapabilitiesCache: () => ({ state: capabilityState.value, refresh: vi.fn() }),
}));
vi.mock('@/agents/backendCatalog/useDaemonMergedProjectionInputs', () => ({
    useDaemonMergedProjectionInputs: () => ({ phase: 'loading' }),
}));
vi.mock('@/hooks/server/useFeatureEnabled', () => ({ useFeatureEnabled: () => false }));
vi.mock('@/sync/domains/state/storage', () => ({
    useAllMachines: () => [{ id: 'machine-1', metadata: { platform: 'win32', name: 'Windows' } }],
    useSettings: () => ({}),
    useSetting: () => null,
}));
vi.mock('@/text', async () => {
    const { createTextModuleMock } = await import('@/dev/testkit/mocks/text');
    return { ...createTextModuleMock({ translate: (key) => key }), getPreferredLanguage: () => 'en' };
});

describe('useSessionAuthoringControlFacts', () => {
    it('projects the incumbent New Session Windows Terminal capability and fails closed without it', async () => {
        const { useSessionAuthoringControlFacts } = await import('./useSessionAuthoringControlFacts');
        const hook = await renderHook(() => useSessionAuthoringControlFacts({
            machineId: 'machine-1',
            serverId: 'server-1',
            directory: 'C:\\repo',
        }));

        expect(hook.getCurrent().windowsTerminalAvailable).toBe(false);

        capabilityState.value = {
            status: 'loaded',
            snapshot: {
                response: {
                    protocolVersion: 1,
                    results: {
                        'tool.windowsTerminal': {
                            ok: true,
                            checkedAt: 1,
                            data: { available: true },
                        },
                    },
                },
            },
        };
        await hook.rerender();

        expect(hook.getCurrent().windowsTerminalAvailable).toBe(true);
        await hook.unmount();
    });
});
