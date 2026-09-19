import { readSessionConversationsFeatureEnv } from './catalog/readFeatureEnv';
import type { FeaturesPayloadDelta } from './types';

/**
 * Publishes the single server bit for Session conversations, on by default with
 * the env variable as the operator opt-out. Dependency closure with Session
 * collaboration is applied centrally when the complete payload is assembled.
 */
export function resolveSessionConversationsFeature(env: NodeJS.ProcessEnv): FeaturesPayloadDelta {
    return {
        features: {
            sessions: {
                enabled: true,
                conversations: {
                    enabled: readSessionConversationsFeatureEnv(env).conversationsEnabled,
                },
            },
        },
    };
}
