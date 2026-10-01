import { createServer } from 'node:http';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { Server } from 'socket.io';
import { io } from 'socket.io-client';
import { afterEach, expect, it } from 'vitest';
import { callSocketRpc, emitWithAckCancellable, type SocketRpcAckScope } from './callSocketRpc.js';
import { readRpcRequestDisposition } from './rpcDisposition.js';
import { socketRpcCodec, type SocketRpcContent } from './socketRpcCodec.js';
import { RPC_METHODS } from '@happier-dev/protocol/rpc';

function cipher(): SocketRpcContent {
  const key = randomBytes(32);
  return { mode: 'e2ee', cipher: {
    encryptRaw: async (value) => {
      const iv = randomBytes(12);
      const encryptor = createCipheriv('aes-256-gcm', key, iv);
      const sealed = Buffer.concat([encryptor.update(JSON.stringify(value)), encryptor.final()]);
      return Buffer.concat([iv, encryptor.getAuthTag(), sealed]).toString('base64');
    },
    decryptRaw: async (value) => {
      const bytes = Buffer.from(value, 'base64');
      const decryptor = createDecipheriv('aes-256-gcm', key, bytes.subarray(0, 12));
      decryptor.setAuthTag(bytes.subarray(12, 28));
      return JSON.parse(Buffer.concat([decryptor.update(bytes.subarray(28)), decryptor.final()]).toString());
    },
  } };
}

let server: Server;
let destroy: (() => Promise<void>) | undefined;
async function setup() {
  const http = createServer();
  server = new Server(http, { path: '/v1/updates/' });
  await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve));
  const address = http.address();
  if (!address || typeof address === 'string') throw new Error('No address');
  const socket = io(`http://127.0.0.1:${address.port}`, { path: '/v1/updates/', auth: { token: 't', clientType: 'session-scoped', sessionId: 's' }, forceNew: true, reconnection: false, autoConnect: false });
  destroy = async () => { socket.disconnect(); };
  await new Promise<void>((resolve, reject) => { socket.once('connect', resolve); socket.once('connect_error', reject); socket.connect(); });
  return socket;
}
afterEach(async () => {
  await destroy?.();
  if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
});
it('issues prefixed RPC with session-write authority and decodes the ack', async () => {
  const socket = await setup();
  server.sockets.sockets.forEach((remote) => remote.on('rpc-call', (payload, ack) => {
    expect(payload).toMatchObject({ method: 's:abort', params: { reason: 'test' }, authorization: { kind: 'session.write', sessionId: 's' } });
    ack({ ok: true, result: { stopped: true } });
  }));
  expect(await callSocketRpc({ socket, target: { kind: 'session', id: 's' }, method: 'abort', params: { reason: 'test' }, content: { mode: 'plain' } })).toEqual({ stopped: true });
});
it('cancels an issued call and marks the unresolved outcome', async () => {
  const socket = await setup();
  const controller = new AbortController();
  const cancelled = new Promise<{ requestId: string }>((resolve) => server.sockets.sockets.forEach((remote) => {
    remote.once('rpc-call', (payload) => {
      remote.once('rpc-cancel', (cancel) => { expect(cancel.requestId).toBe(payload.requestId); resolve(cancel); });
      controller.abort();
    });
  }));
  const outcome = callSocketRpc({ socket, target: { kind: 'session', id: 's' }, method: 'abort', params: {}, content: { mode: 'plain' }, signal: controller.signal });
  const error = await outcome.catch((error: unknown) => error);
  expect(error).toMatchObject({ name: 'AbortError', code: 'SOCKET_RPC_ABORTED' });
  expect(readRpcRequestDisposition(error)).toBe('outcomeUnknown');
  expect((await cancelled).requestId).toMatch(/^rpc_/);
});
it('rejects before issue as notSent and exposes ack timeout after issue', async () => {
  const socket = await setup();
  const controller = new AbortController();
  controller.abort();
  const before = await callSocketRpc({ socket, target: { kind: 'machine', id: 'm' }, method: 'test', params: {}, content: { mode: 'plain' }, signal: controller.signal }).catch((error: unknown) => error);
  expect(readRpcRequestDisposition(before)).toBe('notSent');
  const timeout = await callSocketRpc({ socket, target: { kind: 'machine', id: 'm' }, method: 'test', params: {}, content: { mode: 'plain' }, timeoutMs: 20 }).catch((error: unknown) => error);
  expect(timeout).toMatchObject({ message: 'operation has timed out' });
  expect(readRpcRequestDisposition(timeout)).toBe('outcomeUnknown');
});
it('roundtrips encrypted caller and responder codecs over the relay', async () => {
  const socket = await setup();
  const content = cipher();
  server.sockets.sockets.forEach((remote) => remote.on('rpc-call', async (payload, ack) => {
    expect(typeof payload.params).toBe('string');
    const request = await socketRpcCodec.decodeRequestParams(content, payload.params);
    ack({ ok: true, result: await socketRpcCodec.encodeResponse(content, { request }) });
  }));
  expect(await callSocketRpc({ socket, target: { kind: 'machine', id: 'm' }, method: 'echo', params: { text: 'secret' }, content })).toEqual({ request: { text: 'secret' } });
});
it('keeps attachment routing visible while sealing attachment input and output', async () => {
  const socket = await setup();
  const content = cipher();
  const transferRouting = { method: RPC_METHODS.DAEMON_TRANSFER_UPLOAD_INIT, t: 'session_attachment_upload_v1' as const, sessionId: 's' };
  server.sockets.sockets.forEach((remote) => remote.on('rpc-call', async (payload, ack) => {
    expect(payload.transferRouting).toEqual(transferRouting);
    expect(typeof payload.params).toBe('string');
    expect(JSON.stringify(payload)).not.toContain('private-file.txt');
    const request = await socketRpcCodec.decodeRequestParams(content, payload.params);
    ack({ ok: true, result: await socketRpcCodec.encodeResponse(content, { request }) });
  }));
  expect(await callSocketRpc({ socket, target: { kind: 'session', id: 's' },
    method: transferRouting.method, transferRouting,
    params: { t: transferRouting.t, sessionId: 's', fileName: 'private-file.txt' }, content,
  })).toEqual({ request: { t: transferRouting.t, sessionId: 's', fileName: 'private-file.txt' } });
});
it('prepares the acknowledgement scope before signaling issuance and retains its receiver', async () => {
  const trace: string[] = [];
  // A Socket.IO-compatible network boundary whose methods require their receiver.
  class SocketBoundary {
    connected = true;
    emit(_event: string, _payload: unknown, ack: (value: unknown) => void) { trace.push('emit'); ack({ ok: true }); }
    timeout(): SocketRpcAckScope { trace.push('prepare'); return this; }
    emitWithAck(event: string, payload: unknown): Promise<unknown> {
      return new Promise((resolve) => this.emit(event, payload, resolve));
    }
  }
  expect(await emitWithAckCancellable({ socket: new SocketBoundary(), event: 'rpc-call', payload: {}, timeoutMs: 100,
    onIssued: () => { trace.push('issued'); },
  })).toEqual({ ok: true });
  expect(trace).toEqual(['prepare', 'issued', 'emit']);
});
it('does not signal issuance or send cancellation when acknowledgement preparation fails', async () => {
  const trace: string[] = [];
  const controller = new AbortController();
  const preparationError = new Error('Acknowledgement scope unavailable');
  // Failure belongs to the Socket.IO boundary, before any RPC is emitted.
  const socket = {
    connected: true,
    emit: (event: string) => { trace.push(event); },
    timeout: (): SocketRpcAckScope => { trace.push('prepare'); throw preparationError; },
  };
  const error = await emitWithAckCancellable({ socket, event: 'rpc-call', payload: {}, timeoutMs: 100,
    signal: controller.signal, requestId: 'rpc_preparation', onIssued: () => { trace.push('issued'); },
  }).catch((failure: unknown) => failure);
  controller.abort();
  expect(error).toBe(preparationError);
  expect(readRpcRequestDisposition(error)).toBe('notSent');
  expect(trace).toEqual(['prepare']);
});
it('preserves an authenticated undefined response and outer relay errors', async () => {
  const content: SocketRpcContent = { mode: 'e2ee', cipher: { encryptRaw: async () => 'sealed-undefined', decryptRaw: async () => undefined } };
  expect(await socketRpcCodec.decodeResult(content, { ok: true, result: 'sealed-undefined' })).toBeUndefined();
  await expect(socketRpcCodec.decodeResult(content, { ok: false, error: 'denied', errorCode: 'FORBIDDEN' })).rejects.toMatchObject({ rpcErrorCode: 'FORBIDDEN' });
});
it('preserves authenticated serialized undefined request params', async () => {
  const content: SocketRpcContent = { mode: 'e2ee', cipher: { encryptRaw: async () => 'sealed-undefined', decryptRaw: async () => undefined } };
  expect(await socketRpcCodec.decodeRequestParams(content, 'sealed-undefined')).toBeUndefined();
});
it('marks an issued request unknown when its socket disconnects without a caller deadline', async () => {
  const socket = await setup();
  server.sockets.sockets.forEach((remote) => remote.once('rpc-call', () => remote.disconnect(true)));
  const error = await callSocketRpc({ socket, target: { kind: 'machine', id: 'm' }, method: 'disconnect', params: {}, content: { mode: 'plain' } }).catch((failure: unknown) => failure);
  expect(error).toBeInstanceOf(Error);
  expect(readRpcRequestDisposition(error)).toBe('outcomeUnknown');
});
