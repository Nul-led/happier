import * as React from 'react';
import { useUnistyles } from 'react-native-unistyles';

import { Item } from '@/components/ui/lists/Item';
import { ItemGroup } from '@/components/ui/lists/ItemGroup';
import { t } from '@/text';

import {
    projectInstalledPluginLifecycleCapabilities,
    type InstalledPluginEntry,
} from '../model/pluginMarketplaceModel';
import { Icon } from '@/components/ui/icons/Icon';
import type { InstalledPluginActionId } from '../model/usePluginSettingsScreenState';

export function PluginDetailActionsSection(props: Readonly<{
    installed: InstalledPluginEntry;
    actionInFlight: boolean;
    canRunActions: boolean;
    onAction: (action: InstalledPluginActionId, pluginId: string) => void;
}>) {
    const { theme } = useUnistyles();
    const capabilities = projectInstalledPluginLifecycleCapabilities(props.installed);
    const toggleAction = props.installed.enabled ? 'disable' : 'enable';
    const canToggle = props.installed.enabled ? capabilities.canDisable : capabilities.canEnable;
    const disabled = !props.canRunActions || props.actionInFlight;

    if (!canToggle
        && !capabilities.canUpdate
        && !capabilities.canRollback
        && !capabilities.canUninstall
        && !capabilities.canForgetTrust) return null;

    return (
        <ItemGroup title={t('common.actions')}>
            {canToggle ? (
                <Item
                    testID={`settings.plugins.detail.${props.installed.pluginId}.action.${toggleAction}`}
                    title={props.installed.enabled ? t('common.disable') : t('common.enable')}
                    subtitle={props.installed.enabled ? t('common.enabled') : t('common.disabled')}
                    icon={(
                        <Icon
                            name={props.installed.enabled ? 'x-circle' : 'check-circle'}
                            size={29}
                            color={theme.colors.text.secondary}
                        />
                    )}
                    onPress={() => props.onAction(toggleAction, props.installed.pluginId)}
                    disabled={disabled}
                    showChevron={false}
                />
            ) : null}
            {capabilities.canRollback ? (
                <Item
                    testID={`settings.plugins.detail.${props.installed.pluginId}.action.rollback`}
                    title={t('settingsPlugins.rollback')}
                    icon={<Icon name="arrow-elbow-down-left" size={29} color={theme.colors.text.secondary} />}
                    onPress={() => props.onAction('rollback', props.installed.pluginId)}
                    disabled={disabled}
                    showChevron={false}
                />
            ) : null}
            {capabilities.canUpdate ? (
                <Item
                    testID={`settings.plugins.detail.${props.installed.pluginId}.action.update`}
                    title={t('common.update')}
                    subtitle={t('settingsPlugins.updateFromInstalledRecordSubtitle')}
                    icon={<Icon name="arrow-circle-up" size={29} color={theme.colors.text.secondary} />}
                    onPress={() => props.onAction('update', props.installed.pluginId)}
                    disabled={disabled}
                    showChevron={false}
                />
            ) : null}
            {/*
              * Uninstall removes the installation and forgetting trust
              * withdraws the grant that lets its code run — both discard state
              * the reader cannot get back by pressing the row again, so they
              * carry the destructive treatment the rest of the list does not.
              */}
            {capabilities.canUninstall ? (
                <Item
                    testID={`settings.plugins.detail.${props.installed.pluginId}.action.uninstall`}
                    title={t('settingsPlugins.uninstall')}
                    icon={<Icon name="trash" size={29} color={theme.colors.state.danger.foreground} />}
                    onPress={() => props.onAction('uninstall', props.installed.pluginId)}
                    disabled={disabled}
                    destructive
                    showChevron={false}
                />
            ) : null}
            {capabilities.canForgetTrust ? (
                <Item
                    testID={`settings.plugins.detail.${props.installed.pluginId}.action.forgetTrust`}
                    title={t('settingsPlugins.forgetTrust')}
                    icon={<Icon name="shield" size={29} color={theme.colors.state.danger.foreground} />}
                    onPress={() => props.onAction('forgetTrust', props.installed.pluginId)}
                    disabled={disabled}
                    destructive
                    showChevron={false}
                />
            ) : null}
        </ItemGroup>
    );
}
