import { readMachinePoolsFeatureEnv } from './catalog/readFeatureEnv';
import type { FeaturesPayloadDelta } from './types';

export function resolveMachinePoolsFeature(env: NodeJS.ProcessEnv): FeaturesPayloadDelta {
    return {
        features: {
            machines: {
                enabled: true,
                pools: { enabled: readMachinePoolsFeatureEnv(env).enabled },
            },
        },
    };
}
