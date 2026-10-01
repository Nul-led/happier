import { afterEach, describe, expect, it } from 'vitest';

import { renderHook } from '@/dev/testkit/hooks/renderHook';
import { standardCleanup } from '@/dev/testkit/cleanup/standardCleanup';
import { createMachineFixture } from '@/dev/testkit/fixtures/machineFixtures';

import { getActiveServerSnapshot } from '@/sync/domains/server/serverRuntime';
import { storage } from '@/sync/domains/state/storageStore';
import { useHasMachineForGettingStartedGuidance } from './useHasMachineForGettingStartedGuidance';

afterEach(() => {
    standardCleanup();
});

function activeServerId(): string {
    return String(getActiveServerSnapshot().serverId ?? '').trim();
}

describe('useHasMachineForGettingStartedGuidance', () => {
    it('is undecided (null) until the active Home machine list has loaded', async () => {
        const previousState = storage.getState();
        try {
            expect(activeServerId()).not.toBe('');
            storage.setState((state) => ({
                ...state,
                isDataReady: true,
                machines: {},
                machineListByServerId: {},
                machineListStatusByServerId: {},
            }));

            const hook = await renderHook(() => useHasMachineForGettingStartedGuidance(), {
                flushOptions: { cycles: 1, turns: 4 },
            });

            expect(hook.getCurrent()).toBeNull();

            await hook.unmount();
        } finally {
            storage.setState(previousState);
        }
    });

    it('is unsatisfied once the loaded machine list is empty', async () => {
        const previousState = storage.getState();
        try {
            storage.setState((state) => ({
                ...state,
                isDataReady: true,
                machines: {},
                machineListByServerId: { [activeServerId()]: [] },
                machineListStatusByServerId: {},
            }));

            const hook = await renderHook(() => useHasMachineForGettingStartedGuidance(), {
                flushOptions: { cycles: 1, turns: 4 },
            });

            expect(hook.getCurrent()).toBe(false);

            await hook.unmount();
        } finally {
            storage.setState(previousState);
        }
    });

    it('is satisfied by a single OFFLINE machine (online state is irrelevant)', async () => {
        const previousState = storage.getState();
        try {
            storage.setState((state) => ({
                ...state,
                isDataReady: true,
                machines: {
                    'm-offline': createMachineFixture({ id: 'm-offline', active: false }),
                },
                machineListByServerId: {},
                machineListStatusByServerId: {},
            }));

            const hook = await renderHook(() => useHasMachineForGettingStartedGuidance(), {
                flushOptions: { cycles: 1, turns: 4 },
            });

            expect(hook.getCurrent()).toBe(true);

            await hook.unmount();
        } finally {
            storage.setState(previousState);
        }
    });

    it('ignores revoked machines (a revoked-only account still needs machine setup)', async () => {
        const previousState = storage.getState();
        try {
            storage.setState((state) => ({
                ...state,
                isDataReady: true,
                machines: {
                    'm-revoked': createMachineFixture({ id: 'm-revoked', revokedAt: 1700000000000 }),
                },
                machineListByServerId: {
                    [activeServerId()]: [createMachineFixture({ id: 'm-revoked', revokedAt: 1700000000000 })],
                },
                machineListStatusByServerId: {},
            }));

            const hook = await renderHook(() => useHasMachineForGettingStartedGuidance(), {
                flushOptions: { cycles: 1, turns: 4 },
            });

            expect(hook.getCurrent()).toBe(false);

            await hook.unmount();
        } finally {
            storage.setState(previousState);
        }
    });
});
