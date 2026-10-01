import { describe, expect, it, vi } from 'vitest';

import {
  authenticateCliAccountService,
  parseCliAccountServiceRecoveryKey,
} from './cliAccountServiceAuth';

const openBrowserMock = vi.hoisted(() => vi.fn(async () => false));

vi.mock('@/ui/openBrowser', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/ui/openBrowser')>()),
  openBrowser: openBrowserMock,
}));

vi.mock('@/cloud/loopbackOauthPkce', () => ({
  captureLoopbackOauthRedirect: vi.fn(async (opts: Readonly<{
    resolveAuthorizationUrl(callbackOrigin: string): Promise<string>;
    openAuthorizationUrl(url: string): Promise<void>;
  }>) => {
    // The real owner starts its listener, resolves the authorization URL and
    // hands it to the browser before it waits for the callback.
    await opts.openAuthorizationUrl(await opts.resolveAuthorizationUrl('http://127.0.0.1:34567'));
    return {
      pending: 'pending_headless',
      purpose: 'account_directory',
      credentialTarget: 'account_directory',
      endpointUrl: 'https://accounts.example.test',
      endpointServerIdentityId: 'srv_accounts',
      canonicalServerUrl: 'https://accounts.example.test',
    };
  }),
}));

const selection = {
  endpoint: 'https://accounts.example.test',
  serverIdentityId: 'srv_accounts',
  canonicalServerUrl: 'https://accounts.example.test',
  advertisedMethods: {
    keyLoginAvailable: true,
    oauthProviderIds: ['github'],
    preferredProvisionProviderId: 'github',
  },
} as const;

describe('CLI Account Service recovery-key representation', () => {
  it('accepts canonical display and raw forms without lossy cleanup', () => {
    const bytes = Uint8Array.from({ length: 32 }, (_, index) => index);
    expect(parseCliAccountServiceRecoveryKey(
      'AAAQE-AYEAU-DAOCA-JBIFQ-YDIOB-4IBCE-QTCQK-RMFYY-DENBW-HA5DY-PQ',
    )).toEqual(bytes);
    expect(parseCliAccountServiceRecoveryKey(
      'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=',
    )).toEqual(bytes);
    expect(parseCliAccountServiceRecoveryKey(
      'AAECAwQFBg!cICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8',
    )).toBeNull();
  });
});

describe('CLI Account Service authentication', () => {
  it('uses the dedicated V2 Account Directory challenge and returns only its restricted token', async () => {
    const request = vi.fn(async (path: string) => {
      if (path.endsWith('/challenge')) return new Response(JSON.stringify({
        challengeId: 'challenge_123',
        nonce: 'bm9uY2U',
        audience: { origin: selection.canonicalServerUrl, serverIdentityId: selection.serverIdentityId },
        issuedAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      }), { status: 200 });
      return new Response(JSON.stringify({ token: 'restricted-directory-token' }), { status: 200 });
    });

    const result = await authenticateCliAccountService({
      service: selection,
      method: { kind: 'key' },
      key: new Uint8Array(32).fill(7),
    }, { request });

    expect(result).toEqual({ kind: 'authenticated', credential: { token: 'restricted-directory-token' } });
    expect(request.mock.calls.map(([path]) => path)).toEqual([
      '/v1/auth/account-directory/challenge',
      '/v1/auth/account-directory',
    ]);
  });

  it('provisions a new key Account through the exact Directory purpose and returns generated recovery material', async () => {
    const generatedRecoveryKey = new Uint8Array(32).fill(13);
    const request = vi.fn(async (path: string) => {
      if (path.endsWith('/challenge')) return new Response(JSON.stringify({
        challengeId: 'challenge_new_account',
        nonce: 'bm9uY2U',
        audience: { origin: selection.canonicalServerUrl, serverIdentityId: selection.serverIdentityId },
        issuedAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      }), { status: 200 });
      return new Response(JSON.stringify({ token: 'new-restricted-directory-token' }), { status: 200 });
    });

    await expect(authenticateCliAccountService({
      service: selection,
      method: { kind: 'key', action: 'provision', mode: 'keyed' },
    }, {
      request,
      randomBytes: () => generatedRecoveryKey,
    })).resolves.toEqual({
      kind: 'authenticated',
      credential: { token: 'new-restricted-directory-token' },
      recoveryKey: generatedRecoveryKey,
    });
  });

  it('finalizes provider OAuth only after the loopback callback repeats the exact Account Service binding', async () => {
    const request = vi.fn(async (path: string) => {
      if (path.includes('/params?')) return new Response(JSON.stringify({
        url: 'https://github.example.test/authorize',
        purpose: 'account_directory',
        credentialTarget: 'account_directory',
        endpointUrl: selection.endpoint,
        endpointServerIdentityId: selection.serverIdentityId,
        canonicalServerUrl: selection.canonicalServerUrl,
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      }), { status: 200 });
      return new Response(JSON.stringify({ success: true, token: 'oauth-directory-token' }), { status: 200 });
    });
    const result = await authenticateCliAccountService({
      service: selection,
      method: { kind: 'provider', providerId: 'github', action: 'login', mode: 'keyless' },
    }, {
      request,
      randomBytes: () => new Uint8Array(32).fill(9),
      runBrowserCallback: async ({ expected, resolveAuthorizationUrl }) => {
        await resolveAuthorizationUrl('http://127.0.0.1:34567');
        return {
          pending: 'pending_123',
          purpose: 'account_directory',
          credentialTarget: 'account_directory',
          endpointUrl: expected.endpointUrl,
          endpointServerIdentityId: expected.endpointServerIdentityId,
          canonicalServerUrl: expected.canonicalServerUrl,
        };
      },
    });

    expect(result).toEqual({ kind: 'authenticated', credential: { token: 'oauth-directory-token' } });
    expect(request.mock.calls.some(([path]) => path.endsWith('/finalize-keyless'))).toBe(true);
  });

  it('executes an admitted keyed provisioning tuple and returns its recovery key', async () => {
    const request = vi.fn(async (path: string, init?: RequestInit) => {
      if (path.includes('/params?')) {
        const query = new URL(path, selection.endpoint).searchParams;
        expect(query.get('mode')).toBe('keyed');
        expect(query.get('publicKey')).toBeTruthy();
        expect(query.has('proofHash')).toBe(false);
        return new Response(JSON.stringify({
          url: 'https://github.example.test/authorize',
          purpose: 'account_directory',
          credentialTarget: 'account_directory',
          endpointUrl: selection.endpoint,
          endpointServerIdentityId: selection.serverIdentityId,
          canonicalServerUrl: selection.canonicalServerUrl,
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
        }), { status: 200 });
      }
      expect(path).toBe('/v1/auth/external/github/finalize');
      expect(JSON.parse(String(init?.body))).toMatchObject({ pending: 'pending_keyed' });
      return new Response(JSON.stringify({ success: true, token: 'keyed-directory-token' }), { status: 200 });
    });
    const recoveryKey = new Uint8Array(32).fill(11);

    const result = await authenticateCliAccountService({
      service: selection,
      method: { kind: 'provider', providerId: 'github', action: 'provision', mode: 'keyed' },
    }, {
      request,
      randomBytes: () => recoveryKey,
      runBrowserCallback: async ({ expected, resolveAuthorizationUrl }) => {
        await resolveAuthorizationUrl('http://127.0.0.1:34567');
        return {
          pending: 'pending_keyed',
          purpose: 'account_directory',
          credentialTarget: 'account_directory',
          endpointUrl: expected.endpointUrl,
          endpointServerIdentityId: expected.endpointServerIdentityId,
          canonicalServerUrl: expected.canonicalServerUrl,
        };
      },
    });

    expect(result).toEqual({
      kind: 'authenticated',
      credential: { token: 'keyed-directory-token' },
      recoveryKey,
    });
  });

  it('does not finalize a provider callback whose exact destination binding changed', async () => {
    const request = vi.fn(async () => new Response(JSON.stringify({
      url: 'https://github.example.test/authorize',
      purpose: 'account_directory', credentialTarget: 'account_directory',
      endpointUrl: selection.endpoint,
      endpointServerIdentityId: selection.serverIdentityId,
      canonicalServerUrl: selection.canonicalServerUrl,
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    }), { status: 200 }));
    const result = await authenticateCliAccountService({
      service: selection,
      method: { kind: 'provider', providerId: 'github', action: 'login', mode: 'keyless' },
    }, {
      request,
      randomBytes: () => new Uint8Array(32).fill(9),
      runBrowserCallback: async ({ expected, resolveAuthorizationUrl }) => {
        await resolveAuthorizationUrl('http://127.0.0.1:34567');
        return {
          pending: 'pending_123', purpose: 'account_directory', credentialTarget: 'account_directory',
          endpointUrl: expected.endpointUrl,
          endpointServerIdentityId: 'srv_attacker',
          canonicalServerUrl: expected.canonicalServerUrl,
        };
      },
    });

    expect(result).toEqual({ kind: 'identity_mismatch' });
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('threads provider cancellation into the browser callback owner and never finalizes afterward', async () => {
    const controller = new AbortController();
    const request = vi.fn();

    const result = await authenticateCliAccountService({
      service: selection,
      method: { kind: 'provider', providerId: 'github', action: 'login', mode: 'keyless' },
      signal: controller.signal,
    }, {
      request,
      runBrowserCallback: async ({ signal }) => {
        expect(signal).toBe(controller.signal);
        controller.abort();
        const error = new Error('Authentication cancelled');
        error.name = 'AbortError';
        throw error;
      },
    });

    expect(result).toEqual({ kind: 'cancelled' });
    expect(request).not.toHaveBeenCalled();
  });

  it('prints the authorization link and keeps waiting when no browser can be opened', async () => {
    openBrowserMock.mockResolvedValue(false);
    const request = vi.fn(async (path: string) => {
      if (path.includes('/params?')) return new Response(JSON.stringify({
        url: 'https://github.example.test/authorize?state=abc',
        purpose: 'account_directory',
        credentialTarget: 'account_directory',
        endpointUrl: selection.endpoint,
        endpointServerIdentityId: selection.serverIdentityId,
        canonicalServerUrl: selection.canonicalServerUrl,
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      }), { status: 200 });
      return new Response(JSON.stringify({ success: true, token: 'headless-directory-token' }), { status: 200 });
    });
    const written: string[] = [];

    const result = await authenticateCliAccountService({
      service: selection,
      method: { kind: 'provider', providerId: 'github', action: 'login', mode: 'keyless' },
    }, { request, randomBytes: () => new Uint8Array(32).fill(3), write: (line) => { written.push(line); } });

    expect(result).toEqual({ kind: 'authenticated', credential: { token: 'headless-directory-token' } });
    expect(written).toContain('https://github.example.test/authorize?state=abc');
    expect(written.some((line) => line.includes('Copy this link'))).toBe(true);
  });
});
