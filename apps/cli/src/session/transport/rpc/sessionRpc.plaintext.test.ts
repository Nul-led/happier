import { afterEach, describe, expect, it, vi } from 'vitest';
import { RPC_ERROR_CODES } from '@happier-dev/protocol/rpc';
import { readRpcErrorCode } from '@happier-dev/protocol/rpcErrors';

let nextRpcAck: any = null;
let nextSocket: FakeSocket | null = null;
let configureNextSocket: ((socket: FakeSocket) => void) | null = null;

class FakeSocket {
  private handlers = new Map<string, Array<(...args: any[]) => void>>();
  public emitted: Array<{ event: string; data: any }> = [];
  public onEmit: (() => void) | null = null;
  public connectError: Error | null = null;
  public disconnectAfterConnect = false;
  public emitError: Error | null = null;
  public ackMode: 'sync' | 'never' = 'sync';
  public disconnectCalls = 0;
  public closeCalls = 0;

  on(event: string, handler: (...args: any[]) => void) {
    const list = this.handlers.get(event) ?? [];
    list.push(handler);
    this.handlers.set(event, list);
    return this;
  }

  off(event: string, handler: (...args: any[]) => void) {
    const list = this.handlers.get(event) ?? [];
    this.handlers.set(event, list.filter((item) => item !== handler));
    return this;
  }

  removeListener(event: string, handler: (...args: any[]) => void) {
    return this.off(event, handler);
  }

  listenerCount(event: string) {
    return this.handlers.get(event)?.length ?? 0;
  }

  trigger(event: string, ...args: any[]) {
    for (const handler of this.handlers.get(event) ?? []) handler(...args);
  }

  connect() {
    if (this.connectError) {
      for (const handler of this.handlers.get('connect_error') ?? []) {
        handler(this.connectError);
      }
      return this;
    }
    for (const handler of this.handlers.get('connect') ?? []) {
      handler();
    }
    if (this.disconnectAfterConnect) {
      this.trigger('disconnect', 'transport close');
    }
    return this;
  }

  emit(event: string, data: any, callback: (payload: any) => void) {
    if (this.emitError) {
      throw this.emitError;
    }
    this.emitted.push({ event, data });
    this.onEmit?.();
    if (this.ackMode === 'never') {
      return this;
    }
    callback(nextRpcAck ?? { ok: true, result: { echoed: data.params } });
    return this;
  }

  disconnect() {
    this.disconnectCalls += 1;
  }

  close() {
    this.closeCalls += 1;
  }
}

vi.mock('@/api/session/sockets', () => ({
  createSessionScopedSocket: vi.fn(() => {
    nextSocket = new FakeSocket();
    configureNextSocket?.(nextSocket);
    return nextSocket;
  }),
  createUserScopedSocket: vi.fn(() => {
    nextSocket = new FakeSocket();
    configureNextSocket?.(nextSocket);
    return nextSocket;
  }),
}));

import { callSessionRpc, readSessionRpcRequestDisposition } from './sessionRpc';

describe('callSessionRpc (plaintext sessions)', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
    nextRpcAck = null;
    nextSocket = null;
    configureNextSocket = null;
  });

  it('uses a user-scoped caller socket for one-shot runtime RPC calls', async () => {
    const sockets = await import('@/api/session/sockets');
    await callSessionRpc({
      token: 't',
      sessionId: 'sess_1',
      mode: 'plain',
      method: 'sess_1:demo.method',
      request: { a: 1 },
      ctx: null,
    });

    expect(sockets.createUserScopedSocket).toHaveBeenCalledWith({ token: 't' });
    expect(sockets.createSessionScopedSocket).not.toHaveBeenCalled();
  });

  it('sends plaintext params and returns plaintext results when mode=plain', async () => {
    nextRpcAck = null;
    const req = { a: 1 };
    const res = await callSessionRpc({
      token: 't',
      sessionId: 'sess_1',
      mode: 'plain',
      method: 'sess_1:demo.method',
      request: req,
      ctx: null,
    });

    expect(res).toEqual({ echoed: req });
    expect(nextSocket?.emitted[0]?.data.requestId).toEqual(expect.any(String));
    expect(nextSocket?.disconnectCalls).toBe(1);
    expect(nextSocket?.closeCalls).toBe(1);
    expect(nextSocket?.listenerCount('connect')).toBe(0);
    expect(nextSocket?.listenerCount('connect_error')).toBe(0);
    expect(nextSocket?.listenerCount('disconnect')).toBe(0);
  });

  it('throws RpcError with rpcErrorCode when the RPC response includes errorCode', async () => {
    nextRpcAck = {
      ok: false,
      error: 'RPC method not available',
      errorCode: RPC_ERROR_CODES.METHOD_NOT_AVAILABLE,
    };

    await expect(
      callSessionRpc({
        token: 't',
        sessionId: 'sess_1',
        mode: 'plain',
        method: 'sess_1:demo.method',
        request: { a: 1 },
        ctx: null,
      }),
    ).rejects.toSatisfy((error: unknown) => readRpcErrorCode(error) === RPC_ERROR_CODES.METHOD_NOT_AVAILABLE);
    expect(nextSocket?.disconnectCalls).toBe(1);
    expect(nextSocket?.closeCalls).toBe(1);
  });

  it('closes the socket when connection fails before the RPC emit', async () => {
    configureNextSocket = (socket) => {
      socket.connectError = new Error('connect failed');
    };
    const promise = callSessionRpc({
      token: 't',
      sessionId: 'sess_1',
      mode: 'plain',
      method: 'sess_1:demo.method',
      request: { a: 1 },
      ctx: null,
    });

    const error = await promise.catch((caught: unknown) => caught);
    expect(error).toMatchObject({ message: 'connect failed' });
    expect(readSessionRpcRequestDisposition(error)).toBe('notSent');
    expect(nextSocket?.disconnectCalls).toBe(1);
    expect(nextSocket?.closeCalls).toBe(1);
    expect(nextSocket?.listenerCount('connect')).toBe(0);
    expect(nextSocket?.listenerCount('connect_error')).toBe(0);
  });

  it('closes the socket when emit throws synchronously', async () => {
    configureNextSocket = (socket) => {
      socket.emitError = new Error('emit failed');
    };
    const promise = callSessionRpc({
      token: 't',
      sessionId: 'sess_1',
      mode: 'plain',
      method: 'sess_1:demo.method',
      request: { a: 1 },
      ctx: null,
    });

    const error = await promise.catch((caught: unknown) => caught);
    expect(error).toMatchObject({ message: 'emit failed' });
    expect(readSessionRpcRequestDisposition(error)).toBe('outcomeUnknown');
    expect(nextSocket?.disconnectCalls).toBe(1);
    expect(nextSocket?.closeCalls).toBe(1);
  });

  it('closes the socket when the RPC ack times out', async () => {
    vi.useFakeTimers();
    configureNextSocket = (socket) => {
      socket.ackMode = 'never';
    };
    const promise = callSessionRpc({
      token: 't',
      sessionId: 'sess_1',
      mode: 'plain',
      method: 'sess_1:demo.method',
      request: { a: 1 },
      timeoutMs: 10,
      ctx: null,
    });
    const errorPromise = promise.catch((caught: unknown) => caught);
    await vi.advanceTimersByTimeAsync(10);

    const error = await errorPromise;
    expect(error).toMatchObject({ message: 'RPC call timeout' });
    expect(readSessionRpcRequestDisposition(error)).toBe('outcomeUnknown');
    expect(nextSocket?.disconnectCalls).toBe(1);
    expect(nextSocket?.closeCalls).toBe(1);
  });

  it('lets caller-lifecycle RPCs wait without a competing local ack timeout', async () => {
    vi.useFakeTimers();
    const abort = new AbortController();
    configureNextSocket = (socket) => {
      socket.ackMode = 'never';
    };
    const promise = callSessionRpc({
      token: 't',
      sessionId: 'sess_1',
      mode: 'plain',
      method: 'sess_1:execution.run.wait',
      request: { runId: 'run_1' },
      timeoutMs: null,
      signal: abort.signal,
      ctx: null,
    });
    const errorPromise = promise.catch((caught: unknown) => caught);

    await vi.advanceTimersByTimeAsync(60_000);
    expect(nextSocket?.disconnectCalls).toBe(0);
    expect(nextSocket?.emitted[0]?.data).not.toHaveProperty('timeoutMs');

    abort.abort();
    const error = await errorPromise;
    expect(error).toMatchObject({ name: 'AbortError' });
    expect(readSessionRpcRequestDisposition(error)).toBe('outcomeUnknown');
    expect(nextSocket?.disconnectCalls).toBe(1);
    expect(nextSocket?.closeCalls).toBe(1);
  });

  it('settles an emitted RPC as outcome-unknown when its socket disconnects before acknowledgement', async () => {
    let resolveEmitted = () => {};
    const emitted = new Promise<void>((resolve) => {
      resolveEmitted = resolve;
    });
    configureNextSocket = (socket) => {
      socket.ackMode = 'never';
      socket.onEmit = resolveEmitted;
    };
    const promise = callSessionRpc({
      token: 't',
      sessionId: 'sess_1',
      mode: 'plain',
      method: 'sess_1:execution.run.wait',
      request: { runId: 'run_1' },
      timeoutMs: null,
      ctx: null,
    });

    await emitted;
    nextSocket?.trigger('disconnect', 'transport close');
    const error = await promise.catch((caught: unknown) => caught);
    expect(error).toMatchObject({ message: 'RPC socket disconnected before acknowledgement' });
    expect(readSessionRpcRequestDisposition(error)).toBe('outcomeUnknown');
    expect(nextSocket?.disconnectCalls).toBe(1);
    expect(nextSocket?.closeCalls).toBe(1);
  });

  it('settles a connect-then-disconnect race before emission even with no acknowledgement timeout', async () => {
    const observationFallback = new AbortController();
    configureNextSocket = (socket) => {
      socket.ackMode = 'never';
      socket.disconnectAfterConnect = true;
    };

    const promise = callSessionRpc({
      token: 't',
      sessionId: 'sess_1',
      mode: 'plain',
      method: 'sess_1:execution.run.wait',
      request: { runId: 'run_1' },
      timeoutMs: null,
      signal: observationFallback.signal,
      ctx: null,
    });
    expect(nextSocket?.emitted).toHaveLength(0);
    observationFallback.abort(new Error('test observation fallback'));

    const error = await promise.catch((caught: unknown) => caught);
    expect(error).toMatchObject({ message: 'RPC socket disconnected before acknowledgement' });
    expect(readSessionRpcRequestDisposition(error)).toBe('notSent');
    expect(nextSocket?.emitted).toHaveLength(0);
    expect(nextSocket?.disconnectCalls).toBe(1);
    expect(nextSocket?.closeCalls).toBe(1);
  });
});
