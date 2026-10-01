import * as React from 'react';
import { useRouter } from '@/components/appShell/workspace/destinationRoute';

import { ItemGroup } from '@/components/ui/lists/ItemGroup';
import { t } from '@/text';
import type { LocalServicePreviewPlatform } from '@/sync/domains/local/services/preview/url';
import { useCompactAppDestinations } from '@/components/appShell/destinations/compactAppDestinationCatalog';
import { SettingRow } from '@/components/settings/shell/SettingRow';
import { PLUGINS_SETTINGS } from '@/components/settings/plugins/pluginsSettings';
import { PLUGIN_PANELS_ROUTE } from '@/components/settings/plugins/model/pluginsSurfaceRoutes';
import { settingRendersOnHost } from '@/components/settings/catalog/settingDeclarations';
import { Icon } from '@/components/ui/icons/Icon';

export type NativeAppPluginPanelsSettingsEntryProps = Readonly<{
    platform?: LocalServicePreviewPlatform;
}>;

export function NativeAppPluginPanelsSettingsEntry(
    props: NativeAppPluginPanelsSettingsEntryProps,
): React.ReactElement | null {
    const router = useRouter();
    const nativeApp = props.platform
        ? props.platform === 'ios' || props.platform === 'android'
        : settingRendersOnHost(PLUGINS_SETTINGS.settings.appPanels);
    const compactDestinations = useCompactAppDestinations();
    const hasAvailableAppPanel = compactDestinations.some((destination) => (
        destination.kind === 'plugin'
        && destination.container === 'rightSidebarTab'
        && destination.availability === 'available'
    ));

    if (!nativeApp || !hasAvailableAppPanel) {
        return null;
    }

    return (
        <ItemGroup>
            <SettingRow
                testID="settings.plugins.appPanels"
                icon={<Icon name="puzzle-piece" />}
                accessibilityLabel={t('settingsPlugins.appPanelsTitle')}
                setting={PLUGINS_SETTINGS.settings.appPanels}
                onPress={() => router.push(PLUGIN_PANELS_ROUTE)}
            />
        </ItemGroup>
    );
}
