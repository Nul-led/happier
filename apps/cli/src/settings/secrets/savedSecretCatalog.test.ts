import { describe, expect, it } from 'vitest';

import {
  encryptSecretStringV1,
  sealSavedSecretResourceStoredContentV1,
} from '@happier-dev/protocol';

import { createSavedSecretMaterializerV1 } from './savedSecretCatalog';

const key = new Uint8Array(32).fill(7);
const randomBytes = (length: number) => new Uint8Array(length).fill(3);

describe('Saved Secret catalog materializer', () => {
  it('resolves an extant reserved-reference personal record as personal until rekey commits', () => {
    const ref = 'happier:shared-secret:v1:legacy-personal';
    const resource = sealSavedSecretResourceStoredContentV1({
      resourceId: 'legacy-personal', mode: 'plain',
      content: { v: 1, name: 'shared', kind: 'token', value: 'shared-value' },
    });
    const materializer = createSavedSecretMaterializerV1({
      accountSettings: {
        secrets: [{
          id: ref, name: 'legacy', kind: 'token', updatedAt: 7,
          encryptedValue: { _isSecretValue: true, value: 'exact-personal-value' },
        }],
      },
      settingsSecretsReadKeys: [],
      resources: [{
        resourceId: 'legacy-personal', ownerAccountId: 'owner', displayName: 'shared', kind: 'token',
        encryptionMode: 'plain', revision: 1, storedContent: resource, materialStatus: 'ready',
      }],
      resourceCatalogState: 'ready',
    });

    expect(materializer.resolve(ref)).toMatchObject({
      status: 'ready',
      value: 'exact-personal-value',
      source: 'personal',
    });
    expect(materializer.matchesSharedResourceRevision(ref, 1)).toBe(false);

    const afterRekey = createSavedSecretMaterializerV1({
      accountSettings: { secrets: [] },
      settingsSecretsReadKeys: [],
      resources: [{
        resourceId: 'legacy-personal', ownerAccountId: 'owner', displayName: 'shared', kind: 'token',
        encryptionMode: 'plain', revision: 1, storedContent: resource, materialStatus: 'ready',
      }],
      resourceCatalogState: 'ready',
    });
    expect(afterRekey.resolve(ref)).toMatchObject({
      status: 'ready',
      value: 'shared-value',
      source: 'shared_resource',
    });
    expect(afterRekey.matchesSharedResourceRevision(ref, 1)).toBe(true);
  });

  it('resolves personal and plain shared resources through one API', () => {
    const resource = sealSavedSecretResourceStoredContentV1({
      resourceId: 'resource_1', mode: 'plain',
      content: { v: 1, name: 'shared', kind: 'token', value: 'shared-value' },
    });
    const materializer = createSavedSecretMaterializerV1({
      accountSettings: {
        secrets: [{
          id: 'personal_1', name: 'personal', kind: 'token',
          encryptedValue: { _isSecretValue: true, encryptedValue: encryptSecretStringV1('personal-value', key, randomBytes) },
        }],
      },
      settingsSecretsReadKeys: [key],
      resources: [{
        resourceId: 'resource_1', ownerAccountId: 'owner', displayName: 'shared', kind: 'token',
        encryptionMode: 'plain', revision: 1, storedContent: resource, materialStatus: 'ready',
      }],
    });

    expect(materializer.resolve('personal_1')).toMatchObject({ status: 'ready', value: 'personal-value', source: 'personal' });
    expect(materializer.resolve('happier:shared-secret:v1:resource_1')).toMatchObject({ status: 'ready', value: 'shared-value', source: 'shared_resource' });
    expect(materializer.matchesSharedResourceRevision(
      'happier:shared-secret:v1:resource_1',
      1,
    )).toBe(true);
    expect(materializer.matchesSharedResourceRevision(
      'happier:shared-secret:v1:resource_1',
      2,
    )).toBe(false);
    expect(materializer.matchesSharedResourceRevision('personal_1', 1)).toBe(false);
  });

  it('keeps preparing and stale-resource states typed and fails closed', () => {
    const materializer = createSavedSecretMaterializerV1({
      accountSettings: {}, settingsSecretsReadKeys: [], resources: [{
        resourceId: 'resource_1', ownerAccountId: 'owner', displayName: 'shared', kind: 'token',
        encryptionMode: 'e2ee', revision: 2,
        storedContent: { t: 'encrypted', c: 'AA==' },
        materialStatus: 'preparing_encrypted_access',
      }],
    });
    expect(materializer.resolve('happier:shared-secret:v1:resource_1')).toEqual({ status: 'temporarily_unavailable' });
    expect(materializer.resolve('happier:shared-secret:v1:missing')).toEqual({ status: 'temporarily_unavailable' });
    expect(materializer.resolve('happier:shared-secret:v1:')).toEqual({ status: 'missing' });
  });

  it('distinguishes an unhydrated shared catalog from a missing personal record', () => {
    const materializer = createSavedSecretMaterializerV1({
      accountSettings: {},
      settingsSecretsReadKeys: [],
      resourceCatalogState: 'temporarily_unavailable',
    });

    expect(materializer.resolve('personal_1')).toEqual({ status: 'missing' });
    expect(materializer.resolve('happier:shared-secret:v1:resource_1'))
      .toEqual({ status: 'temporarily_unavailable' });
  });

  it('treats authoritative current absence as revoked while retryable catalog absence stays unavailable', () => {
    const ref = 'happier:shared-secret:v1:resource_1';
    const authoritative = createSavedSecretMaterializerV1({
      accountSettings: {},
      settingsSecretsReadKeys: [],
      resources: [],
      resourceCatalogState: 'ready',
    });
    const retryable = createSavedSecretMaterializerV1({
      accountSettings: {},
      settingsSecretsReadKeys: [],
      resourceCatalogState: 'temporarily_unavailable',
    });
    expect(authoritative.resolve(ref)).toEqual({ status: 'forbidden' });
    expect(retryable.resolve(ref)).toEqual({ status: 'temporarily_unavailable' });
    expect(authoritative.resolve('personal_1')).toEqual({ status: 'missing' });
  });

  it('detects rotation through the existing currentness recheck', () => {
    const first = sealSavedSecretResourceStoredContentV1({
      resourceId: 'resource_1', mode: 'plain',
      content: { v: 1, name: 'shared', kind: 'token', value: 'v1' },
    });
    const materializer = createSavedSecretMaterializerV1({
      accountSettings: {}, settingsSecretsReadKeys: [], resources: [{
        resourceId: 'resource_1', ownerAccountId: 'owner', displayName: 'shared', kind: 'token',
        encryptionMode: 'plain', revision: 1, storedContent: first, materialStatus: 'ready',
      }],
    });
    const resolved = materializer.resolve('happier:shared-secret:v1:resource_1');
    expect(resolved.status).toBe('ready');
    expect(materializer.recheck('happier:shared-secret:v1:resource_1', 'different')).toEqual({ status: 'repair_required' });
  });

  it('opens an E2EE resource only when the caller snapshot includes its resource DEK', () => {
    const storedContent = sealSavedSecretResourceStoredContentV1({
      resourceId: 'resource_1', mode: 'e2ee',
      content: { v: 1, name: 'encrypted', kind: 'apiKey', value: 'secret' },
      resourceDataKey: key,
      randomBytes,
    });
    const withoutKey = createSavedSecretMaterializerV1({
      accountSettings: {}, settingsSecretsReadKeys: [], resources: [{
        resourceId: 'resource_1', ownerAccountId: 'owner', displayName: 'encrypted', kind: 'apiKey',
        encryptionMode: 'e2ee', revision: 1, storedContent, materialStatus: 'ready',
      }],
    });
    expect(withoutKey.inspect('happier:shared-secret:v1:resource_1')).toEqual({ status: 'temporarily_unavailable' });
    expect(withoutKey.resolve('happier:shared-secret:v1:resource_1')).toEqual({ status: 'temporarily_unavailable' });
    expect(withoutKey.inspect('happier:shared-secret:v1:resource_1')).toEqual({ status: 'temporarily_unavailable' });
    const withKey = createSavedSecretMaterializerV1({
      accountSettings: {}, settingsSecretsReadKeys: [], resources: [{
        resourceId: 'resource_1', ownerAccountId: 'owner', displayName: 'encrypted', kind: 'apiKey',
        encryptionMode: 'e2ee', revision: 1, storedContent, materialStatus: 'ready', resourceDataKey: key,
      }],
    });
    expect(withKey.resolve('happier:shared-secret:v1:resource_1')).toMatchObject({ status: 'ready', value: 'secret' });
  });

  it('rejects opened content whose authenticated metadata disagrees with the catalog projection', () => {
    const storedContent = sealSavedSecretResourceStoredContentV1({
      resourceId: 'resource_1', mode: 'plain',
      content: { v: 1, name: 'source-name', kind: 'token', value: 'secret' },
    });
    const materializer = createSavedSecretMaterializerV1({
      accountSettings: {}, settingsSecretsReadKeys: [], resources: [{
        resourceId: 'resource_1', ownerAccountId: 'owner', displayName: 'stale-name', kind: 'token',
        encryptionMode: 'plain', revision: 1, storedContent, materialStatus: 'ready',
      }],
    });
    expect(materializer.resolve('happier:shared-secret:v1:resource_1')).toEqual({ status: 'corrupt' });
  });

  it('materializes a retained resource whose Home projects no display name', () => {
    // The Home maps an empty stored display name to `name: null` and still
    // projects the row as ready, so a snapshot that invents a name out of the
    // resource id would reject healthy material as corrupt. The UI already
    // compares only when the projected name exists.
    const storedContent = sealSavedSecretResourceStoredContentV1({
      resourceId: 'resource_1', mode: 'plain',
      content: { v: 1, name: 'source-name', kind: 'token', value: 'secret' },
    });
    const materializer = createSavedSecretMaterializerV1({
      accountSettings: {}, settingsSecretsReadKeys: [], resources: [{
        resourceId: 'resource_1', ownerAccountId: 'owner', displayName: null, kind: 'token',
        encryptionMode: 'plain', revision: 1, storedContent, materialStatus: 'ready',
      }],
    });
    expect(materializer.resolve('happier:shared-secret:v1:resource_1')).toMatchObject({ status: 'ready', value: 'secret' });
  });

  it.each([
    ['recipient_mode_unsupported', 'mode_incompatible'],
    ['access_removed', 'forbidden'],
    ['update_required', 'repair_required'],
    ['deleted', 'deleted'],
  ] as const)('normalizes catalog status %s to %s', (materialStatus, expected) => {
    const materializer = createSavedSecretMaterializerV1({
      accountSettings: {}, settingsSecretsReadKeys: [], resources: [{
        resourceId: 'resource_1', ownerAccountId: 'owner', displayName: 'shared', kind: 'token',
        encryptionMode: 'e2ee', revision: 2,
        storedContent: { t: 'encrypted', c: 'AA==' },
        materialStatus,
      }],
    });
    expect(materializer.resolve('happier:shared-secret:v1:resource_1')).toEqual({ status: expected });
  });
});
