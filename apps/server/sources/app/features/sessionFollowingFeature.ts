import { readSessionFollowingFeatureEnv } from './catalog/readFeatureEnv';
import type { FeaturesPayloadDelta } from './types';

/**
 * The one server bit for durable Session Following.
 *
 * It covers both the per-Account Follow preference resource and the
 * Session-to-Session Follow source resource: runtime delivery is negotiated by
 * the exact daemon capability, so no second feature bit exists per mode.
 */
export function resolveSessionFollowingFeature(env: NodeJS.ProcessEnv): FeaturesPayloadDelta {
    const featureConfig = readSessionFollowingFeatureEnv(env);

    return {
        features: {
            sessions: {
                enabled: true,
                following: { enabled: featureConfig.followingEnabled },
            },
        },
    };
}
