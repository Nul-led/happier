import { afterEach, describe, expect, it, vi } from 'vitest';
import { awaitSpawnedSessionId } from './awaitSpawnedSessionId';
import { SPAWN_SESSION_ERROR_CODES } from '@/session/shared/spawnSessionContract';

describe('awaitSpawnedSessionId terminal observation', () => {
  afterEach(() => vi.useRealTimers());

  it('keeps transport loss unresolved until the containing deadline without redispatch', async () => {
    vi.useFakeTimers();
    const resolve = vi.fn(async () => { throw new Error('control transport lost'); });
    let settled = false;
    const wait = awaitSpawnedSessionId({ result: { type: 'success' }, spawnNonce: 'nonce', resolveSpawnSessionByNonce: resolve, timeoutMs: 1_000 })
      .then((result) => { settled = true; return result; });
    await vi.advanceTimersByTimeAsync(500);
    expect(settled).toBe(false);
    expect(resolve).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(500);
    expect(await wait).toMatchObject({ type: 'error', errorCode: SPAWN_SESSION_ERROR_CODES.SESSION_WEBHOOK_TIMEOUT });
  });

  it('makes one deadline-bounded observation without a cadence when the owner returns pending', async () => {
    vi.useFakeTimers();
    const resolve = vi.fn(async () => ({ status: 'pending' as const }));
    const wait = awaitSpawnedSessionId({ result: { type: 'success' }, spawnNonce: 'nonce', resolveSpawnSessionByNonce: resolve, timeoutMs: 1_000 });
    await vi.advanceTimersByTimeAsync(500);
    expect(resolve).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(500);
    expect(await wait).toMatchObject({ type: 'error', errorCode: SPAWN_SESSION_ERROR_CODES.SESSION_WEBHOOK_TIMEOUT });
  });

  it('bounds a stuck transport and cancellation by the containing wait', async () => {
    vi.useFakeTimers();
    const resolve = vi.fn(() => new Promise<never>(() => {}));
    const signal = new AbortController();
    const wait = awaitSpawnedSessionId({ result: { type: 'success' }, spawnNonce: 'nonce', resolveSpawnSessionByNonce: resolve, timeoutMs: 1_000, signal: signal.signal });
    signal.abort();
    expect(await wait).toMatchObject({ type: 'error', errorCode: SPAWN_SESSION_ERROR_CODES.SESSION_WEBHOOK_TIMEOUT });
    expect(vi.getTimerCount()).toBe(0);
    const timed = awaitSpawnedSessionId({ result: { type: 'success' }, spawnNonce: 'nonce', resolveSpawnSessionByNonce: resolve, timeoutMs: 1_000 });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(await timed).toMatchObject({ type: 'error', errorCode: SPAWN_SESSION_ERROR_CODES.SESSION_WEBHOOK_TIMEOUT });
    expect(vi.getTimerCount()).toBe(0);
  });
});
