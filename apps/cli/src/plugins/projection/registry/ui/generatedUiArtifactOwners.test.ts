import { describe, expect, it } from 'vitest';

import {
  PluginUiArtifactDigestV1Schema,
  type PluginUiArtifactsManifestEntryV2,
} from '@happier-dev/protocol/plugins/ui';

import {
  collectResolvedGeneratedReactNativeCollectionMigrationArtifactOwners,
  findGeneratedReactNativeArtifactEntry,
  findGeneratedReactNativeCollectionMigrationsModule,
  type ResolvedGeneratedReactNativeCollectionMigrationArtifactOwner,
  type ResolvedGeneratedReactNativeArtifactOwner,
} from './generatedUiArtifactOwners';
import type { ResolvedContributionRegistry } from '../types';

const digest = PluginUiArtifactDigestV1Schema.parse(`sha256:${'a'.repeat(64)}`);

function createEntry(exports: readonly string[] = ['renderSurface']): PluginUiArtifactsManifestEntryV2 {
  const entry = 'react-native/panel-artifact/entry.cjs.bundle';
  return {
    artifactId: 'panel-artifact',
    tier: 'reactNative',
    entry,
    files: [{ relativePath: entry, digest, byteSize: 1 }],
    digest,
    builtWith: { bundler: 'esbuild', version: '0.25.0' },
    executable: { exports: [...exports] },
    hostUiApiRange: '^1.0.0',
  };
}

function createOwner(
  entry: PluginUiArtifactsManifestEntryV2,
  expectedExport = 'renderSurface',
): ResolvedGeneratedReactNativeArtifactOwner {
  return {
    kind: 'renderer',
    pluginId: 'acme.native',
    pluginSource: { kind: 'path' },
    contributionId: 'panel',
    artifactId: 'panel-artifact',
    pluginRootPath: '/plugins/acme.native',
    manifestPath: '/plugins/acme.native/.happier-plugin/plugin.json',
    generatedUiArtifactsManifest: { version: 2, entries: [entry] },
    requiredHostMethods: [],
    expectedExecutable: { exportName: expectedExport },
  };
}

describe('findGeneratedReactNativeArtifactEntry', () => {
  it('resolves one universal executable artifact for every host platform', () => {
    const entry = createEntry();
    const owner = createOwner(entry);

    for (const platform of ['web', 'ios', 'android'] as const) {
      expect(findGeneratedReactNativeArtifactEntry({ owner, platform })).toEqual({
        entry,
        failure: null,
      });
    }
  });

  it('fails closed when the universal artifact omits the declared export', () => {
    const owner = createOwner(createEntry(['otherExport']));

    expect(findGeneratedReactNativeArtifactEntry({ owner, platform: 'ios' })).toEqual({
      entry: null,
      failure: 'generated_react_native_export_missing',
    });
  });

  it('does not infer host-private Collection migrations from a render artifact', () => {
    expect(collectResolvedGeneratedReactNativeCollectionMigrationArtifactOwners({
      agents: [],
      actions: [],
      resources: [],
      accountCollections: [],
      uiRenderersV2: [],
    } as unknown as ResolvedContributionRegistry)).toEqual([]);
  });

  it('resolves Collection migration authority only from its Account Collection declaration', () => {
    const entry = createEntry(['collectionMigrations']);
    const owner: ResolvedGeneratedReactNativeCollectionMigrationArtifactOwner = {
      kind: 'collectionMigrations',
      pluginId: 'acme.native',
      pluginSource: { kind: 'path' },
      pluginVersion: '2.0.0',
      contributionId: 'tasks',
      artifactId: 'panel-artifact',
      pluginRootPath: '/plugins/acme.native',
      manifestPath: '/plugins/acme.native/.happier-plugin/plugin.json',
      generatedUiArtifactsManifest: { version: 2, entries: [entry] },
      requiredHostMethods: [],
      declaredPlatforms: ['web', 'ios', 'android'],
      expectedExecutable: { exportName: 'collectionMigrations' },
    };

    expect(findGeneratedReactNativeCollectionMigrationsModule({ owner, platform: 'ios' })).toEqual({
      entry,
      moduleReference: { exportName: 'collectionMigrations' },
      failure: null,
    });
    expect(collectResolvedGeneratedReactNativeCollectionMigrationArtifactOwners({
      agents: [],
      actions: [],
      resources: [],
      accountCollections: [{
        provenance: 'external',
        source: { kind: 'path' },
        pluginId: owner.pluginId,
        pluginVersion: owner.pluginVersion,
        identity: { pluginId: owner.pluginId, localId: owner.contributionId },
        manifestPath: owner.manifestPath,
        pluginRootPath: owner.pluginRootPath,
        generatedUiArtifactsManifest: owner.generatedUiArtifactsManifest,
        migrationArtifact: { artifactId: owner.artifactId, exportName: 'collectionMigrations' },
        definition: {
          pluginId: owner.pluginId,
          collectionId: owner.contributionId,
          migrations: [{ id: 'v1-v2', fromSchemaVersion: 1, toSchemaVersion: 2 }],
        } as never,
      }],
    } as unknown as ResolvedContributionRegistry)).toEqual([owner]);
  });
});
