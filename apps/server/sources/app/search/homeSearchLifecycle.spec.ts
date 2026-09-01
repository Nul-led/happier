import { mkdtemp, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { openHomeSearchDb, type HomeSearchDb } from './homeSearchDb';
import { startHomeSearchLifecycle } from './homeSearchLifecycle';
import type { HomeSearchCanonicalMessage } from './homeSearchIndexer';

function reader(readRows: () => readonly HomeSearchCanonicalMessage[]) {
    return async ({ afterId, limit }: { afterId?: string; limit: number }) => {
        const rows = [...readRows()].sort((left, right) => left.id.localeCompare(right.id));
        const messages = rows.filter((row) => !afterId || row.id > afterId).slice(0, limit);
        const nextAfterId = messages.length === limit ? messages.at(-1)?.id : undefined;
        return { messages, ...(nextAfterId ? { nextAfterId } : {}) };
    };
}

function corruptOnce(db: HomeSearchDb, operation: 'upsert' | 'search'): HomeSearchDb {
    let pending = true;
    const fail = () => {
        if (!pending) return;
        pending = false;
        const error = new Error('database disk image is malformed') as Error & { code: string };
        error.code = 'SQLITE_CORRUPT';
        throw error;
    };
    return {
        ...db,
        upsert(message) {
            if (operation === 'upsert') fail();
            db.upsert(message);
        },
        search(input) {
            if (operation === 'search') fail();
            return db.search(input);
        },
    };
}

describe('Home search lifecycle', () => {
    it('does no index I/O until post-listen start and exposes indexing meanwhile', async () => {
        const root = await mkdtemp(join(tmpdir(), 'happier-home-lifecycle-deferred-'));
        const path = join(root, 'derived', 'search.sqlite');
        const openDb = vi.fn(openHomeSearchDb);
        const lifecycle = await startHomeSearchLifecycle({
            dbPath: path,
            homeServerIdentityId: 'srv_test',
            storagePolicy: 'plaintext_only',
            readCanonicalMessagesPage: reader(() => []),
            openDb,
        });

        expect(openDb).not.toHaveBeenCalled();
        await expect(stat(path)).rejects.toMatchObject({ code: 'ENOENT' });
        expect(lifecycle.capability()).toEqual({ enabled: false, provider: 'home', reason: 'indexing' });

        lifecycle.start();
        await lifecycle.whenReady();
        expect(openDb).toHaveBeenCalledTimes(1);
        expect(lifecycle.capability()).toEqual({ enabled: true, provider: 'home' });
        await lifecycle.stop();
    });

    it('composes reconciliation, readiness gating, search, and shutdown over one index database', async () => {
        const root = await mkdtemp(join(tmpdir(), 'happier-home-lifecycle-'));
        let rows: readonly HomeSearchCanonicalMessage[] = [
            { id: 'm-1', sessionId: 's-1', seq: 1, createdAtMs: 10, role: 'user', content: { t: 'plain', v: { role: 'user', content: { type: 'text', text: 'lifecycle probe text' } } } },
        ];
        const lifecycle = await startHomeSearchLifecycle({
            dbPath: join(root, 'derived', 'search.sqlite'),
            homeServerIdentityId: 'srv_test',
            storagePolicy: 'plaintext_only',
            readCanonicalMessagesPage: reader(() => rows),
        });

        // Search is not advertised ready before the initial reconciliation completes.
        expect(lifecycle.capability()).toEqual({ enabled: false, provider: 'home', reason: 'indexing' });
        expect(lifecycle.search({ v: 1, query: 'lifecycle', scope: { type: 'global' }, mode: 'auto' }))
            .toMatchObject({ ok: false, errorCode: 'memory_index_missing' });

        lifecycle.start();
        await lifecycle.whenReady();
        expect(lifecycle.capability()).toEqual({ enabled: true, provider: 'home' });
        expect(lifecycle.search({ v: 1, query: 'lifecycle', scope: { type: 'global' }, mode: 'auto' }))
            .toMatchObject({ ok: true, hits: [expect.objectContaining({ sessionId: 's-1', homeServerIdentityId: 'srv_test' })] });

        await lifecycle.stop();
        expect(lifecycle.capability()).toEqual({ enabled: false, provider: 'home', reason: 'index_unavailable' });
        expect(lifecycle.search({ v: 1, query: 'lifecycle', scope: { type: 'global' }, mode: 'auto' }))
            .toMatchObject({ ok: false, errorCode: 'memory_index_missing' });
        await expect(lifecycle.stop()).resolves.toBeUndefined();
    });

    it('never indexes non-plain homes', async () => {
        const root = await mkdtemp(join(tmpdir(), 'happier-home-lifecycle-e2ee-'));
        const lifecycle = await startHomeSearchLifecycle({
            dbPath: join(root, 'derived', 'search.sqlite'),
            homeServerIdentityId: 'srv_test',
            storagePolicy: 'e2ee',
            readCanonicalMessagesPage: reader(() => [
                { id: 'm-1', sessionId: 's-1', seq: 1, createdAtMs: 10, content: { type: 'text', text: 'secret words' } },
            ]),
        });
        lifecycle.start();
        await lifecycle.whenReady();
        expect(lifecycle.capability()).toEqual({ enabled: false, provider: 'daemon', reason: 'non_plain_home' });
        expect(lifecycle.search({ v: 1, query: 'secret', scope: { type: 'global' }, mode: 'auto' }))
            .toMatchObject({ ok: false, errorCode: 'memory_disabled' });
        await lifecycle.stop();
    });

    it('degrades to typed unavailability when the index database cannot open', async () => {
        const root = await mkdtemp(join(tmpdir(), 'happier-home-lifecycle-degraded-'));
        const lifecycle = await startHomeSearchLifecycle({
            dbPath: root, // A directory cannot be opened as a SQLite database.
            homeServerIdentityId: 'srv_test',
            storagePolicy: 'plaintext_only',
            readCanonicalMessagesPage: reader(() => []),
        });
        expect(lifecycle.capability()).toEqual({ enabled: false, provider: 'home', reason: 'indexing' });
        lifecycle.start();
        await lifecycle.whenReady();
        expect(lifecycle.capability()).toEqual({ enabled: false, provider: 'home', reason: 'index_unavailable' });
        expect(lifecycle.search({ v: 1, query: 'x', scope: { type: 'global' }, mode: 'auto' }))
            .toMatchObject({ ok: false, errorCode: 'memory_index_missing' });
        await lifecycle.stop();
    });

    it('recreates only the derived database after corruption and supports explicit invalidation', async () => {
        const root = await mkdtemp(join(tmpdir(), 'happier-home-lifecycle-corrupt-'));
        const path = join(root, 'derived', 'search.sqlite');
        await writeFile(path, 'not a sqlite database', { flag: 'w' }).catch(async () => {
            const { mkdir } = await import('node:fs/promises');
            await mkdir(join(root, 'derived'), { recursive: true });
            await writeFile(path, 'not a sqlite database');
        });
        const lifecycle = await startHomeSearchLifecycle({
            dbPath: path,
            homeServerIdentityId: 'srv_test',
            storagePolicy: 'plaintext_only',
            readCanonicalMessagesPage: reader(() => [
                { id: 'm-1', sessionId: 's-1', seq: 1, createdAtMs: 1, content: { t: 'plain', v: { content: { type: 'text', text: 'rebuilt projection' } } } },
            ]),
        });
        lifecycle.start();
        await lifecycle.whenReady();
        expect(lifecycle.search({ v: 1, query: 'rebuilt', scope: { type: 'global' }, mode: 'auto' })).toMatchObject({ ok: true });
        await lifecycle.invalidateAndRebuild('restore');
        expect(lifecycle.search({ v: 1, query: 'rebuilt', scope: { type: 'global' }, mode: 'auto' })).toMatchObject({ ok: true });
        await lifecycle.stop();
    });

    it('rebuilds an unsupported derived schema instead of disabling canonical search', async () => {
        const root = await mkdtemp(join(tmpdir(), 'happier-home-lifecycle-schema-upgrade-'));
        const path = join(root, 'derived', 'search.sqlite');
        const { mkdir } = await import('node:fs/promises');
        const { DatabaseSync } = await import('node:sqlite');
        await mkdir(join(root, 'derived'), { recursive: true });
        const stale = new DatabaseSync(path);
        stale.exec(`
            CREATE TABLE home_search_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
            INSERT INTO home_search_meta(key, value) VALUES ('schema_version', '999');
        `);
        stale.close();

        const lifecycle = startHomeSearchLifecycle({
            dbPath: path,
            homeServerIdentityId: 'srv_test',
            storagePolicy: 'plaintext_only',
            readCanonicalMessagesPage: reader(() => [
                { id: 'm-1', sessionId: 's-1', seq: 1, createdAtMs: 1, content: { t: 'plain', v: { role: 'assistant', content: { type: 'text', text: 'schema projection rebuilt' } } } },
            ]),
        });

        lifecycle.start();
        await lifecycle.whenReady();
        expect(lifecycle.capability()).toEqual({ enabled: true, provider: 'home' });
        expect(lifecycle.search({ v: 1, query: 'schema', scope: { type: 'global' }, mode: 'auto' }))
            .toMatchObject({ ok: true, hits: [expect.objectContaining({ sessionId: 's-1' })] });
        await lifecycle.stop();
    });

    it('coalesces corruption during reconciliation into a real derived-index rebuild', async () => {
        const root = await mkdtemp(join(tmpdir(), 'happier-home-lifecycle-reconcile-corrupt-'));
        const path = join(root, 'derived', 'search.sqlite');
        let opens = 0;
        const lifecycle = await startHomeSearchLifecycle({
            dbPath: path,
            homeServerIdentityId: 'srv_test',
            storagePolicy: 'plaintext_only',
            readCanonicalMessagesPage: reader(() => [
                { id: 'm-1', sessionId: 's-1', seq: 1, createdAtMs: 1, content: { t: 'plain', v: { role: 'assistant', content: { type: 'text', text: 'recovered projection' } } } },
            ]),
            openDb: async (params) => {
                const db = await openHomeSearchDb(params);
                opens += 1;
                return opens === 1 ? corruptOnce(db, 'upsert') : db;
            },
        });

        lifecycle.start();
        await vi.waitFor(() => expect(lifecycle.capability()).toEqual({ enabled: true, provider: 'home' }));
        expect(opens).toBe(2);
        expect(lifecycle.search({ v: 1, query: 'recovered', scope: { type: 'global' }, mode: 'auto' }))
            .toMatchObject({ ok: true, hits: [expect.anything()] });
        await lifecycle.stop();
    });

    it('returns typed unavailability during query corruption and recovers through the same rebuild owner', async () => {
        const root = await mkdtemp(join(tmpdir(), 'happier-home-lifecycle-query-corrupt-'));
        const path = join(root, 'derived', 'search.sqlite');
        let opens = 0;
        const lifecycle = await startHomeSearchLifecycle({
            dbPath: path,
            homeServerIdentityId: 'srv_test',
            storagePolicy: 'plaintext_only',
            readCanonicalMessagesPage: reader(() => [
                { id: 'm-1', sessionId: 's-1', seq: 1, createdAtMs: 1, content: { t: 'plain', v: { role: 'assistant', content: { type: 'text', text: 'query recovery' } } } },
            ]),
            openDb: async (params) => {
                const db = await openHomeSearchDb(params);
                opens += 1;
                return opens === 1 ? corruptOnce(db, 'search') : db;
            },
        });

        lifecycle.start();
        await lifecycle.whenReady();
        expect(lifecycle.search({ v: 1, query: 'query', scope: { type: 'global' }, mode: 'auto' }))
            .toMatchObject({ ok: false, errorCode: 'memory_failed' });
        expect(lifecycle.capability()).toEqual({ enabled: false, provider: 'home', reason: 'index_unavailable' });
        await vi.waitFor(() => expect(lifecycle.capability()).toEqual({ enabled: true, provider: 'home' }));
        expect(opens).toBe(2);
        expect(lifecycle.search({ v: 1, query: 'query', scope: { type: 'global' }, mode: 'auto' }))
            .toMatchObject({ ok: true, hits: [expect.anything()] });
        await lifecycle.stop();
    });
});
