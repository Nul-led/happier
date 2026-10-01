import { SETTINGS_ROUTES } from '@/components/settings/catalog/routes';
import { PLUGINS_SETTINGS } from '@/components/settings/plugins/pluginsSettings';

export type PluginsDeveloperRoute =
    | typeof SETTINGS_ROUTES.pluginSources
    | typeof SETTINGS_ROUTES.pluginDevelopment
    | typeof SETTINGS_ROUTES.pluginDiagnostics
    | typeof SETTINGS_ROUTES.pluginWebhooks;

type PluginsSettingDefinition = (typeof PLUGINS_SETTINGS.settings)[keyof typeof PLUGINS_SETTINGS.settings];

export type PluginsDeveloperLink = Readonly<{ testID: string; setting: PluginsSettingDefinition; route: PluginsDeveloperRoute }>;

/**
 * "For developers": where plugins come from, building your own, and what the machine reports. They
 * are Settings pages of their own in both hosts; the Plugins page footer and the Plugins column both
 * list exactly these.
 */
export function listPluginsDeveloperLinks(params: Readonly<{ webhooksAvailable: boolean }>): readonly PluginsDeveloperLink[] {
    return [
        { testID: 'settings.plugins.sources', setting: PLUGINS_SETTINGS.settings.sourceAdministration, route: SETTINGS_ROUTES.pluginSources },
        { testID: 'settings.plugins.development', setting: PLUGINS_SETTINGS.settings.development, route: SETTINGS_ROUTES.pluginDevelopment },
        { testID: 'settings.plugins.diagnostics', setting: PLUGINS_SETTINGS.settings.diagnostics, route: SETTINGS_ROUTES.pluginDiagnostics },
        ...(params.webhooksAvailable ? [{
            testID: 'settings.plugins.webhooks',
            setting: PLUGINS_SETTINGS.settings.webhookAdministration,
            route: SETTINGS_ROUTES.pluginWebhooks,
        }] : []),
    ];
}
