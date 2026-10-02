import { describe, expect, it } from 'vitest';
import { socketRpcCodec } from '@happier-dev/sync-client';
import { RPC_ERROR_CODES } from '@happier-dev/protocol/rpc';

import { decryptLegacyBase64, encryptLegacyBase64 } from './messageCrypto';
import { callLegacyEncryptedSessionRpc } from './sessionRpc';

function responder(secret: Uint8Array, result: unknown, methods?: string[]) {
  const content = { mode: 'e2ee' as const, cipher: {
    encryptRaw: async (value: unknown) => encryptLegacyBase64(value, secret),
    decryptRaw: async (value: string) => decryptLegacyBase64(value, secret),
  } };
  const rpcCall = async (method: string, params: unknown) => {
    methods?.push(method);
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

describe('callLegacyEncryptedSessionRpc', () => {
  it('reports an unbound response as update required without retrying', async () => {
    const secret = new Uint8Array(32).fill(3);
    let calls = 0;
    const ui = {
      emit: () => undefined,
      emitWithAck: async <T = unknown>(): Promise<T> => {
        calls += 1;
        return { ok: true, result: encryptLegacyBase64({ ok: true }, secret) } as T;
      },
    };
    await expect(callLegacyEncryptedSessionRpc({
      ui,
      sessionId: 'sess_1',
      method: 'permission',
      req: { id: 'perm_1', approved: true },
      secret,
      schema: { safeParse: () => ({ success: true, data: { ok: true } }) },
      timeoutMs: 250,
    })).rejects.toThrow(RPC_ERROR_CODES.UPDATE_REQUIRED);
    expect(calls).toBe(1);
  });

  it('does not double-prefix fully scoped session methods', async () => {
    const secret = new Uint8Array(32).fill(8);
    const methods: string[] = [];
    const ui = responder(secret, { ok: true }, methods);

    await expect(
      callLegacyEncryptedSessionRpc({
        ui,
        sessionId: 'sess_1',
        method: 'sess_1:permission',
        req: { id: 'perm_1', approved: true },
        secret,
        schema: { safeParse: (input) => ({ success: true, data: input as { ok: boolean } }) },
        timeoutMs: 250,
      }),
    ).resolves.toEqual({ ok: true });

    expect(methods).toEqual(['sess_1:permission']);
  });

  it('preserves decrypted application error envelopes instead of reporting them as timeouts', async () => {
    const secret = new Uint8Array(32).fill(7);
    const ui = responder(secret, { ok: false, error: 'Invalid params', errorCode: 'execution_run_invalid_action_input' });

    await expect(
      callLegacyEncryptedSessionRpc({
        ui,
        sessionId: 'sess_1',
        method: 'execution.run.stream.start',
        req: { runId: 'run_1', message: 'hello' },
        secret,
        schema: { safeParse: () => ({ success: false }) },
        timeoutMs: 250,
      }),
    ).rejects.toMatchObject({
      message: 'RPC returned application error (execution_run_invalid_action_input): Invalid params',
    });
  });

  it('uses canonical errorMessage text from decrypted application error envelopes', async () => {
    const secret = new Uint8Array(32).fill(9);
    const ui = responder(secret, {
      ok: false,
      errorCode: 'invalid_parameters',
      errorMessage: 'Rollback target is not available in the active conversation',
    });

    await expect(
      callLegacyEncryptedSessionRpc({
        ui,
        sessionId: 'sess_2',
        method: 'execution.run.rollback',
        req: { turnId: 'turn_1' },
        secret,
        schema: { safeParse: () => ({ success: false }) },
        timeoutMs: 250,
      }),
    ).rejects.toMatchObject({
      message:
        'RPC returned application error (invalid_parameters): Rollback target is not available in the active conversation',
    });
  });
});
