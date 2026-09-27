import { defineSettingsPage, settingsHosts } from '@/components/settings/catalog/settingDeclarations';

/** The searchable settings of the `pets` page. Rows render their labels from these declarations. */
export const PETS_SETTINGS = defineSettingsPage({
    pageId: 'pets',
    sections: {
        account: {
            titleKey: 'settingsPets.accountTitle',
            settings: {
                enabled: { titleKey: 'settingsPets.enabledTitle', descriptionKey: 'settingsPets.enabledSubtitle' },
                deviceOverride: { titleKey: 'settingsPets.deviceOverrideTitle', descriptionKey: 'settingsPets.deviceOverrideSubtitle' },
                companionSize: { titleKey: 'settingsPets.companionSizeTitle', descriptionKey: 'settingsPets.companionSizeSubtitle' },
            },
        },
        codexPets: {
            titleKey: 'settingsPets.codexPetsTitle',
            settings: {
                detectCodexPets: { titleKey: 'settingsPets.detectCodexPetsTitle', descriptionKey: 'settingsPets.detectCodexPetsSubtitle' },
            },
        },
        desktopOverlay: {
            titleKey: 'settingsPets.desktopOverlayTitle',
            host: settingsHosts.desktop,
            settings: {
                desktopOverlayEnabled: { titleKey: 'settingsPets.desktopOverlayEnabledTitle', descriptionKey: 'settingsPets.desktopOverlayEnabledSubtitle' },
                desktopOverlayDeviceOverride: { titleKey: 'settingsPets.desktopOverlayDeviceOverrideTitle' },
                desktopOverlayVisibilityMode: { titleKey: 'settingsPets.desktopOverlayVisibilityModeTitle', descriptionKey: 'settingsPets.desktopOverlayVisibilityModeSubtitle' },
            },
        },
    },
});
