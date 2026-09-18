import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CURRENT_ACCOUNT_STORED_CONTENT_PROTOCOL_VERSION } from '@happier-dev/protocol';

const { fetchServerFeaturesSnapshot, fetchAccountEncryptionCurrentness } = vi.hoisted(() => ({
  fetchServerFeaturesSnapshot: vi.fn(),
  fetchAccountEncryptionCurrentness: vi.fn(),
}));

vi.mock('@/features/serverFeaturesClient', () => ({
  fetchServerFeaturesSnapshot,
}));

vi.mock('@/api/client/connectedServiceCredentialApi', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/api/client/connectedServiceCredentialApi')>(),
  fetchAccountEncryptionCurrentness,
}));

import { AccountEncryptionCurrentnessUnavailableError } from '@/api/client/connectedServiceCredentialApi';
import { resolveSessionCreateEncryptionMode } from './resolveSessionCreateEncryptionMode';
import { configuration } from '@/configuration';

const READY_SNAPSHOT_REQUIREMENTS = {
  v: 1,
  minimumProtocolVersion: 2,
  currentProtocolVersion: CURRENT_ACCOUNT_STORED_CONTENT_PROTOCOL_VERSION,
  declarationTransport: 'http-header-and-socket-auth-v1',
} as const;

function readySnapshot(
  accountStoredContentCompatibility?: Readonly<Record<string, unknown>>,
  storagePolicy: 'required_e2ee' | 'optional' | 'plaintext_only' = 'optional',
) {
  return {
    status: 'ready' as const,
    features: {
      capabilities: {
        encryption: {
          storagePolicy,
          allowAccountOptOut: true,
          defaultAccountMode: 'e2ee' as const,
        },
        ...(accountStoredContentCompatibility
          ? { accountStoredContentCompatibility }
          : {}),
      },
    },
  };
}

describe('resolveSessionCreateEncryptionMode', () => {
  beforeEach(() => {
    fetchServerFeaturesSnapshot.mockReset();
    fetchAccountEncryptionCurrentness.mockReset();
  });

  it.each([
    { storagePolicy: 'plaintext_only' as const, accountMode: 'e2ee' as const },
    { storagePolicy: 'optional' as const, accountMode: 'plain' as const },
  ])('rejects $storagePolicy when this client requires E2EE', async ({ storagePolicy, accountMode }) => {
    fetchServerFeaturesSnapshot.mockResolvedValue(readySnapshot({
      v: 1,
      minimumProtocolVersion: 2,
      currentProtocolVersion: CURRENT_ACCOUNT_STORED_CONTENT_PROTOCOL_VERSION,
      declarationTransport: 'http-header-and-socket-auth-v1',
    }, storagePolicy));
    fetchAccountEncryptionCurrentness.mockResolvedValue({
      mode: accountMode,
      version: 3,
      signingKeyFingerprint: null,
      contentKeyFingerprint: accountMode === 'e2ee' ? 'content-fingerprint' : null,
      updatedAt: 9,
    });
    const previous = (configuration as { clientEncryptionRequirement?: unknown }).clientEncryptionRequirement;
    Object.assign(configuration, { clientEncryptionRequirement: 'require_e2ee' });
    try {
      await expect(resolveSessionCreateEncryptionMode({
        token: 'token-1',
        serverBaseUrl: 'https://server.example',
      })).rejects.toMatchObject({ code: 'CLIENT_E2EE_REQUIRED', retryable: false });
    } finally {
      Object.assign(configuration, { clientEncryptionRequirement: previous });
    }
  });

  it.each([
    { reason: 'network' as const },
    { reason: 'timeout' as const },
    { reason: 'response_status' as const },
  ])('fails closed but retryably when the server feature snapshot has a transient $reason error', async ({ reason }) => {
    fetchServerFeaturesSnapshot.mockResolvedValue({ status: 'error', reason });

    await expect(resolveSessionCreateEncryptionMode({
      token: 'token-1',
      serverBaseUrl: 'https://server.example',
    })).rejects.toMatchObject({
      code: 'account_stored_content_compatibility_unavailable',
      retryable: true,
      reason,
    });
    expect(fetchServerFeaturesSnapshot).toHaveBeenCalledWith({
      serverUrl: 'https://server.example',
    });
    expect(fetchAccountEncryptionCurrentness).not.toHaveBeenCalled();
  });

  it.each([
    {
      name: 'missing requirements',
      requirements: undefined,
      decision: 'missing',
    },
    {
      name: 'protocol v1',
      requirements: {
        v: 1,
        minimumProtocolVersion: 1,
        currentProtocolVersion: 1,
        declarationTransport: 'http-header-and-socket-auth-v1',
      },
      decision: 'server-too-old',
    },
  ])('rejects $name before resolving Account mode', async ({
    requirements,
    decision,
  }) => {
    fetchServerFeaturesSnapshot.mockResolvedValue(
      readySnapshot(requirements),
    );

    await expect(resolveSessionCreateEncryptionMode({
      token: 'token-1',
      serverBaseUrl: 'https://server.example',
    })).rejects.toMatchObject({
      code: 'client-upgrade-required',
      retryable: false,
      decision,
    });
    expect(fetchAccountEncryptionCurrentness).not.toHaveBeenCalled();
  });

  it.each([
    { storagePolicy: 'plaintext_only' as const, accountMode: 'e2ee' as const, expected: 'plain' as const },
    { storagePolicy: 'optional' as const, accountMode: 'plain' as const, expected: 'plain' as const },
    { storagePolicy: 'optional' as const, accountMode: 'e2ee' as const, expected: 'e2ee' as const },
    { storagePolicy: 'required_e2ee' as const, accountMode: 'plain' as const, expected: 'e2ee' as const },
  ])('resolves $storagePolicy Session mode from one Account-currentness snapshot', async ({
    storagePolicy,
    accountMode,
    expected,
  }) => {
    const snapshot = readySnapshot({
      v: 1,
      minimumProtocolVersion: 2,
      currentProtocolVersion: CURRENT_ACCOUNT_STORED_CONTENT_PROTOCOL_VERSION,
      declarationTransport: 'http-header-and-socket-auth-v1',
    }, storagePolicy);
    fetchServerFeaturesSnapshot.mockResolvedValue(snapshot);
    fetchAccountEncryptionCurrentness.mockResolvedValue({
      mode: accountMode,
      version: 3,
      signingKeyFingerprint: null,
      contentKeyFingerprint: accountMode === 'e2ee' ? 'content-fingerprint' : null,
      updatedAt: 9,
    });

    await expect(resolveSessionCreateEncryptionMode({
      token: 'token-1',
      serverBaseUrl: 'https://server.example',
    })).resolves.toMatchObject({
      status: 'resolved',
      desiredSessionEncryptionMode: expected,
      accountEncryptionCurrentness: { mode: accountMode, version: 3 },
    });
    expect(fetchAccountEncryptionCurrentness).toHaveBeenCalledOnce();
    expect(fetchAccountEncryptionCurrentness).toHaveBeenCalledWith({
      token: 'token-1',
      serverBaseUrl: 'https://server.example',
    });
  });

  it('returns a typed currentness-unavailable result instead of throwing when the Account read cannot be served', async () => {
    fetchServerFeaturesSnapshot.mockResolvedValue(readySnapshot(READY_SNAPSHOT_REQUIREMENTS, 'optional'));
    const unavailable = new AccountEncryptionCurrentnessUnavailableError(
      'Account encryption currentness is unavailable (503)',
    );
    fetchAccountEncryptionCurrentness.mockRejectedValue(unavailable);

    // The caller owns the transport-failure classification (offline mode, stable
    // auth errors); the preflight must hand it the failure rather than decide.
    await expect(resolveSessionCreateEncryptionMode({
      token: 'token-1',
      serverBaseUrl: 'https://server.example',
    })).resolves.toEqual({ status: 'currentness_unavailable', error: unavailable });
  });

  it('does not reinterpret an unrelated preflight failure as currentness unavailability', async () => {
    fetchServerFeaturesSnapshot.mockResolvedValue(readySnapshot(READY_SNAPSHOT_REQUIREMENTS, 'optional'));
    fetchAccountEncryptionCurrentness.mockRejectedValue(new Error('boom'));

    await expect(resolveSessionCreateEncryptionMode({
      token: 'token-1',
      serverBaseUrl: 'https://server.example',
    })).rejects.toThrow('boom');
  });
});
