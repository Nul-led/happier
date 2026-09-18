import axios from 'axios';
import tweetnacl from 'tweetnacl';
import {
  AccountSettingsSchema,
  ENCRYPTED_DATA_KEY_ENVELOPE_V1_BYTES,
  encryptSecretStringV1,
  FeaturesResponseSchema,
  formatSavedSecretCatalogReferenceV1,
  sealEncryptedDataKeyEnvelopeV1,
  sealSavedSecretResourceStoredContentV1,
} from '@happier-dev/protocol';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  getActiveAccountSettingsSnapshot,
  resetActiveAccountSettingsSnapshotForTests,
  setActiveAccountSettingsSnapshot,
} from '@/settings/accountSettings/activeAccountSettingsSnapshot';
import { resolveAccountSettingsScopeKeyForToken } from '@/settings/accountSettings/accountSettingsScopeKey';
import { createSavedSecretMaterializerFromSnapshotV1 } from './savedSecretCatalog';
import {
  hydrateSavedSecretCatalog,
  refreshSavedSecretCatalogForOperation,
} from './hydrateSavedSecretCatalog';

vi.mock('axios', () => ({
  default: { get: vi.fn() },
}));

const persistenceMocks = vi.hoisted(() => ({
  readStoredCredentials: vi.fn(),
}));
const featureMocks = vi.hoisted(() => ({
  fetchServerFeaturesSnapshot: vi.fn(async () => ({
    status: 'ready' as const,
    features: {
      features: { teams: { enabled: true, credentialResources: { enabled: false, externalApi: { enabled: false } } } },
      capabilities: {},
    },
  })),
}));

vi.mock('@/persistence', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/persistence')>(),
  readStoredCredentials: persistenceMocks.readStoredCredentials,
}));

vi.mock('@/features/serverFeaturesClient', () => featureMocks);

describe('Saved Secret catalog hydration', () => {
  const serverFeatures = (teamsEnabled: boolean, credentialResourcesEnabled = false) => FeaturesResponseSchema.parse({
    features: {
      teams: {
        enabled: teamsEnabled,
        credentialResources: { enabled: credentialResourcesEnabled },
      },
    },
    capabilities: {},
  });

  beforeEach(() => {
    resetActiveAccountSettingsSnapshotForTests();
    vi.mocked(axios.get).mockReset();
    persistenceMocks.readStoredCredentials.mockReset();
    persistenceMocks.readStoredCredentials.mockResolvedValue(null);
    featureMocks.fetchServerFeaturesSnapshot.mockClear();
  });

  afterEach(() => {
    resetActiveAccountSettingsSnapshotForTests();
  });

  it('hydrates under the Teams master feature even when credential resources are disabled', async () => {
    const token = 'account-token';
    const resourceId = 'resource-1';
    const ref = formatSavedSecretCatalogReferenceV1({ kind: 'shared_resource', id: resourceId });
    const storedContent = sealSavedSecretResourceStoredContentV1({
      resourceId,
      mode: 'plain',
      content: {
        v: 1,
        name: 'Shared API key',
        kind: 'apiKey',
        value: 'provider-secret',
      },
    });
    setActiveAccountSettingsSnapshot({
      source: 'network',
      settings: AccountSettingsSchema.parse({}),
      settingsVersion: 1,
      loadedAtMs: 1,
      settingsSecretsReadKeys: [],
      scopeKey: resolveAccountSettingsScopeKeyForToken(token),
    });
    vi.mocked(axios.get).mockResolvedValue({
      status: 200,
      data: {
        resources: [{
          resourceId,
          encryptionMode: 'plain',
          entry: {
            ref,
            source: 'shared_resource',
            relationship: 'recipient',
            name: 'Shared API key',
            kind: 'apiKey',
            ownerAccountId: 'owner-account',
            revision: 4,
            materialStatus: 'ready',
            capabilities: {
              use: true,
              rename: false,
              rotate: false,
              manageAccess: false,
              delete: false,
            },
          },
          storedContent,
          recipientEnvelope: null,
        }],
      },
    });

    await hydrateSavedSecretCatalog({ token, serverFeatures: serverFeatures(true, false) });

    const snapshot = getActiveAccountSettingsSnapshot();
    if (!snapshot) throw new Error('expected active Account snapshot');
    expect(createSavedSecretMaterializerFromSnapshotV1(snapshot).resolve(ref)).toEqual({
      status: 'ready',
      value: 'provider-secret',
      fingerprint: expect.stringMatching(/^saved-secret-record:v1:/u),
      source: 'shared_resource',
    });
  });

  it('preserves an authorized repair status when the server intentionally withholds material', async () => {
    const token = 'account-token';
    const resourceId = 'resource-needs-repair';
    const ref = formatSavedSecretCatalogReferenceV1({ kind: 'shared_resource', id: resourceId });
    setActiveAccountSettingsSnapshot({
      source: 'network',
      settings: AccountSettingsSchema.parse({}),
      settingsVersion: 1,
      loadedAtMs: 1,
      settingsSecretsReadKeys: [],
      scopeKey: resolveAccountSettingsScopeKeyForToken(token),
    });
    vi.mocked(axios.get).mockResolvedValue({
      status: 200,
      data: {
        resources: [{
          resourceId,
          encryptionMode: 'e2ee',
          entry: {
            ref,
            source: 'shared_resource',
            relationship: 'recipient',
            name: 'Shared token',
            kind: 'token',
            ownerAccountId: 'owner-account',
            revision: 7,
            materialStatus: 'update_required',
            capabilities: {
              use: true,
              rename: false,
              rotate: false,
              manageAccess: false,
              delete: false,
            },
          },
          storedContent: null,
          recipientEnvelope: null,
        }],
      },
    });

    await hydrateSavedSecretCatalog({ token, serverFeatures: serverFeatures(true) });

    const snapshot = getActiveAccountSettingsSnapshot();
    if (!snapshot) throw new Error('expected active Account snapshot');
    expect(createSavedSecretMaterializerFromSnapshotV1(snapshot).resolve(ref)).toEqual({
      status: 'repair_required',
    });
  });

  it('keeps owner and recipient corrupt catalog entries out of material inputs', async () => {
    const token = 'account-token';
    const resourceId = 'resource-healthy';
    const ref = formatSavedSecretCatalogReferenceV1({ kind: 'shared_resource', id: resourceId });
    const storedContent = sealSavedSecretResourceStoredContentV1({
      resourceId,
      mode: 'plain',
      content: {
        v: 1,
        name: 'Healthy API key',
        kind: 'apiKey',
        value: 'provider-secret',
      },
    });
    setActiveAccountSettingsSnapshot({
      source: 'network',
      settings: AccountSettingsSchema.parse({}),
      settingsVersion: 1,
      loadedAtMs: 1,
      settingsSecretsReadKeys: [],
      scopeKey: resolveAccountSettingsScopeKeyForToken(token),
    });
    vi.mocked(axios.get).mockResolvedValue({
      status: 200,
      data: {
        resources: [{
          entry: {
            materialStatus: 'resource_corrupt',
            relationship: 'owner',
            repair: {
              kind: 'delete_resource',
              resourceId: 'malformed retained resource id',
              expectedRevision: 9,
            },
          },
        }, {
          entry: {
            materialStatus: 'resource_corrupt',
            relationship: 'recipient',
            repair: null,
          },
        }, {
          resourceId,
          encryptionMode: 'plain',
          entry: {
            ref,
            source: 'shared_resource',
            relationship: 'recipient',
            name: 'Healthy API key',
            kind: 'apiKey',
            ownerAccountId: 'owner-account',
            revision: 4,
            materialStatus: 'ready',
            capabilities: {
              use: true,
              rename: false,
              rotate: false,
              manageAccess: false,
              delete: false,
            },
          },
          storedContent,
          recipientEnvelope: null,
        }],
      },
    });

    const hydrated = await hydrateSavedSecretCatalog({ token, serverFeatures: serverFeatures(true) });

    expect(hydrated.resources.map((resource) => resource.resourceId)).toEqual([resourceId]);
    const snapshot = getActiveAccountSettingsSnapshot();
    if (!snapshot) throw new Error('expected active Account snapshot');
    expect(createSavedSecretMaterializerFromSnapshotV1(snapshot).resolve(ref)).toMatchObject({
      status: 'ready',
      value: 'provider-secret',
    });
  });

  it('keeps healthy rows usable when one recipient envelope cannot be opened', async () => {
    const token = 'account-token';
    const encryptedResourceId = 'resource-invalid-envelope';
    const plainResourceId = 'resource-healthy';
    const encryptedRef = formatSavedSecretCatalogReferenceV1({ kind: 'shared_resource', id: encryptedResourceId });
    const plainRef = formatSavedSecretCatalogReferenceV1({ kind: 'shared_resource', id: plainResourceId });
    const accountMachineKey = new Uint8Array(32).fill(7);
    persistenceMocks.readStoredCredentials.mockResolvedValue({
      token,
      encryption: {
        type: 'dataKey',
        machineKey: accountMachineKey,
        publicKey: new Uint8Array(32).fill(8),
      },
    });
    setActiveAccountSettingsSnapshot({
      source: 'network',
      settings: AccountSettingsSchema.parse({}),
      settingsVersion: 1,
      loadedAtMs: 1,
      settingsSecretsReadKeys: [],
      scopeKey: resolveAccountSettingsScopeKeyForToken(token),
    });
    vi.mocked(axios.get).mockResolvedValue({
      status: 200,
      data: {
        resources: [{
          resourceId: encryptedResourceId,
          encryptionMode: 'e2ee',
          entry: {
            ref: encryptedRef,
            source: 'shared_resource',
            relationship: 'recipient',
            name: 'Unavailable token',
            kind: 'token',
            ownerAccountId: 'owner-account',
            revision: 2,
            materialStatus: 'ready',
            capabilities: {
              use: true,
              rename: false,
              rotate: false,
              manageAccess: false,
              delete: false,
            },
          },
          storedContent: sealSavedSecretResourceStoredContentV1({
            resourceId: encryptedResourceId,
            mode: 'e2ee',
            resourceDataKey: new Uint8Array(32).fill(11),
            randomBytes: (length) => new Uint8Array(length).fill(12),
            content: { v: 1, name: 'Unavailable token', kind: 'token', value: 'must-not-open' },
          }),
          recipientEnvelope: {
            encryptedDataKey: Buffer.alloc(ENCRYPTED_DATA_KEY_ENVELOPE_V1_BYTES).toString('base64'),
            recipientContentPublicKeyFingerprint: 'content-fingerprint',
          },
        }, {
          resourceId: plainResourceId,
          encryptionMode: 'plain',
          entry: {
            ref: plainRef,
            source: 'shared_resource',
            relationship: 'recipient',
            name: 'Healthy API key',
            kind: 'apiKey',
            ownerAccountId: 'owner-account',
            revision: 3,
            materialStatus: 'ready',
            capabilities: {
              use: true,
              rename: false,
              rotate: false,
              manageAccess: false,
              delete: false,
            },
          },
          storedContent: sealSavedSecretResourceStoredContentV1({
            resourceId: plainResourceId,
            mode: 'plain',
            content: { v: 1, name: 'Healthy API key', kind: 'apiKey', value: 'healthy-value' },
          }),
          recipientEnvelope: null,
        }],
      },
    });

    await hydrateSavedSecretCatalog({ token, serverFeatures: serverFeatures(true) });

    const snapshot = getActiveAccountSettingsSnapshot();
    if (!snapshot) throw new Error('expected active Account snapshot');
    const materializer = createSavedSecretMaterializerFromSnapshotV1(snapshot);
    expect(materializer.resolve(encryptedRef)).toEqual({ status: 'temporarily_unavailable' });
    expect(materializer.resolve(plainRef)).toMatchObject({
      status: 'ready',
      value: 'healthy-value',
      source: 'shared_resource',
    });
  });

  it('fails stale shared material closed while preserving it for a retryable refresh', async () => {
    const token = 'account-token';
    const resourceId = 'resource-revoked-during-refresh';
    const ref = formatSavedSecretCatalogReferenceV1({ kind: 'shared_resource', id: resourceId });
    const storedContent = sealSavedSecretResourceStoredContentV1({
      resourceId,
      mode: 'plain',
      content: {
        v: 1,
        name: 'Shared API key',
        kind: 'apiKey',
        value: 'stale-provider-secret',
      },
    });
    setActiveAccountSettingsSnapshot({
      source: 'network',
      settings: AccountSettingsSchema.parse({}),
      settingsVersion: 1,
      loadedAtMs: 1,
      settingsSecretsReadKeys: [],
      scopeKey: resolveAccountSettingsScopeKeyForToken(token),
      savedSecretCatalogState: 'ready',
      savedSecretResources: [{
        resourceId,
        ownerAccountId: 'owner-account',
        displayName: 'Shared API key',
        kind: 'apiKey',
        encryptionMode: 'plain',
        revision: 4,
        storedContent,
        materialStatus: 'ready',
      }],
    });
    vi.mocked(axios.get).mockRejectedValue(new Error('network unavailable'));

    await expect(hydrateSavedSecretCatalog({ token, serverFeatures: serverFeatures(true) }))
      .rejects.toThrow('network unavailable');

    const snapshot = getActiveAccountSettingsSnapshot();
    if (!snapshot) throw new Error('expected active Account snapshot');
    expect(snapshot.savedSecretCatalogState).toBe('temporarily_unavailable');
    expect(snapshot.savedSecretResources).toHaveLength(1);
    expect(snapshot.savedSecretResources?.[0]?.storedContent).toBeNull();
    expect(createSavedSecretMaterializerFromSnapshotV1(snapshot).resolve(ref)).toEqual({
      status: 'temporarily_unavailable',
    });
  });

  it('withdraws and zeroes an opened resource DEK when refresh loses authoritative observation', async () => {
    const token = 'account-token';
    const resourceDataKey = new Uint8Array(32).fill(19);
    setActiveAccountSettingsSnapshot({
      source: 'network',
      settings: AccountSettingsSchema.parse({}),
      settingsVersion: 1,
      loadedAtMs: 1,
      settingsSecretsReadKeys: [],
      scopeKey: resolveAccountSettingsScopeKeyForToken(token),
      savedSecretCatalogState: 'ready',
      savedSecretResources: [{
        resourceId: 'resource-e2ee',
        ownerAccountId: 'owner-account',
        displayName: 'Shared API key',
        kind: 'apiKey',
        encryptionMode: 'e2ee',
        revision: 4,
        storedContent: { t: 'encrypted', c: 'AA==' },
        materialStatus: 'ready',
        resourceDataKey,
      }],
    });
    vi.mocked(axios.get).mockRejectedValue(new Error('observer gap'));

    await expect(hydrateSavedSecretCatalog({ token, serverFeatures: serverFeatures(true) }))
      .rejects.toThrow('observer gap');

    const snapshot = getActiveAccountSettingsSnapshot();
    if (!snapshot) throw new Error('expected active Account snapshot');
    expect(snapshot.savedSecretResources?.[0]?.resourceDataKey).toBeUndefined();
    expect([...resourceDataKey]).toEqual(new Array(32).fill(0));
  });

  it('clears shared material without affecting personal Saved Secrets when Teams is disabled', async () => {
    const token = 'account-token';
    const settingsKey = new Uint8Array(32).fill(17);
    const resourceDataKey = new Uint8Array(32).fill(23);
    setActiveAccountSettingsSnapshot({
      source: 'network',
      settings: AccountSettingsSchema.parse({
        secrets: [{
          id: 'personal-secret',
          name: 'Personal token',
          kind: 'token',
          encryptedValue: {
            _isSecretValue: true,
            encryptedValue: encryptSecretStringV1(
              'personal-value',
              settingsKey,
              (length) => new Uint8Array(length).fill(18),
            ),
          },
          createdAt: 1,
          updatedAt: 1,
        }],
      }),
      settingsVersion: 1,
      loadedAtMs: 1,
      settingsSecretsReadKeys: [settingsKey],
      scopeKey: resolveAccountSettingsScopeKeyForToken(token),
      savedSecretCatalogState: 'ready',
      savedSecretResources: [{
        resourceId: 'resource-e2ee',
        ownerAccountId: 'owner-account',
        displayName: 'Shared token',
        kind: 'token',
        encryptionMode: 'e2ee',
        revision: 4,
        storedContent: { t: 'encrypted', c: 'AA==' },
        materialStatus: 'ready',
        resourceDataKey,
      }],
    });

    const hydrated = await hydrateSavedSecretCatalog({
      token,
      serverFeatures: serverFeatures(false, true),
    });

    expect(hydrated).toEqual({ resources: [], state: 'disabled' });
    expect(axios.get).not.toHaveBeenCalled();
    const snapshot = getActiveAccountSettingsSnapshot();
    if (!snapshot) throw new Error('expected active Account snapshot');
    expect(snapshot.savedSecretCatalogState).toBe('disabled');
    expect(snapshot.savedSecretResources).toEqual([]);
    expect([...resourceDataKey]).toEqual(new Array(32).fill(0));
    expect(createSavedSecretMaterializerFromSnapshotV1(snapshot).resolve('personal-secret')).toMatchObject({
      status: 'ready',
      value: 'personal-value',
      source: 'personal',
    });
  });

  it('refreshes shared references at operation admission so a missed invalidation cannot use revoked material', async () => {
    const token = 'account-token';
    const resourceId = 'resource-revoked-without-change-hint';
    const ref = formatSavedSecretCatalogReferenceV1({ kind: 'shared_resource', id: resourceId });
    setActiveAccountSettingsSnapshot({
      source: 'network',
      settings: AccountSettingsSchema.parse({}),
      settingsVersion: 1,
      loadedAtMs: 1,
      settingsSecretsReadKeys: [],
      scopeKey: resolveAccountSettingsScopeKeyForToken(token),
      savedSecretCatalogState: 'ready',
      savedSecretResources: [{
        resourceId,
        ownerAccountId: 'owner-account',
        displayName: 'Revoked shared key',
        kind: 'apiKey',
        encryptionMode: 'plain',
        revision: 4,
        storedContent: sealSavedSecretResourceStoredContentV1({
          resourceId,
          mode: 'plain',
          content: { v: 1, name: 'Revoked shared key', kind: 'apiKey', value: 'stale-value' },
        }),
        materialStatus: 'ready',
      }],
    });
    persistenceMocks.readStoredCredentials.mockResolvedValue({ token, encryption: null });
    vi.mocked(axios.get).mockResolvedValue({ status: 200, data: { resources: [] } });
    const overlay = {
      v: 1 as const,
      bindings: { API_KEY: { ref, revision: 4 } },
    };

    await expect(refreshSavedSecretCatalogForOperation({
      expectedScopeKey: resolveAccountSettingsScopeKeyForToken(token),
      secretReferenceOverlay: overlay,
    })).rejects.toMatchObject({
      reason: 'reference_stale',
      reference: ref,
    });

    expect(axios.get).toHaveBeenCalledTimes(1);
  });

  it('does not contact the shared catalog for a personal-only operation overlay', async () => {
    const token = 'account-token';
    setActiveAccountSettingsSnapshot({
      source: 'network',
      settings: AccountSettingsSchema.parse({}),
      settingsVersion: 1,
      loadedAtMs: 1,
      settingsSecretsReadKeys: [],
      scopeKey: resolveAccountSettingsScopeKeyForToken(token),
    });
    persistenceMocks.readStoredCredentials.mockResolvedValue({ token, encryption: null });

    await expect(refreshSavedSecretCatalogForOperation({
      expectedScopeKey: resolveAccountSettingsScopeKeyForToken(token),
      secretReferenceOverlay: {
        v: 1,
        bindings: { API_KEY: { ref: 'personal-secret' } },
      },
    })).resolves.toMatchObject({ settingsVersion: 1 });

    expect(axios.get).not.toHaveBeenCalled();
  });

  it('keeps a legacy colliding Profile reference personal before rekey', async () => {
    const token = 'account-token';
    const ref = 'happier:shared-secret:v1:legacy-personal';
    setActiveAccountSettingsSnapshot({
      source: 'network',
      settings: AccountSettingsSchema.parse({
        secrets: [{
          id: ref, name: 'Legacy personal', kind: 'token', updatedAt: 7,
          createdAt: 1,
          encryptedValue: { _isSecretValue: true, value: 'exact-personal-value' },
        }],
      }),
      settingsVersion: 1,
      loadedAtMs: 1,
      settingsSecretsReadKeys: [],
      scopeKey: resolveAccountSettingsScopeKeyForToken(token),
    });

    const refreshed = await refreshSavedSecretCatalogForOperation({
      expectedScopeKey: resolveAccountSettingsScopeKeyForToken(token),
      references: [{ ref }],
    });

    expect(createSavedSecretMaterializerFromSnapshotV1(refreshed).resolve(ref)).toMatchObject({
      status: 'ready',
      value: 'exact-personal-value',
      source: 'personal',
    });
    expect(axios.get).not.toHaveBeenCalled();
  });

  it('refuses a shared operation that collides with an extant personal record until rekey', async () => {
    const token = 'account-token';
    const ref = 'happier:shared-secret:v1:legacy-personal';
    setActiveAccountSettingsSnapshot({
      source: 'network',
      settings: AccountSettingsSchema.parse({
        secrets: [{
          id: ref, name: 'Legacy personal', kind: 'token', updatedAt: 7,
          createdAt: 1,
          encryptedValue: { _isSecretValue: true, value: 'exact-personal-value' },
        }],
      }),
      settingsVersion: 1,
      loadedAtMs: 1,
      settingsSecretsReadKeys: [],
      scopeKey: resolveAccountSettingsScopeKeyForToken(token),
    });

    await expect(refreshSavedSecretCatalogForOperation({
      expectedScopeKey: resolveAccountSettingsScopeKeyForToken(token),
      references: [{ ref, revision: 1 }],
    })).rejects.toMatchObject({
      reason: 'reference_collision_migration_required',
      reference: ref,
    });
    expect(axios.get).not.toHaveBeenCalled();
  });

  it('rejects freshly hydrated shared material whose authenticated content cannot be opened', async () => {
    const token = 'account-token';
    const resourceId = 'resource-corrupt-content';
    const ref = formatSavedSecretCatalogReferenceV1({ kind: 'shared_resource', id: resourceId });
    const accountMachineKey = new Uint8Array(32).fill(7);
    const accountPublicKey = tweetnacl.box.keyPair.fromSecretKey(accountMachineKey).publicKey;
    const resourceDataKey = new Uint8Array(32).fill(11);
    const storedContent = sealSavedSecretResourceStoredContentV1({
      resourceId,
      mode: 'e2ee',
      resourceDataKey,
      randomBytes: (length) => new Uint8Array(length).fill(12),
      content: { v: 1, name: 'Corrupt token', kind: 'token', value: 'must-not-open' },
    });
    if (storedContent.t !== 'encrypted') throw new Error('expected encrypted Saved Secret fixture');
    const corruptedBytes = Buffer.from(storedContent.c, 'base64');
    corruptedBytes[corruptedBytes.length - 1] ^= 1;
    setActiveAccountSettingsSnapshot({
      source: 'network',
      settings: AccountSettingsSchema.parse({}),
      settingsVersion: 1,
      loadedAtMs: 1,
      settingsSecretsReadKeys: [],
      scopeKey: resolveAccountSettingsScopeKeyForToken(token),
    });
    persistenceMocks.readStoredCredentials.mockResolvedValue({
      token,
      encryption: {
        type: 'dataKey',
        machineKey: accountMachineKey,
        publicKey: accountPublicKey,
      },
    });
    vi.mocked(axios.get).mockResolvedValue({
      status: 200,
      data: {
        resources: [{
          resourceId,
          encryptionMode: 'e2ee',
          entry: {
            ref,
            source: 'shared_resource',
            relationship: 'recipient',
            name: 'Corrupt token',
            kind: 'token',
            ownerAccountId: 'owner-account',
            revision: 3,
            materialStatus: 'ready',
            capabilities: {
              use: true,
              rename: false,
              rotate: false,
              manageAccess: false,
              delete: false,
            },
          },
          storedContent: { t: 'encrypted', c: corruptedBytes.toString('base64') },
          recipientEnvelope: {
            encryptedDataKey: Buffer.from(sealEncryptedDataKeyEnvelopeV1({
              dataKey: resourceDataKey,
              recipientPublicKey: accountPublicKey,
              randomBytes: (length) => new Uint8Array(length).fill(13),
            })).toString('base64'),
            recipientContentPublicKeyFingerprint: 'content-fingerprint',
          },
        }],
      },
    });

    await expect(refreshSavedSecretCatalogForOperation({
      expectedScopeKey: resolveAccountSettingsScopeKeyForToken(token),
      references: [{ ref, revision: 3 }],
    })).rejects.toMatchObject({
      reason: 'reference_missing',
      reference: ref,
    });
  });

  it('rejects freshly hydrated shared material whose authenticated metadata disagrees with its catalog row', async () => {
    const token = 'account-token';
    const resourceId = 'resource-mismatched-content';
    const ref = formatSavedSecretCatalogReferenceV1({ kind: 'shared_resource', id: resourceId });
    setActiveAccountSettingsSnapshot({
      source: 'network',
      settings: AccountSettingsSchema.parse({}),
      settingsVersion: 1,
      loadedAtMs: 1,
      settingsSecretsReadKeys: [],
      scopeKey: resolveAccountSettingsScopeKeyForToken(token),
    });
    persistenceMocks.readStoredCredentials.mockResolvedValue({ token, encryption: null });
    vi.mocked(axios.get).mockResolvedValue({
      status: 200,
      data: {
        resources: [{
          resourceId,
          encryptionMode: 'plain',
          entry: {
            ref,
            source: 'shared_resource',
            relationship: 'recipient',
            name: 'Catalog API key',
            kind: 'apiKey',
            ownerAccountId: 'owner-account',
            revision: 5,
            materialStatus: 'ready',
            capabilities: {
              use: true,
              rename: false,
              rotate: false,
              manageAccess: false,
              delete: false,
            },
          },
          storedContent: sealSavedSecretResourceStoredContentV1({
            resourceId,
            mode: 'plain',
            content: { v: 1, name: 'Different token', kind: 'token', value: 'must-not-open' },
          }),
          recipientEnvelope: null,
        }],
      },
    });

    await expect(refreshSavedSecretCatalogForOperation({
      expectedScopeKey: resolveAccountSettingsScopeKeyForToken(token),
      references: [{ ref, revision: 5 }],
    })).rejects.toMatchObject({
      reason: 'reference_missing',
      reference: ref,
    });
  });

  it('admits freshly hydrated shared material whose value is whitespace', async () => {
    const token = 'account-token';
    const resourceId = 'resource-whitespace-value';
    const ref = formatSavedSecretCatalogReferenceV1({ kind: 'shared_resource', id: resourceId });
    setActiveAccountSettingsSnapshot({
      source: 'network',
      settings: AccountSettingsSchema.parse({}),
      settingsVersion: 1,
      loadedAtMs: 1,
      settingsSecretsReadKeys: [],
      scopeKey: resolveAccountSettingsScopeKeyForToken(token),
    });
    persistenceMocks.readStoredCredentials.mockResolvedValue({ token, encryption: null });
    vi.mocked(axios.get).mockResolvedValue({
      status: 200,
      data: {
        resources: [{
          resourceId,
          encryptionMode: 'plain',
          entry: {
            ref,
            source: 'shared_resource',
            relationship: 'recipient',
            name: 'Whitespace token',
            kind: 'token',
            ownerAccountId: 'owner-account',
            revision: 8,
            materialStatus: 'ready',
            capabilities: {
              use: true,
              rename: false,
              rotate: false,
              manageAccess: false,
              delete: false,
            },
          },
          storedContent: sealSavedSecretResourceStoredContentV1({
            resourceId,
            mode: 'plain',
            content: { v: 1, name: 'Whitespace token', kind: 'token', value: ' \t\n ' },
          }),
          recipientEnvelope: null,
        }],
      },
    });

    const refreshed = await refreshSavedSecretCatalogForOperation({
      expectedScopeKey: resolveAccountSettingsScopeKeyForToken(token),
      references: [{ ref, revision: 8 }],
    });

    expect(createSavedSecretMaterializerFromSnapshotV1(refreshed).resolve(ref)).toMatchObject({
      status: 'ready',
      value: ' \t\n ',
    });
  });

  it('admits a current persisted Profile shared reference without requiring an overlay revision', async () => {
    const token = 'account-token';
    const resourceId = 'resource-profile-current';
    const ref = formatSavedSecretCatalogReferenceV1({ kind: 'shared_resource', id: resourceId });
    const storedContent = sealSavedSecretResourceStoredContentV1({
      resourceId,
      mode: 'plain',
      content: {
        v: 1,
        name: 'Current Profile key',
        kind: 'apiKey',
        value: 'current-value',
      },
    });
    setActiveAccountSettingsSnapshot({
      source: 'network',
      settings: AccountSettingsSchema.parse({}),
      settingsVersion: 1,
      loadedAtMs: 1,
      settingsSecretsReadKeys: [],
      scopeKey: resolveAccountSettingsScopeKeyForToken(token),
    });
    persistenceMocks.readStoredCredentials.mockResolvedValue({ token, encryption: null });
    vi.mocked(axios.get).mockResolvedValue({
      status: 200,
      data: {
        resources: [{
          resourceId,
          encryptionMode: 'plain',
          entry: {
            ref,
            source: 'shared_resource',
            relationship: 'recipient',
            name: 'Current Profile key',
            kind: 'apiKey',
            ownerAccountId: 'owner-account',
            revision: 9,
            materialStatus: 'ready',
            capabilities: {
              use: true,
              rename: false,
              rotate: false,
              manageAccess: false,
              delete: false,
            },
          },
          storedContent,
          recipientEnvelope: null,
        }],
      },
    });

    const refreshed = await refreshSavedSecretCatalogForOperation({
      expectedScopeKey: resolveAccountSettingsScopeKeyForToken(token),
      references: [{ ref }],
    });

    expect(createSavedSecretMaterializerFromSnapshotV1(refreshed).resolve(ref))
      .toMatchObject({ status: 'ready', value: 'current-value' });
    expect(axios.get).toHaveBeenCalledTimes(1);
  });
});
