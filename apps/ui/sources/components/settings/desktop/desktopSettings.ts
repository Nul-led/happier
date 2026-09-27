import { defineSettingsPage, settingsHosts } from '@/components/settings/catalog/settingDeclarations';

/**
 * The searchable settings of the `desktop` page. Rows render their labels from these declarations.
 * Everything here exists only in the desktop app; the overlay rows below `enabled` also wait on it.
 */
export const DESKTOP_SETTINGS = defineSettingsPage({
    pageId: 'desktop',
    sections: {
        startup: {
            titleKey: 'settingsDesktop.startupTitle',
            host: settingsHosts.desktop,
            settings: {
                startOnLogin: { titleKey: 'settingsDesktop.startOnLoginTitle', descriptionKey: 'settingsDesktop.startOnLoginSubtitle' },
            },
        },
        overlay: {
            titleKey: 'settingsDesktop.overlay.title',
            host: settingsHosts.desktop,
            settings: {
                enabled: { titleKey: 'settingsDesktop.overlay.enabledTitle', descriptionKey: 'settingsDesktop.overlay.enabledSubtitle' },
                visibilityMode: { titleKey: 'settingsDesktop.overlay.visibilityModeTitle', descriptionKey: 'settingsDesktop.overlay.visibilityModeSubtitle' },
                showWhenRunning: { titleKey: 'settingsDesktop.overlay.showWhenRunningTitle', descriptionKey: 'settingsDesktop.overlay.showWhenRunningSubtitle' },
                showWhenAttentionRequired: { titleKey: 'settingsDesktop.overlay.showWhenAttentionRequiredTitle', descriptionKey: 'settingsDesktop.overlay.showWhenAttentionRequiredSubtitle' },
                showWhenReady: { titleKey: 'settingsDesktop.overlay.showWhenReadyTitle', descriptionKey: 'settingsDesktop.overlay.showWhenReadySubtitle' },
                alwaysOnTop: { titleKey: 'settingsDesktop.overlay.alwaysOnTopTitle', descriptionKey: 'settingsDesktop.overlay.alwaysOnTopSubtitle' },
            },
        },
        interaction: {
            titleKey: 'settingsDesktop.overlay.interactionTitle',
            host: settingsHosts.desktop,
            settings: {
                autoHideEnabled: { titleKey: 'settingsDesktop.overlay.autoHideEnabledTitle', descriptionKey: 'settingsDesktop.overlay.autoHideEnabledSubtitle' },
                autoHideDelay: { titleKey: 'settingsDesktop.overlay.autoHideDelayTitle', descriptionKey: 'settingsDesktop.overlay.autoHideDelaySubtitle' },
            },
        },
        placement: {
            titleKey: 'settingsDesktop.overlay.placementTitle',
            host: settingsHosts.desktop,
            settings: {
                presentationMode: { titleKey: 'settingsDesktop.overlay.presentationModeTitle', descriptionKey: 'settingsDesktop.overlay.presentationModeSubtitle' },
                placementMode: { titleKey: 'settingsDesktop.overlay.placementModeTitle', descriptionKey: 'settingsDesktop.overlay.placementModeSubtitle' },
                anchorPreset: { titleKey: 'settingsDesktop.overlay.anchorPresetTitle', descriptionKey: 'settingsDesktop.overlay.anchorPresetSubtitle' },
                resetPosition: { titleKey: 'settingsDesktop.overlay.resetPositionTitle', descriptionKey: 'settingsDesktop.overlay.resetPositionSubtitle' },
                allowRepositioning: { titleKey: 'settingsDesktop.overlay.allowRepositioningTitle', descriptionKey: 'settingsDesktop.overlay.allowRepositioningSubtitle' },
                lockPosition: { titleKey: 'settingsDesktop.overlay.lockPositionTitle', descriptionKey: 'settingsDesktop.overlay.lockPositionSubtitle' },
            },
        },
        presentation: {
            titleKey: 'settingsDesktop.overlay.presentationTitle',
            host: settingsHosts.desktop,
            settings: {
                showPreviewText: { titleKey: 'settingsDesktop.overlay.showPreviewTextTitle', descriptionKey: 'settingsDesktop.overlay.showPreviewTextSubtitle' },
            },
        },
    },
});
