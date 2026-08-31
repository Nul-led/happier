import { afterEach, describe, expect, it, vi } from 'vitest';

import { resetRuntimeFetch } from './client';

type WaitForServerReachable = typeof import(
    '@/sync/runtime/connectivity/serverReachabilitySupervisorPool'
).waitForServerReachable;
type RuntimeFetch = (
    input: RequestInfo | URL,
    init?: RequestInit,
) => Promise<Response>;

afterEach(() => {
    resetRuntimeFetch();
    vi.unstubAllGlobals();
    vi.resetModules();
    vi.clearAllMocks();
});

describe('serverFetch runtime fetch override', () => {
    it('uses the configured runtime fetch implementation instead of global fetch', async () => {
        vi.doMock('@/sync/domains/server/serverRuntime', () => ({
            getActiveServerSnapshot: () => ({
                serverId: 'server-a',
                serverUrl: 'https://api.example.test',
                kind: 'custom',
                generation: 1,
            }),
        }));
        vi.doMock('@/auth/storage/tokenStorage', () => ({
            TokenStorage: {
                getCredentials: vi.fn(async () => null),
                invalidateCredentialsTokenForServerUrl: vi.fn(async () => false),
            },
        }));

        const globalFetchMock = vi.fn(async () => {
            throw new Error('global fetch should not be called');
        });
        vi.stubGlobal('fetch', globalFetchMock as unknown as typeof fetch);

        const client = await import('./client');
        expect((client as unknown as { setRuntimeFetch?: unknown }).setRuntimeFetch).toBeTypeOf('function');

        const overrideFetch = vi.fn(async () => new Response(null, { status: 200, headers: new Headers() }));
        (client as unknown as {
            setRuntimeFetch: (next: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>) => void;
        }).setRuntimeFetch(overrideFetch);

        const resp = await (client as unknown as { serverFetch: typeof import('./client').serverFetch }).serverFetch(
            '/v1/health',
            undefined,
            { retry: 'none' },
        );
        expect(resp.status).toBe(200);
        expect(overrideFetch).toHaveBeenCalledTimes(1);
        expect(globalFetchMock).not.toHaveBeenCalled();
    });

    it('gates explicit-endpoint requests with a runtime origin under the stable endpoint reachability key', async () => {
        const waitForSpy = vi.fn<WaitForServerReachable>(async () => {});
        vi.doMock('@/sync/runtime/connectivity/serverReachabilitySupervisorPool', async (importOriginal) => {
            const actual = await importOriginal<typeof import('@/sync/runtime/connectivity/serverReachabilitySupervisorPool')>();
            return {
                ...actual,
                waitForServerReachable: waitForSpy,
                peekServerReachabilityToken: () => null,
                peekServerReachabilityScope: () => null,
            };
        });
        vi.doMock('@/sync/domains/server/serverRuntime', () => ({
            getActiveServerSnapshot: () => ({
                serverId: 'server-a',
                serverUrl: 'https://api.example.test',
                kind: 'custom',
                generation: 1,
            }),
        }));
        vi.doMock('@/auth/storage/tokenStorage', () => ({
            TokenStorage: {
                getCredentials: vi.fn(async () => null),
                getCredentialsForServerUrl: vi.fn(async () => null),
                invalidateCredentialsTokenForServerUrl: vi.fn(async () => false),
            },
        }));

        const overrideFetch = vi.fn<RuntimeFetch>(async () => new Response(null, { status: 200, headers: new Headers() }));

        const client = await import('./client');
        (client as unknown as {
            setRuntimeFetch: (next: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>) => void;
        }).setRuntimeFetch(overrideFetch);

        // A non-focused Iroh-only Home: the verified loopback origin carries the request
        // bytes, but reachability must stay keyed by the Home's stable canonical URL.
        const request = client.createServerFetchAtEndpoint({
            endpointUrl: 'https://home-b.example.test',
            runtimeOrigin: 'http://127.0.0.1:43210',
            credentials: { token: 'token-b' },
        });
        const response = await request('/v1/example', { method: 'GET' });
        expect(response.status).toBe(200);

        expect(waitForSpy).toHaveBeenCalledWith(expect.objectContaining({
            serverUrl: 'https://home-b.example.test',
        }));
        expect(waitForSpy.mock.calls[0]?.[0]).not.toHaveProperty('serverUrl', 'http://127.0.0.1:43210');
        expect(overrideFetch.mock.calls[0]?.[0]).toBe('http://127.0.0.1:43210/v1/example');
    });
});
