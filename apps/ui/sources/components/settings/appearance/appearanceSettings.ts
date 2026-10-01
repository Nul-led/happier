import { defineSettingsPage } from '@/components/settings/catalog/settingDeclarations';
import { UI_FONT_SCALE_PRESETS } from '@/components/ui/text/uiFontScale';

/** Appearance's searchable settings. Rows render their labels from these declarations. */
export const APPEARANCE_SETTINGS = defineSettingsPage({
    pageId: 'appearance',
    sections: {
        theme: {
            titleKey: 'settingsAppearance.theme',
            settings: {
                themes: { titleKey: 'settingsAppearance.themeProfiles.title' },
                themeToggle: { titleKey: 'settingsAppearance.themeToggle.title', descriptionKey: 'settingsAppearance.themeToggle.description', storage: { scope: 'local', key: 'titleStripThemeToggleVisible', access: 'read_write' } },
            },
        },
        text: {
            titleKey: 'settingsAppearance.text',
            settings: {
                textSize: { titleKey: 'settingsAppearance.textSize', descriptionKey: 'settingsAppearance.textSizeDescription', storage: { scope: 'local', key: 'uiFontScale', access: 'read_write', allowedValues: Object.values(UI_FONT_SCALE_PRESETS) } },
                density: { titleKey: 'settingsAppearance.itemDensity', descriptionKey: 'settingsAppearance.itemDensityDescription', storage: { scope: 'local', key: 'uiItemDensity', access: 'read_write' } },
            },
        },
        display: {
            titleKey: 'settingsAppearance.display',
            settings: {
                contentWidth: { titleKey: 'settingsAppearance.contentWidth', descriptionKey: 'settingsAppearance.contentWidthDescription', storage: { scope: 'local', key: 'uiContentWidthMode', access: 'read_write' } },
                editorTabs: { titleKey: 'settingsAppearance.detailsPaneTabsBehavior', descriptionKey: 'settingsAppearance.detailsPaneTabsBehaviorDescription', storage: { scope: 'local', key: 'detailsPaneTabsBehavior', access: 'read_write' } },
                rightPanels: { titleKey: 'settingsAppearance.multiPanePanels', descriptionKey: 'settingsAppearance.multiPanePanelsDescription', storage: { scope: 'local', key: 'uiMultiPanePanelsEnabled', access: 'read_write' } },
                settingsSidebar: { titleKey: 'settingsAppearance.settingsNavSidebar', descriptionKey: 'settingsAppearance.settingsNavSidebarDescription', storage: { scope: 'local', key: 'settingsNavSidebarEnabled', access: 'read_write' } },
            },
        },
        home: {
            titleKey: 'settingsOverview.homeLayoutSectionTitle',
            settings: {
                homeSections: {
                    titleKey: 'settingsOverview.homeCustomize',
                    descriptionKey: 'settingsOverview.homeCustomizeDescription',
                },
            },
        },
        widgets: {
            titleKey: 'widgetFrame.appearanceTitle',
            settings: {
                widgetFrameHome: { titleKey: 'widgetFrame.surfaceHome', storage: { scope: 'local', key: 'widgetFrameStyleHome', access: 'read_write', allowedValues: ['card', 'plain'] } },
                widgetFrameBoard: { titleKey: 'widgetFrame.surfaceBoard', storage: { scope: 'local', key: 'widgetFrameStyleBoard', access: 'read_write', allowedValues: ['card', 'plain'] } },
                widgetFrameCompanion: { titleKey: 'widgetFrame.surfaceCompanion', storage: { scope: 'local', key: 'widgetFrameStyleCompanion', access: 'read_write', allowedValues: ['card', 'plain'] } },
                widgetGalleryView: { titleKey: 'widgetFrame.addViewTitle', descriptionKey: 'widgetFrame.addViewDescription', storage: { scope: 'local', key: 'widgetGalleryViewV1', access: 'read_write', allowedValues: ['grid', 'list'] } },
            },
        },
        effects: {
            titleKey: 'settingsAppearance.visualEffects.title',
            settings: {
                backdropBlur: { titleKey: 'settingsAppearance.backdropBlur', descriptionKey: 'settingsAppearance.backdropBlurDescription', storage: { scope: 'local', key: 'uiBackdropBlurEnabled', access: 'read_write' } },
            },
        },
        sessions: {
            titleKey: 'tabs.sessions',
            settings: {
                avatarStyle: { titleKey: 'settingsAppearance.avatarStyle', descriptionKey: 'settingsAppearance.avatarStyleDescription', storage: { scope: 'account', key: 'avatarStyle', access: 'read_write' } },
                agentIcons: { titleKey: 'settingsAppearance.showFlavorIcons', descriptionKey: 'settingsAppearance.showFlavorIconsDescription', storage: { scope: 'account', key: 'showFlavorIcons', access: 'read_write' } },
                alwaysShowContextSize: { titleKey: 'settingsAppearance.alwaysShowContextSize', descriptionKey: 'settingsAppearance.alwaysShowContextSizeDescription', storage: { scope: 'account', key: 'alwaysShowContextSize', access: 'read_write' } },
            },
        },
        tabBar: {
            titleKey: 'settingsAppearance.tabBarAppearance.title',
            settings: {
                tabBarSize: { titleKey: 'settingsAppearance.tabBarAppearance.size', storage: { scope: 'account', key: 'tabBarSize', access: 'read_write' } },
                tabBarLabels: { titleKey: 'settingsAppearance.tabBarAppearance.showLabels', storage: { scope: 'account', key: 'tabBarShowLabels', access: 'read_write' } },
                tabBarBadges: { titleKey: 'settingsAppearance.tabBarBadges.title' },
            },
        },
        privacy: {
            titleKey: 'connectedServicesCollection.privacyTitle',
            settings: {
                hideAccountIdentities: {
                    titleKey: 'connectedServicesCollection.hideIdentitiesTitle',
                    descriptionKey: 'connectedServicesCollection.hideIdentitiesDescription',
                    storage: { scope: 'local', key: 'hideConnectedAccountIdentities', access: 'read_write' },
                },
            },
        },
        glass: {
            titleKey: 'settingsAppearance.glass.title',
            settings: {
                glassBlur: { titleKey: 'settingsAppearance.glass.enable', storage: { scope: 'account', key: 'glassBlurEnabled', access: 'read_write' } },
                glassIntensity: { titleKey: 'settingsAppearance.glass.intensity', storage: { scope: 'account', key: 'glassBlurIntensity', access: 'read_write' } },
            },
        },
    },
});
