import { describe, expect, it, vi } from 'vitest';
import { withAuthenticatedTestApp } from '@/app/api/testkit/sqliteFastify';
import { registerHomeSearchRoutes } from './homeSearchRoutes';

describe('Home search route', () => {
    it('requires an ordinary present-user credential and passes only that account visibility to search', async () => {
        const search = vi.fn((_query: unknown, context?: Readonly<{ visibleSessionIds?: readonly string[] }>) => ({
            v: 1 as const,
            ok: true as const,
            hits: context?.visibleSessionIds?.includes('owned-session')
                ? [{ sessionId: 'owned-session', seqFrom: 1, seqTo: 1, createdAtFromMs: 1, createdAtToMs: 1, summary: 'owned', score: 1 }]
                : [],
        }));
        await withAuthenticatedTestApp((app) => registerHomeSearchRoutes(app, {
            service: { capability: () => ({ enabled: true, provider: 'home' }), search },
            resolveVisibleSessionIds: async (userId) => userId === 'owner' ? ['owned-session'] : [],
        }), async (app) => {
            const body = { v: 1, query: 'owned', scope: { type: 'global' }, mode: 'auto' };
            expect((await app.inject({ method: 'POST', url: '/v1/home/search', payload: body })).statusCode).toBe(401);
            expect((await app.inject({
                method: 'POST', url: '/v1/home/search', payload: body,
                headers: { 'x-test-user-id': 'owner', 'x-test-auth-token-kind': 'account_directory' },
            })).statusCode).toBe(403);
            expect((await app.inject({
                method: 'POST', url: '/v1/home/search', payload: body,
                headers: { 'x-test-user-id': 'owner', 'x-test-auth-token-kind': 'terminal' },
            })).statusCode).toBe(403);
            const other = await app.inject({ method: 'POST', url: '/v1/home/search', payload: body, headers: { 'x-test-user-id': 'other' } });
            expect(other.json()).toMatchObject({ ok: true, hits: [] });
            const owner = await app.inject({ method: 'POST', url: '/v1/home/search', payload: body, headers: { 'x-test-user-id': 'owner' } });
            expect(owner.json()).toMatchObject({ ok: true, hits: [expect.objectContaining({ sessionId: 'owned-session' })] });
        });
    });
});
