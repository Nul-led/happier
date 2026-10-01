import { defineSettingsPage } from '@/components/settings/catalog/settingDeclarations';
import { SETTINGS_ROUTES } from '@/components/settings/catalog/routes';

/** The searchable settings of Appearance › Themes. Theme names find the mode sections. */
export const THEMES_SETTINGS = defineSettingsPage({
    pageId: 'appearance',
    subpage: { id: 'themes', route: SETTINGS_ROUTES.appearanceThemes, titleKey: 'settingsAppearance.themeProfiles.title' },
    sections: {
        lightMode: {
            titleKey: 'settingsAppearance.themeProfiles.lightModeSection',
            settings: {
                lightTheme: {
                    titleKey: 'settingsAppearance.themeProfiles.lightModeSection',
                    descriptionKey: 'settingsAppearance.themeProfiles.lightModeSectionDescription',
                    keywordKeys: [
                        'settingsAppearance.themeProfiles.presets.premiumLight',
                        'settingsAppearance.themeProfiles.presets.paperLight',
                        'settingsAppearance.themeProfiles.presets.catppuccinLatte',
                        'settingsAppearance.themeProfiles.presets.githubLight',
                    ],
                },
            },
        },
        darkMode: {
            titleKey: 'settingsAppearance.themeProfiles.darkModeSection',
            settings: {
                darkTheme: {
                    titleKey: 'settingsAppearance.themeProfiles.darkModeSection',
                    descriptionKey: 'settingsAppearance.themeProfiles.darkModeSectionDescription',
                    keywordKeys: [
                        'settingsAppearance.themeProfiles.presets.premiumDark',
                        'settingsAppearance.themeProfiles.presets.pitchDark',
                        'settingsAppearance.themeProfiles.presets.sunsetDark',
                        'settingsAppearance.themeProfiles.presets.tokyoNight',
                        'settingsAppearance.themeProfiles.presets.nightDark',
                        'settingsAppearance.themeProfiles.presets.classicDark',
                        'settingsAppearance.themeProfiles.presets.graphiteDark',
                        'settingsAppearance.themeProfiles.presets.catppuccinMocha',
                        'settingsAppearance.themeProfiles.presets.catppuccinMacchiato',
                        'settingsAppearance.themeProfiles.presets.catppuccinFrappe',
                        'settingsAppearance.themeProfiles.presets.oneDarkPro',
                        'settingsAppearance.themeProfiles.presets.monokaiPro',
                        'settingsAppearance.themeProfiles.presets.githubDark',
                        'settingsAppearance.themeProfiles.presets.darkModern',
                    ],
                },
            },
        },
        yourThemes: {
            titleKey: 'settingsAppearance.themeProfiles.yourThemes',
            settings: {
                yourThemes: {
                    titleKey: 'settingsAppearance.themeProfiles.yourThemes',
                    descriptionKey: 'settingsAppearance.themeProfiles.yourThemesDescription',
                    keywordKeys: [
                        'settingsAppearance.themeProfiles.newTheme',
                        'settingsAppearance.themeProfiles.importProfile',
                        'settingsAppearance.themeProfiles.exportProfile',
                    ],
                },
            },
        },
    },
});
