import { afterEach, describe, expect, it, vi } from 'vitest';

import { FEATURES_RESPONSE_MAX_UTF8_BYTES_V1 } from '@happier-dev/protocol';

import {
  fetchServerFeaturesSnapshot,
  observeServerFeaturesSnapshot,
  refreshServerFeaturesSnapshot,
  resetServerFeaturesClientForTests,
} from './serverFeaturesClient';

describe('fetchServerFeaturesSnapshot', () => {
  afterEach(() => {
    resetServerFeaturesClientForTests();
    vi.unstubAllGlobals();
  });

  it('lets a caller stop waiting without cancelling the shared public request', async () => {
    const caller = new AbortController();
    let observedSignal: AbortSignal | undefined;
    let resolveRequest!: (response: Response) => void;
    vi.stubGlobal('fetch', vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      observedSignal = init?.signal ?? undefined;
      return await new Promise<Response>((resolve) => {
        resolveRequest = resolve;
      });
    }));

    const pending = fetchServerFeaturesSnapshot({
      serverUrl: 'https://server.example.test',
      signal: caller.signal,
    });
    await vi.waitFor(() => expect(observedSignal).toBeDefined());
    const cancellation = new DOMException('Caller cancelled feature discovery', 'AbortError');
    caller.abort(cancellation);

    expect(observedSignal?.aborted).toBe(false);
    await expect(pending).rejects.toBe(cancellation);
    resolveRequest(new Response(JSON.stringify({ features: {}, capabilities: {} }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }));
    await expect(fetchServerFeaturesSnapshot({
      serverUrl: 'https://server.example.test',
    })).resolves.toMatchObject({ status: 'ready' });
  });

  it('coalesces concurrent public reads and caches the ready snapshot', async () => {
    let resolveRequest!: (response: Response) => void;
    const fetchMock = vi.fn(async () => await new Promise<Response>((resolve) => {
      resolveRequest = resolve;
    }));
    vi.stubGlobal('fetch', fetchMock);

    const first = fetchServerFeaturesSnapshot({ serverUrl: 'https://server.example.test' });
    const second = fetchServerFeaturesSnapshot({ serverUrl: 'https://server.example.test/' });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    resolveRequest(new Response(JSON.stringify({
      features: {},
      capabilities: { serverIdentity: { serverIdentityId: 'srv_home' } },
    }), { status: 200, headers: { 'content-type': 'application/json' } }));

    await expect(Promise.all([first, second])).resolves.toEqual([
      expect.objectContaining({ status: 'ready' }),
      expect.objectContaining({ status: 'ready' }),
    ]);
    await expect(fetchServerFeaturesSnapshot({
      serverUrl: 'https://server.example.test',
    })).resolves.toMatchObject({ status: 'ready' });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('refreshes the shared public snapshot instead of returning its cached value', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      features: {},
      capabilities: { serverIdentity: { serverIdentityId: `srv_${fetchMock.mock.calls.length}` } },
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);

    await fetchServerFeaturesSnapshot({ serverUrl: 'https://server.example.test' });
    await refreshServerFeaturesSnapshot({ serverUrl: 'https://server.example.test' });

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('retains the last ready public snapshot through a retryable refresh failure', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        features: {},
        capabilities: { serverIdentity: { serverIdentityId: 'srv_home' } },
      }), { status: 200, headers: { 'content-type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(null, { status: 503 }));
    vi.stubGlobal('fetch', fetchMock);

    const ready = await fetchServerFeaturesSnapshot({ serverUrl: 'https://server.example.test' });
    const afterFailure = await refreshServerFeaturesSnapshot({ serverUrl: 'https://server.example.test' });

    expect(ready).toMatchObject({ status: 'ready' });
    expect(afterFailure).toBe(ready);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('keeps the request-owned deadline classified as a timeout', async () => {
    vi.useFakeTimers();
    try {
      vi.stubGlobal('fetch', vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
        return await new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(new DOMException('Feature request timed out', 'AbortError'));
          }, { once: true });
        });
      }));
      const pending = fetchServerFeaturesSnapshot({
        serverUrl: 'https://server.example.test',
        timeoutMs: 1,
      });

      await vi.advanceTimersByTimeAsync(1_001);

      await expect(pending).resolves.toEqual({ status: 'error', reason: 'timeout' });
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not fail ordinary feature discovery at the former six-second deadline', async () => {
    vi.useFakeTimers();
    try {
      vi.stubGlobal('fetch', vi.fn(async (_input: string | URL | Request, init?: RequestInit) => (
        await new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(new DOMException('Feature request timed out', 'AbortError'));
          }, { once: true });
        })
      )));
      let settled = false;
      const pending = fetchServerFeaturesSnapshot({ serverUrl: 'https://server.example.test' })
        .then((snapshot) => {
          settled = true;
          return snapshot;
        });

      await vi.advanceTimersByTimeAsync(6_001);
      expect(settled).toBe(false);
      await vi.advanceTimersByTimeAsync(54_000);
      await expect(pending).resolves.toEqual({ status: 'error', reason: 'timeout' });
    } finally {
      vi.useRealTimers();
    }
  });

  it('uses the authenticated exact-descriptor endpoint only when a credential is supplied', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      features: {},
      capabilities: { serverIdentity: { serverIdentityId: 'srv_home' } },
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchServerFeaturesSnapshot({
      serverUrl: 'https://server.example.test',
      token: 'home-token',
    })).resolves.toMatchObject({ status: 'ready', provenance: 'authenticated' });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://server.example.test/v1/features/authenticated',
      expect.objectContaining({
        headers: { Authorization: 'Bearer home-token' },
      }),
    );
  });

  it('supports a fresh bearer-authenticated observation of the public projection through an injected fetch boundary', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      features: {},
      capabilities: { serverIdentity: { serverIdentityId: 'srv_home' } },
    }), { status: 200, headers: { 'content-type': 'application/json' } }));

    await expect(observeServerFeaturesSnapshot({
      serverUrl: 'https://server.example.test',
      token: 'home-token',
      projection: 'public',
      fetchImpl,
    })).resolves.toMatchObject({ status: 'ready', provenance: 'public' });

    expect(fetchImpl).toHaveBeenCalledWith(
      'https://server.example.test/v1/features',
      expect.objectContaining({
        headers: { Authorization: 'Bearer home-token' },
      }),
    );
  });

  it.each([404, 405, 501])(
    'falls back without a bearer to the public advisory projection when the authenticated route returns %s',
    async (status) => {
      const fetchMock = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(new Response(null, { status }))
        .mockResolvedValueOnce(new Response(JSON.stringify({
          features: {},
          capabilities: { serverIdentity: { serverIdentityId: 'srv_legacy_home' } },
        }), { status: 200, headers: { 'content-type': 'application/json' } }));
      vi.stubGlobal('fetch', fetchMock);

      await expect(fetchServerFeaturesSnapshot({
        serverUrl: 'https://legacy-home.example.test',
        token: 'home-token',
      })).resolves.toMatchObject({
        status: 'ready',
        provenance: 'public',
        features: { capabilities: { serverIdentity: { serverIdentityId: 'srv_legacy_home' } } },
      });
      expect(fetchMock).toHaveBeenNthCalledWith(1,
        'https://legacy-home.example.test/v1/features/authenticated',
        expect.objectContaining({ headers: { Authorization: 'Bearer home-token' } }),
      );
      expect(fetchMock).toHaveBeenNthCalledWith(2,
        'https://legacy-home.example.test/v1/features',
        expect.not.objectContaining({ headers: expect.anything() }),
      );
    },
  );

  it.each([401, 403, 429, 500])(
    'does not fall back to public features for authenticated response status %s',
    async (status) => {
      const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status }));
      vi.stubGlobal('fetch', fetchMock);

      await expect(fetchServerFeaturesSnapshot({
        serverUrl: 'https://server.example.test',
        token: 'home-token',
      })).resolves.toMatchObject({ status: 'error', reason: 'response_status', httpStatus: status });
      expect(fetchMock).toHaveBeenCalledOnce();
    },
  );

  it('does not fall back after an authenticated network failure', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockRejectedValue(new Error('offline'));
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchServerFeaturesSnapshot({
      serverUrl: 'https://server.example.test',
      token: 'home-token',
    })).resolves.toEqual({ status: 'error', reason: 'network' });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('rejects an over-budget feature body without calling the unbounded JSON reader', async () => {
    const response = new Response('x'.repeat(FEATURES_RESPONSE_MAX_UTF8_BYTES_V1 + 1), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
    const json = vi.spyOn(response, 'json');
    vi.stubGlobal('fetch', vi.fn(async () => response));

    await expect(fetchServerFeaturesSnapshot({
      serverUrl: 'https://server.example.test',
    })).resolves.toEqual({ status: 'unsupported', reason: 'invalid_payload' });
    expect(json).not.toHaveBeenCalled();
  });
});
