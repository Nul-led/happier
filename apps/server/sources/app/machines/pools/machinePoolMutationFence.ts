import { getDbProviderFromEnv } from '@/storage/prisma';
import type { Tx } from '@/storage/inTx';

/**
 * Serializes the only cross-aggregate Pool mutation: attaching a credential
 * resource and deleting the Pool. The Pool row remains the lock authority;
 * no lease, mutation ledger, or Pool-membership ACL is introduced.
 */
export async function acquireMachinePoolMutationFenceInTx(input: Readonly<{
    tx: Tx;
    accountId: string;
    poolId: string;
    provider?: 'postgres' | 'mysql' | 'sqlite';
}>): Promise<boolean> {
    const provider = input.provider ?? getDbProviderFromEnv(process.env, 'postgres');
    if (provider === 'sqlite') {
        const affected = await input.tx.$executeRawUnsafe(
            'UPDATE "MachinePool" SET "revision" = "revision" WHERE "id" = ? AND "accountId" = ?',
            input.poolId,
            input.accountId,
        );
        return affected === 1;
    }
    const query = provider === 'mysql'
        ? 'SELECT `id` FROM `MachinePool` WHERE `id` = ? AND `accountId` = ? FOR UPDATE'
        : 'SELECT "id" FROM "MachinePool" WHERE "id" = $1 AND "accountId" = $2 FOR UPDATE';
    const rows = await input.tx.$queryRawUnsafe<Array<{ id: string }>>(
        query,
        input.poolId,
        input.accountId,
    );
    return rows.length === 1;
}
