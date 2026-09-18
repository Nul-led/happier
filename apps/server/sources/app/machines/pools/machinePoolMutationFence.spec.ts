import { describe, expect, it, vi } from 'vitest';

import { acquireMachinePoolMutationFenceInTx } from './machinePoolMutationFence';

describe('acquireMachinePoolMutationFenceInTx', () => {
    it.each([
        ['postgres', 'SELECT "id" FROM "MachinePool" WHERE "id" = $1 AND "accountId" = $2 FOR UPDATE'],
        ['mysql', 'SELECT `id` FROM `MachinePool` WHERE `id` = ? AND `accountId` = ? FOR UPDATE'],
    ] as const)('locks the exact Pool parent row on %s', async (provider, query) => {
        const queryRaw = vi.fn(async () => [{ id: 'pool-1' }]);
        await expect(acquireMachinePoolMutationFenceInTx({
            tx: { $queryRawUnsafe: queryRaw } as never,
            provider,
            accountId: 'account-1',
            poolId: 'pool-1',
        })).resolves.toBe(true);
        expect(queryRaw).toHaveBeenCalledWith(query, 'pool-1', 'account-1');
    });

    it('reserves the SQLite writer without changing Pool revision or timestamps', async () => {
        const executeRaw = vi.fn(async () => 1);
        await expect(acquireMachinePoolMutationFenceInTx({
            tx: { $executeRawUnsafe: executeRaw } as never,
            provider: 'sqlite',
            accountId: 'account-1',
            poolId: 'pool-1',
        })).resolves.toBe(true);
        expect(executeRaw).toHaveBeenCalledWith(
            'UPDATE "MachinePool" SET "revision" = "revision" WHERE "id" = ? AND "accountId" = ?',
            'pool-1',
            'account-1',
        );
    });

    it('reports an absent or concurrently deleted Pool', async () => {
        await expect(acquireMachinePoolMutationFenceInTx({
            tx: { $queryRawUnsafe: vi.fn(async () => []) } as never,
            provider: 'postgres',
            accountId: 'account-1',
            poolId: 'pool-1',
        })).resolves.toBe(false);
    });
});
