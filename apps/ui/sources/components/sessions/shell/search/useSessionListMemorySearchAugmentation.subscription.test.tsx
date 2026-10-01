import { act } from 'react-test-renderer';
import { afterEach, describe, expect, it } from 'vitest';

import { createMachineFixture, renderHook, standardCleanup } from '@/dev/testkit';
import { useFeatureEnabled } from '@/hooks/server/useFeatureEnabled';
import { getActiveServerSnapshot } from '@/sync/domains/server/serverRuntime';
import { storage } from '@/sync/domains/state/storageStore';

import { useSessionListMemorySearchAugmentation } from './useSessionListMemorySearchAugmentation';

afterEach(() => {
    standardCleanup();
});

describe('session-list memory search subscription demand', () => {
    it.each([
        { enabled: false, searchQuery: 'vector' },
        { enabled: true, searchQuery: '  v  ' },
    ])('ignores machine updates for $searchQuery when enabled=$enabled', async (input) => {
        const previousState = storage.getState();
        const serverId = getActiveServerSnapshot().serverId;
        const machine = createMachineFixture({ id: 'memory-machine', activeAt: Date.now() });
        try {
            storage.setState({
                isDataReady: true,
                machines: { [machine.id]: machine },
                machineListByServerId: { [serverId]: [machine] },
                machineListStatusByServerId: { [serverId]: 'idle' },
                settings: {
                    ...previousState.settings,
                    experiments: true,
                    featureToggles: { ...previousState.settings.featureToggles, 'memory.search': true },
                },
            });
            let renders = 0;
            const hook = await renderHook(() => {
                renders += 1;
                return {
                    search: useSessionListMemorySearchAugmentation(input),
                    featureEnabled: useFeatureEnabled('memory.search'),
                };
            }, { flushOptions: { cycles: 1, turns: 4 } });
            expect(hook.getCurrent().featureEnabled).toBe(true);
            const settledRenders = renders;

            await act(async () => {
                const latest = { ...machine, updatedAt: 2, activeAt: Date.now() + 1 };
                storage.setState({
                    machines: { [latest.id]: latest },
                    machineListByServerId: { [serverId]: [latest] },
                    machineListStatusByServerId: { [serverId]: 'loading' },
                });
            });

            expect(renders).toBe(settledRenders);
            expect(hook.getCurrent().search.memoryMatchedSessionKeys.size).toBe(0);
            await hook.unmount();
        } finally {
            storage.setState(previousState);
        }
    });
});
