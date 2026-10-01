import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { linkCliHomeToAccountService, unlinkCliHomeFromAccountService } from './linkCliHomeToAccountService';

const controller = vi.hoisted(() => ({ current: null as AbortController | null }));
const closeRuntimeMock = vi.hoisted(() => vi.fn(async () => {}));
const fetchServerFeaturesSnapshotMock = vi.hoisted(() => vi.fn());
const readStoredCredentialsForServerIdMock = vi.hoisted(() => vi.fn(async (_serverId: string) => ({ token: 'home-token' })));
const readSelectionMock = vi.hoisted(() => vi.fn(async () => ({
  endpoint: 'https://accounts.example.test',
  serverIdentityId: 'srv_account_service',
  canonicalServerUrl: 'https://accounts.example.test',
})));
const readCredentialMock = vi.hoisted(() => vi.fn(async () => ({ token: 'account-service-token' })));

const descriptor = {
  v: 1 as const,
  homeServerIdentityId: 'srv_home_a',
  canonicalServerUrl: 'https://home.example.test',
  revision: 1,
  endpoints: [{ kind: 'https' as const, url: 'https://home.example.test' }],
};

vi.mock('@happier-dev/cli-common/agents', () => ({
  resolveHappyHomeDirFromEnvironment: () => '/tmp/happier-test',
}));
vi.mock('@/auth/terminalAuthEnrollmentRuntime', () => ({
  acquireTerminalAuthEnrollmentRuntime: async () => ({
    ok: true,
    runtime: { runtimeOrigin: 'https://home.example.test' },
    close: closeRuntimeMock,
  }),
}));
vi.mock('@/features/serverFeaturesClient', () => ({
  fetchServerFeaturesSnapshot: (input: unknown) => fetchServerFeaturesSnapshotMock(input),
}));
vi.mock('@/persistence', () => ({
  readStoredCredentialsForServerId: (input: string) => readStoredCredentialsForServerIdMock(input),
}));
vi.mock('@/server/serverProfiles', () => ({
  getActiveServerProfile: async () => ({
    id: 'profile-home-a',
    name: 'Home A',
    homeConnectionDescriptor: descriptor,
    homeConnectionDescriptorAuthority: 'exact',
  }),
  getServerProfile: async () => ({
    id: 'profile-home-a',
    name: 'Home A',
    homeConnectionDescriptor: descriptor,
    homeConnectionDescriptorAuthority: 'exact',
  }),
}));
vi.mock('./cliAccountServiceSession', () => ({
  createCliAccountServiceSessionOwner: () => ({
    readSelection: readSelectionMock,
    readCredential: readCredentialMock,
  }),
}));

describe('linkCliHomeToAccountService production adapter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    controller.current = new AbortController();
    fetchServerFeaturesSnapshotMock.mockResolvedValue({
      status: 'ready',
      features: {
        features: {},
        capabilities: {
          accountDirectory: {
            version: 1,
            homeDirectory: true,
            homeEnrollment: true,
            deviceApproval: true,
            homeLoginAssertion: {
              keyId: 'a'.repeat(64),
              publicKeyBase64Url: 'A'.repeat(43),
            },
          },
          serverIdentity: { serverIdentityId: 'srv_account_service' },
        },
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('finishes Account Service publication when abort flips during the successful Home PUT', async () => {
    const requests: Array<{ url: string; signal: AbortSignal | null | undefined; authorization: string | null }> = [];
    vi.stubGlobal('fetch', vi.fn(async (urlInput: string | URL | Request, init?: RequestInit) => {
      const url = String(urlInput);
      requests.push({
        url,
        signal: init?.signal,
        authorization: new Headers(init?.headers).get('Authorization'),
      });
      if (init?.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      if (url.endsWith('/v1/account-directory/me')) {
        return Response.json({
          v: 1,
          accountId: 'account-1',
          displayName: null,
          avatar: null,
          linkedAuthenticationMethods: [],
        });
      }
      if (url.includes('/v1/account/directory-links/')) {
        controller.current?.abort();
        return Response.json({
          v: 1,
          issuerServerIdentityId: 'srv_account_service',
          issuerSubjectId: 'account-1',
          issuerSigningKeyId: 'a'.repeat(64),
          issuerSigningPublicKeyBase64Url: 'A'.repeat(43),
        });
      }
      return Response.json({
        v: 1,
        homeServerIdentityId: descriptor.homeServerIdentityId,
        canonicalServerUrl: descriptor.canonicalServerUrl,
        label: 'Home A',
        preferred: false,
        connectionDescriptor: descriptor,
        createdAtMs: 1_700_000_000_000,
        updatedAtMs: 1_700_000_000_001,
      });
    }));

    await expect(linkCliHomeToAccountService({
      homeServerIdentityId: descriptor.homeServerIdentityId,
      relink: false,
      signal: controller.current!.signal,
    })).resolves.toEqual({ kind: 'linked', homeServerIdentityId: descriptor.homeServerIdentityId });

    expect(requests.map((request) => request.url)).toEqual([
      'https://accounts.example.test/v1/account-directory/me',
      'https://home.example.test/v1/account/directory-links/srv_account_service',
      'https://accounts.example.test/v1/account-directory/homes/srv_home_a',
    ]);
    expect(requests[2]?.signal).toBeUndefined();
    expect(requests.map((request) => request.authorization)).toEqual([
      'Bearer account-service-token',
      'Bearer home-token',
      'Bearer account-service-token',
    ]);
    expect(closeRuntimeMock).toHaveBeenCalledOnce();
  });

  it('revokes the selected service link on the Home with the Home credential only', async () => {
    const requests: Array<{ url: string; method: string | undefined; authorization: string | null; body: unknown }> = [];
    vi.stubGlobal('fetch', vi.fn(async (urlInput: string | URL | Request, init?: RequestInit) => {
      requests.push({
        url: String(urlInput),
        method: init?.method,
        authorization: new Headers(init?.headers).get('Authorization'),
        body: init?.body,
      });
      return Response.json({ v: 1, deleted: true, issuerServerIdentityId: 'srv_account_service' });
    }));

    await expect(unlinkCliHomeFromAccountService({
      homeServerIdentityId: descriptor.homeServerIdentityId,
      signal: controller.current!.signal,
    })).resolves.toEqual({
      kind: 'unlinked',
      homeServerIdentityId: descriptor.homeServerIdentityId,
      issuerServerIdentityId: 'srv_account_service',
    });

    expect(requests).toEqual([{
      url: 'https://home.example.test/v1/account/directory-links/srv_account_service',
      method: 'DELETE',
      authorization: 'Bearer home-token',
      body: JSON.stringify({ v: 1 }),
    }]);
    expect(readCredentialMock).not.toHaveBeenCalled();
    expect(fetchServerFeaturesSnapshotMock).not.toHaveBeenCalled();
    expect(closeRuntimeMock).toHaveBeenCalledOnce();
  });

  it('names the selected sign-in service when this CLI is not signed in to it', async () => {
    readCredentialMock.mockResolvedValueOnce(null as never);

    await expect(linkCliHomeToAccountService({
      homeServerIdentityId: descriptor.homeServerIdentityId,
      relink: false,
    })).resolves.toEqual({
      kind: 'unavailable',
      reason: 'account_service_credentials_unavailable',
      selectedEndpoint: 'https://accounts.example.test',
    });
    expect(fetchServerFeaturesSnapshotMock).not.toHaveBeenCalled();
  });

  it('fails closed before credential or network use when the selected Account Service changed after confirmation', async () => {
    readSelectionMock.mockResolvedValueOnce({
      endpoint: 'https://other-accounts.example.test',
      serverIdentityId: 'srv_other_account_service',
      canonicalServerUrl: 'https://other-accounts.example.test',
    });

    await expect(linkCliHomeToAccountService({
      homeServerIdentityId: descriptor.homeServerIdentityId,
      relink: false,
      expectedAccountServiceSelection: {
        endpoint: 'https://accounts.example.test',
        serverIdentityId: 'srv_account_service',
      },
    })).resolves.toEqual({ kind: 'failed' });

    expect(readCredentialMock).not.toHaveBeenCalled();
    expect(fetchServerFeaturesSnapshotMock).not.toHaveBeenCalled();
  });
});
