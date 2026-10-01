import { defineSettingsPage, settingsHosts } from '@/components/settings/catalog/settingDeclarations';

/** The searchable settings of the `plugins` page. Rows render their labels from these declarations. */
export const PLUGINS_SETTINGS = defineSettingsPage({
    pageId: 'plugins',
    sections: {
        updates: {
            titleKey: 'settingsPlugins.surfaces.updatesTitle',
            settings: {
                updateReview: { storage: { scope: 'account', key: 'pluginUpdateReviewModeV1', access: 'read_write' }, titleKey: 'settingsPlugins.updateReview.title' },
            },
        },
        // Native apps only, and only while a plugin offers an app panel (page state).
        appPanels: {
            host: settingsHosts.native,
            settings: {
                appPanels: { titleKey: 'settingsPlugins.appPanelsTitle', descriptionKey: 'settingsPlugins.appPanelsSubtitle' },
            },
        },
        more: {
            titleKey: 'settingsPlugins.surfaces.forDevelopers',
            settings: {
                sourceAdministration: { titleKey: 'settingsPlugins.sourceAdministration.title', descriptionKey: 'settingsPlugins.sourceAdministration.subtitle' },
                development: { titleKey: 'settingsPlugins.views.development', descriptionKey: 'settingsPlugins.developerDevelopmentSubtitle' },
                diagnostics: { titleKey: 'settingsPlugins.views.diagnostics', descriptionKey: 'settingsPlugins.developerDiagnosticsSubtitle' },
            },
        },
        moreWebhooks: {
            titleKey: 'settingsPlugins.surfaces.forDevelopers',
            featureId: 'plugins.webhooks',
            settings: {
                webhookAdministration: { titleKey: 'settingsPlugins.webhookAdministration.title', descriptionKey: 'settingsPlugins.webhookAdministration.footer' },
            },
        },
    },
});
