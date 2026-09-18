import { readSessionEphemeralRunnerFeatureEnv } from './catalog/readFeatureEnv';
import type { FeaturesPayloadDelta } from './types';

export function resolveSessionEphemeralRunnerFeature(env: NodeJS.ProcessEnv): FeaturesPayloadDelta {
    return { features: { sessions: { enabled: true,
        ephemeralRunner: { enabled: readSessionEphemeralRunnerFeatureEnv(env).ephemeralRunnerEnabled },
    } } };
}
