import { describe, expect, it } from 'vitest';

import {
    getUiFeatureDefinition,
    shouldTrackUiFeatureEffective,
    shouldTrackUiFeaturePreference,
} from './uiFeatureRegistry';
import { listUiFeatureToggleDefinitions } from './uiFeatureToggles';

const TEAM_CREDENTIAL_RUNTIME_FEATURE_IDS = [
    'teams.credentialResources',
    'teams.credentialResources.externalApi',
] as const;

describe('UI Team credential feature registry', () => {
    it('registers both rollout decisions as runtime-only UI features', () => {
        for (const featureId of TEAM_CREDENTIAL_RUNTIME_FEATURE_IDS) {
            expect(getUiFeatureDefinition(featureId).settingsToggle).toBeUndefined();
        }
    });

    it('does not create client-owned toggles for server-controlled rollout decisions', () => {
        const toggleIds = new Set(listUiFeatureToggleDefinitions().map((definition) => definition.featureId));

        for (const featureId of TEAM_CREDENTIAL_RUNTIME_FEATURE_IDS) {
            expect(toggleIds.has(featureId)).toBe(false);
            expect(shouldTrackUiFeaturePreference(featureId)).toBe(false);
            expect(shouldTrackUiFeatureEffective(featureId)).toBe(true);
        }
    });
});
