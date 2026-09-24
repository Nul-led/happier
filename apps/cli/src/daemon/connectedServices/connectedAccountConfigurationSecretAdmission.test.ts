import axios from 'axios';
import {
  AccountSettingsSchema,
  CONNECTED_ACCOUNT_SERVICE_CONFIGURATIONS_SETTINGS_KEY,
  FeaturesResponseSchema,
  PluginConnectedAccountAuthenticationModeV2Schema,
  formatSavedSecretCatalogReferenceV1,
  sealSavedSecretResourceStoredContentV1,
} from '@happier-dev/protocol';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  ConnectedAccountConfigurationError,
  createConnectedAccountConfigurationOwner,
} from '@/plugins/runtime/connectedAccounts/configurationOwner';
import {
  resetActiveAccountSettingsSnapshotForTests,
  setActiveAccountSettingsSnapshot,
  subscribeActiveAccountSettingsSnapshot,
} from '@/settings/accountSettings/activeAccountSettingsSnapshot';
import { resolveAccountSettingsScopeKeyForToken } from '@/settings/accountSettings/accountSettingsScopeKey';
import { hydrateSavedSecretCatalog } from '@/settings/secrets/hydrateSavedSecretCatalog';

import {
  createActiveAccountSettingsConnectedAccountSecrets,
  createQualifiedConnectedAccountDaemonPersistence,
} from './qualifiedConnectedAccountDaemonPersistence';

// System boundaries only: the Home HTTP transport (catalog list and features)
// and the credentials file. Account Settings, the Saved Secret catalog, the
// daemon configuration persistence and the configuration owner are real.
vi.mock('axios', async (importOriginal) => {
  const actual = await importOriginal<typeof import('axios')>();
  return { ...actual, default: Object.assign(Object.create(actual.default), { get: vi.fn() }) };
});

const persistenceMocks = vi.hoisted(() => ({
  readStoredCredentials: vi.fn(),
}));

vi.mock('@/persistence', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/persistence')>(),
  readStoredCredentials: persistenceMocks.readStoredCredentials,
}));

vi.mock('@/features/serverFeaturesClient', () => ({
  fetchServerFeaturesSnapshot: vi.fn(async () => ({
    status: 'ready' as const,
    features: FeaturesResponseSchema.parse({ features: { teams: { enabled: true } }, capabilities: {} }),
  })),
}));

const token = 'account-token';
const scopeKey = resolveAccountSettingsScopeKeyForToken(token);
const service = Object.freeze({ pluginId: 'acme.accounts', localId: 'work' });
const generation = Object.freeze({
  occurrenceId: 'occurrence-1',
  sourceCustody: Object.freeze({
    kind: 'managed' as const,
    immutableGenerationId: 'sha256:artifact-1',
    installSource: 'archive' as const,
  }),
});
const mode = PluginConnectedAccountAuthenticationModeV2Schema.parse({
  id: 'oauth',
  kind: 'oauthDeviceCode',
  outcomeReconciliation: 'providerCheck',
  configuration: {
    scope: 'service',
    changeBehavior: 'refresh',
    fields: [{
      id: 'endpoint',
      title: 'Endpoint',
      schema: { type: 'string', minLength: 1 },
      required: true,
    }, {
      id: 'clientSecret',
      title: 'Client secret',
      schema: { type: 'string', minLength: 1 },
      secret: true,
      required: true,
    }],
  },
});
const resourceId = 'resource-client-secret';
const sharedRef = formatSavedSecretCatalogReferenceV1({ kind: 'shared_resource', id: resourceId });
const sharedRow = {
  resourceId,
  encryptionMode: 'plain' as const,
  entry: {
    ref: sharedRef,
    source: 'shared_resource' as const,
    relationship: 'recipient' as const,
    name: 'Shared client secret',
    kind: 'apiKey' as const,
    ownerAccountId: 'owner-account',
    revision: 3,
    materialStatus: 'ready' as const,
    capabilities: { use: true, rename: false, rotate: false, manageAccess: false, delete: false },
  },
  storedContent: sealSavedSecretResourceStoredContentV1({
    resourceId,
    mode: 'plain',
    content: { v: 1, name: 'Shared client secret', kind: 'apiKey', value: 'shared-client-secret' },
  }),
  recipientEnvelope: null,
};
const teamsEnabled = FeaturesResponseSchema.parse({ features: { teams: { enabled: true } }, capabilities: {} });

function createConfigurationOwner() {
  const persistence = createQualifiedConnectedAccountDaemonPersistence({
    credentials: { token, encryption: null },
    getAccountEncryptionMode: vi.fn(async (): Promise<'plain'> => 'plain'),
    readCredential: vi.fn(async () => null),
    readConfiguration: vi.fn(async () => null),
    mutateCredential: vi.fn(),
    mutateConfiguration: vi.fn(),
    secrets: createActiveAccountSettingsConnectedAccountSecrets({ expectedScopeKey: scopeKey }),
  });
  return createConnectedAccountConfigurationOwner({
    ...persistence.configuration,
    isRuntimeCurrent: () => true,
  });
}

describe('Connected Account service configuration admits its shared Saved Secret refs', () => {
  beforeEach(() => {
    resetActiveAccountSettingsSnapshotForTests();
    vi.mocked(axios.get).mockReset();
    persistenceMocks.readStoredCredentials.mockReset();
    persistenceMocks.readStoredCredentials.mockResolvedValue({ token, encryption: null });
    setActiveAccountSettingsSnapshot({
      source: 'network',
      settings: AccountSettingsSchema.parse({
        [CONNECTED_ACCOUNT_SERVICE_CONFIGURATIONS_SETTINGS_KEY]: {
          v: 1,
          entries: [{
            service,
            modeId: 'oauth',
            revision: 'configuration-1',
            values: { endpoint: 'https://api.example.test' },
            secretRefs: { clientSecret: sharedRef },
          }],
        },
      }),
      settingsVersion: 1,
      loadedAtMs: 1,
      settingsSecretsReadKeys: [],
      scopeKey,
    });
  });

  afterEach(() => {
    resetActiveAccountSettingsSnapshotForTests();
  });

  it('refuses a new operation after a revocation whose AccountChange hint was missed', async () => {
    vi.mocked(axios.get).mockResolvedValue({ status: 200, data: { resources: [sharedRow] } });
    await hydrateSavedSecretCatalog({ token, serverFeatures: teamsEnabled });
    // The Home revokes the grant; the daemon never receives the hint.
    vi.mocked(axios.get).mockResolvedValue({ status: 200, data: { resources: [] } });

    await expect(createConfigurationOwner().admit({
      intent: 'connect',
      service,
      mode,
      ...generation,
    })).rejects.toBeInstanceOf(ConnectedAccountConfigurationError);
    expect(axios.get).toHaveBeenCalledTimes(2);
  });

  it('admits a still-authorized ref without waking any Account Settings consumer', async () => {
    vi.mocked(axios.get).mockResolvedValue({ status: 200, data: { resources: [sharedRow] } });
    await hydrateSavedSecretCatalog({ token, serverFeatures: teamsEnabled });
    const publications = vi.fn();
    const unsubscribe = subscribeActiveAccountSettingsSnapshot(publications);
    try {
      const admitted = await createConfigurationOwner().admit({
        intent: 'connect',
        service,
        mode,
        ...generation,
      });

      if (admitted.status !== 'ready') throw new Error(`expected ready admission, got ${admitted.status}`);
      await expect(admitted.snapshot.getSecret('clientSecret')).resolves.toBe('shared-client-secret');
      expect(axios.get).toHaveBeenCalledTimes(2);
      // Admission re-observed an unchanged catalog, so no purpose watch or
      // direct reconciler is woken by the operation's own admission.
      expect(publications).not.toHaveBeenCalled();
    } finally {
      unsubscribe();
    }
  });
});
