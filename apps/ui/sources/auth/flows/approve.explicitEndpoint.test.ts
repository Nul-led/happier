import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    serverFetch: vi.fn(),
    createServerFetchAtEndpoint: vi.fn(),
    endpointFetch: vi.fn(),
}));

vi.mock('@/sync/http/client', () => ({
    serverFetch: mocks.serverFetch,
    createServerFetchAtEndpoint: mocks.createServerFetchAtEndpoint,
}));

import { authApproveAtEndpoint } from './approve';

function jsonResponse(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });
}

describe('authApproveAtEndpoint explicit target', () => {
    beforeEach(() => {
        mocks.serverFetch.mockReset();
        mocks.endpointFetch.mockReset();
        mocks.createServerFetchAtEndpoint.mockReset();
        mocks.createServerFetchAtEndpoint.mockImplementation(() => mocks.endpointFetch);
    });

    it('posts the token-only response to the explicit endpoint with the supplied token and no focused-Home use', async () => {
        mocks.endpointFetch
            .mockResolvedValueOnce(jsonResponse({ status: 'pending', supportsV2: true }))
            .mockResolvedValueOnce(jsonResponse({ success: true }));

        await expect(authApproveAtEndpoint({
            endpointUrl: 'http://127.0.0.1:3005',
            serverId: 'srv_home_b',
            token: 'home-b-bearer',
            publicKeyBase64: 'pub-key-b64',
            responseBase64: 'opaque-response-b64',
            responseKind: 'tokenOnly',
        })).resolves.toBe('approved');

        expect(mocks.createServerFetchAtEndpoint).toHaveBeenCalledWith(expect.objectContaining({
            endpointUrl: 'http://127.0.0.1:3005',
            serverId: 'srv_home_b',
        }));
        expect(mocks.serverFetch).not.toHaveBeenCalled();

        const statusCall = mocks.endpointFetch.mock.calls[0];
        expect(String(statusCall?.[0])).toContain('/v1/auth/request/status?publicKey=pub-key-b64');
        const postCall = mocks.endpointFetch.mock.calls[1];
        expect(postCall?.[0]).toBe('/v1/auth/response');
        const init = postCall?.[1] as RequestInit;
        expect((init.headers as Record<string, string>).Authorization).toBe('Bearer home-b-bearer');
        expect(JSON.parse(String(init.body))).toEqual({
            publicKey: 'pub-key-b64',
            response: 'opaque-response-b64',
            responseKind: 'tokenOnly',
        });
        expect(postCall?.[2]).toMatchObject({ includeAuth: false });
    });

    it('posts dataKey responses with their declared kind to the explicit endpoint', async () => {
        mocks.endpointFetch
            .mockResolvedValueOnce(jsonResponse({ status: 'pending', supportsV2: true }))
            .mockResolvedValueOnce(jsonResponse({ success: true }));

        await expect(authApproveAtEndpoint({
            endpointUrl: 'http://127.0.0.1:3005',
            token: 'home-b-bearer',
            publicKeyBase64: 'pub-key-b64',
            responseBase64: 'opaque-datakey-response-b64',
            responseKind: 'dataKey',
        })).resolves.toBe('approved');

        const postCall = mocks.endpointFetch.mock.calls[1];
        expect(JSON.parse(String((postCall?.[1] as RequestInit).body))).toEqual({
            publicKey: 'pub-key-b64',
            response: 'opaque-datakey-response-b64',
            responseKind: 'dataKey',
        });
    });

    it('reports already_authorized without posting when the request is already authorized', async () => {
        mocks.endpointFetch
            .mockResolvedValueOnce(jsonResponse({ status: 'authorized', supportsV2: true }));

        await expect(authApproveAtEndpoint({
            endpointUrl: 'http://127.0.0.1:3005',
            token: 'home-b-bearer',
            publicKeyBase64: 'pub-key-b64',
            responseBase64: 'opaque-response-b64',
            responseKind: 'tokenOnly',
        })).resolves.toBe('already_authorized');

        expect(mocks.endpointFetch).toHaveBeenCalledTimes(1);
    });

    it('reports not_found without posting when the request expired', async () => {
        mocks.endpointFetch
            .mockResolvedValueOnce(jsonResponse({ status: 'not_found', supportsV2: true }));

        await expect(authApproveAtEndpoint({
            endpointUrl: 'http://127.0.0.1:3005',
            token: 'home-b-bearer',
            publicKeyBase64: 'pub-key-b64',
            responseBase64: 'opaque-response-b64',
            responseKind: 'tokenOnly',
        })).resolves.toBe('not_found');

        expect(mocks.endpointFetch).toHaveBeenCalledTimes(1);
    });
});
