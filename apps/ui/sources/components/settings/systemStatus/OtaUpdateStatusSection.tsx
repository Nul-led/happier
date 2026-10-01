import * as React from 'react';
import { useRouter } from '@/components/appShell/workspace/destinationRoute';
import { useUnistyles } from 'react-native-unistyles';
import { Icon } from '@/components/ui/icons/Icon';

import { Item } from '@/components/ui/lists/Item';
import { ItemGroup } from '@/components/ui/lists/ItemGroup';
import { Text } from '@/components/ui/text/Text';
import { useUpdates } from '@/hooks/inbox/useUpdates';
import { useNativeUpdate } from '@/hooks/ui/useNativeUpdate';
import { UPDATES_ROUTE } from '@/components/updates/updatesRoute';
import { t } from '@/text';

function toErrorMessage(error: unknown): string | null {
    if (error instanceof Error) {
        const message = error.message.trim();
        return message || null;
    }

    if (typeof error === 'string') {
        const message = error.trim();
        return message || null;
    }

    return null;
}

function formatLastChecked(value: Date | undefined): string {
    return value instanceof Date ? value.toLocaleString() : t('status.unknown');
}

function formatDownloadProgress(progress: number | undefined): string | undefined {
    if (typeof progress !== 'number' || !Number.isFinite(progress)) {
        return undefined;
    }

    const clamped = Math.max(0, Math.min(100, Math.round(progress * 100)));
    return `${clamped}%`;
}

/**
 * Diagnostics only: what the store and OTA owners report. The update itself — the store link, the
 * OTA check and the restart — lives in Settings › Updates, the one entry (plan R13 (e)).
 */
export const OtaUpdateStatusSection = React.memo(function OtaUpdateStatusSection() {
    const { theme } = useUnistyles();
    const router = useRouter();
    const updateUrl = useNativeUpdate();
    const {
        otaRuntimeSupported,
        isDownloading,
        isUpdatePending,
        downloadProgress,
        checkError,
        downloadError,
        lastCheckForUpdateTimeSinceRestart,
    } = useUpdates();

    const errorMessage = toErrorMessage(downloadError) ?? toErrorMessage(checkError);
    const openUpdates = React.useCallback(() => {
        router.push(UPDATES_ROUTE);
    }, [router]);

    if (!updateUrl && !otaRuntimeSupported) {
        return null;
    }

    return (
        <ItemGroup title={t('systemStatus.sections.updates')}>
            {otaRuntimeSupported ? (
                <Item
                    title={t('updateBanner.lastCheckedTitle')}
                    detail={isDownloading ? formatDownloadProgress(downloadProgress) : formatLastChecked(lastCheckForUpdateTimeSinceRestart)}
                    subtitle={errorMessage
                        ? <Text style={{ color: theme.colors.text.secondary }}>{errorMessage}</Text>
                        : isUpdatePending ? t('updateBanner.updateAvailable') : undefined}
                    mode="info"
                />
            ) : null}
            <Item
                icon={<Icon name="download" />}
                testID="system-status-open-updates"
                title={t('updates.action.openUpdates')}
                {...(updateUrl ? { subtitle: t('updateBanner.nativeUpdateAvailable') } : {})}
                onPress={openUpdates}
            />
        </ItemGroup>
    );
});
