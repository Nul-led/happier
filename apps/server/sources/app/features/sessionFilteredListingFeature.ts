import type { FeaturesPayloadDelta } from './types';
import { readSessionFilteredListingFeatureEnv } from './catalog/readFeatureEnv';

/** Default off until the composed V1 vertical is proven; explicit QA/development activation is allowed. */
export function resolveSessionFilteredListingFeature(env: NodeJS.ProcessEnv): FeaturesPayloadDelta {
    return {
        features: {
            sessions: {
                enabled: true,
                filteredListing: {
                    enabled: readSessionFilteredListingFeatureEnv(env).filteredListingEnabled,
                },
            },
        },
    };
}
