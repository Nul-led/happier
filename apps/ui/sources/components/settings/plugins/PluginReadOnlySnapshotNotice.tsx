import * as React from 'react';

import { AttentionBanner } from '@/components/ui/lists/AttentionBanner';
import { t } from '@/text';

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

/**
 * The plugin page's read-only notice: the plugin copy for why the list is read-only, shown through the
 * one tinted page notice (`AttentionBanner`) with Retry as its action when a failed read can be retried.
 */
export const PluginReadOnlySnapshotNotice = React.memo(function PluginReadOnlySnapshotNotice(props: Readonly<{
    testID: string;
    reason: PluginReadOnlySnapshotReason;
    onRetry?: () => void;
}>) {
    const refreshing = props.reason === 'refreshing';
    // Only failed reads from a reachable machine can be retried here.
    const onRetry = props.reason === 'projectionUnavailable' || props.reason === 'installationUnavailable' ? props.onRetry : undefined;
    return (
        <AttentionBanner
            testID={props.testID}
            tone={refreshing ? 'neutral' : 'warning'}
            title={t(refreshing ? 'common.loading' : 'common.unavailable')}
            description={resolveNoticeSubtitle(props.reason)}
            accessibilityLiveRegion="polite"
            action={onRetry ? { label: t('common.retry'), onPress: onRetry, testID: `${props.testID}-retry` } : null}
        />
    );
});
