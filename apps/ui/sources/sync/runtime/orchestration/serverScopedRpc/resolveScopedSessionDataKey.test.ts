import { afterEach, describe, expect, it, vi } from 'vitest';

import { resetScopedSessionDataKeyCacheForTests, resolveScopedSessionDataKey } from './resolveScopedSessionDataKey';

const runtimeFetchMock = vi.hoisted(() => vi.fn());

vi.mock('@/utils/system/runtimeFetch', () => ({
  runtimeFetch: (...args: unknown[]) => runtimeFetchMock(...args),
}));

const validSessionById = {
  id: 'session-1',
  seq: 1,
  createdAt: 1,
  updatedAt: 1,
  active: true,
  activeAt: 1,
  archivedAt: null,
  metadata: 'metadata',
  metadataVersion: 1,
  agentState: null,
  agentStateVersion: 0,
  pendingCount: 0,
  pendingVersion: 0,
  dataEncryptionKey: 'k1',
};

describe('resolveScopedSessionDataKey', () => {
  afterEach(async () => {
    runtimeFetchMock.mockReset();
    resetScopedSessionDataKeyCacheForTests();
    try {
      const { resetServerReachabilitySupervisors } = await import('@/sync/runtime/connectivity/serverReachabilitySupervisorPool');
      await resetServerReachabilitySupervisors();
    } catch {
      // ignore
    }
  });

  it.each(['absent', 'empty', 'malformed', 'wrong_recipient'] as const)(
    'keeps %s envelopes unavailable and opens a later valid envelope through the canonical reader',
    async (initialEnvelope) => {
      const { Encryption } = await import('@/sync/encryption/encryption');
      const { encodeBase64 } = await import('@/encryption/base64');
      const { sealEncryptedDataKeyEnvelopeV1 } = await import('@happier-dev/protocol');
      const encryption = await Encryption.create(new Uint8Array(32).fill(7));
      const otherRecipient = await Encryption.create(new Uint8Array(32).fill(8));
      const sessionKey = new Uint8Array(32).fill(9);
      const sealTo = (recipientPublicKey: Uint8Array) => encodeBase64(sealEncryptedDataKeyEnvelopeV1({
        dataKey: sessionKey,
        recipientPublicKey,
        randomBytes: (length) => new Uint8Array(length).fill(3),
      }), 'base64');
      let dataEncryptionKey: string | null = initialEnvelope === 'absent'
        ? null
        : initialEnvelope === 'empty'
          ? ''
          : initialEnvelope === 'malformed'
            ? 'not-an-envelope'
            : sealTo(otherRecipient.contentDataKey);
      runtimeFetchMock.mockImplementation(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith('/health') || url.endsWith('/v1/auth/ping')) {
          return { ok: true, status: 200, json: async () => ({}) };
        }
        return {
          ok: true, status: 200,
          json: async () => ({ session: { ...validSessionById, encryptionMode: 'e2ee', dataEncryptionKey } }),
        };
      });
      const params = {
        serverId: 's-id', serverUrl: 'https://server.example.test',
        token: 'token', sessionId: 'session-1',
        decryptEncryptionKey: (value: string) => encryption.decryptEncryptionKey(value),
      };

      await expect(resolveScopedSessionDataKey(params)).resolves.toBeNull();
      expect(encryption.getSessionEncryption('session-1')).toBeNull();

      dataEncryptionKey = sealTo(encryption.contentDataKey);
      await expect(resolveScopedSessionDataKey(params)).resolves.toEqual(sessionKey);
      // Standalone key resolution never installs an Account-scoped Session reader.
      expect(encryption.getSessionEncryption('session-1')).toBeNull();
    },
  );

  it('loads and decrypts the session data encryption key from a valid by-id response', async () => {
    runtimeFetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : String(input);
      if (url.endsWith('/health') || url.endsWith('/v1/auth/ping')) {
        return { ok: true, status: 200, json: async () => ({}) };
      }
      return { ok: true, status: 200, json: async () => ({ session: validSessionById }) };
    });
    const expectedKey = new Uint8Array(32).fill(9);
    const decrypt = vi.fn(async () => expectedKey);

    const key = await resolveScopedSessionDataKey({
      serverId: 's-id',
      serverUrl: 'https://server.example.test',
      token: 'token',
      sessionId: 'session-1',
      decryptEncryptionKey: decrypt,
    });

    expect(runtimeFetchMock.mock.calls.some(([input]) => String(input).includes('/v2/sessions/session-1'))).toBe(true);
    expect(decrypt).toHaveBeenCalledWith('k1');
    expect(key).toEqual(expectedKey);
  });

  it('uses the verified runtime origin for an Iroh-only session key lookup', async () => {
    runtimeFetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/health') || url.endsWith('/v1/auth/ping')) {
        return { ok: true, status: 200, json: async () => ({}) };
      }
      if (url === 'http://127.0.0.1:43111/v2/sessions/session-1') {
        return { ok: true, status: 200, json: async () => ({ session: validSessionById }) };
      }
      throw new Error(`unexpected session lookup: ${url}`);
    });
    const expectedKey = new Uint8Array(32).fill(7);
    const decrypt = vi.fn(async () => expectedKey);

    await expect(resolveScopedSessionDataKey({
      serverId: 's-id',
      serverUrl: 'http://127.0.0.1:3010',
      runtimeOrigin: 'http://127.0.0.1:43111',
      token: 'token',
      sessionId: 'session-1',
      decryptEncryptionKey: decrypt,
    })).resolves.toEqual(expectedKey);

    expect(runtimeFetchMock.mock.calls.some(([input]) =>
      String(input) === 'http://127.0.0.1:43111/v2/sessions/session-1',
    )).toBe(true);
    expect(runtimeFetchMock.mock.calls.some(([input]) =>
      String(input) === 'http://127.0.0.1:3010/v2/sessions/session-1',
    )).toBe(false);
  });

  it('returns null and does not call decryption for an invalid by-id shape', async () => {
    runtimeFetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : String(input);
      if (url.endsWith('/health') || url.endsWith('/v1/auth/ping')) {
        return { ok: true, status: 200, json: async () => ({}) };
      }
      return { ok: true, status: 200, json: async () => ({ session: { id: 'session-1', dataEncryptionKey: 'k1' } }) };
    });

    const decrypt = vi.fn(async () => new Uint8Array([9]));

    const key = await resolveScopedSessionDataKey({
      serverId: 's-id',
      serverUrl: 'https://server.example.test',
      token: 'token',
      sessionId: 'session-1',
      decryptEncryptionKey: decrypt,
      timeoutMs: 10,
    });

    expect(key).toBeNull();
    expect(decrypt).not.toHaveBeenCalled();
  });

  it('does not cache transient failures', async () => {
    runtimeFetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : String(input);
      if (url.endsWith('/health') || url.endsWith('/v1/auth/ping')) {
        return { ok: true, status: 200, json: async () => ({}) };
      }
      return { ok: false, status: 500, json: async () => ({}) };
    });
    const decrypt = vi.fn(async () => new Uint8Array([9]));

    const first = await resolveScopedSessionDataKey({
      serverId: 's-id',
      serverUrl: 'https://server.example.test',
      token: 'token',
      sessionId: 'session-1',
      decryptEncryptionKey: decrypt,
      timeoutMs: 10,
    });
    const second = await resolveScopedSessionDataKey({
      serverId: 's-id',
      serverUrl: 'https://server.example.test',
      token: 'token',
      sessionId: 'session-1',
      decryptEncryptionKey: decrypt,
      timeoutMs: 10,
    });

    expect(first).toBeNull();
    expect(second).toBeNull();
    expect(decrypt).not.toHaveBeenCalled();
    expect(runtimeFetchMock.mock.calls.filter(([input]) => String(input).includes('/v2/sessions/session-1')).length).toBe(2);
  });

  it('throws terminal auth instead of returning an unknown key for scoped 401 responses', async () => {
    runtimeFetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : String(input);
      if (url.endsWith('/health') || url.endsWith('/v1/auth/ping')) {
        return { ok: true, status: 200, json: async () => ({}) };
      }
      return { ok: false, status: 401, json: async () => ({}) };
    });
    const decrypt = vi.fn(async () => new Uint8Array([9]));

    await expect(resolveScopedSessionDataKey({
      serverId: 's-id',
      serverUrl: 'https://server.example.test',
      token: 'token',
      sessionId: 'session-1',
      decryptEncryptionKey: decrypt,
      timeoutMs: 10,
    })).rejects.toMatchObject({
      name: 'HappyError',
      kind: 'auth',
      code: 'not_authenticated',
    });

    expect(decrypt).not.toHaveBeenCalled();
  });
});
