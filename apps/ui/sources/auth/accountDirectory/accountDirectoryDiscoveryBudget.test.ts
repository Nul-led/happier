import { afterEach, describe, expect, it, vi } from 'vitest';

import { installTokenStorageWebPlatformMocks } from '@/auth/storage/tokenStorage.testHelpers';

installTokenStorageWebPlatformMocks();
const boundary = vi.hoisted(() => ({ request: vi.fn() }));
// The network is the only boundary: the real feature client, its cache and its attempt bound run.
vi.mock('@/sync/http/client', () => ({
    createServerFetchAtEndpoint: (options: { endpointUrl: string }) => (path: string, init?: RequestInit) => boundary.request(options.endpointUrl, path, init),
    serverFetch: (path: string, init?: RequestInit) => boundary.request('ambient', path, init),
}));

import { accountDirectoryAuthClient } from './accountDirectoryAuthClient';

/** The shared feature probe's own attempt bound (`REQUEST_ATTEMPT_TIMEOUT_MS`). */
const FEATURE_PROBE_ATTEMPT_MS = 60_000;

function hangingUntilAborted(_endpoint: string, _path: string, init?: RequestInit): Promise<Response> {
    return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true });
    });
}

describe('account-service discovery budget', () => {
    afterEach(() => {
        vi.useRealTimers();
        boundary.request.mockReset();
    });

    it('waits for a slow service instead of reporting it unreachable after a foreground cutoff', async () => {
        vi.useFakeTimers();
        boundary.request.mockImplementation(hangingUntilAborted);
        let settled: unknown = null;
        void accountDirectoryAuthClient.discoverAuthenticationMethods({ endpointUrl: 'https://slow-directory.test' })
            .then((result) => { settled = result; });

        // Well past any foreground wait, the service is still being checked, not "unreachable".
        await vi.advanceTimersByTimeAsync(FEATURE_PROBE_ATTEMPT_MS - 1);
        expect(settled).toBeNull();

        // The owning probe's attempt bound is what ends the check, as a real failure.
        await vi.advanceTimersByTimeAsync(1);
        await vi.waitFor(() => expect(settled).toMatchObject({
            kind: 'endpoint_unavailable',
            reason: 'probe_failed',
            snapshot: { status: 'error', reason: 'timeout' },
        }));
    });
});
