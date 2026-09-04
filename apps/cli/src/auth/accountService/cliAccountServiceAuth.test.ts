import { describe, expect, it, vi } from 'vitest';

import { authenticateCliAccountService } from './cliAccountServiceAuth';

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
      method: { kind: 'provider', providerId: 'github' },
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
      method: { kind: 'provider', providerId: 'github' },
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
      method: { kind: 'provider', providerId: 'github' },
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
});
