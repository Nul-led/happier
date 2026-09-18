import { readSessionConversationsFeatureEnv } from './catalog/readFeatureEnv';
import type { FeaturesPayloadDelta } from './types';

/**
 * Publishes the single fail-closed server gate for Session conversations.
 * Dependency closure with Session collaboration is applied centrally when the
 * complete payload is assembled.
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
