import { describe, expect, it } from 'vitest';

import {
  PLUGIN_UI_ARTIFACT_GRAMMAR_VERSION_V2,
  PluginUiArtifactsManifestV2Schema,
} from './uiArtifactsManifest.js';

const digest = `sha256:${'a'.repeat(64)}`;

describe('PluginUiArtifactsManifestV2Schema', () => {
  it('admits a platform-neutral CommonJS executable using only the Host UI API range', () => {
    const entry = 'react-native/panel/entry.cjs.bundle';
    const result = PluginUiArtifactsManifestV2Schema.parse({
      version: PLUGIN_UI_ARTIFACT_GRAMMAR_VERSION_V2,
      entries: [{
        artifactId: 'panel',
        tier: 'reactNative',
        entry,
        files: [{ relativePath: entry, digest, byteSize: 12 }],
        digest,
        builtWith: { bundler: 'esbuild', version: '0.27.2' },
        executable: { exports: ['renderSurface'] },
        hostUiApiRange: '^1.0.0',
      }],
    });
    expect(result.entries[0]).toMatchObject({ artifactId: 'panel', tier: 'reactNative' });
  });

  it('rejects retired exact framework and engine compatibility facts', () => {
    const entry = 'react-native/panel/entry.cjs.bundle';
    const canonicalEntry = {
      artifactId: 'panel',
      tier: 'reactNative',
      entry,
      files: [{ relativePath: entry, digest, byteSize: 12 }],
      digest,
      builtWith: { bundler: 'esbuild', version: '0.27.2' },
      executable: { exports: ['renderSurface'] },
      hostUiApiRange: '^1.0.0',
    } as const;

    for (const [field, value] of [
      ['reactVersion', '19.2.0'],
      ['reactNativeVersion', '0.83.4'],
      ['expoRuntimeVersion', '55.0.0'],
      ['hermesVersion', '0.15.0'],
    ] as const) {
      expect(PluginUiArtifactsManifestV2Schema.safeParse({
        version: 2,
        entries: [{ ...canonicalEntry, [field]: value }],
      }).success).toBe(false);
    }
  });

  it('rejects retired per-platform and module-path executable facts', () => {
    const entry = 'react-native/panel/entry.cjs.bundle';
    expect(PluginUiArtifactsManifestV2Schema.safeParse({
      version: 2,
      entries: [{
        artifactId: 'panel', tier: 'reactNative', platform: 'ios', entry,
        files: [{ relativePath: entry, digest, byteSize: 12 }], digest,
        builtWith: { bundler: 'esbuild', version: '0.27.2' },
        executable: { exports: ['renderSurface'], modulePath: './panel' },
        hostUiApiRange: '^1.0.0',
      }],
    }).success).toBe(false);
  });

  it('admits hosted static directories as a distinct tier', () => {
    const entry = 'hosted-web/panel/index.html';
    expect(PluginUiArtifactsManifestV2Schema.safeParse({
      version: 2,
      entries: [{
        artifactId: 'panel', tier: 'hostedWeb', entry,
        files: [{ relativePath: entry, digest, byteSize: 12 }], digest,
        builtWith: { staging: 'staticDirectory' }, hostUiApiRange: '^1.0.0',
      }],
    }).success).toBe(true);
  });
});
