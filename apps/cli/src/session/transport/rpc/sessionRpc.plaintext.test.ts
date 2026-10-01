import { afterEach, describe, expect, it, vi } from 'vitest';
import { RPC_ERROR_CODES } from '@happier-dev/protocol/rpc';
import { readRpcErrorCode } from '@happier-dev/protocol/rpcErrors';
import tweetnacl from 'tweetnacl';
import { encrypt, encodeBase64 } from '@/api/encryption';
import { API_TOKEN_FULL_GRANT_V1, verifyExternalActionMachineRpcRequestV1, type ActionExecutorContext } from '@happier-dev/protocol';
import { createSocketIoManagerStub } from '@/testkit/backends/apiSessionSocketHarness';

let nextRpcAck: any = null;
let nextSocket: FakeSocket | null = null;
let configureNextSocket: ((socket: FakeSocket) => void) | null = null;

class FakeSocket {
  public io = createSocketIoManagerStub();
  public connected = false;
  private handlers = new Map<string, Array<(...args: any[]) => void>>();
  public emitted: Array<{ event: string; data: any }> = [];
  public onEmit: (() => void) | null = null;
  public connectError: Error | null = null;
  public disconnectAfterConnect = false;
  public emitError: Error | null = null;
  public ackMode: 'sync' | 'never' = 'sync';
  public disconnectCalls = 0;
  public closeCalls = 0;
  private pendingAcks = new Set<(error: Error) => void>();

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
    if (event === 'disconnect') {
      this.connected = false;
      for (const reject of this.pendingAcks) reject(new Error('RPC socket disconnected before acknowledgement'));
      this.pendingAcks.clear();
    }
    for (const handler of this.handlers.get(event) ?? []) handler(...args);
  }

  connect() {
    if (this.connectError) {
      for (const handler of this.handlers.get('connect_error') ?? []) {
        handler(this.connectError);
      }
      return this;
    }
    this.connected = true;
    for (const handler of this.handlers.get('connect') ?? []) {
      handler();
    }
    if (this.disconnectAfterConnect) {
      this.connected = false;
      this.trigger('disconnect', 'transport close');
    }
    return this;
  }

  emit(event: string, data: any, callback?: (payload: any) => void) {
    if (this.emitError) {
      throw this.emitError;
    }
    this.emitted.push({ event, data });
    this.onEmit?.();
    if (this.ackMode === 'never') {
      return this;
    }
    callback?.(nextRpcAck ?? { ok: true, result: { echoed: data.params } });
    return this;
  }

  // Socket.IO's promise acknowledgement rejects its pending callback on disconnect.
  emitWithAck(event: string, data: unknown): Promise<unknown> {
    return new Promise((resolve, reject) => {
      this.pendingAcks.add(reject);
      try {
        this.emit(event, data, (value) => {
          this.pendingAcks.delete(reject);
          resolve(value);
        });
      } catch (error) {
        this.pendingAcks.delete(reject);
        reject(error);
      }
    });
  }

  disconnect() {
    this.connected = false;
    this.disconnectCalls += 1;
  }

  close() {
    this.closeCalls += 1;
  }

  removeAllListeners() {
    this.handlers.clear();
  }
}

vi.mock('socket.io-client', () => ({
  io: vi.fn(() => {
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

  it.each([
    ['plain', 'session.model.set', 'session.model.transition'],
    ['e2ee', 'session.model.set', 'session.model.transition'],
    ['plain', 'session.permission.respond', 'session.permission.respond'],
    ['e2ee', 'session.user_action.answer', 'session.user_action.answer'],
  ] as const)('binds an external %s %s RPC to its exact payload and refuses missing proof', async (mode, effectActionId, method) => {
    const key = tweetnacl.sign.keyPair.fromSeed(new Uint8Array(32).fill(7));
    const target = { kind: 'session' as const, sessionId: 'sess_1' };
    const authorization = { v: 1 as const, token: 'home-proof', binding: {
      serverIdentityId: 'home', accountId: 'account', principalId: 'account',
      credentialId: '11111111-1111-4111-8111-111111111111', machineId: 'machine',
      actionId: effectActionId, requestId: 'outer-request', requestEnvelopeDigest: 'A'.repeat(43),
      target, grant: API_TOKEN_FULL_GRANT_V1,
    } };
    const context: ActionExecutorContext = { authority: 'account_automation', surface: 'api',
      externalActionTarget: target, externalActionExecutionAuthorization: authorization };
    const content = mode === 'plain' ? { mode, ctx: null } : { mode, ctx: {
      encryptionKey: new Uint8Array(32).fill(4), encryptionVariant: 'legacy' as const,
    } };
    nextRpcAck = { ok: true, result: mode === 'plain' ? null : encodeBase64(encrypt(new Uint8Array(32).fill(4), 'legacy', null), 'base64') };
    const input = { token: 'daemon-token', sessionId: target.sessionId, method: `sess_1:${method}`,
      request: { v: 1, selection: { agentTargetKey: 'agent:happier.agent.codex/codex', providerConnectionId: null, modelId: 'A' } },
      ...content, externalAction: { context, effectActionId, installationId: 'installation', privateKey: key.secretKey },
    };
    await callSessionRpc(input);
    const payload = nextSocket?.emitted.find((item) => item.event === 'rpc-call')?.data;
    expect(payload.externalActionExecution).toMatchObject({ authorization, target, effectActionId });
    const signed = { authorizationToken: authorization.token, effectActionId, target,
      installationId: 'installation', event: 'rpc-call', method: payload.method, requestId: payload.requestId,
      params: payload.params, publicKey: key.publicKey, signature: payload.externalActionExecution.machineSignature };
    expect(verifyExternalActionMachineRpcRequestV1(signed)).toBe(true);
    expect(verifyExternalActionMachineRpcRequestV1({ ...signed, params: 'tampered' })).toBe(false);
    await expect(callSessionRpc({ ...input, externalAction: { ...input.externalAction,
      context: { authority: 'account_automation', surface: 'api' },
    } })).rejects.toThrow();
    expect(nextSocket?.emitted).toHaveLength(0);
  });

  it('uses a user-scoped caller socket for one-shot runtime RPC calls', async () => {
    const { io } = await import('socket.io-client');
    await callSessionRpc({
      token: 't',
      sessionId: 'sess_1',
      mode: 'plain',
      method: 'sess_1:demo.method',
      request: { a: 1 },
      ctx: null,
    });

    expect(io).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({
      auth: expect.objectContaining({ token: 't', clientType: 'user-scoped' }),
    }));
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

  it('carries the protocol Session write context to the relay', async () => {
    await callSessionRpc({
      token: 't', sessionId: 'sess_1', mode: 'plain', ctx: null,
      method: 'sess_1:session.user_action.answer', request: { id: 'question', approved: true },
    });
    expect(nextSocket?.emitted[0]?.data).toMatchObject({
      method: 'sess_1:session.user_action.answer',
      authorization: { kind: 'session.write', sessionId: 'sess_1' },
    });
  });

  it('cancels the exact issued request when the caller aborts', async () => {
    const abort = new AbortController();
    let issued = () => {};
    const emitted = new Promise<void>((resolve) => { issued = resolve; });
    configureNextSocket = (socket) => { socket.ackMode = 'never'; socket.onEmit = issued; };
    const pending = callSessionRpc({
      token: 't', sessionId: 'sess_1', mode: 'plain', ctx: null,
      method: 'sess_1:execution.run.wait', request: { runId: 'run_1' },
      timeoutMs: null, signal: abort.signal,
    });
    const rejected = pending.catch((error: unknown) => error);
    await emitted;
    const requestId = nextSocket?.emitted[0]?.data.requestId;
    abort.abort();
    expect(await rejected).toMatchObject({ name: 'AbortError' });
    expect(nextSocket?.emitted).toContainEqual({ event: 'rpc-cancel', data: { requestId } });
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
