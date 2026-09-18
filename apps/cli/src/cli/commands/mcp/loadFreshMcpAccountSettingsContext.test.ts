import { accountSettingsParse, FeaturesResponseSchema } from '@happier-dev/protocol';
import { describe, expect, it, vi } from 'vitest';

import { loadFreshMcpAccountSettingsContext } from './loadFreshMcpAccountSettingsContext';

vi.mock('@/api/client/serverHttpBaseUrl', () => ({
  resolveServerHttpBaseUrl: () => 'https://home.example.test',
}));
vi.mock('@/features/serverFeaturesClient', () => ({
  fetchServerFeaturesSnapshot: vi.fn(),
}));
vi.mock('@/settings/secrets/hydrateSavedSecretCatalog', () => ({
  hydrateSavedSecretCatalog: vi.fn(),
}));

describe('loadFreshMcpAccountSettingsContext', () => {
  it('returns the current shared Saved Secret material alongside freshly loaded Settings', async () => {
    const settings = accountSettingsParse({});
    const bootstrapAccountSettingsContext = vi.fn(async () => ({
      source: 'network' as const,
      settings,
      settingsVersion: 4,
      loadedAtMs: 10,
      settingsSecretsReadKeys: [],
      whenRefreshed: null,
    }));
    const sharedResource = {
      resourceId: 'resource-1',
      ownerAccountId: 'owner-account',
      displayName: 'Shared token',
      kind: 'token' as const,
      encryptionMode: 'plain' as const,
      revision: 3,
      storedContent: {
        t: 'plain' as const,
        v: { v: 1 as const, name: 'Shared token', kind: 'token' as const, value: 'secret-value' },
      },
      materialStatus: 'ready' as const,
    };
    const hydrateSavedSecretCatalog = vi.fn(async () => ({
      resources: [sharedResource],
      state: 'ready' as const,
    }));
    const serverFeatures = FeaturesResponseSchema.parse({
      features: {
        teams: {
          enabled: true,
          credentialResources: {
            enabled: true,
            externalApi: { enabled: true },
          },
        },
      },
      capabilities: {},
    });
    const fetchServerFeaturesSnapshot = vi.fn(async () => ({
      status: 'ready' as const,
      features: serverFeatures,
      provenance: 'authenticated' as const,
    }));
    const deps = {
      bootstrapAccountSettingsContext,
      fetchServerFeaturesSnapshot,
      hydrateSavedSecretCatalog,
    };

    const result = await loadFreshMcpAccountSettingsContext(
      { token: 'token', encryption: null },
      deps,
    );

    expect(fetchServerFeaturesSnapshot).toHaveBeenCalledWith({
      serverUrl: 'https://home.example.test',
      token: 'token',
      projection: 'authenticated',
    });
    expect(hydrateSavedSecretCatalog).toHaveBeenCalledWith({
      token: 'token',
      serverFeatures,
    });
    expect(result.savedSecretResources).toEqual([sharedResource]);
    expect(result.savedSecretCatalogState).toBe('ready');
  });

  it('fails shared catalog admission closed when the Home feature snapshot is unavailable', async () => {
    const settings = accountSettingsParse({});
    const bootstrapAccountSettingsContext = vi.fn(async () => ({
      source: 'network' as const,
      settings,
      settingsVersion: 4,
      loadedAtMs: 10,
      settingsSecretsReadKeys: [],
      whenRefreshed: null,
    }));
    const fetchServerFeaturesSnapshot = vi.fn(async () => ({
      status: 'error' as const,
      reason: 'network' as const,
    }));
    const hydrateSavedSecretCatalog = vi.fn(async () => ({
      resources: [],
      state: 'disabled' as const,
    }));

    const result = await loadFreshMcpAccountSettingsContext(
      { token: 'token', encryption: null },
      {
        bootstrapAccountSettingsContext,
        fetchServerFeaturesSnapshot,
        hydrateSavedSecretCatalog,
      },
    );

    expect(hydrateSavedSecretCatalog).toHaveBeenCalledWith({
      token: 'token',
      serverFeatures: null,
    });
    expect(result.savedSecretCatalogState).toBe('disabled');
  });
});
