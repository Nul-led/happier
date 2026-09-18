import { afterEach, describe, expect, it, vi } from 'vitest';

import { OpenCodeSseReadIdleTimeoutError, subscribeSseJson } from './openCodeSse.js';

type TestReaderResult<T> =
  | { done: true; value?: T }
  | { done: false; value: T };

describe('subscribeSseJson', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('aborts a half-open stream when no bytes arrive before the read-idle timeout', async () => {
    vi.useFakeTimers();
    const fetchSignalState = { aborted: false };
    const reader = {
      read: () => new Promise<TestReaderResult<Uint8Array>>(() => undefined),
      cancel: vi.fn(async () => undefined),
    };
    const fetch = vi.fn(async (_url: string | URL, init?: RequestInit) => {
      fetchSignalState.aborted = init?.signal?.aborted === true;
      init?.signal?.addEventListener('abort', () => {
        fetchSignalState.aborted = true;
      }, { once: true });
      return {
        ok: true,
        status: 200,
        statusText: 'OK',
        body: {
          getReader: () => reader,
        },
      } as unknown as Response;
    });

    const subscription = await subscribeSseJson<{ type: string }>({
      url: 'http://127.0.0.1:9999/global/event',
      fetch,
      signal: new AbortController().signal,
      readIdleTimeoutMs: 5,
      onMessage: vi.fn(),
    });

    const doneExpectation = expect(subscription.done).rejects.toBeInstanceOf(OpenCodeSseReadIdleTimeoutError);

    await vi.advanceTimersByTimeAsync(6);

    await doneExpectation;
    expect(fetchSignalState.aborted).toBe(true);
    expect(reader.cancel).toHaveBeenCalledWith(expect.any(OpenCodeSseReadIdleTimeoutError));
  });

  it('does not impose a read-idle deadline on a healthy quiet stream by default', async () => {
    vi.useFakeTimers();
    const reader = {
      read: () => new Promise<TestReaderResult<Uint8Array>>((resolve) => {
        setTimeout(() => resolve({ done: true }), 31_000);
      }),
      cancel: vi.fn(async () => undefined),
    };
    const fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      body: { getReader: () => reader },
    } as unknown as Response));

    const subscription = await subscribeSseJson<{ type: string }>({
      url: 'http://127.0.0.1:9999/global/event',
      fetch,
      signal: new AbortController().signal,
      onMessage: vi.fn(),
    });
    const outcome = subscription.done.then(
      () => 'resolved' as const,
      (error: unknown) => error,
    );

    await vi.advanceTimersByTimeAsync(31_000);
    await expect(outcome).resolves.toBe('resolved');
    expect(reader.cancel).not.toHaveBeenCalled();
  });

  it('parses JSON data frames and ignores non-data SSE fields', async () => {
    const encoder = new TextEncoder();
    const chunks = [
      // `id:` is parsed as a field rather than payload, but is not surfaced:
      // neither OpenCode event route supports resuming from one.
      encoder.encode('id: evt-1\ndata: {"type":"hello"}\n\n'),
      encoder.encode('event: message\ndata: {"type":"bye"}\n\n'),
      encoder.encode(': heartbeat\n\n'),
    ];
    const fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      body: {
        getReader: () => ({
          read: async () => {
            const next = chunks.shift();
            return next ? { done: false, value: next } : { done: true };
          },
          cancel: vi.fn(async () => undefined),
        }),
      },
    } as unknown as Response));
    const onMessage = vi.fn();

    const subscription = await subscribeSseJson<{ type: string }>({
      url: 'http://127.0.0.1:9999/global/event',
      fetch,
      signal: new AbortController().signal,
      readIdleTimeoutMs: null,
      onMessage,
    });
    await subscription.done;

    expect(onMessage.mock.calls).toEqual([
      [{ type: 'hello' }],
      [{ type: 'bye' }],
    ]);
  });
});
