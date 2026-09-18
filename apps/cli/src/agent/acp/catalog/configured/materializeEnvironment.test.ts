import { describe, expect, it } from 'vitest';
import {
  encryptSecretStringV1,
  sealSavedSecretResourceStoredContentV1,
  type SavedSecret,
  type SavedSecretCatalogResourceV1,
} from '@happier-dev/protocol';

import { deriveSettingsSecretsKeyForCredentials } from '@/settings/secrets/settingsSecretsKey';
import type { Credentials, TokenOnlyCredentials } from '@/persistence';
import type { SavedSecretCatalogResourceInputV1 } from '@/settings/secrets/savedSecretCatalog';

import type { ResolvedConfiguredAcpBackend } from './resolveBackend';
import { materializeConfiguredAcpEnvironment } from './materializeEnvironment';

function backend(secretId: string): ResolvedConfiguredAcpBackend {
  return {
    backendId: 'plain-acp',
    source: { kind: 'account_configured' },
    name: 'plain-acp',
    title: 'Plain ACP',
    command: 'plain-acp',
    args: [],
    env: {
      ACP_TOKEN: { t: 'savedSecret', secretId },
    },
    capabilities: {
      supportsLoadSession: false,
      supportsModes: 'unknown',
      supportsModels: 'unknown',
      supportsConfigOptions: 'unknown',
      promptImageSupport: 'unknown',
    },
  };
}

function savedSecret(encryptedValue: SavedSecret['encryptedValue']): SavedSecret {
  return {
    id: 'secret-acp',
    name: 'ACP token',
    kind: 'token',
    encryptedValue,
    createdAt: 1,
    updatedAt: 1,
  };
}

describe('materializeConfiguredAcpEnvironment', () => {
  it.each([
    ['missing', 'personal_missing', null],
    ['temporarily_unavailable', 'happier:shared-secret:v1:resource_1', 'temporarily_unavailable'],
    ['forbidden', 'happier:shared-secret:v1:resource_1', 'access_removed'],
    ['repair_required', 'happier:shared-secret:v1:resource_1', 'update_required'],
    ['deleted', 'happier:shared-secret:v1:resource_1', 'deleted'],
    ['mode_incompatible', 'happier:shared-secret:v1:resource_1', 'recipient_mode_unsupported'],
    ['corrupt', 'happier:shared-secret:v1:resource_1', 'ready'],
  ] as const)('preserves Saved Secret status %s in configured ACP launch failures', (
    expectedStatus,
    secretId,
    materialStatus,
  ) => {
    const savedSecretResources: SavedSecretCatalogResourceInputV1[] = materialStatus === null ? [] : [{
      resourceId: 'resource_1',
      ownerAccountId: 'owner',
      displayName: 'shared',
      kind: 'token',
      encryptionMode: 'plain',
      revision: 1,
      materialStatus: materialStatus satisfies SavedSecretCatalogResourceV1['materialStatus'],
      storedContent: materialStatus === 'ready' ? null : sealSavedSecretResourceStoredContentV1({
        resourceId: 'resource_1',
        mode: 'plain',
        content: { v: 1, name: 'shared', kind: 'token', value: 'unused' },
      }),
    }];

    try {
      materializeConfiguredAcpEnvironment({
        backend: backend(secretId),
        accountSettings: {},
        credentials: { token: 'plain-account', encryption: null },
        processEnv: {},
        savedSecretResources,
      });
      throw new Error('expected configured ACP materialization to fail');
    } catch (error) {
      expect(error).toMatchObject({
        code: 'saved_secret_resolution_failed',
        status: expectedStatus,
        consumer: 'acp',
        field: 'env:ACP_TOKEN',
      });
    }
  });

  it('reads plaintext Saved Secrets with token-only credentials and no fabricated key', () => {
    const credentials: TokenOnlyCredentials = {
      token: 'token-only',
      encryption: null,
    };

    expect(materializeConfiguredAcpEnvironment({
      backend: backend('secret-acp'),
      accountSettings: {
        secrets: [savedSecret({ _isSecretValue: true, value: 'plain-account-secret' })],
      },
      credentials,
      processEnv: {},
    })).toEqual({
      ACP_TOKEN: 'plain-account-secret',
    });
  });

  it('keeps encrypted Saved Secrets unavailable without their real E2EE material', () => {
    const e2eeCredentials: Credentials = {
      token: 'e2ee',
      encryption: { type: 'legacy', secret: new Uint8Array(32).fill(5) },
    };
    const encryptedValue = encryptSecretStringV1(
      'retained-e2ee-secret',
      deriveSettingsSecretsKeyForCredentials(e2eeCredentials),
      (length) => new Uint8Array(length).fill(2),
    );
    const accountSettings = {
      secrets: [savedSecret({ _isSecretValue: true, encryptedValue })],
    };

    try {
      materializeConfiguredAcpEnvironment({
        backend: backend('secret-acp'),
        accountSettings,
        credentials: { token: 'token-only', encryption: null },
        processEnv: {},
      });
      throw new Error('expected configured ACP materialization to fail');
    } catch (error) {
      expect(error).toMatchObject({ status: 'temporarily_unavailable', consumer: 'acp' });
    }
    expect(accountSettings.secrets[0]?.encryptedValue).toEqual({
      _isSecretValue: true,
      encryptedValue,
    });
  });

  it('materializes a shared Saved Secret through the configured ACP launch owner', () => {
    const resourceId = 'shared-acp-resource';
    const secretId = `happier:shared-secret:v1:${resourceId}`;

    expect(materializeConfiguredAcpEnvironment({
      backend: backend(secretId),
      accountSettings: {},
      credentials: { token: 'plain-account', encryption: null },
      processEnv: {},
      savedSecretResources: [{
        resourceId,
        ownerAccountId: 'owner-account',
        displayName: 'Shared ACP token',
        kind: 'token',
        encryptionMode: 'plain',
        revision: 4,
        materialStatus: 'ready',
        storedContent: sealSavedSecretResourceStoredContentV1({
          resourceId,
          mode: 'plain',
          content: { v: 1, name: 'Shared ACP token', kind: 'token', value: 'shared-acp-token' },
        }),
      }],
    })).toEqual({ ACP_TOKEN: 'shared-acp-token' });
  });
});
