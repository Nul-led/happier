import { describe, expect, it } from 'vitest';

import {
    deriveDaemonPluginReactNativeBundleCacheIdentityKeyV1,
} from '@happier-dev/protocol';
const BASE_IDENTITY = {
    artifactDigest: `sha256:${'b'.repeat(64)}`,
} as const;

describe('generated React Native artifact runtime identity', () => {
    it('derives the executable byte cache key from the artifact digest only', () => {
        expect(deriveDaemonPluginReactNativeBundleCacheIdentityKeyV1(BASE_IDENTITY))
            .toBe(BASE_IDENTITY.artifactDigest);
    });

    it('does not invalidate identical bytes when semantic routing metadata changes', () => {
        const firstSelection = {
            cacheIdentity: BASE_IDENTITY,
            pluginId: 'acme.preview',
            contributionId: 'native-preview',
            artifactId: 'native-preview-artifact',
            platform: 'ios',
        } as const;
        const routedSelection = {
            cacheIdentity: BASE_IDENTITY,
            pluginId: 'acme.other',
            contributionId: 'other-preview',
            artifactId: 'other-artifact',
            platform: 'android',
        } as const;
        expect(deriveDaemonPluginReactNativeBundleCacheIdentityKeyV1(routedSelection.cacheIdentity))
            .toBe(deriveDaemonPluginReactNativeBundleCacheIdentityKeyV1(firstSelection.cacheIdentity));
    });
});
