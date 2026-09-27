import { defineSettingsPage } from '@/components/settings/catalog/settingDeclarations';

/** Appearance's searchable settings. Rows render their labels from these declarations. */
export const APPEARANCE_SETTINGS = defineSettingsPage({
    pageId: 'appearance',
    sections: {
        theme: {
            titleKey: 'settingsAppearance.theme',
            settings: {
                themes: { titleKey: 'settingsAppearance.themeProfiles.title' },
            },
        },
        text: {
            titleKey: 'settingsAppearance.text',
            settings: {
                textSize: { titleKey: 'settingsAppearance.textSize', descriptionKey: 'settingsAppearance.textSizeDescription' },
                density: { titleKey: 'settingsAppearance.itemDensity', descriptionKey: 'settingsAppearance.itemDensityDescription' },
            },
        },
        display: {
            titleKey: 'settingsAppearance.display',
            settings: {
                contentWidth: { titleKey: 'settingsAppearance.contentWidth', descriptionKey: 'settingsAppearance.contentWidthDescription' },
                editorTabs: { titleKey: 'settingsAppearance.detailsPaneTabsBehavior', descriptionKey: 'settingsAppearance.detailsPaneTabsBehaviorDescription' },
                rightPanels: { titleKey: 'settingsAppearance.multiPanePanels', descriptionKey: 'settingsAppearance.multiPanePanelsDescription' },
                settingsSidebar: { titleKey: 'settingsAppearance.settingsNavSidebar', descriptionKey: 'settingsAppearance.settingsNavSidebarDescription' },
            },
        },
        effects: {
            titleKey: 'settingsAppearance.visualEffects.title',
            settings: {
                backdropBlur: { titleKey: 'settingsAppearance.backdropBlur', descriptionKey: 'settingsAppearance.backdropBlurDescription' },
            },
        },
        sessions: {
            titleKey: 'tabs.sessions',
            settings: {
                avatarStyle: { titleKey: 'settingsAppearance.avatarStyle', descriptionKey: 'settingsAppearance.avatarStyleDescription' },
                agentIcons: { titleKey: 'settingsAppearance.showFlavorIcons', descriptionKey: 'settingsAppearance.showFlavorIconsDescription' },
                alwaysShowContextSize: { titleKey: 'settingsAppearance.alwaysShowContextSize', descriptionKey: 'settingsAppearance.alwaysShowContextSizeDescription' },
            },
        },
        tabBar: {
            titleKey: 'settingsAppearance.tabBarAppearance.title',
            settings: {
                tabBarSize: { titleKey: 'settingsAppearance.tabBarAppearance.size' },
                tabBarLabels: { titleKey: 'settingsAppearance.tabBarAppearance.showLabels' },
                tabBarBadges: { titleKey: 'settingsAppearance.tabBarBadges.title' },
            },
        },
        glass: {
            titleKey: 'settingsAppearance.glass.title',
            settings: {
                glassBlur: { titleKey: 'settingsAppearance.glass.enable' },
                glassIntensity: { titleKey: 'settingsAppearance.glass.intensity' },
            },
        },
    },
});
