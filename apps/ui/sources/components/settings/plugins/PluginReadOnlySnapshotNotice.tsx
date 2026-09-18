import * as React from 'react';
import { View } from 'react-native';
import { useUnistyles } from 'react-native-unistyles';

import { Item } from '@/components/ui/lists/Item';
import { t } from '@/text';
import { Icon } from '@/components/ui/icons/Icon';

import type { PluginReadOnlySnapshotReason } from './model/pluginMarketplaceModel';

function resolveNoticeSubtitle(reason: PluginReadOnlySnapshotReason): string {
    if (reason === 'refreshing') {
        return t('settingsPlugins.readOnlyRefreshing');
    }
    if (reason === 'installationUnavailable') {
        return t('settingsPlugins.installationReadUnavailable');
    }
    if (reason === 'projectionUnavailable') {
        return t('settingsPlugins.readOnlyProjectionUnavailable');
    }
    if (reason === 'accountRecovery') {
        return t('settingsPlugins.readOnlyAccountRecovery');
    }
    return t('settingsPlugins.readOnlySnapshot');
}

export const PluginReadOnlySnapshotNotice = React.memo(function PluginReadOnlySnapshotNotice(props: Readonly<{
    testID: string;
    reason: PluginReadOnlySnapshotReason;
    onRetry?: () => void;
}>) {
    const { theme } = useUnistyles();
    const subtitle = resolveNoticeSubtitle(props.reason);
    // Only failed reads from a reachable machine can be retried here.
    const onRetry = props.reason === 'projectionUnavailable' || props.reason === 'installationUnavailable' ? props.onRetry : undefined;

    return (
        <View
            testID={props.testID}
            accessible={!onRetry}
            accessibilityLiveRegion="polite"
            {...(onRetry ? {} : { accessibilityLabel: subtitle })}
        >
            <Item
                testID={onRetry ? `${props.testID}-retry` : undefined}
                title={t(props.reason === 'refreshing' ? 'common.loading' : 'common.unavailable')}
                subtitle={subtitle}
                subtitleLines={0}
                icon={<Icon name={props.reason === 'refreshing' ? 'arrow-clockwise' : 'cloud-slash'} size={29} color={theme.colors.text.secondary} />}
                showChevron={false}
                mode={onRetry ? 'interactive' : 'info'}
                {...(onRetry ? { detail: t('common.retry'), onPress: onRetry, accessibilityLabel: `${subtitle} ${t('common.retry')}` } : {})}
            />
        </View>
    );
});
