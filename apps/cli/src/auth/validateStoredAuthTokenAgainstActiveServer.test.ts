import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const resolveLoopbackHttpUrlMock = vi.hoisted(() => vi.fn((url: string) => url));
const descriptorRuntimeMock = vi.hoisted(() => ({
  acquire: vi.fn(),
  resolveTarget: vi.fn(),
  verify: vi.fn(),
}));

vi.mock('@/api/client/loopbackUrl', () => ({
  resolveLoopbackHttpUrl: resolveLoopbackHttpUrlMock,
}));
vi.mock('@/auth/terminalAuthEnrollmentRuntime', () => ({
  acquireTerminalAuthEnrollmentRuntime: descriptorRuntimeMock.acquire,
}));
vi.mock('@/auth/terminalAuthEnrollmentClient', () => ({
  verifyTerminalAuthEnrollmentRuntime: descriptorRuntimeMock.verify,
}));
vi.mock('@/server/homeTarget', () => ({
  resolveCurrentCliHomeTarget: descriptorRuntimeMock.resolveTarget,
}));

describe('validateStoredAuthTokenAgainstActiveServer', () => {
  const originalFetch = global.fetch;
  const originalAbortSignalTimeout = AbortSignal.timeout;
  const timeoutMock = vi.fn(() => new AbortController().signal);

  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv('HAPPIER_SERVER_URL', 'https://active.example.test');
    resolveLoopbackHttpUrlMock.mockClear();
    resolveLoopbackHttpUrlMock.mockImplementation((url: string) => url);
    descriptorRuntimeMock.acquire.mockReset();
    descriptorRuntimeMock.resolveTarget.mockResolvedValue({
      descriptor: null,
      applicationUrl: 'https://active.example.test',
    });
    descriptorRuntimeMock.verify.mockReset();
    AbortSignal.timeout = timeoutMock;
  });

  afterEach(() => {
    if (originalFetch === undefined) {
      Reflect.deleteProperty(globalThis, 'fetch');
    } else {
      global.fetch = originalFetch;
    }
    AbortSignal.timeout = originalAbortSignalTimeout;
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('returns invalid for 403 profile responses', async () => {
    global.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ code: 'forbidden' }), {
        status: 403,
        headers: { 'content-type': 'application/json' },
      }),
    ) as typeof fetch;

    const { validateStoredAuthTokenAgainstActiveServer } = await import('./validateStoredAuthTokenAgainstActiveServer');
    await expect(validateStoredAuthTokenAgainstActiveServer('token-123')).resolves.toEqual({
      state: 'invalid',
      httpStatus: 403,
      reasonCode: 'forbidden',
    });
  });

  it('returns unknown for transport failures instead of forcing invalid auth', async () => {
    global.fetch = vi.fn(async () => {
      throw new TypeError('fetch failed');
    }) as typeof fetch;

    const { validateStoredAuthTokenAgainstActiveServer } = await import('./validateStoredAuthTokenAgainstActiveServer');
    await expect(validateStoredAuthTokenAgainstActiveServer('token-123')).resolves.toEqual({
      state: 'unknown',
      httpStatus: null,
      reasonCode: 'TypeError',
    });
  });

  it('fails fast for missing tokens without calling fetch', async () => {
    const fetchMock = vi.fn();
    global.fetch = fetchMock as typeof fetch;

    const { validateStoredAuthTokenAgainstActiveServer } = await import('./validateStoredAuthTokenAgainstActiveServer');
    await expect(validateStoredAuthTokenAgainstActiveServer('   ')).resolves.toEqual({
      state: 'invalid',
      httpStatus: 401,
      reasonCode: 'missing-token',
    });

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('validates an explicit profile without consulting the active-server URL', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ id: 'account-explicit' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    ) as typeof fetch;

    const { validateStoredAuthTokenAgainstServer } = await import('./validateStoredAuthTokenAgainstActiveServer');
    await expect(validateStoredAuthTokenAgainstServer({
      token: 'token-explicit',
      baseUrl: 'https://other.example.test/',
      fetchImpl: fetchMock,
    })).resolves.toMatchObject({ state: 'valid', httpStatus: 200 });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://other.example.test/v1/account/profile',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer token-explicit' }),
      }),
    );
  });

  it('validates an active descriptor Home through its authenticated carrier and closes it once', async () => {
    const descriptor = {
      v: 1 as const,
      homeServerIdentityId: 'srv_stored_iroh_home',
      canonicalServerUrl: 'http://localhost:3010',
      revision: 2,
      endpoints: [{ kind: 'iroh' as const, endpointId: 'e'.repeat(64) }],
    };
    const close = vi.fn(async () => {});
    descriptorRuntimeMock.resolveTarget.mockResolvedValue({
      descriptor,
      applicationUrl: descriptor.canonicalServerUrl,
      preferredTransport: 'iroh',
    });
    descriptorRuntimeMock.acquire.mockResolvedValue({
      ok: true,
      runtime: {
        runtimeOrigin: 'http://127.0.0.1:49123',
        carrier: 'iroh',
        authenticatedCredentialDestination: { kind: 'iroh', endpointId: 'e'.repeat(64) },
      },
      close,
    });
    global.fetch = vi.fn(async () => new Response(JSON.stringify({ id: 'account-iroh' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })) as typeof fetch;

    const { validateStoredAuthTokenAgainstActiveServer } = await import('./validateStoredAuthTokenAgainstActiveServer');
    await expect(validateStoredAuthTokenAgainstActiveServer('token-iroh')).resolves.toMatchObject({
      state: 'valid',
      httpStatus: 200,
    });

    expect(global.fetch).toHaveBeenCalledWith(
      'http://127.0.0.1:49123/v1/account/profile',
      expect.anything(),
    );
    expect(descriptorRuntimeMock.verify).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
  });
});
