import type { FeaturesPayloadDelta } from './types';
import { readWorkflowsFeatureEnv } from './catalog/readFeatureEnv';

export function resolveWorkflowsFeature(env: NodeJS.ProcessEnv): FeaturesPayloadDelta {
    return {
        features: {
            workflows: {
                enabled: readWorkflowsFeatureEnv(env).enabled,
            },
        },
    };
}
