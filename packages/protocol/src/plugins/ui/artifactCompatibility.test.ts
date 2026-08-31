import { describe, expect, it } from 'vitest';

import * as protocolRoot from '../../index.js';
import { DaemonReactNativeHostRuntimeIdentityV1Schema } from '../../daemon/contributionRegistryProjection.js';
import { PluginReactNativeCompatibilityInputV1Schema } from './reactNativeCompatibility.js';
import { computePluginUiArtifactSha256DigestV1 } from './artifactIntegrity.js';
import {
  derivePluginUiNativeCapabilitiesDigestV1,
  PluginUiExactRuntimeVersionV1Schema,
} from './artifactCompatibility.js';

describe('Plugin UI artifact compatibility', () => {
  it('derives native capability identity from the trimmed, sorted compatibility set', () => {
    const expected = computePluginUiArtifactSha256DigestV1(
      new TextEncoder().encode(JSON.stringify(['clipboard', 'haptics'])),
    );

    expect(derivePluginUiNativeCapabilitiesDigestV1([
      ' haptics ',
      'clipboard',
      '  ',
    ])).toBe(expected);
  });

  it('publishes the canonical digest helper through the Protocol root', () => {
    expect(protocolRoot.derivePluginUiNativeCapabilitiesDigestV1)
      .toBe(derivePluginUiNativeCapabilitiesDigestV1);
  });
});

describe('PluginUiExactRuntimeVersionV1Schema — one exact-version decision owner', () => {
  const rejectionDiagnostics = (schema: { safeParse(value: unknown): { success: boolean; error?: { issues: readonly { message: string }[] } } }, value: unknown) => {
    const result = schema.safeParse(value);
    expect(result.success).toBe(false);
    return (result as { error: { issues: readonly { message: string }[] } }).error.issues.map((issue) => issue.message);
  };

  it('preserves opaque exact versions and prereleases', () => {
    for (const version of ['runtime-55', '1.0.0-rc.1', '0.83.4']) {
      expect(PluginUiExactRuntimeVersionV1Schema.safeParse(version).success).toBe(true);
    }
  });

  it('rejects floating tags, wildcards, and selector syntax with the canonical diagnostic', () => {
    for (const version of ['*', '1.x', 'x', '1.X', '1.*', 'latest', '^1.2.3', '~1.2.3', '>=1']) {
      const canonical = rejectionDiagnostics(PluginUiExactRuntimeVersionV1Schema, version);
      expect(canonical.length).toBeGreaterThan(0);
    }
  });

  it('validates React Native compatibility runtime versions through the canonical owner', () => {
    const base = {
      pluginId: 'acme.preview',
      contributionId: 'native-preview',
      artifactDigest: 'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      hostAppVersion: '2.0.0',
      hostUiApiVersion: '1.0.0',
      reactVersion: '19.0.0',
      reactNativeVersion: '0.79.0',
      platform: 'ios',
      channel: 'store',
      featureState: 'enabled',
    } as const;

    expect(PluginReactNativeCompatibilityInputV1Schema.safeParse(base).success).toBe(true);
    for (const field of ['hostAppVersion', 'hostUiApiVersion', 'reactVersion', 'reactNativeVersion'] as const) {
      const canonical = rejectionDiagnostics(PluginUiExactRuntimeVersionV1Schema, '*');
      expect(rejectionDiagnostics(PluginReactNativeCompatibilityInputV1Schema, { ...base, [field]: '*' }))
        .toEqual(canonical);
    }
  });

  it('validates daemon host-runtime identity versions through the canonical owner', () => {
    const base = {
      platform: 'ios',
      channel: 'store',
    } as const;

    expect(DaemonReactNativeHostRuntimeIdentityV1Schema.safeParse({
      ...base,
      reactVersion: 'runtime-55',
      reactNativeVersion: '0.83.4-prerelease.1',
    }).success).toBe(true);
    for (const field of ['reactVersion', 'reactNativeVersion', 'expoRuntimeVersion', 'hermesVersion'] as const) {
      const canonical = rejectionDiagnostics(PluginUiExactRuntimeVersionV1Schema, '1.x');
      expect(rejectionDiagnostics(DaemonReactNativeHostRuntimeIdentityV1Schema, { ...base, [field]: '1.x' }))
        .toEqual(canonical);
    }
  });
});
