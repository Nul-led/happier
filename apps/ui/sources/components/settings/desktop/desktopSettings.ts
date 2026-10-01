import { defineSettingsPage, settingsHosts } from '@/components/settings/catalog/settingDeclarations';
import { AUTO_HIDE_DELAY_OPTIONS } from './desktopOverlayAutoHideDelayOptions';

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
                startOnLogin: { titleKey: 'settingsDesktop.loginStart.title', descriptionKey: 'settingsDesktop.loginStart.subtitle' },
            },
        },
        overlay: {
            titleKey: 'settingsDesktop.overlay.title',
            host: settingsHosts.desktop,
            settings: {
                enabled: { storage: { scope: 'local', key: 'desktopOverlayEnabled', access: 'read_write' }, titleKey: 'settingsDesktop.overlay.enabledTitle', descriptionKey: 'settingsDesktop.overlay.enabledSubtitle' },
                visibilityMode: { storage: { scope: 'local', key: 'desktopOverlayVisibilityMode', access: 'read_write' }, titleKey: 'settingsDesktop.overlay.visibilityModeTitle', descriptionKey: 'settingsDesktop.overlay.visibilityModeSubtitle' },
                showWhenRunning: { storage: { scope: 'local', key: 'desktopOverlayShowWhenRunning', access: 'read_write' }, titleKey: 'settingsDesktop.overlay.showWhenRunningTitle', descriptionKey: 'settingsDesktop.overlay.showWhenRunningSubtitle' },
                showWhenAttentionRequired: { storage: { scope: 'local', key: 'desktopOverlayShowWhenAttentionRequired', access: 'read_write' }, titleKey: 'settingsDesktop.overlay.showWhenAttentionRequiredTitle', descriptionKey: 'settingsDesktop.overlay.showWhenAttentionRequiredSubtitle' },
                showWhenReady: { storage: { scope: 'local', key: 'desktopOverlayShowWhenReady', access: 'read_write' }, titleKey: 'settingsDesktop.overlay.showWhenReadyTitle', descriptionKey: 'settingsDesktop.overlay.showWhenReadySubtitle' },
                alwaysOnTop: { storage: { scope: 'local', key: 'desktopOverlayAlwaysOnTop', access: 'read_write' }, titleKey: 'settingsDesktop.overlay.alwaysOnTopTitle', descriptionKey: 'settingsDesktop.overlay.alwaysOnTopSubtitle' },
            },
        },
        interaction: {
            titleKey: 'settingsDesktop.overlay.interactionTitle',
            host: settingsHosts.desktop,
            settings: {
                autoHideEnabled: { storage: { scope: 'local', key: 'desktopOverlayAutoHideEnabled', access: 'read_write' }, titleKey: 'settingsDesktop.overlay.autoHideEnabledTitle', descriptionKey: 'settingsDesktop.overlay.autoHideEnabledSubtitle' },
                autoHideDelay: { titleKey: 'settingsDesktop.overlay.autoHideDelayTitle', descriptionKey: 'settingsDesktop.overlay.autoHideDelaySubtitle', storage: { scope: 'local', key: 'desktopOverlayAutoHideDelayMs', access: 'read_write', allowedValues: AUTO_HIDE_DELAY_OPTIONS.map((option) => option.value) } },
            },
        },
        placement: {
            titleKey: 'settingsDesktop.overlay.placementTitle',
            host: settingsHosts.desktop,
            settings: {
                presentationMode: { storage: { scope: 'local', key: 'desktopOverlayPresentationMode', access: 'read_write' }, titleKey: 'settingsDesktop.overlay.presentationModeTitle', descriptionKey: 'settingsDesktop.overlay.presentationModeSubtitle' },
                placementMode: { titleKey: 'settingsDesktop.overlay.placementModeTitle', descriptionKey: 'settingsDesktop.overlay.placementModeSubtitle' },
                anchorPreset: { titleKey: 'settingsDesktop.overlay.anchorPresetTitle', descriptionKey: 'settingsDesktop.overlay.anchorPresetSubtitle' },
                resetPosition: { titleKey: 'settingsDesktop.overlay.resetPositionTitle', descriptionKey: 'settingsDesktop.overlay.resetPositionSubtitle' },
                allowRepositioning: { storage: { scope: 'local', key: 'desktopOverlayEnableDragReposition', access: 'read_write' }, titleKey: 'settingsDesktop.overlay.allowRepositioningTitle', descriptionKey: 'settingsDesktop.overlay.allowRepositioningSubtitle' },
                lockPosition: { storage: { scope: 'local', key: 'desktopOverlayLockPosition', access: 'read_write' }, titleKey: 'settingsDesktop.overlay.lockPositionTitle', descriptionKey: 'settingsDesktop.overlay.lockPositionSubtitle' },
            },
        },
        presentation: {
            titleKey: 'settingsDesktop.overlay.presentationTitle',
            host: settingsHosts.desktop,
            settings: {
                showPreviewText: { storage: { scope: 'local', key: 'desktopOverlayShowPreviewText', access: 'read_write' }, titleKey: 'settingsDesktop.overlay.showPreviewTextTitle', descriptionKey: 'settingsDesktop.overlay.showPreviewTextSubtitle' },
            },
        },
    },
});
