import { describe, expect, it } from 'vitest';

import { requestScmForgeJson, type ScmForgeHttpErrorContext } from './forgeHttp.js';

function jsonResponse(body: unknown, init?: Readonly<{ status?: number; statusText?: string }>) {
    const status = init?.status ?? 200;
    return {
        ok: status >= 200 && status < 300,
        status,
        statusText: init?.statusText ?? 'OK',
        json: async () => body,
        text: async () => JSON.stringify(body),
    };
}

describe('requestScmForgeJson', () => {
    it('redacts sensitive request headers in error context while sending real credentials', async () => {
        let fetchAuthorization: string | null = null;
        let mappedContext: ScmForgeHttpErrorContext | null = null;

        await expect(requestScmForgeJson({
            url: 'https://alice:scm-userinfo-secret@api.github.com/repos/happier-dev/private?access_token=scm-query-secret&safe=yes',
            init: {
                method: 'POST',
                headers: {
                    Authorization: 'Bearer secret-token',
                    'X-Api-Key': 'secret-api-key',
                    'X-Scm-Secret': 'unallowlisted-scm-secret',
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ name: 'private' }),
            },
            fetcher: async (_url, init) => {
                const headers = init?.headers as Readonly<Record<string, string>>;
                fetchAuthorization = headers.Authorization ?? null;
                return jsonResponse({ message: 'forbidden' }, { status: 403, statusText: 'Forbidden' });
            },
            mapError: (context) => {
                mappedContext = context;
                return new Error(`mapped ${context.status}`);
            },
        })).rejects.toThrow('mapped 403');

        expect(fetchAuthorization).toBe('Bearer secret-token');
        expect(mappedContext).toMatchObject({
            url: expect.stringContaining('api.github.com/repos/happier-dev/private'),
            method: 'POST',
            status: 403,
            statusText: 'Forbidden',
            body: { message: 'forbidden' },
            request: {
                headers: {
                    Authorization: '[redacted]',
                    'X-Api-Key': '[redacted]',
                    'X-Scm-Secret': '[redacted]',
                    'Content-Type': 'application/json',
                },
            },
        });
        expect(JSON.stringify(mappedContext)).not.toContain('secret-token');
        expect(JSON.stringify(mappedContext)).not.toContain('secret-api-key');
        expect(JSON.stringify(mappedContext)).not.toContain('unallowlisted-scm-secret');
        expect(JSON.stringify(mappedContext)).not.toContain('alice');
        expect(JSON.stringify(mappedContext)).not.toContain('scm-userinfo-secret');
        expect(JSON.stringify(mappedContext)).not.toContain('scm-query-secret');
        expect(JSON.stringify(mappedContext)).toContain('safe=yes');
    });

    it('preserves non-JSON error response bodies from real fetch responses', async () => {
        let mappedContext: ScmForgeHttpErrorContext | null = null;

        await expect(requestScmForgeJson({
            url: 'https://api.github.com/repos/happier-dev/private',
            fetcher: async () => new Response('service unavailable', {
                status: 503,
                statusText: 'Service Unavailable',
                headers: { 'Content-Type': 'text/plain' },
            }),
            mapError: (context) => {
                mappedContext = context;
                return new Error(`mapped ${context.status}`);
            },
        })).rejects.toThrow('mapped 503');

        expect(mappedContext).toMatchObject({
            status: 503,
            statusText: 'Service Unavailable',
            body: 'service unavailable',
        });
    });

    it('normalizes only the allowlisted retry-evidence response headers a mapper classifies from', async () => {
        let responseHeaders: Readonly<Record<string, string>> | null = null;

        await expect(requestScmForgeJson({
            url: 'https://api.github.com/user/repos',
            init: { method: 'POST' },
            fetcher: async () => new Response(JSON.stringify({ message: 'API rate limit exceeded' }), {
                status: 403,
                statusText: 'Forbidden',
                headers: {
                    'Content-Type': 'application/json',
                    'Retry-After': '  120  ',
                    'X-RateLimit-Remaining': '0',
                    'X-RateLimit-Reset': '1700000000',
                    'X-Accepted-GitHub-Permissions': 'administration=write',
                    'Set-Cookie': 'forge_session=forge-response-secret',
                },
            }),
            mapError: (context) => {
                responseHeaders = context.response.headers;
                return new Error(`mapped ${context.status}`);
            },
        })).rejects.toThrow('mapped 403');

        // Normalized to lowercase names and trimmed values, and bounded: a forge
        // response can carry credential-bearing headers, and an error mapper may
        // log or persist this context.
        expect(responseHeaders).toEqual({
            'retry-after': '120',
            'x-ratelimit-remaining': '0',
            'x-ratelimit-reset': '1700000000',
            'x-accepted-github-permissions': 'administration=write',
        });
        expect(JSON.stringify(responseHeaders)).not.toContain('forge-response-secret');
    });

    it('reports empty response headers when a fetcher stub exposes none', async () => {
        let responseHeaders: Readonly<Record<string, string>> | null = null;

        await expect(requestScmForgeJson({
            url: 'https://api.github.com/user/repos',
            fetcher: async () => jsonResponse({ message: 'forbidden' }, { status: 403 }),
            mapError: (context) => {
                responseHeaders = context.response.headers;
                return new Error('mapped');
            },
        })).rejects.toThrow('mapped');

        expect(responseHeaders).toEqual({});
    });
});
