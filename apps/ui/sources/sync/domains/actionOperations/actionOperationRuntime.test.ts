import { describe, expect, it, vi } from 'vitest';

import type { ActionOperationSnapshotV1 } from '@happier-dev/protocol';

import { createActionOperationStore } from './actionOperationStore';
import { createActionOperationSelectors } from './actionOperationSelectors';
import { actionOperationAddressKey, actionOperationMachineAddressKey } from './qualifiedActionOperation';
import {
    bindActionOperationRuntimeToAccountLifetime,
    reconcileActionOperationsOnce,
    type ActionOperationMachineRuntimeScope,
} from './actionOperationRuntime';

const scope: ActionOperationMachineRuntimeScope = {
    accountId: 'account-1',
    machineId: 'machine-1',
    serverId: 'server-1',
};

function operation(overrides: Partial<ActionOperationSnapshotV1> = {}): ActionOperationSnapshotV1 {
    return {
        version: 1,
        operationId: 'operation-1',
        revision: 1,
        actionId: 'session.spawn_new',
        state: 'accepted',
        scope: {
            accountId: scope.accountId,
            machineId: scope.machineId,
        },
        title: 'Create session',
        createdAt: 1_000,
        cancellation: 'unsupported',
        ...overrides,
    };
}

describe('action operation observation runtime', () => {
    it('hydrates list pages once and leaves later revisions to pushed observations', async () => {
        const store = createActionOperationStore();
        const accepted = operation();
        const otherAccount = operation({
            operationId: 'wrong-account',
            scope: { accountId: 'account-2', machineId: scope.machineId },
        });
        const otherMachine = operation({
            operationId: 'wrong-machine',
            scope: { accountId: scope.accountId, machineId: 'machine-2' },
        });
        const list = vi.fn()
            .mockResolvedValueOnce({ items: [accepted, otherAccount], nextCursor: 'page-2' })
            .mockResolvedValueOnce({ items: [otherMachine], nextCursor: null });

        await reconcileActionOperationsOnce({
            scope,
            store,
            list,
        });

        expect(list).toHaveBeenNthCalledWith(1, {
            machineId: scope.machineId,
            serverId: scope.serverId,
            request: {},
        });
        expect(list).toHaveBeenNthCalledWith(2, {
            machineId: scope.machineId,
            serverId: scope.serverId,
            request: { cursor: 'page-2' },
        });
        expect([...store.getSnapshot().operationsByKey.keys()]).toEqual([
            actionOperationAddressKey({ serverId: scope.serverId, operationId: accepted.operationId }),
        ]);
        expect([...store.getSnapshot().operationsByKey.values()][0]).toEqual({ serverId: scope.serverId, snapshot: accepted });
        expect([...store.getSnapshot().machineObservationByKey.values()]).toEqual(['available']);
    });

    it('retains cached active rows as unavailable when a complete post-restart list is empty', async () => {
        const store = createActionOperationStore();
        const cached = operation();
        store.mergeSnapshots({ serverId: scope.serverId, snapshots: [cached] });

        await reconcileActionOperationsOnce({
            scope,
            store,
            list: async () => ({ items: [], nextCursor: null }),
        });

        expect(store.getSnapshot().operationsByKey.get(actionOperationAddressKey({ serverId: scope.serverId, operationId: cached.operationId }))?.snapshot).toBe(cached);
        expect(store.getSnapshot().machineObservationByKey.get(actionOperationMachineAddressKey({ serverId: scope.serverId, machineId: scope.machineId }))).toBe('available');
        expect(createActionOperationSelectors().selectById(store.getSnapshot(), {
            serverId: scope.serverId,
            operationId: cached.operationId,
        })?.observation).toBe('unavailable');
    });

    it('retains cached rows when pagination fails before the daemon projection is complete', async () => {
        const store = createActionOperationStore();
        const cached = operation();
        store.mergeSnapshots({ serverId: scope.serverId, snapshots: [cached] });
        const list = vi.fn()
            .mockResolvedValueOnce({ items: [], nextCursor: 'page-2' })
            .mockRejectedValueOnce(new Error('connection lost'));

        await expect(reconcileActionOperationsOnce({
            scope,
            store,
            list,
        })).rejects.toThrow('connection lost');

        expect(store.getSnapshot().operationsByKey.get(actionOperationAddressKey({ serverId: scope.serverId, operationId: cached.operationId }))?.snapshot).toBe(cached);
    });

    it('retires the singleton projection with the active server/account lifetime', () => {
        const store = createActionOperationStore();
        store.mergeSnapshots({ serverId: scope.serverId, snapshots: [operation()] });
        const stopAll = vi.fn();
        const retirement = { current: null as (() => void) | null };
        const lifetime = {
            scope: { accountId: scope.accountId, serverId: scope.serverId! },
            isCurrent: () => true,
            onRetire(callback: () => void) {
                retirement.current = callback;
                return { dispose: vi.fn() };
            },
        };

        bindActionOperationRuntimeToAccountLifetime({ lifetime, coordinator: { stopAll }, store });
        retirement.current?.();

        expect(stopAll).toHaveBeenCalledTimes(1);
        expect(store.getSnapshot().operationsByKey.size).toBe(0);
    });
});
