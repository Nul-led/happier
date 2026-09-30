import * as React from 'react';
import { useUnistyles } from 'react-native-unistyles';

import { Item } from '@/components/ui/lists/Item';
import { ItemGroup } from '@/components/ui/lists/ItemGroup';
import { Icon } from '@/components/ui/icons/Icon';
import { useDesktopUpdater } from '@/desktop/updates/useDesktopUpdater';
import { t } from '@/text';
import { isDesktopHost } from '@/utils/platform/desktopHost';

function DesktopUpdateStatusContent() {
    const { theme } = useUnistyles();
    const updater = useDesktopUpdater();
    const installing = updater.status === 'installing';
    const busy = updater.isChecking || installing;
    const status = !updater.checksEnabled
        ? t('systemStatus.updates.disabled')
        : updater.isChecking
            ? t('systemStatus.updates.checking')
            : installing
                ? t('systemStatus.updates.applying')
                : updater.status === 'upToDate'
                    ? t('systemStatus.updates.upToDate')
                    : updater.status === 'error'
                        ? t('systemStatus.updates.error')
                        : updater.availableVersion
                            ? t('systemStatus.updates.available')
                            : t('systemStatus.updates.unknown');
    const canShowInstall = updater.availableVersion && (
        updater.status === 'available' || updater.status === 'dismissed' || installing
    );

    return (
        <ItemGroup title={t('systemStatus.updates.desktopTitle')}>
            <Item
                testID="settings-desktop-update-check"
                title={t('systemStatus.updates.checkNow')}
                subtitle={status}
                onPress={updater.refresh}
                loading={updater.isChecking}
                disabled={!updater.checksEnabled || busy}
                showChevron={false}
                icon={<Icon name="arrow-clockwise" size={24} color={theme.colors.accent.indigo} />}
            />
            <Item
                testID="settings-desktop-update-last-checked"
                title={t('systemStatus.updates.lastChecked')}
                detail={updater.lastCheckedAt === null ? t('status.unknown') : new Date(updater.lastCheckedAt).toLocaleString()}
                mode="info"
                icon={<Icon name="clock" size={24} color={theme.colors.accent.orange} />}
            />
            {canShowInstall ? (
                <Item
                    testID="settings-desktop-update-install"
                    title={t('systemStatus.updates.applyNow')}
                    detail={updater.availableVersion ?? undefined}
                    onPress={updater.startInstall}
                    loading={installing}
                    disabled={!updater.checksEnabled || busy}
                    showChevron={false}
                    icon={<Icon name="download" size={24} color={theme.colors.accent.indigo} />}
                />
            ) : null}
        </ItemGroup>
    );
}

export function DesktopUpdateStatusSection() {
    return isDesktopHost() ? <DesktopUpdateStatusContent /> : null;
}
