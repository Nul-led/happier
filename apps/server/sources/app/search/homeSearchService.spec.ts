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
        expect(encrypted.capability()).toEqual({ enabled: false, reason: 'index_unavailable' });
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
        expect(service.capability()).toEqual({ enabled: false, reason: 'indexing' });
        expect(service.search({ v: 1, query: 'x', scope: { type: 'global' }, mode: 'auto' })).toMatchObject({ ok: false, errorCode: 'memory_index_missing' });

        ready = true;
        expect(service.capability()).toEqual({ enabled: true });
        index.close();
    });

    it('applies contextual Session eligibility before the Home result limit', async () => {
        const root = await mkdtemp(join(tmpdir(), 'happier-home-service-eligibility-'));
        const index = await openHomeSearchDb({ dbPath: join(root, 'search.sqlite') });
        for (let value = 1; value <= 3; value += 1) {
            index.upsert({
                id: `active-message-${value}`,
                sessionId: `active-${value}`,
                seq: 1,
                createdAtMs: 100 + value,
                text: 'shared eligibility term',
            });
        }
        index.upsert({
            id: 'archived-message',
            sessionId: 'archived-target',
            seq: 1,
            createdAtMs: 1,
            text: 'shared eligibility term',
        });
        const service = createHomeSearchService({
            db: index,
            homeServerIdentityId: 'srv_test',
            storagePolicy: 'plaintext_only',
        });

        expect(service.search({
            v: 1,
            query: 'eligibility',
            scope: { type: 'global' },
            mode: 'auto',
            maxResults: 2,
            eligibleSessionIds: ['archived-target'],
        }, {
            visibleSessionIds: ['active-1', 'active-2', 'active-3', 'archived-target'],
        })).toEqual(expect.objectContaining({
            ok: true,
            hits: [expect.objectContaining({ sessionId: 'archived-target' })],
        }));
        index.close();
    });
});
