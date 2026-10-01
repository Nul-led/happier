import { afterEach, describe, expect, it, vi } from 'vitest';

import { startExecutionRunStream } from './subscriptions.js';

type StreamEvent = Readonly<{ t: 'delta'; textDelta: string }>;

function deferred<T>(): Readonly<{
  promise: Promise<T>;
  resolve: (value: T) => void;
}> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

describe('execution-run subscriptions', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('serializes concurrent next calls through one cursor read', async () => {
    const firstPage = deferred<Readonly<{
      streamId: string;
      events: StreamEvent[];
      nextCursor: number;
      done: boolean;
    }>>();
    const cursors: number[] = [];
    const cancel = vi.fn(async () => undefined);
    const stream = await startExecutionRunStream({
      runId: 'run-1',
      start: async () => ({ streamId: 'stream-1' }),
      read: async (input) => {
        cursors.push(input.cursor);
        return await firstPage.promise;
      },
      cancel,
      closeSignal: new AbortController().signal,
    });
    const iterator = stream[Symbol.asyncIterator]();

    const first = iterator.next();
    const second = iterator.next();
    await Promise.resolve();
    expect(cursors).toEqual([0]);

    firstPage.resolve({
      streamId: 'stream-1',
      events: [
        { t: 'delta', textDelta: 'first' },
        { t: 'delta', textDelta: 'second' },
      ],
      nextCursor: 1,
      done: false,
    });

    await expect(first).resolves.toEqual({
      done: false,
      value: { t: 'delta', textDelta: 'first' },
    });
    await expect(second).resolves.toEqual({
      done: false,
      value: { t: 'delta', textDelta: 'second' },
    });
    expect(cursors).toEqual([0]);
    await iterator.return?.();
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it('rejects a first page with a foreign stream id before emitting or adopting it', async () => {
    const cancel = vi.fn(async () => undefined);
    const stream = await startExecutionRunStream({
      runId: 'run-1',
      start: async () => ({ streamId: 'stream-1' }),
      read: async () => ({
        streamId: 'stream-2',
        events: [{ t: 'delta' as const, textDelta: 'foreign' }],
        nextCursor: 99,
        done: true,
      }),
      cancel,
      closeSignal: new AbortController().signal,
    });

    await expect(stream[Symbol.asyncIterator]().next()).rejects.toMatchObject({
      name: 'HappierTransportError',
      code: 'execution_run_stream_id_mismatch',
    });
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(cancel).toHaveBeenCalledWith({ runId: 'run-1', streamId: 'stream-1' });
  });

  it('rejects a later foreign page while preserving the original cursor and cancellation identity', async () => {
    const cancel = vi.fn(async () => undefined);
    let reads = 0;
    const cursors: number[] = [];
    const stream = await startExecutionRunStream({
      runId: 'run-1',
      start: async () => ({ streamId: 'stream-1' }),
      read: async (input) => {
        reads += 1;
        cursors.push(input.cursor);
        return reads === 1
          ? {
              streamId: 'stream-1',
              events: [{ t: 'delta' as const, textDelta: 'valid' }],
              nextCursor: 1,
              done: false,
            }
          : {
              streamId: 'stream-2',
              events: [{ t: 'delta' as const, textDelta: 'foreign' }],
              nextCursor: 2,
              done: true,
            };
      },
      cancel,
      closeSignal: new AbortController().signal,
    });
    const iterator = stream[Symbol.asyncIterator]();

    await expect(iterator.next()).resolves.toEqual({
      done: false,
      value: { t: 'delta', textDelta: 'valid' },
    });
    await expect(iterator.next()).rejects.toMatchObject({
      name: 'HappierTransportError',
      code: 'execution_run_stream_id_mismatch',
    });
    expect(cursors).toEqual([0, 1]);
    expect(cancel).toHaveBeenCalledWith({ runId: 'run-1', streamId: 'stream-1' });
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it('waits on the producer push without issuing idle reads', async () => {
    vi.useFakeTimers();
    const pushedPage = deferred<Readonly<{
      streamId: string; events: StreamEvent[]; nextCursor: number; done: boolean;
    }>>();
    let reads = 0;
    let requestedWait: unknown;
    const stream = await startExecutionRunStream({
      runId: 'run-1',
      start: async () => ({ streamId: 'stream-1' }),
      read: async (input) => {
        reads += 1;
        requestedWait = Reflect.get(input, 'waitForEvents');
        return await pushedPage.promise;
      },
      cancel: async () => undefined,
      closeSignal: new AbortController().signal,
    });
    const iterator = stream[Symbol.asyncIterator]();

    const next = iterator.next();
    await Promise.resolve();
    await Promise.resolve();
    expect(reads).toBe(1);

    await vi.advanceTimersByTimeAsync(10_000);
    expect(reads).toBe(1);
    expect(requestedWait).toBe(true);
    pushedPage.resolve({ streamId: 'stream-1', events: [{ t: 'delta', textDelta: 'ready' }], nextCursor: 1, done: true });
    await expect(next).resolves.toEqual({
      done: false,
      value: { t: 'delta', textDelta: 'ready' },
    });
    expect(reads).toBe(1);
  });

  it('aborts a pending producer read and cancels without another read', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const cancel = vi.fn(async () => undefined);
    let reads = 0;
    const stream = await startExecutionRunStream({
      runId: 'run-1',
      start: async () => ({ streamId: 'stream-1' }),
      read: async (_input, signal) => {
        reads += 1;
        return await new Promise<never>((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(signal.reason), { once: true });
        });
      },
      cancel,
      closeSignal: new AbortController().signal,
      signal: controller.signal,
    });
    const iterator = stream[Symbol.asyncIterator]();

    const next = iterator.next();
    await Promise.resolve();
    await Promise.resolve();
    expect(reads).toBe(1);

    controller.abort(new Error('stop observation'));
    await expect(next).resolves.toEqual({ done: true, value: undefined });
    expect(reads).toBe(1);
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it('rejects a finite-only producer instead of repeatedly reading an idle cursor', async () => {
    const cancel = vi.fn(async () => undefined);
    const read = vi.fn(async () => ({ streamId: 'stream-1', events: [], nextCursor: 0, done: false }));
    const stream = await startExecutionRunStream({
      runId: 'run-1', start: async () => ({ streamId: 'stream-1' }), read, cancel,
      closeSignal: new AbortController().signal,
    });
    await expect(stream[Symbol.asyncIterator]().next()).rejects.toMatchObject({ code: 'execution_run_stream_update_required' });
    expect(read).toHaveBeenCalledOnce();
    expect(cancel).toHaveBeenCalledOnce();
  });

  it('returns while concurrent next calls share one pending read', async () => {
    const page = deferred<Readonly<{
      streamId: string;
      events: StreamEvent[];
      nextCursor: number;
      done: boolean;
    }>>();
    const cancel = vi.fn(async () => undefined);
    let reads = 0;
    const stream = await startExecutionRunStream({
      runId: 'run-1',
      start: async () => ({ streamId: 'stream-1' }),
      read: async () => {
        reads += 1;
        return await page.promise;
      },
      cancel,
      closeSignal: new AbortController().signal,
    });
    const iterator = stream[Symbol.asyncIterator]();

    const first = iterator.next();
    const second = iterator.next();
    await Promise.resolve();
    expect(reads).toBe(1);

    await iterator.return?.();
    page.resolve({
      streamId: 'stream-1',
      events: [{ t: 'delta', textDelta: 'late' }],
      nextCursor: 1,
      done: false,
    });

    await expect(first).resolves.toEqual({ done: true, value: undefined });
    await expect(second).resolves.toEqual({ done: true, value: undefined });
    expect(reads).toBe(1);
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it('bounds iterator return while execution-run cancellation continues', async () => {
    vi.useFakeTimers();
    const cancellation = deferred<void>();
    let cancellationCompleted = false;
    const cancel = vi.fn(async () => {
      await cancellation.promise;
      cancellationCompleted = true;
    });
    const stream = await startExecutionRunStream({
      runId: 'run-1',
      start: async () => ({ streamId: 'stream-1' }),
      read: async () => ({
        streamId: 'stream-1',
        events: [],
        nextCursor: 0,
        done: false,
      }),
      cancel,
      closeSignal: new AbortController().signal,
    });

    const returning = stream[Symbol.asyncIterator]().return!();
    let returnSettled = false;
    void returning.then(() => {
      returnSettled = true;
    });
    await vi.advanceTimersByTimeAsync(1_000);
    const settledAtGrace = returnSettled;
    const cleanupCompletedAtGrace = cancellationCompleted;
    cancellation.resolve();
    await returning;

    expect(settledAtGrace).toBe(true);
    expect(cleanupCompletedAtGrace).toBe(false);
    expect(cancel).toHaveBeenCalledOnce();
  });

});
