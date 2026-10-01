import { defineSettingsPage, settingsHosts } from '@/components/settings/catalog/settingDeclarations';

/** The searchable settings of the `pets` page. Rows render their labels from these declarations. */
export const PETS_SETTINGS = defineSettingsPage({
    pageId: 'pets',
    sections: {
        account: {
            titleKey: 'settingsPets.accountTitle',
            settings: {
                enabled: { storage: { scope: 'account', key: 'petsEnabled', access: 'read_write' }, titleKey: 'settingsPets.enabledTitle', descriptionKey: 'settingsPets.enabledSubtitle' },
                deviceOverride: { storage: { scope: 'local', key: 'petsEnabledOverride', access: 'read_write' }, titleKey: 'settingsPets.deviceOverrideTitle', descriptionKey: 'settingsPets.deviceOverrideSubtitle' },
                companionSize: { storage: { scope: 'local', key: 'petsCompanionSizeScale', access: 'read_write' }, titleKey: 'settingsPets.companionSizeTitle', descriptionKey: 'settingsPets.companionSizeSubtitle' },
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
                desktopOverlayEnabled: { storage: { scope: 'account', key: 'petsDesktopOverlayDefaultEnabled', access: 'read_write' }, titleKey: 'settingsPets.desktopOverlayEnabledTitle', descriptionKey: 'settingsPets.desktopOverlayEnabledSubtitle' },
                desktopOverlayDeviceOverride: { storage: { scope: 'local', key: 'desktopPetOverlayEnabledOverride', access: 'read_write' }, titleKey: 'settingsPets.desktopOverlayDeviceOverrideTitle' },
                desktopOverlayVisibilityMode: { storage: { scope: 'local', key: 'desktopPetOverlayVisibilityModeOverride', access: 'read_write' }, titleKey: 'settingsPets.desktopOverlayVisibilityModeTitle', descriptionKey: 'settingsPets.desktopOverlayVisibilityModeSubtitle' },
            },
        },
    },
});
