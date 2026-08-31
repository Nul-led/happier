import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { openHomeSearchDb } from './homeSearchDb';
import { createHomeSearchService } from './homeSearchService';

describe('Home search service', () => {
    it('fails closed for encrypted homes and exposes identity on plain hits', async () => {
        const root = await mkdtemp(join(tmpdir(), 'happier-home-service-'));
        const encrypted = createHomeSearchService({ db: null, homeServerIdentityId: 'srv_test', storagePolicy: 'e2ee' });
        expect(encrypted.capability()).toMatchObject({ enabled: false, provider: 'daemon' });
        expect(encrypted.search({ v: 1, query: 'x', scope: { type: 'global' }, mode: 'auto' })).toMatchObject({ ok: false, errorCode: 'memory_disabled' });

        const path = join(root, 'plain.sqlite');
        const index = await openHomeSearchDb({ dbPath: path });
        index.upsert({ id: 'm-1', sessionId: 's-1', seq: 1, createdAtMs: 1, text: 'plain message' });
        const plain = createHomeSearchService({ db: index, homeServerIdentityId: 'srv_test', storagePolicy: 'plaintext_only' });
        expect(plain.search({ v: 1, query: 'plain', scope: { type: 'global' }, mode: 'auto' })).toMatchObject({ ok: true, hits: [expect.objectContaining({ homeServerIdentityId: 'srv_test' })] });
        expect(plain.search({ v: 1, query: 'plain', scope: { type: 'global' }, mode: 'auto' }, { visibleSessionIds: [] })).toMatchObject({ ok: true, hits: [] });
        expect(plain.search({ v: 1, query: 'plain', scope: { type: 'session', sessionId: 'other' }, mode: 'auto' }, { visibleSessionIds: ['s-1'] })).toMatchObject({ ok: true, hits: [] });
        index.close();
    });

    it('is not ready while the initial index reconciliation is pending', async () => {
        const root = await mkdtemp(join(tmpdir(), 'happier-home-service-indexing-'));
        const index = await openHomeSearchDb({ dbPath: join(root, 'search.sqlite') });
        let ready = false;
        const service = createHomeSearchService({
            db: index,
            homeServerIdentityId: 'srv_test',
            storagePolicy: 'plaintext_only',
            isReady: () => ready,
        });
        expect(service.capability()).toEqual({ enabled: false, provider: 'home', reason: 'indexing' });
        expect(service.search({ v: 1, query: 'x', scope: { type: 'global' }, mode: 'auto' })).toMatchObject({ ok: false, errorCode: 'memory_index_missing' });

        ready = true;
        expect(service.capability()).toEqual({ enabled: true, provider: 'home' });
        index.close();
    });
});
