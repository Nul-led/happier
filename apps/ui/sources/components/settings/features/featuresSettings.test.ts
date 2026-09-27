import { describe, expect, it } from 'vitest';

import { getFeatureBuildPolicyDecision } from '@/sync/domains/features/featureBuildPolicy';
import { listUiFeatureToggleDefinitions } from '@/sync/domains/features/featureRegistry';

import { FEATURES_SETTINGS } from './featuresSettings';

describe('Features page search declarations', () => {
    it('declares every feature toggle this build can show, so search finds each one', () => {
        const declaredTitleKeys = Object.values(FEATURES_SETTINGS.settings).map((setting) => setting.titleKey);
        const buildAllowed = listUiFeatureToggleDefinitions()
            .filter((definition) => getFeatureBuildPolicyDecision(definition.featureId) !== 'deny');

        expect(buildAllowed.length).toBeGreaterThan(0);
        for (const definition of buildAllowed) {
            expect(declaredTitleKeys).toContain(definition.titleKey);
        }
        expect(declaredTitleKeys).toEqual(expect.arrayContaining([
            'terminalEmbedded.settings.locationTitle',
            'terminalEmbedded.settings.rendererTitle',
        ]));
    });

    it('names the section of every declared setting, so a search result shows where it lives', () => {
        for (const setting of Object.values(FEATURES_SETTINGS.settings)) {
            expect(setting.sectionTitleKey).toBeTruthy();
        }
    });
});
