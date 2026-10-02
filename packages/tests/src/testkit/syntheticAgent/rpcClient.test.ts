import { describe, expect, it } from 'vitest';
import { RPC_ERROR_CODES, RPC_METHODS } from '@happier-dev/protocol/rpc';
import { socketRpcCodec } from '@happier-dev/sync-client';

import { createDataKeyRpcClient, createLegacyRpcClient, createMachineRpcClient } from './rpcClient';
import { decryptDataKeyBase64, encryptDataKeyBase64 } from '../rpcCrypto';
import { decryptLegacyBase64, encryptLegacyBase64 } from '../messageCrypto';

describe('createMachineRpcClient', () => {
  it('sends token-only plaintext machine RPC as raw JSON and accepts an object result', async () => {
    const rpcCalls: Array<{ method: string; params: unknown; timeoutMs?: number }> = [];
    const rpcCall = async <T = unknown>(method: string, params: unknown, timeoutMs?: number): Promise<T> => {
      rpcCalls.push({ method, params, timeoutMs });
      return {
        ok: true,
        result: {
          ok: true,
          candidates: [{ remoteSessionId: 'sess-plain' }],
          nextCursor: null,
        },
      } as unknown as T;
    };

    const client = createMachineRpcClient({ rpcCall, emit: () => undefined, emitWithAck: async () => { throw new Error('Unexpected encrypted transport'); } }, { mode: 'plain' });
    await expect(client.call(
      RPC_METHODS.DAEMON_EXTERNAL_SESSIONS_CANDIDATES_LIST,
      { providerId: 'claude' },
      60_000,
    )).resolves.toEqual({
      ok: true,
      result: {
        ok: true,
        candidates: [{ remoteSessionId: 'sess-plain' }],
        nextCursor: null,
      },
    });

    expect(rpcCalls).toEqual([{
      method: RPC_METHODS.DAEMON_EXTERNAL_SESSIONS_CANDIDATES_LIST,
      params: { providerId: 'claude' },
      timeoutMs: 60_000,
    }]);
  });
});

describe('createDataKeyRpcClient', () => {
  it('forwards an explicit rpc timeout to the socket collector', async () => {
    const dataKey = new Uint8Array(32).fill(7);
    const rpcCalls: Array<{ method: string; params: string; timeoutMs?: number }> = [];
    const rpcCall = async <T = unknown>(method: string, params: unknown, timeoutMs?: number): Promise<T> => {
      if (typeof params !== 'string') throw new Error('Expected encrypted RPC params.');
      rpcCalls.push({ method, params, timeoutMs });
      const content = { mode: 'e2ee' as const, cipher: {
        encryptRaw: async (value: unknown) => encryptDataKeyBase64(value, dataKey),
        decryptRaw: async (value: string) => decryptDataKeyBase64(value, dataKey),
      } };
      const request = await socketRpcCodec.decodeRequestParams(content, params, method);
      return {
        ok: true,
        result: await socketRpcCodec.encodeResponse(content, { persisted: true }, request.callId),
      } as unknown as T;
    };

    const client = createDataKeyRpcClient({
      emit: () => undefined,
      emitWithAck: async <T = unknown>(_event: string, data: unknown, timeoutMs?: number): Promise<T> => {
        const payload = data as { method: string; params: unknown };
        return rpcCall<T>(payload.method, payload.params, timeoutMs);
      },
    }, dataKey);
    await expect(client.call(`machine_1:${RPC_METHODS.DAEMON_EXTERNAL_SESSION_TAKEOVER}`, {
      linkedSessionId: 'sess_1',
      storageMode: 'persisted',
    }, 60_000)).resolves.toEqual({
      ok: true,
      result: { persisted: true },
    });

    expect(rpcCalls).toHaveLength(1);
    expect(rpcCalls[0]?.method).toBe(`machine_1:${RPC_METHODS.DAEMON_EXTERNAL_SESSION_TAKEOVER}`);
    expect(rpcCalls[0]?.timeoutMs).toBe(60_000);
    expect(rpcCalls[0]?.params).toEqual(expect.any(String));
    expect(decryptDataKeyBase64(rpcCalls[0]!.params, dataKey)).toMatchObject({
      v: 2, k: 'req', m: `machine_1:${RPC_METHODS.DAEMON_EXTERNAL_SESSION_TAKEOVER}`,
      c: expect.stringMatching(/^[0-9a-f]{32}$/),
      p: { linkedSessionId: 'sess_1', storageMode: 'persisted' },
    });
  });
});

describe('encrypted RPC clients', () => {
  it.each(['{"ok":true}', undefined])('preserves the authenticated legacy result without reinterpreting %s', async (value) => {
    const key = new Uint8Array(32).fill(5);
    const content = { mode: 'e2ee' as const, cipher: {
      encryptRaw: async (data: unknown) => encryptLegacyBase64(data, key),
      decryptRaw: async (data: string) => decryptLegacyBase64(data, key),
    } };
    const socket = {
      emit: () => undefined,
      emitWithAck: async <T = unknown>(_event: string, payload: unknown): Promise<T> => {
        const request = payload as { method: string; params: unknown };
        const decoded = await socketRpcCodec.decodeRequestParams(content, request.params, request.method);
        return { ok: true, result: await socketRpcCodec.encodeResponse(content, value, decoded.callId) } as T;
      },
    };
    await expect(createLegacyRpcClient(socket, key).call('machine_1:value', {})).resolves.toEqual({ ok: true, result: value });
  });

  it.each(['dataKey', 'legacy'] as const)('rejects a substituted %s response with another call id', async (mode) => {
    const key = new Uint8Array(32).fill(5);
    const cipher = {
      encryptRaw: async (value: unknown) => mode === 'dataKey'
        ? encryptDataKeyBase64(value, key) : encryptLegacyBase64(value, key),
      decryptRaw: async (value: string) => mode === 'dataKey'
        ? decryptDataKeyBase64(value, key) : decryptLegacyBase64(value, key),
    };
    const content = { mode: 'e2ee' as const, cipher };
    const socket = {
      emit: () => undefined,
      emitWithAck: async <T = unknown>(_event: string, payload: unknown): Promise<T> => {
        const request = payload as { method: string; params: unknown };
        const decoded = await socketRpcCodec.decodeRequestParams(content, request.params, request.method);
        const wrongId = decoded.callId === 'a'.repeat(32) ? 'b'.repeat(32) : 'a'.repeat(32);
        return { ok: true, result: await socketRpcCodec.encodeResponse(content, { approved: true }, wrongId) } as T;
      },
    };
    const client = mode === 'dataKey' ? createDataKeyRpcClient(socket, key) : createLegacyRpcClient(socket, key);
    await expect(client.call('machine_1:permission', { approved: false })).resolves.toMatchObject({
      ok: false, errorCode: RPC_ERROR_CODES.UPDATE_REQUIRED,
    });
  });
});
