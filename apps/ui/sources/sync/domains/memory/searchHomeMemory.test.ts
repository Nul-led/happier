import { afterEach, describe, expect, it, vi } from 'vitest';

const serverFetchMock = vi.hoisted(() => vi.fn());

vi.mock('@/sync/http/client', () => ({
    serverFetch: serverFetchMock,
}));

afterEach(() => {
    serverFetchMock.mockReset();
});

function createHomeSearchHit(sessionId: string, summary = 'Personal Home summary', score = 0.9) {
    return {
        sessionId,
        seqFrom: 1,
        seqTo: 3,
        createdAtFromMs: 10,
        createdAtToMs: 20,
        summary,
        score,
    };
}

describe('searchHomeMemory', () => {
    it('posts the shared MemorySearchQueryV1 to /v1/home/search through serverFetch and parses the shared result', async () => {
        serverFetchMock.mockResolvedValueOnce(new Response(JSON.stringify({
            v: 1,
            ok: true,
            hits: [createHomeSearchHit('session-1')],
        }), { status: 200 }));

        const { searchHomeMemory } = await import('./searchHomeMemory');
        const result = await searchHomeMemory({
            query: ' vector cache ',
            scope: { type: 'global' },
            mode: 'auto',
            maxResults: 20,
        });

        expect(serverFetchMock).toHaveBeenCalledTimes(1);
        const [path, init] = serverFetchMock.mock.calls[0] ?? [];
        expect(path).toBe('/v1/home/search');
        expect(init?.method).toBe('POST');
        expect(JSON.parse(init?.body ?? '{}')).toEqual({
            v: 1,
            query: 'vector cache',
            scope: { type: 'global' },
            mode: 'auto',
            maxResults: 20,
        });
        expect(result).toEqual({
            v: 1,
            ok: true,
            hits: [createHomeSearchHit('session-1')],
        });
    });

    it('rejects a malformed Home result as a typed failure instead of a false success', async () => {
        const { searchHomeMemory } = await import('./searchHomeMemory');

        serverFetchMock.mockResolvedValueOnce(new Response(JSON.stringify({
            v: 1,
            ok: true,
            hits: [{ sessionId: '', seqFrom: -1 }],
        }), { status: 200 }));
        const malformedHits = await searchHomeMemory({
            query: 'vector',
            scope: { type: 'global' },
            mode: 'auto',
        });
        expect(malformedHits).toMatchObject({ v: 1, ok: false, errorCode: 'memory_failed' });
        expect(serverFetchMock).toHaveBeenCalledTimes(1);
    });

    it('maps Home endpoint unavailability to a typed unavailable result', async () => {
        const { searchHomeMemory } = await import('./searchHomeMemory');

        serverFetchMock.mockResolvedValueOnce(new Response(null, { status: 404 }));
        const unavailable = await searchHomeMemory({
            query: 'vector',
            scope: { type: 'global' },
            mode: 'auto',
        });

        expect(unavailable).toMatchObject({ v: 1, ok: false, errorCode: 'memory_index_missing' });
    });
});
