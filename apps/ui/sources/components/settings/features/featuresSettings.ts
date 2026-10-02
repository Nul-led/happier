import type { FeatureId } from '@happier-dev/protocol';

import { SETTINGS_ROUTES } from '@/components/settings/catalog/routes';
import { buildSettingHref, defineSettingsPage, settingsHosts, type SettingDeclaration, type SettingRef } from '@/components/settings/catalog/settingDeclarations';
import { getFeatureBuildPolicyDecision } from '@/sync/domains/features/featureBuildPolicy';
import { getUiFeatureDefinition, listUiFeatureToggleDefinitions } from '@/sync/domains/features/featureRegistry';

/** Registry toggles this build can show, declared under the section that renders them. */
function declareToggles(experimental: boolean): Readonly<Record<string, SettingDeclaration>> {
    return Object.fromEntries(listUiFeatureToggleDefinitions()
        .filter((definition) => definition.isExperimental === experimental)
        .filter((definition) => getFeatureBuildPolicyDecision(definition.featureId) !== 'deny')
        .map((definition) => [definition.featureId, {
            titleKey: definition.titleKey,
            descriptionKey: definition.subtitleKey,
        }]));
}

/** The searchable settings of the `features` page. Rows render their labels from these declarations. */
export const FEATURES_SETTINGS = defineSettingsPage({
    pageId: 'features',
    sections: {
        general: {
            titleKey: 'settingsFeatures.generalTitle',
            settings: {
                machinePickerSearch: { storage: { scope: 'account', key: 'useMachinePickerSearch', access: 'read_write' }, titleKey: 'settingsFeatures.machinePickerSearch', descriptionKey: 'settingsFeatures.machinePickerSearchSubtitle' },
                pathPickerSearch: { storage: { scope: 'account', key: 'usePathPickerSearch', access: 'read_write' }, titleKey: 'settingsFeatures.pathPickerSearch', descriptionKey: 'settingsFeatures.pathPickerSearchSubtitle' },
                profiles: { storage: { scope: 'account', key: 'useProfiles', access: 'read_write' }, titleKey: 'settingsFeatures.profiles' },
            },
        },
        optionalFeatures: {
            titleKey: 'settingsFeatures.localTogglesTitle',
            settings: Object.assign({}, declareToggles(false), {
                terminalRenderer: { storage: { scope: 'local', key: 'terminalRendererPreference', access: 'read_write' }, titleKey: 'terminalEmbedded.settings.rendererTitle', host: settingsHosts.notWeb },
            } satisfies Readonly<Record<string, SettingDeclaration>>),
        },
        webFeatures: {
            titleKey: 'settingsFeatures.webFeatures',
            host: settingsHosts.web,
            settings: {
                commandPalette: { storage: { scope: 'account', key: 'commandPaletteEnabled', access: 'read_write' }, titleKey: 'settingsFeatures.commandPalette' },
            },
        },
        experiments: {
            titleKey: 'settingsFeatures.experiments',
            settings: Object.assign({
                experimentalFeatures: { titleKey: 'settingsFeatures.experimentalFeatures' },
            } satisfies Readonly<Record<string, SettingDeclaration>>, declareToggles(true)),
        },
    },
});

/** A registry toggle's declared setting (its search anchor), when this build declares it. */
export function resolveFeatureToggleSetting(featureId: FeatureId): SettingRef | undefined {
    const settings: Readonly<Record<string, SettingRef>> = FEATURES_SETTINGS.settings;
    return settings[featureId];
}

/**
 * The link that leads to the switch turning a feature on, for surfaces that explain why a feature is
 * off. An experimental toggle is only rendered under the Experiments switch, so while experiments are
 * off the link lands on that switch first. `undefined` when this build does not show the toggle.
 */
export function resolveFeatureToggleHref(featureId: FeatureId, experimentsEnabled: boolean): string | undefined {
    const toggle = resolveFeatureToggleSetting(featureId);
    if (!toggle) return undefined;
    const target = getUiFeatureDefinition(featureId).settingsToggle?.isExperimental === true && !experimentsEnabled
        ? FEATURES_SETTINGS.settings.experimentalFeatures
        : toggle;
    return buildSettingHref(SETTINGS_ROUTES.features, target);
}
