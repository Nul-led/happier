import type { SocketCollector } from '../socketClient';
import { callSocketRpc, type SocketRpcContent } from '@happier-dev/sync-client';
import { readRpcErrorCode } from '@happier-dev/protocol/rpcErrors';
import { decryptLegacyBase64, encryptLegacyBase64 } from '../messageCrypto';
import { decryptDataKeyBase64, encryptDataKeyBase64 } from '../rpcCrypto';
import { unwrapSerializedJsonValue } from '../unwrapSerializedJsonValue';

export type MachineRpcResult =
  | { ok: true; result: unknown | null }
  | { ok: false; error?: string; errorCode?: string };

export type DataKeyRpcResult = MachineRpcResult;

export function unwrapDataKeyRpcResult(result: DataKeyRpcResult, context = 'data key rpc'): unknown | null {
  if (result.ok !== true) {
    const reason = result.errorCode ?? result.error ?? 'unknown-error';
    throw new Error(`${context} failed: ${reason}`);
  }
  return result.result;
}

export type RpcSocket = Pick<SocketCollector, 'emitWithAck' | 'emit'>;

export type MachineRpcTransport =
  | Readonly<{ mode: 'plain' }>
  | Readonly<{ mode: 'dataKey'; dataKey: Uint8Array }>;

type RpcResponseEnvelope = {
  ok?: unknown;
  result?: unknown;
  error?: unknown;
  errorCode?: unknown;
};

export function createMachineRpcClient(
  socket: RpcSocket & Pick<SocketCollector, 'rpcCall'>,
  transport: MachineRpcTransport,
): {
  call: (method: string, payload: unknown, timeoutMs?: number) => Promise<MachineRpcResult>;
} {
  if (transport.mode === 'dataKey') {
    return createDataKeyRpcClient(socket, transport.dataKey);
  }
  return {
    call: async (method, payload, timeoutMs) => {
      const res = await socket.rpcCall<RpcResponseEnvelope>(method, payload, timeoutMs);
      if (!res || typeof res !== 'object') {
        return { ok: false, error: 'invalid-rpc-response' };
      }
      if (res.ok === true) {
        if (!Object.prototype.hasOwnProperty.call(res, 'result')) {
          return { ok: false, error: 'invalid-rpc-result', errorCode: undefined };
        }
        return { ok: true, result: res.result ?? null };
      }
      return {
        ok: false,
        error: typeof res.error === 'string' ? res.error : 'rpc-failed',
        errorCode: typeof res.errorCode === 'string' ? res.errorCode : undefined,
      };
    },
  };
}

export function createDataKeyRpcClient(socket: RpcSocket, dataKey: Uint8Array): {
  call: (method: string, payload: unknown, timeoutMs?: number) => Promise<DataKeyRpcResult>;
} {
  const client = createEncryptedRpcClient(socket, {
    encryptRaw: async (value) => encryptDataKeyBase64(value, dataKey),
    decryptRaw: async (ciphertext) => decryptDataKeyBase64(ciphertext, dataKey),
  });
  return { call: async (method, payload, timeoutMs) => {
    const response = await client.call(method, payload, timeoutMs);
    return response.ok === true
      ? { ok: true, result: unwrapSerializedJsonValue(response.result) }
      : response;
  } };
}

export function createLegacyRpcClient(socket: RpcSocket, secret: Uint8Array, targetKind: 'machine' | 'session' = 'machine') {
  return createEncryptedRpcClient(socket, {
    encryptRaw: async (value) => encryptLegacyBase64(value, secret),
    decryptRaw: async (ciphertext) => decryptLegacyBase64(ciphertext, secret),
  }, targetKind);
}

export function createEncryptedRpcClient(
  socket: RpcSocket,
  cipher: Extract<SocketRpcContent, { mode: 'e2ee' }>['cipher'],
  targetKind: 'machine' | 'session' = 'machine',
): { call: (method: string, payload: unknown, timeoutMs?: number) => Promise<MachineRpcResult> } {
  return {
    call: async (method, payload, timeoutMs = 30_000) => {
      const separator = method.indexOf(':');
      if (separator < 1 || separator === method.length - 1) throw new Error('RPC method must include its target prefix');
      let acknowledged = false;
      try {
        const result = await callSocketRpc({
          socket: {
            emit: (event, ...args) => socket.emit(event, args[0]),
            emitWithAck: async (event, ...args) => {
              const ack = await socket.emitWithAck(event, args[0], timeoutMs);
              acknowledged = true;
              return ack;
            },
          },
          target: { kind: targetKind, id: method.slice(0, separator) },
          method: method.slice(separator + 1),
          params: payload,
          content: { mode: 'e2ee', cipher },
          timeoutMs,
        });
        return { ok: true, result };
      } catch (error) {
        const errorCode = readRpcErrorCode(error);
        if (!acknowledged && !errorCode) throw error;
        return { ok: false, error: error instanceof Error ? error.message : String(error), errorCode };
      }
    },
  };
}
