import { describe, expect, it } from 'vitest';

import {
  DaemonPluginHostedWebArtifactCacheIdentityV1Schema,
  DaemonPluginReactNativeBundleCacheIdentityV1Schema,
  deriveDaemonPluginHostedWebArtifactCacheIdentityKeyV1,
  deriveDaemonPluginReactNativeBundleCacheIdentityKeyV1,
  isSameDaemonPluginHostedWebArtifactCacheIdentityV1,
  isSameDaemonPluginReactNativeBundleCacheIdentityV1,
  type DaemonPluginReactNativeBundleCacheIdentityV1,
} from './contributionRegistryProjection.js';

const BASE_IDENTITY: DaemonPluginReactNativeBundleCacheIdentityV1 = {
  artifactDigest: `sha256:${'b'.repeat(64)}`,
};

describe('daemon UI bundle cache identity', () => {
  it('keys executable bytes by digest only', () => {
    const key = deriveDaemonPluginReactNativeBundleCacheIdentityKeyV1(BASE_IDENTITY);
    expect(key).toBe(`sha256:${'b'.repeat(64)}`);
    expect(DaemonPluginReactNativeBundleCacheIdentityV1Schema.safeParse({
      ...BASE_IDENTITY,
      contributionId: 'native-preview',
    }).success).toBe(false);
  });

  it('does not let semantic selection metadata redefine byte equality', () => {
    const left = { ...BASE_IDENTITY };
    const right = { ...BASE_IDENTITY };
    expect(isSameDaemonPluginReactNativeBundleCacheIdentityV1(left, right)).toBe(true);
    expect(deriveDaemonPluginReactNativeBundleCacheIdentityKeyV1(left))
      .toBe(deriveDaemonPluginReactNativeBundleCacheIdentityKeyV1(right));
  });

  it('uses the same digest-only identity for hosted-Web executable bytes', () => {
    const hosted = { ...BASE_IDENTITY };
    expect(DaemonPluginHostedWebArtifactCacheIdentityV1Schema.parse(hosted)).toEqual(hosted);
    expect(isSameDaemonPluginHostedWebArtifactCacheIdentityV1(hosted, { ...hosted })).toBe(true);
    expect(deriveDaemonPluginHostedWebArtifactCacheIdentityKeyV1(hosted)).toBe(hosted.artifactDigest);
  });
});
