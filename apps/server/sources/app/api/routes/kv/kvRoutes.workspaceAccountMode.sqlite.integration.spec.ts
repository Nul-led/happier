import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { CURRENT_ACCOUNT_STORED_CONTENT_PROTOCOL_VERSION } from '@happier-dev/protocol';

import { db } from '@/storage/db';
import { createLightSqliteHarness, type LightSqliteHarness } from '@/testkit/lightSqliteHarness';
import { captureAccountStoredContentCompatibilityForHttpRequest } from '@/app/clientCompatibility/accountStoredContentCompatibility';
import { eventRouter } from '@/app/events/eventRouter';
import { withAuthenticatedTestApp } from '../../testkit/sqliteFastify';
import { kvRoutes } from './kvRoutes';

async function withWorkspaceKvApp(run: Parameters<typeof withAuthenticatedTestApp>[1]) {
    await withAuthenticatedTestApp(app => {
        app.addHook('preHandler', async (request: Parameters<typeof captureAccountStoredContentCompatibilityForHttpRequest>[0]) => { captureAccountStoredContentCompatibilityForHttpRequest(request); });
        kvRoutes(app);
    }, run);
}

describe('workspace Account-mode KV admission', () => {
    let harness: LightSqliteHarness;
    const socketEmit = vi.fn();

    beforeAll(async () => {
        harness = await createLightSqliteHarness({ tempDirPrefix: 'happier-workspace-kv-mode-', initAuth: false, initEncrypt: false, initFiles: false });
    }, 120_000);
    beforeEach(() => {
        vi.clearAllMocks();
        harness.resetEnv();
        // Socket transport is the genuine boundary; mutation and AccountChange owners remain real.
        eventRouter.setIo({ to: () => ({ emit: socketEmit }) } as unknown as Parameters<typeof eventRouter.setIo>[0]);
    });
    afterEach(async () => {
        harness.resetEnv();
        await harness.resetDbTables([
            () => db.accountChange.deleteMany(),
            () => db.userKVStore.deleteMany(),
            () => db.account.deleteMany(),
        ]);
    });
    afterAll(async () => { await harness?.close(); });

    it.each(['workspace:tabs:v1', 'workspace:handoff-tabs:v1:device:window'])('rejects stale ciphertext creation and overwrite for a plain Account at %s', async key => {
        const account = await db.account.create({ data: { publicKey: null, encryptionMode: 'plain' }, select: { id: true } });
        const plain = Buffer.from(JSON.stringify({ t: 'plain', v: { v: 1, tabsById: {}, order: [], pairs: [] } }));
        const staleCiphertext = Buffer.from('released-ciphertext').toString('base64');
        await withWorkspaceKvApp(async app => {
            const headers = { 'x-test-user-id': account.id, 'x-happier-account-stored-content-protocol': String(CURRENT_ACCOUNT_STORED_CONTENT_PROTOCOL_VERSION) };
            const create = await app.inject({ method: 'POST', url: '/v1/kv', headers, payload: { mutations: [{ key, version: -1, value: staleCiphertext }] } });
            expect(create.statusCode, create.body).toBe(400);
            expect(await db.userKVStore.findUnique({ where: { accountId_key: { accountId: account.id, key } } })).toBeNull();
            await db.userKVStore.create({ data: { accountId: account.id, key, version: 5, value: plain } });
            const update = await app.inject({ method: 'POST', url: '/v1/kv', headers, payload: { mutations: [{ key, version: 5, value: staleCiphertext }] } });
            expect(update.statusCode, update.body).toBe(400);
            expect(await db.userKVStore.findUniqueOrThrow({ where: { accountId_key: { accountId: account.id, key } } })).toMatchObject({ value: plain, version: 5 });
        });
        expect(await db.accountChange.count({ where: { accountId: account.id } })).toBe(0);
        expect(socketEmit).not.toHaveBeenCalled();
    });

    it('pages exact workspace keys, retaining versions and excluding tombstones', async () => {
        const account = await db.account.create({ data: { publicKey: null, encryptionMode: 'plain' }, select: { id: true } });
        const value = Buffer.from(JSON.stringify({ t: 'plain', v: { v: 1, tabsById: {}, order: [], pairs: [] } }));
        await db.userKVStore.createMany({ data: [
            { accountId: account.id, key: 'workspace:handoff-tabs:v1:a:window', value, version: 2 },
            { accountId: account.id, key: 'workspace:handoff-tabs:v1:b:window', value, version: 5 },
            { accountId: account.id, key: 'workspace:handoff-tabs:v1:deleted:window', value: null, version: 8 },
            { accountId: account.id, key: 'workspace:tabs:v1', value, version: 9 },
            { accountId: account.id, key: 'other', value: Buffer.from('opaque'), version: 0 },
        ] });
        await withWorkspaceKvApp(async app => {
            const headers = { 'x-test-user-id': account.id, 'x-happier-account-stored-content-protocol': String(CURRENT_ACCOUNT_STORED_CONTENT_PROTOCOL_VERSION) };
            const first = await app.inject({ method: 'GET', url: '/v1/kv?prefix=workspace%3A&limit=2', headers });
            expect(first.statusCode, first.body).toBe(200);
            expect(first.json().items.map((row: { key: string; version: number }) => ({ key: row.key, version: row.version }))).toEqual([
                { key: 'workspace:handoff-tabs:v1:a:window', version: 2 }, { key: 'workspace:handoff-tabs:v1:b:window', version: 5 },
            ]);
            const second = await app.inject({ method: 'GET', url: '/v1/kv?prefix=workspace%3A&limit=2&afterKey=workspace%3Ahandoff-tabs%3Av1%3Ab%3Awindow', headers });
            expect(second.statusCode, second.body).toBe(200);
            expect(second.json().items).toEqual([{ key: 'workspace:tabs:v1', version: 9, value: value.toString('base64') }]);
        });
    });

    it('rejects workspace content from the wrong persisted Account mode before disclosure', async () => {
        const account = await db.account.create({ data: { publicKey: null, encryptionMode: 'plain' }, select: { id: true } });
        await db.userKVStore.create({ data: { accountId: account.id, key: 'workspace:tabs:v1', version: 3, value: Buffer.from('encrypted-ciphertext') } });
        await withWorkspaceKvApp(async app => {
            const response = await app.inject({ method: 'GET', url: '/v1/kv/workspace%3Atabs%3Av1', headers: { 'x-test-user-id': account.id, 'x-happier-account-stored-content-protocol': String(CURRENT_ACCOUNT_STORED_CONTENT_PROTOCOL_VERSION) } });
            expect(response.statusCode, response.body).toBe(400);
            expect(response.json()).toEqual({ error: 'Invalid parameters' });
        });
    });
});
