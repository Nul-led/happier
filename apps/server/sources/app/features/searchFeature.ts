import type { FeaturesPayloadDelta } from './types';
import { readSearchFeatureEnv } from './catalog/readFeatureEnv';

export function resolveSearchFeature(env: NodeJS.ProcessEnv): FeaturesPayloadDelta {
    return {
        features: {
            search: { enabled: readSearchFeatureEnv(env).enabled },
        },
    };
}
