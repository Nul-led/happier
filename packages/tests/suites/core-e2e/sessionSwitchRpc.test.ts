import { describe, expect, it } from 'vitest';

import { decryptLegacyBase64, encryptLegacyBase64 } from '../../src/testkit/messageCrypto';
import { socketRpcCodec } from '@happier-dev/sync-client';
import { requestSessionSwitchRpc } from '../../src/testkit/sessionSwitchRpc';

describe('requestSessionSwitchRpc', () => {
  it.each([true, false])('preserves the serialized-json boolean result %s through bound encrypted RPC', async (value) => {
    const secret = new Uint8Array(32).fill(7);
    const content = { mode: 'e2ee' as const, cipher: {
      encryptRaw: async (data: unknown) => encryptLegacyBase64(data, secret),
      decryptRaw: async (data: string) => decryptLegacyBase64(data, secret),
    } };
    const ui = {
      emit: () => {},
      emitWithAck: async <T>(_event: string, data: unknown): Promise<T> => {
        // The fake network accepts the canonical caller's request payload.
        const payload = data as { method: string; params: unknown };
        const request = await socketRpcCodec.decodeRequestParams(content, payload.params, payload.method);
        expect(payload.method).toBe('sess-1:switch');
        expect(request.params).toEqual({ to: 'remote' });
        return { ok: true, result: await socketRpcCodec.encodeResponse(content,
          { __happierSerializedJsonValueV1: true, type: 'json', value }, request.callId) } as T;
      },
    };

    const switched = await requestSessionSwitchRpc({
      ui,
      sessionId: 'sess-1',
      to: 'remote',
      secret,
      timeoutMs: 50,
    });

    expect(switched).toBe(value);
  });
});
