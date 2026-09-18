import { afterEach, describe, expect, it, vi } from 'vitest';

const getCredentialsSpy = vi.hoisted(() => vi.fn());
const createEncryptionSpy = vi.hoisted(() => vi.fn());
const listServerProfilesSpy = vi.hoisted(() => vi.fn());
const getActiveServerSnapshotSpy = vi.hoisted(() => vi.fn());

function tokenForSub(sub: string): string {
  const payload = globalThis.btoa(JSON.stringify({ sub }))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '');
  return `e30.${payload}.signature`;
}

vi.mock('@/auth/storage/tokenStorage', () => ({
  TokenStorage: {
    getCredentialsForServerUrl: (...args: unknown[]) => getCredentialsSpy(...args),
  },
  isTokenOnlyAuthCredentials: (credentials: unknown) => {
    if (!credentials || typeof credentials !== 'object') return false;
    const record = credentials as Record<string, unknown>;
    return !('secret' in record) && !('encryption' in record);
  },
}));

vi.mock('@/auth/encryption/createEncryptionFromAuthCredentials', () => ({
  createEncryptionFromAuthCredentials: (...args: unknown[]) => createEncryptionSpy(...args),
}));

vi.mock('@/sync/domains/server/serverProfiles', async () => {
  const { createServerProfilesModuleMock } = await import('@/dev/testkit/mocks/serverProfiles');
  return createServerProfilesModuleMock({
    listServerProfiles: (...args: unknown[]) => listServerProfilesSpy(...args),
  });
});

vi.mock('@/sync/domains/server/serverRuntime', () => ({
  getActiveServerSnapshot: (...args: unknown[]) => getActiveServerSnapshotSpy(...args),
}));

describe('resolveServerAccountRequestContext', () => {
  afterEach(() => {
    getCredentialsSpy.mockReset();
    createEncryptionSpy.mockReset();
    listServerProfilesSpy.mockReset();
    getActiveServerSnapshotSpy.mockReset();
  });

  it('returns active scope when serverId is missing', async () => {
    getActiveServerSnapshotSpy.mockReturnValue({
      serverId: 'server-a',
      serverUrl: 'https://server-a.example.test',
      generation: 1,
    });

    const { resolveServerAccountRequestContext } = await import('./resolveServerAccountRequestContext');
    const context = await resolveServerAccountRequestContext({});

    expect(context).toEqual({
      scope: 'active',
      timeoutMs: 30000,
    });
  });

  it('returns active scope when the target profile id aliases the active durable server identity', async () => {
    getActiveServerSnapshotSpy.mockReturnValue({
      serverId: 'srv_server_a',
      serverUrl: 'https://server-a.example.test',
      generation: 1,
    });
    listServerProfilesSpy.mockReturnValue([
      {
        id: 'localhost-52753',
        serverIdentityId: 'srv_server_a',
        serverUrl: 'https://server-a.example.test',
        name: 'Server A',
      },
    ]);
    getCredentialsSpy.mockResolvedValue({ token: tokenForSub('account-a'), secret: 'secret-a' });

    const { resolveServerAccountRequestContext } = await import('./resolveServerAccountRequestContext');
    const context = await resolveServerAccountRequestContext({ serverId: 'localhost-52753' });

    expect(context).toEqual({
      scope: 'active',
      timeoutMs: 30000,
    });
    expect(getCredentialsSpy).not.toHaveBeenCalled();
  });

  it('returns scoped context with credentials and encryption when target differs from active server', async () => {
    getActiveServerSnapshotSpy.mockReturnValue({
      serverId: 'server-a',
      serverUrl: 'https://server-a.example.test',
      generation: 1,
    });
    listServerProfilesSpy.mockReturnValue([
      { id: 'server-b', serverUrl: 'https://server-b.example.test', name: 'Server B' },
    ]);
    const token = tokenForSub('account-sub-b');
    getCredentialsSpy.mockResolvedValue({ token, secret: 'secret-b' });

    const fakeEncryption = {
      decryptEncryptionKey: vi.fn(async () => null),
      initializeSessions: vi.fn(async () => {}),
      getSessionEncryption: vi.fn(),
    };
    createEncryptionSpy.mockResolvedValue(fakeEncryption);

    const { resolveServerAccountRequestContext } = await import('./resolveServerAccountRequestContext');
    const context = await resolveServerAccountRequestContext({ serverId: 'server-b', timeoutMs: 5000 });

    expect(context).toEqual({
      scope: 'scoped',
      timeoutMs: 5000,
      targetServerId: 'server-b',
      targetServerUrl: 'https://server-b.example.test',
      targetAccountId: 'account-sub-b',
      token,
      credentials: { token, secret: 'secret-b' },
      encryption: fakeEncryption,
      runtimeOrigin: 'https://server-b.example.test',
      carrier: 'https',
      release: expect.any(Function),
    });
  });

  it('returns a keyless scoped context for token-only plaintext accounts', async () => {
    getActiveServerSnapshotSpy.mockReturnValue({
      serverId: 'server-a',
      serverUrl: 'https://server-a.example.test',
      generation: 1,
    });
    listServerProfilesSpy.mockReturnValue([
      { id: 'server-b', serverUrl: 'https://server-b.example.test', name: 'Server B' },
    ]);
    const token = tokenForSub('account-sub-b');
    getCredentialsSpy.mockResolvedValue({ token });

    const { resolveServerAccountRequestContext } = await import('./resolveServerAccountRequestContext');
    await expect(resolveServerAccountRequestContext({
      serverId: 'server-b',
      timeoutMs: 5000,
    })).resolves.toEqual({
      scope: 'scoped',
      timeoutMs: 5000,
      targetServerId: 'server-b',
      targetServerUrl: 'https://server-b.example.test',
      targetAccountId: 'account-sub-b',
      token,
      credentials: { token },
      encryption: null,
      runtimeOrigin: 'https://server-b.example.test',
      carrier: 'https',
      release: expect.any(Function),
    });
    expect(createEncryptionSpy).not.toHaveBeenCalled();
  });

  it('builds a scoped context for a same-URL alternate profile when that exact profile has credentials', async () => {
    getActiveServerSnapshotSpy.mockReturnValue({
      serverId: 'server-a',
      serverUrl: 'https://server-a.example.test/',
      generation: 1,
    });
    listServerProfilesSpy.mockReturnValue([
      { id: 'server-b', serverUrl: 'https://server-a.example.test', name: 'Server A (alt id)' },
    ]);
    const token = tokenForSub('account-sub-b');
    getCredentialsSpy.mockResolvedValue({ token, secret: 'secret-b' });

    const fakeEncryption = {
      decryptEncryptionKey: vi.fn(async () => null),
      initializeSessions: vi.fn(async () => {}),
      getSessionEncryption: vi.fn(),
    };
    createEncryptionSpy.mockResolvedValue(fakeEncryption);

    const { resolveServerAccountRequestContext } = await import('./resolveServerAccountRequestContext');
    await expect(resolveServerAccountRequestContext({ serverId: 'server-b', timeoutMs: 5000 })).resolves.toEqual({
      scope: 'scoped',
      timeoutMs: 5000,
      targetServerId: 'server-b',
      targetServerUrl: 'https://server-a.example.test',
      targetAccountId: 'account-sub-b',
      token,
      credentials: { token, secret: 'secret-b' },
      encryption: fakeEncryption,
      runtimeOrigin: 'https://server-a.example.test',
      carrier: 'https',
      release: expect.any(Function),
    });
    expect(getCredentialsSpy).toHaveBeenCalledWith('https://server-a.example.test', { serverId: 'server-b' });
  });

  it('fails closed when same-URL alternate profile credentials are unavailable', async () => {
    getActiveServerSnapshotSpy.mockReturnValue({
      serverId: 'server-a',
      serverUrl: 'https://server-a.example.test/',
      generation: 1,
    });
    listServerProfilesSpy.mockReturnValue([
      { id: 'server-b', serverUrl: 'https://server-a.example.test', name: 'Server A (alt id)' },
    ]);
    getCredentialsSpy.mockResolvedValue(null);

    const { resolveServerAccountRequestContext } = await import('./resolveServerAccountRequestContext');
    await expect(resolveServerAccountRequestContext({ serverId: 'server-b' })).rejects.toThrow(
      'No authentication credentials for target server "server-b"',
    );
  });

  it('can force a scoped context for the active server', async () => {
    getActiveServerSnapshotSpy.mockReturnValue({
      serverId: 'server-a',
      serverUrl: 'https://server-a.example.test/',
      generation: 1,
    });
    const token = tokenForSub('account-sub-a');
    getCredentialsSpy.mockResolvedValue({ token, secret: 'secret-a' });

    const fakeEncryption = {
      decryptEncryptionKey: vi.fn(async () => null),
      initializeSessions: vi.fn(async () => {}),
      getSessionEncryption: vi.fn(),
    };
    createEncryptionSpy.mockResolvedValue(fakeEncryption);

    const { resolveServerAccountRequestContext } = await import('./resolveServerAccountRequestContext');
    const context = await resolveServerAccountRequestContext({ preferScoped: true, timeoutMs: 7000 });

    expect(context).toEqual({
      scope: 'scoped',
      timeoutMs: 7000,
      targetServerId: 'server-a',
      targetServerUrl: 'https://server-a.example.test',
      targetAccountId: 'account-sub-a',
      token,
      credentials: { token, secret: 'secret-a' },
      encryption: fakeEncryption,
      runtimeOrigin: 'https://server-a.example.test',
      carrier: 'https',
      release: expect.any(Function),
    });
  });
});
