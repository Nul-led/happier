import { readSessionCollaborationFeatureEnv } from './catalog/readFeatureEnv';
import type { FeaturesPayloadDelta } from './types';

export function resolveSessionCollaborationFeature(env: NodeJS.ProcessEnv): FeaturesPayloadDelta {
    return { features: { sessions: {
        enabled: true,
        collaboration: { enabled: readSessionCollaborationFeatureEnv(env).enabled },
    } } };
}
