import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  createHomeCredentialDestinationDigestV1,
  decodeBase64,
  encodeBase64,
  type AccountDirectoryHomeEntryV1,
} from '@happier-dev/protocol';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { libsodiumEncryptForPublicKey } from '@/api/encryption';
import { reloadConfiguration } from '@/configuration';
import {
  adoptServerProfileHomeConnectionDescriptor,
  listServerProfiles,
} from '@/server/serverProfiles';
import {
  createCliAccountServiceSessionOwner,
  resolveCliAccountServiceSessionRecordPath,
} from './cliAccountServiceSession';
import { runCliAccountServiceSetupEntry } from './cliAccountServiceSetupEntry';

const fetchServerFeaturesSnapshotMock = vi.hoisted(() => vi.fn());
const acquireTerminalAuthEnrollmentRuntimeMock = vi.hoisted(() => vi.fn());
const authAndSetupMachineIfNeededMock = vi.hoisted(() => vi.fn(async (_opts?: unknown) => {}));
const registerMachineWithAuthenticatedHomeRuntimeMock = vi.hoisted(() => vi.fn(async (_opts?: unknown) => ({
  machineId: 'machine-account-service',
})));
const closeHomeTransportMock = vi.hoisted(() => vi.fn(async () => {}));
const promptMultipleChoiceMock = vi.hoisted(() => vi.fn(async (
  _message: string,
  _choices: unknown,
  _options: unknown,
) => 'key'));
const authenticateCliAccountServiceMock = vi.hoisted(() => vi.fn(
  async (_input: unknown): Promise<
    | Readonly<{ kind: 'failed' }>
    | Readonly<{ kind: 'authenticated'; credential: Readonly<{ token: string }> }>
  > => ({ kind: 'failed' }),
));
const writeCredentialsTokenOnlyForServerIdMock = vi.hoisted(() => vi.fn(
  async (_serverId: string, _credentials: Readonly<{ token: string; encryption: null }>) => {},
));

vi.mock('@/features/serverFeaturesClient', () => ({
  fetchServerFeaturesSnapshot: (...args: unknown[]) => fetchServerFeaturesSnapshotMock(...args),
}));
vi.mock('@/auth/terminalAuthEnrollmentRuntime', () => ({
  acquireTerminalAuthEnrollmentRuntime: (...args: unknown[]) => acquireTerminalAuthEnrollmentRuntimeMock(...args),
}));
vi.mock('@/ui/auth', () => ({
  authAndSetupMachineIfNeeded: (opts?: unknown) => authAndSetupMachineIfNeededMock(opts),
  registerMachineWithAuthenticatedHomeRuntime: (opts?: unknown) =>
    registerMachineWithAuthenticatedHomeRuntimeMock(opts),
}));
vi.mock('@/terminal/prompts/promptMultipleChoice', () => ({
  promptMultipleChoice: (message: string, choices: unknown, options: unknown) => promptMultipleChoiceMock(
    message,
    choices,
    options,
  ),
}));
vi.mock('./cliAccountServiceAuth', () => ({
  authenticateCliAccountService: (input: unknown) => authenticateCliAccountServiceMock(input),
}));
vi.mock('@/persistence', async (importOriginal) => {
  const persistence = await importOriginal<typeof import('@/persistence')>();
  return {
    ...persistence,
    writeCredentialsTokenOnlyForServerId: (
      serverId: string,
      credentials: Readonly<{ token: string; encryption: null }>,
    ) => writeCredentialsTokenOnlyForServerIdMock(serverId, credentials),
  };
});

const nowMs = 1_700_000_000_000;
const accountService = {
  endpoint: 'https://accounts.example.test',
  serverIdentityId: 'srv_account_service',
  canonicalServerUrl: 'https://accounts.example.test',
  advertisedMethods: {
    keyLoginAvailable: true,
    oauthProviderIds: [],
    preferredProvisionProviderId: null,
  },
} as const;
const home: AccountDirectoryHomeEntryV1 = {
  v: 1,
  homeServerIdentityId: 'srv_home_a',
  canonicalServerUrl: 'https://home-a.example.test',
  label: 'Home A',
  preferred: true,
  connectionDescriptor: {
    v: 1,
    homeServerIdentityId: 'srv_home_a',
    canonicalServerUrl: 'https://home-a.example.test',
    revision: 1,
    endpoints: [{ kind: 'https', url: 'https://home-a.example.test' }],
  },
  createdAtMs: nowMs - 10_000,
  updatedAtMs: nowMs - 5_000,
};

function readyAccountServiceFeatures(
  service: typeof accountService,
  serverIdentityId: string = service.serverIdentityId,
) {
  return {
    status: 'ready' as const,
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
        server: { canonicalServerUrl: service.canonicalServerUrl },
        serverIdentity: { serverIdentityId },
        auth: { methods: [], keyChallenge: { v2: true } },
        oauth: { providers: {} },
      },
    },
  };
}

const roots: string[] = [];
const originalHome = process.env.HAPPIER_HOME_DIR;

async function configureProductionJourney(): Promise<Readonly<{
  redemptionCount(): number;
  waitForApproval(): Promise<void>;
  readPersistedSession(): Promise<Record<string, unknown>>;
}>> {
  const happyHomeDir = await mkdtemp(join(tmpdir(), 'happier-account-service-approval-'));
  roots.push(happyHomeDir);
  process.env.HAPPIER_HOME_DIR = happyHomeDir;
  reloadConfiguration();
  const session = createCliAccountServiceSessionOwner({ happyHomeDir });
  await session.selectService(accountService);
  await session.replaceCredential({ service: accountService, credential: { token: 'account-service-token' } });

  fetchServerFeaturesSnapshotMock.mockImplementation(async (input: Readonly<{ serverUrl: string; token?: string }>) => {
    if (input.serverUrl === accountService.endpoint) {
      return {
        status: 'ready',
        serverIdentityId: accountService.serverIdentityId,
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
            server: { canonicalServerUrl: accountService.canonicalServerUrl },
            serverIdentity: { serverIdentityId: accountService.serverIdentityId },
            auth: { methods: [], keyChallenge: { v2: true } },
            oauth: { providers: {} },
          },
        },
      };
    }
    return {
      status: 'ready',
      serverIdentityId: home.homeServerIdentityId,
      features: {
        features: {},
        capabilities: { serverIdentity: { serverIdentityId: home.homeServerIdentityId } },
        homeConnectionDescriptor: home.connectionDescriptor,
      },
    };
  });
  acquireTerminalAuthEnrollmentRuntimeMock.mockResolvedValue({
    ok: true,
    runtime: {
      runtimeOrigin: home.canonicalServerUrl,
      authenticatedCredentialDestination: {
        kind: 'https',
        applicationUrl: home.canonicalServerUrl,
      },
    },
    close: closeHomeTransportMock,
  });

  let requesterPublicKeyBase64 = '';
  let redemptions = 0;
  let resolveApproval!: () => void;
  const approvalIssued = new Promise<void>((resolve) => { resolveApproval = resolve; });
  vi.stubGlobal('fetch', vi.fn(async (urlInput: string | URL | Request, init?: RequestInit) => {
    const url = String(urlInput);
    if (url.endsWith('/v1/account-directory/me')) return Response.json({});
    if (url.endsWith('/v1/account-directory/homes')) {
      return Response.json({ v: 1, homes: [home], preferredHomeServerIdentityId: home.homeServerIdentityId });
    }
    if (url.endsWith(`/v1/account-directory/homes/${home.homeServerIdentityId}/login-assertion`)) {
      const body = JSON.parse(String(init?.body)) as { clientBoxPublicKeyBase64: string };
      requesterPublicKeyBase64 = body.clientBoxPublicKeyBase64;
      return Response.json({
        v: 1,
        purpose: 'happier.home-login',
        issuerServerIdentityId: accountService.serverIdentityId,
        issuerSubjectId: 'account-1',
        audienceHomeServerIdentityId: home.homeServerIdentityId,
        credentialDestinationDigestBase64Url: createHomeCredentialDestinationDigestV1(home.connectionDescriptor),
        clientBoxPublicKeyBase64: requesterPublicKeyBase64,
        issuedAtMs: nowMs,
        expiresAtMs: nowMs + 120_000,
        keyId: 'a'.repeat(64),
        signatureBase64Url: 'A'.repeat(86),
      });
    }
    if (url.endsWith('/v1/auth/home-login')) {
      redemptions += 1;
      if (redemptions === 1) {
        resolveApproval();
        return Response.json({
          v: 1,
          outcome: 'approval_required',
          homeServerIdentityId: home.homeServerIdentityId,
          approvalId: 'approval-1',
          deviceLabel: null,
          expiresAtMs: nowMs + 60_000,
        });
      }
      const plaintext = new TextEncoder().encode(JSON.stringify({ token: 'home-token' }));
      return Response.json({
        v: 1,
        homeServerIdentityId: home.homeServerIdentityId,
        sealedHomeTokenBase64Url: encodeBase64(
          libsodiumEncryptForPublicKey(plaintext, decodeBase64(requesterPublicKeyBase64, 'base64')),
          'base64url',
        ),
        issuedAtMs: nowMs + 1_000,
        expiresAtMs: nowMs + 30_000,
      });
    }
    return new Response(null, { status: 404 });
  }));

  return {
    redemptionCount: () => redemptions,
    waitForApproval: async () => await approvalIssued,
    readPersistedSession: async () => JSON.parse(
      await readFile(resolveCliAccountServiceSessionRecordPath(happyHomeDir), 'utf8'),
    ) as Record<string, unknown>,
  };
}

describe('production CLI Account Service approval continuation', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(nowMs);
  });

  afterEach(async () => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    fetchServerFeaturesSnapshotMock.mockReset();
    acquireTerminalAuthEnrollmentRuntimeMock.mockReset();
    authAndSetupMachineIfNeededMock.mockClear();
    registerMachineWithAuthenticatedHomeRuntimeMock.mockClear();
    closeHomeTransportMock.mockClear();
    promptMultipleChoiceMock.mockClear();
    authenticateCliAccountServiceMock.mockClear();
    writeCredentialsTokenOnlyForServerIdMock.mockClear();
    if (originalHome === undefined) delete process.env.HAPPIER_HOME_DIR;
    else process.env.HAPPIER_HOME_DIR = originalHome;
    reloadConfiguration();
    await Promise.all(roots.splice(0).map(async (root) => await rm(root, { recursive: true, force: true })));
  });

  it('polls an approval-required Home to completion before focusing and continuing setup', async () => {
    const harness = await configureProductionJourney();
    const result = runCliAccountServiceSetupEntry({
      endpoint: accountService.endpoint,
      promptInputFn: async () => 'k',
      promptSecretInputFn: async () => encodeBase64(new Uint8Array(32), 'base64url'),
      timeoutMs: 10_000,
    });

    await harness.waitForApproval();
    const persistedWhilePending = await harness.readPersistedSession();
    expect(persistedWhilePending).not.toHaveProperty('approval');
    expect(persistedWhilePending).not.toHaveProperty('requesterSecretKey');
    expect(persistedWhilePending).not.toHaveProperty('continuation');
    await vi.advanceTimersByTimeAsync(1_250);

    await expect(result).resolves.toMatchObject({
      kind: 'preferred_home_enrolled',
      homeServerIdentityId: home.homeServerIdentityId,
    });
    expect(harness.redemptionCount()).toBe(2);
    expect(writeCredentialsTokenOnlyForServerIdMock).toHaveBeenCalledWith(
      expect.any(String),
      { token: 'home-token', encryption: null },
    );
    expect(registerMachineWithAuthenticatedHomeRuntimeMock).toHaveBeenCalledWith({
      credentials: { token: 'home-token', encryption: null },
      forceNew: true,
      runtimeOrigin: home.canonicalServerUrl,
    });
    expect(closeHomeTransportMock).toHaveBeenCalledTimes(2);
    expect(registerMachineWithAuthenticatedHomeRuntimeMock.mock.invocationCallOrder[0])
      .toBeLessThan(closeHomeTransportMock.mock.invocationCallOrder.at(-1)!);
    expect(authAndSetupMachineIfNeededMock).not.toHaveBeenCalled();
  });

  it('does not commit an enrolled Home credential when authenticated reconciliation is stale', async () => {
    const harness = await configureProductionJourney();
    const newerDescriptor = {
      ...home.connectionDescriptor,
      revision: home.connectionDescriptor.revision + 1,
      endpoints: [{ kind: 'https' as const, url: 'https://newer-home-a.example.test' }],
    };
    const existing = await adoptServerProfileHomeConnectionDescriptor({
      descriptor: newerDescriptor,
      suggestedName: home.label,
      observation: 'exact',
    });

    const result = runCliAccountServiceSetupEntry({
      endpoint: accountService.endpoint,
      promptInputFn: async () => 'k',
      promptSecretInputFn: async () => encodeBase64(new Uint8Array(32), 'base64url'),
      timeoutMs: 10_000,
    });
    await harness.waitForApproval();
    await vi.advanceTimersByTimeAsync(1_250);

    await expect(result).resolves.toEqual({ kind: 'home_unavailable' });
    expect(writeCredentialsTokenOnlyForServerIdMock).not.toHaveBeenCalled();
    expect(authAndSetupMachineIfNeededMock).not.toHaveBeenCalled();
    const retained = (await listServerProfiles()).find((profile) => profile.id === existing.profile.id);
    expect(retained).toMatchObject({
      homeConnectionDescriptorAuthority: 'exact',
      homeConnectionDescriptor: newerDescriptor,
    });
  });

  it('cancels approval polling without redeeming or committing a late Home credential', async () => {
    const harness = await configureProductionJourney();
    const controller = new AbortController();
    const result = runCliAccountServiceSetupEntry({
      endpoint: accountService.endpoint,
      promptInputFn: async () => 'k',
      promptSecretInputFn: async () => encodeBase64(new Uint8Array(32), 'base64url'),
      signal: controller.signal,
      timeoutMs: 10_000,
    });
    await harness.waitForApproval();
    controller.abort();

    await expect(result).resolves.toEqual({ kind: 'cancelled' });
    expect(harness.redemptionCount()).toBe(1);
    expect(writeCredentialsTokenOnlyForServerIdMock).not.toHaveBeenCalled();
    expect(authAndSetupMachineIfNeededMock).not.toHaveBeenCalled();
  });

  it('times out approval polling without a second redemption or Home credential commit', async () => {
    const harness = await configureProductionJourney();
    const result = runCliAccountServiceSetupEntry({
      endpoint: accountService.endpoint,
      promptInputFn: async () => 'k',
      promptSecretInputFn: async () => encodeBase64(new Uint8Array(32), 'base64url'),
      timeoutMs: 10,
    });

    await harness.waitForApproval();
    await vi.advanceTimersByTimeAsync(10);

    await expect(result).resolves.toEqual({ kind: 'timed_out' });
    expect(harness.redemptionCount()).toBe(1);
    expect(writeCredentialsTokenOnlyForServerIdMock).not.toHaveBeenCalled();
    expect(authAndSetupMachineIfNeededMock).not.toHaveBeenCalled();
  });

  it('rejects a selected method that the Account Service did not advertise before authentication', async () => {
    const happyHomeDir = await mkdtemp(join(tmpdir(), 'happier-account-service-method-selection-'));
    roots.push(happyHomeDir);
    process.env.HAPPIER_HOME_DIR = happyHomeDir;
    fetchServerFeaturesSnapshotMock.mockResolvedValue({
      status: 'ready',
      serverIdentityId: accountService.serverIdentityId,
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
          server: { canonicalServerUrl: accountService.canonicalServerUrl },
          serverIdentity: { serverIdentityId: accountService.serverIdentityId },
          auth: {
            methods: [{ id: 'github', actions: [{ id: 'provision', enabled: true, mode: 'keyed' }] }],
            keyChallenge: { v2: false },
          },
          oauth: { providers: { github: { configured: true, enabled: true } } },
        },
      },
    });
    const secretPrompt = vi.fn(async () => encodeBase64(new Uint8Array(32), 'base64url'));

    await expect(runCliAccountServiceSetupEntry({
      endpoint: accountService.endpoint,
      promptInputFn: async () => 'k',
      promptSecretInputFn: secretPrompt,
      timeoutMs: 10_000,
    })).resolves.toEqual({ kind: 'cancelled' });

    expect(secretPrompt).not.toHaveBeenCalled();
    expect(authenticateCliAccountServiceMock).not.toHaveBeenCalled();
  });

  it('reuses the persisted custom Account Service when setup supplies no explicit override', async () => {
    const happyHomeDir = await mkdtemp(join(tmpdir(), 'happier-account-service-persisted-selection-'));
    roots.push(happyHomeDir);
    process.env.HAPPIER_HOME_DIR = happyHomeDir;
    const session = createCliAccountServiceSessionOwner({ happyHomeDir });
    const previouslyAdvertisedService = {
      ...accountService,
      advertisedMethods: {
        keyLoginAvailable: false,
        oauthProviderIds: ['github'],
        preferredProvisionProviderId: 'github',
      },
    } as const;
    await session.selectService(previouslyAdvertisedService);
    await session.replaceCredential({
      service: previouslyAdvertisedService,
      credential: { token: 'account-service-token' },
    });

    const observedEndpoints: string[] = [];
    fetchServerFeaturesSnapshotMock.mockImplementation(async (input: Readonly<{ serverUrl: string }>) => {
      observedEndpoints.push(input.serverUrl);
      if (input.serverUrl === accountService.endpoint) return readyAccountServiceFeatures(accountService);
      throw new Error(`Unexpected Account Service contact: ${input.serverUrl}`);
    });
    const requestedUrls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (urlInput: string | URL | Request) => {
      const url = String(urlInput);
      requestedUrls.push(url);
      if (url.endsWith('/v1/account-directory/me')) return Response.json({});
      if (url.endsWith('/v1/account-directory/homes')) {
        return Response.json({ v: 1, homes: [], preferredHomeServerIdentityId: null });
      }
      return new Response(null, { status: 404 });
    }));

    await expect(runCliAccountServiceSetupEntry({
      promptInputFn: async () => 'k',
      promptSecretInputFn: async () => encodeBase64(new Uint8Array(32), 'base64url'),
      timeoutMs: 10_000,
    })).resolves.toMatchObject({ kind: 'no_linked_homes' });

    expect(observedEndpoints).toEqual([accountService.endpoint]);
    expect(requestedUrls).not.toEqual([]);
    expect(requestedUrls.every((url) => url.startsWith(`${accountService.endpoint}/`))).toBe(true);
    await expect(session.readSelection()).resolves.toEqual(accountService);
  });

  it('validates and reuses a stored restricted credential before prompting for an auth method', async () => {
    const happyHomeDir = await mkdtemp(join(tmpdir(), 'happier-account-service-session-reuse-'));
    roots.push(happyHomeDir);
    process.env.HAPPIER_HOME_DIR = happyHomeDir;
    const session = createCliAccountServiceSessionOwner({ happyHomeDir });
    await session.selectService(accountService);
    await session.replaceCredential({
      service: accountService,
      credential: { token: 'account-service-token' },
    });

    fetchServerFeaturesSnapshotMock.mockResolvedValue(readyAccountServiceFeatures(accountService));
    const promptInputFn = vi.fn(async () => 'k');
    const promptSecretInputFn = vi.fn(async () => encodeBase64(new Uint8Array(32), 'base64url'));
    vi.stubGlobal('fetch', vi.fn(async (urlInput: string | URL | Request) => {
      const url = String(urlInput);
      if (url.endsWith('/v1/account-directory/me')) return Response.json({});
      if (url.endsWith('/v1/account-directory/homes')) {
        return Response.json({ v: 1, homes: [], preferredHomeServerIdentityId: null });
      }
      return new Response(null, { status: 404 });
    }));

    await expect(runCliAccountServiceSetupEntry({
      promptInputFn,
      promptSecretInputFn,
      timeoutMs: 10_000,
    })).resolves.toMatchObject({ kind: 'no_linked_homes' });

    expect(promptMultipleChoiceMock).not.toHaveBeenCalled();
    expect(promptInputFn).not.toHaveBeenCalled();
    expect(promptSecretInputFn).not.toHaveBeenCalled();
    expect(authenticateCliAccountServiceMock).not.toHaveBeenCalled();
    await expect(session.readSelection()).resolves.toEqual(accountService);
    await expect(session.readCredential(accountService)).resolves.toEqual({
      token: 'account-service-token',
    });
  });

  it('uses the existing method flow only after a stored credential is definitively rejected', async () => {
    const happyHomeDir = await mkdtemp(join(tmpdir(), 'happier-account-service-session-replacement-'));
    roots.push(happyHomeDir);
    process.env.HAPPIER_HOME_DIR = happyHomeDir;
    const session = createCliAccountServiceSessionOwner({ happyHomeDir });
    await session.selectService(accountService);
    await session.replaceCredential({
      service: accountService,
      credential: { token: 'rejected-account-service-token' },
    });

    fetchServerFeaturesSnapshotMock.mockResolvedValue(readyAccountServiceFeatures(accountService));
    authenticateCliAccountServiceMock.mockResolvedValue({
      kind: 'authenticated',
      credential: { token: 'replacement-account-service-token' },
    });
    const promptInputFn = vi.fn(async () => 'k');
    const promptSecretInputFn = vi.fn(async () => encodeBase64(new Uint8Array(32), 'base64url'));
    vi.stubGlobal('fetch', vi.fn(async (urlInput: string | URL | Request) => {
      const url = String(urlInput);
      if (url.endsWith('/v1/account-directory/me')) {
        return new Response(null, { status: 401 });
      }
      if (url.endsWith('/v1/account-directory/homes')) {
        return Response.json({ v: 1, homes: [], preferredHomeServerIdentityId: null });
      }
      return new Response(null, { status: 404 });
    }));

    await expect(runCliAccountServiceSetupEntry({
      promptInputFn,
      promptSecretInputFn,
      timeoutMs: 10_000,
    })).resolves.toMatchObject({ kind: 'no_linked_homes' });

    expect(promptMultipleChoiceMock).toHaveBeenCalledOnce();
    expect(promptSecretInputFn).toHaveBeenCalledOnce();
    expect(authenticateCliAccountServiceMock).toHaveBeenCalledOnce();
    await expect(session.readCredential(accountService)).resolves.toEqual({
      token: 'replacement-account-service-token',
    });
  });

  it('retains a stored restricted credential when validation is temporarily unavailable', async () => {
    const happyHomeDir = await mkdtemp(join(tmpdir(), 'happier-account-service-session-unavailable-'));
    roots.push(happyHomeDir);
    process.env.HAPPIER_HOME_DIR = happyHomeDir;
    const session = createCliAccountServiceSessionOwner({ happyHomeDir });
    await session.selectService(accountService);
    await session.replaceCredential({
      service: accountService,
      credential: { token: 'retained-account-service-token' },
    });

    fetchServerFeaturesSnapshotMock.mockResolvedValue(readyAccountServiceFeatures(accountService));
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 503 })));

    await expect(runCliAccountServiceSetupEntry({
      promptInputFn: async () => 'k',
      promptSecretInputFn: async () => encodeBase64(new Uint8Array(32), 'base64url'),
      timeoutMs: 10_000,
    })).resolves.toEqual({ kind: 'account_service_unavailable' });

    expect(promptMultipleChoiceMock).not.toHaveBeenCalled();
    expect(authenticateCliAccountServiceMock).not.toHaveBeenCalled();
    await expect(session.readCredential(accountService)).resolves.toEqual({
      token: 'retained-account-service-token',
    });
  });

  it('keeps an unavailable persisted Account Service selected without contacting Cloud', async () => {
    const happyHomeDir = await mkdtemp(join(tmpdir(), 'happier-account-service-persisted-unavailable-'));
    roots.push(happyHomeDir);
    process.env.HAPPIER_HOME_DIR = happyHomeDir;
    const session = createCliAccountServiceSessionOwner({ happyHomeDir });
    await session.selectService(accountService);

    const observedEndpoints: string[] = [];
    fetchServerFeaturesSnapshotMock.mockImplementation(async (input: Readonly<{ serverUrl: string }>) => {
      observedEndpoints.push(input.serverUrl);
      return { status: 'error' as const, reason: 'network' as const };
    });

    await expect(runCliAccountServiceSetupEntry({
      promptInputFn: async () => 'k',
      timeoutMs: 10_000,
    })).resolves.toEqual({ kind: 'account_service_unavailable' });

    expect(observedEndpoints).toEqual([accountService.endpoint]);
    await expect(session.readSelection()).resolves.toEqual(accountService);
  });

  it('uses Happier Cloud only when setup has neither an override nor a persisted selection', async () => {
    const happyHomeDir = await mkdtemp(join(tmpdir(), 'happier-account-service-default-selection-'));
    roots.push(happyHomeDir);
    process.env.HAPPIER_HOME_DIR = happyHomeDir;

    const observedEndpoints: string[] = [];
    fetchServerFeaturesSnapshotMock.mockImplementation(async (input: Readonly<{ serverUrl: string }>) => {
      observedEndpoints.push(input.serverUrl);
      return { status: 'error' as const, reason: 'network' as const };
    });

    await expect(runCliAccountServiceSetupEntry({
      promptInputFn: async () => 'k',
      timeoutMs: 10_000,
    })).resolves.toEqual({ kind: 'account_service_unavailable' });

    expect(observedEndpoints).toEqual(['https://api.happier.dev']);
  });

  it('fails closed when the persisted Account Service endpoint presents another identity', async () => {
    const happyHomeDir = await mkdtemp(join(tmpdir(), 'happier-account-service-persisted-identity-'));
    roots.push(happyHomeDir);
    process.env.HAPPIER_HOME_DIR = happyHomeDir;
    const session = createCliAccountServiceSessionOwner({ happyHomeDir });
    await session.selectService(accountService);

    fetchServerFeaturesSnapshotMock.mockResolvedValue(
      readyAccountServiceFeatures(accountService, 'srv_another_account_service'),
    );

    await expect(runCliAccountServiceSetupEntry({
      promptInputFn: async () => 'k',
      timeoutMs: 10_000,
    })).resolves.toEqual({ kind: 'identity_mismatch' });

    await expect(session.readSelection()).resolves.toEqual(accountService);
  });
});
