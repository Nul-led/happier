import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { db, initDbMysql, initDbPostgres } from '@/storage/db';
import {
    HOME_CONNECTION_DESCRIPTOR_CONTINUITY_CACHE_KEY,
    createHomeConnectionDescriptorContentKey,
    createSimpleCacheHomeConnectionDescriptorContinuityStore,
} from './homeConnectionDescriptorContinuity';

function resolveContractProvider(): 'postgres' | 'mysql' {
    const raw = String(
        process.env.HAPPIER_DB_PROVIDER
        ?? process.env.HAPPY_DB_PROVIDER
        ?? 'postgres',
    ).trim().toLowerCase();
    if (raw === 'postgres' || raw === 'postgresql') return 'postgres';
    if (raw === 'mysql') return 'mysql';
    throw new Error(`Unsupported descriptor continuity DB contract provider: ${raw}`);
}

const provider = resolveContractProvider();

describe('Home connection descriptor continuity database contract', () => {
    let dbConnected = false;

    beforeAll(async () => {
        if (!process.env.DATABASE_URL) {
            throw new Error('Missing DATABASE_URL (required for db contract tests).');
        }
        if (provider === 'mysql') await initDbMysql();
        else initDbPostgres();
        await db.$connect();
        dbConnected = true;
    });

    afterEach(async () => {
        await db.simpleCache.deleteMany({
            where: { key: HOME_CONNECTION_DESCRIPTOR_CONTINUITY_CACHE_KEY },
        });
    });

    afterAll(async () => {
        if (dbConnected) await db.$disconnect();
    });

    it(`atomically selects one equal-revision winner on ${provider}`, async () => {
        const firstStore = createSimpleCacheHomeConnectionDescriptorContinuityStore();
        const secondStore = createSimpleCacheHomeConnectionDescriptorContinuityStore();
        const candidate = (url: string) => ({
            revision: 8,
            contentKey: createHomeConnectionDescriptorContentKey({
                homeServerIdentityId: 'srv_home',
                canonicalServerUrl: 'https://home.example.test',
                endpoints: [{ kind: 'https' as const, url }],
            }),
        });
        const first = candidate('https://first.example.test');
        const second = candidate('https://second.example.test');

        const results = await Promise.all([firstStore.write(first), secondStore.write(second)]);

        expect(results.map((result) => result.status).sort()).toEqual(['committed', 'superseded']);
        const winner = results.find((result) => result.status === 'committed')!.continuity;
        await expect(firstStore.read()).resolves.toEqual(winner);
        const stored = await db.simpleCache.findUniqueOrThrow({
            where: { key: HOME_CONNECTION_DESCRIPTOR_CONTINUITY_CACHE_KEY },
            select: { value: true },
        });
        expect(stored.value.length).toBeLessThanOrEqual(191);
    });

    it(`rejects malformed nonempty continuity on ${provider}`, async () => {
        await db.simpleCache.create({
            data: {
                key: HOME_CONNECTION_DESCRIPTOR_CONTINUITY_CACHE_KEY,
                value: JSON.stringify({ revision: 8, contentKey: 'junk' }),
            },
        });

        await expect(createSimpleCacheHomeConnectionDescriptorContinuityStore().read()).rejects.toThrow(
            'Home connection descriptor continuity is malformed',
        );
    });
});
