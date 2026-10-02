import { describe, expect, it } from 'vitest';
import { socketRpcCodec } from '@happier-dev/sync-client';

import { callEncryptedMachineRpc, type MemoryRpcSchema } from './memoryRpc';
import { decryptLegacyBase64, encryptLegacyBase64 } from './messageCrypto';

function responder(secret: Uint8Array, result: unknown, onCall?: () => void) {
  const content = { mode: 'e2ee' as const, cipher: {
    encryptRaw: async (value: unknown) => encryptLegacyBase64(value, secret),
    decryptRaw: async (value: string) => decryptLegacyBase64(value, secret),
  } };
  const rpcCall = async (method: string, params: unknown) => {
    onCall?.();
    const request = await socketRpcCodec.decodeRequestParams(content, params, method);
    return { ok: true, result: await socketRpcCodec.encodeResponse(content, result, request.callId) };
  };
  return {
    rpcCall,
    emit: () => undefined,
    emitWithAck: async <T = unknown>(_event: string, payload: unknown): Promise<T> => {
      const request = payload as { method: string; params: unknown };
      return await rpcCall(request.method, request.params) as T;
    },
  };
}

const passthroughSchema: MemoryRpcSchema<unknown> = {
  safeParse: (input: unknown) => ({ success: true, data: input }),
};

describe('callEncryptedMachineRpc', () => {
  it('fails fast when the machine RPC returns an explicit error envelope', async () => {
    let calls = 0;

    await expect(
      callEncryptedMachineRpc({
        ui: {
          emit: () => undefined,
          emitWithAck: async <T = unknown>() => {
            calls += 1;
            return { ok: false, errorCode: 'memory_index_unavailable', error: 'index is disabled' } as T;
          },
        },
        machineId: 'machine-1',
        method: 'memory.search',
        req: {},
        secret: new Uint8Array(32),
        schema: passthroughSchema,
        timeoutMs: 5_000,
      }),
    ).rejects.toThrow(/memory_index_unavailable.*index is disabled|index is disabled.*memory_index_unavailable/);

    expect(calls).toBe(1);
  });

  it('fails fast when the encrypted machine handler result contains an explicit error', async () => {
    const secret = new Uint8Array(32);
    let calls = 0;

    await expect(
      callEncryptedMachineRpc({
        ui: responder(secret, { errorCode: 'projection_unavailable', error: 'projection failed' }, () => { calls += 1; }),
        machineId: 'machine-1',
        method: 'daemon.extensions.contributionRegistryProjection.describe',
        req: {},
        secret,
        schema: {
          safeParse: () => ({ success: false }),
        },
        timeoutMs: 5_000,
      }),
    ).rejects.toThrow(/projection_unavailable.*projection failed|projection failed.*projection_unavailable/);

    expect(calls).toBe(1);
  });

  it('reports the last schema error when the decrypted response never satisfies the response schema', async () => {
    const secret = new Uint8Array(32);

    await expect(
      callEncryptedMachineRpc({
        ui: responder(secret, { unexpected: 'shape' }),
        machineId: 'machine-1',
        method: 'memory.search',
        req: {},
        secret,
        schema: {
          safeParse: () => ({ success: false, error: new Error('invalid test shape') }),
        },
        timeoutMs: 25,
      }),
    ).rejects.toThrow(
      'last schema error: invalid test shape; invalid response shape: object keys=[unexpected] protocolVersion=absent projection=absent',
    );
  });
});
