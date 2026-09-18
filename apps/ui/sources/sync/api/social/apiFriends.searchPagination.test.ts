import { describe, expect, it, vi } from 'vitest';

import type { AuthCredentials } from '@/auth/storage/tokenStorage';

import { searchUsersPageByUsername } from './apiFriends';

const credentials: AuthCredentials = { token: 'token', secret: 'secret' };

describe('searchUsersPageByUsername', () => {
    it('carries the server-owned cursor unchanged and accepts the next page', async () => {
        const request = vi.fn(async (_path: string, _init?: RequestInit) => new Response(JSON.stringify({
            users: [{
                id: 'account-11', firstName: 'Candidate', lastName: null, avatar: null,
                username: 'candidate_11', bio: null, badges: [], status: 'none', publicKey: null,
            }],
            nextCursor: null,
        }), { status: 200, headers: { 'Content-Type': 'application/json' } }));

        await expect(searchUsersPageByUsername(credentials, 'candidate_', {
            request,
            retry: 'none',
            cursor: 'opaque-page-two',
        })).resolves.toMatchObject({ users: [{ id: 'account-11' }], nextCursor: null });

        const requestedUrl = new URL(String(request.mock.calls[0]?.[0]), 'https://home.invalid');
        expect(requestedUrl.pathname).toBe('/v1/user/search');
        expect(requestedUrl.searchParams.get('query')).toBe('candidate_');
        expect(requestedUrl.searchParams.get('cursor')).toBe('opaque-page-two');
        expect(requestedUrl.searchParams.get('purpose')).toBeNull();
    });

    it('treats a released response without a cursor as a complete bounded page', async () => {
        const request = vi.fn(async (_path: string, _init?: RequestInit) => new Response(JSON.stringify({ users: [] }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
        }));

        await expect(searchUsersPageByUsername(credentials, '', { request, retry: 'none' }))
            .resolves.toEqual({ users: [], nextCursor: null });
    });

    it('declares collaboration discovery without changing ordinary username search', async () => {
        const request = vi.fn(async () => new Response(JSON.stringify({ users: [], nextCursor: null }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
        }));

        await searchUsersPageByUsername(credentials, 'candidate_', {
            purpose: 'collaboration', request, retry: 'none',
        });

        const requestedUrl = new URL(String(request.mock.calls[0]?.[0]), 'https://home.invalid');
        expect(requestedUrl.searchParams.get('purpose')).toBe('collaboration');
    });
});
