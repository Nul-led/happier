import { describe, expect, it } from 'vitest';
import { stringifySerializedJsonValue } from '@happier-dev/protocol';
import { RPC_ERROR_CODES, RPC_METHODS } from '@happier-dev/protocol/rpc';
import { socketRpcCodec, type SocketRpcContent } from '@happier-dev/sync-client';

import { decryptDataKeyBase64, encryptDataKeyBase64 } from '../../src/testkit/rpcCrypto';

import { createDataKeyRpcClient, type RpcSocket } from '../../src/testkit/syntheticAgent/rpcClient';

function createBoundResultSocket(dataKey: Uint8Array, result: unknown): RpcSocket {
  const content: SocketRpcContent = {
    mode: 'e2ee',
    cipher: {
      encryptRaw: async (value) => encryptDataKeyBase64(value, dataKey),
      decryptRaw: async (value) => decryptDataKeyBase64(value, dataKey),
    },
  };
  return {
    emit: () => undefined,
    emitWithAck: async <T = unknown>(_event: string, payload: unknown): Promise<T> => {
      if (payload === null || typeof payload !== 'object'
        || !('method' in payload) || typeof payload.method !== 'string'
        || !('params' in payload)) {
        throw new Error('Expected an RPC request payload');
      }
      const request = await socketRpcCodec.decodeRequestParams(content, payload.params, payload.method);
      // SocketCollector's generic acknowledgement type is selected by the transport caller.
      return { ok: true, result: await socketRpcCodec.encodeResponse(content, result, request.callId) } as T;
    },
  };
}

describe('testkit: synthetic agent rpc client', () => {
  it('fails closed when rpc success payload has non-string encrypted result', async () => {
    const socket: RpcSocket = {
      emit: () => undefined,
      // Deliberately malformed acknowledgement at the external socket boundary.
      emitWithAck: async <T = unknown>(): Promise<T> => ({ ok: true, result: 123 }) as T,
    };

    const client = createDataKeyRpcClient(socket, new Uint8Array(32));
    const res = await client.call('session:permission', { approved: true });

    expect(res).toMatchObject({ ok: false, errorCode: RPC_ERROR_CODES.UPDATE_REQUIRED });
  });

  it('unwraps serialized JSON envelopes from encrypted rpc results', async () => {
    const dataKey = new Uint8Array(32).fill(7);
    const socket = createBoundResultSocket(dataKey, stringifySerializedJsonValue({
      ok: true,
      candidates: [{ remoteSessionId: 'sess-direct-core' }],
      nextCursor: null,
    }));

    const client = createDataKeyRpcClient(socket, dataKey);
    const res = await client.call(`machine:${RPC_METHODS.DAEMON_EXTERNAL_SESSIONS_CANDIDATES_LIST}`, { providerId: 'claude' });

    expect(res).toEqual({
      ok: true,
      result: {
        ok: true,
        candidates: [{ remoteSessionId: 'sess-direct-core' }],
        nextCursor: null,
      },
    });
  });

  it('unwraps cli-style serialized JSON objects from encrypted rpc results', async () => {
    const dataKey = new Uint8Array(32).fill(9);
    const socket = createBoundResultSocket(dataKey, {
      __happierSerializedJsonValueV1: true,
      type: 'json',
      value: {
        ok: true,
        candidates: [{ remoteSessionId: 'sess-direct-core' }],
        nextCursor: null,
      },
    });

    const client = createDataKeyRpcClient(socket, dataKey);
    const res = await client.call(`machine:${RPC_METHODS.DAEMON_EXTERNAL_SESSIONS_CANDIDATES_LIST}`, { providerId: 'claude' });

    expect(res).toEqual({
      ok: true,
      result: {
        ok: true,
        candidates: [{ remoteSessionId: 'sess-direct-core' }],
        nextCursor: null,
      },
    });
  });
});
