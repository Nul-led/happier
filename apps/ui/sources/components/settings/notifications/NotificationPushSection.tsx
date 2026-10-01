import * as React from 'react';

import { Switch } from '@/components/ui/forms/Switch';
import { ItemGroup } from '@/components/ui/lists/ItemGroup';
import { t } from '@/text';
import { SettingRow } from '@/components/settings/shell/SettingRow';
import { NOTIFICATIONS_SETTINGS } from '@/components/settings/notifications/notificationsSettings';
import { Icon } from '@/components/ui/icons/Icon';

type NotificationPushSectionProps = Readonly<{
    homeName: string;
    pushEnabled: boolean;
    setPushEnabled: (enabled: boolean) => void;
    openPushTroubleshooting: () => void;
}>;

export function NotificationPushSection({
    homeName,
    pushEnabled,
    setPushEnabled,
    openPushTroubleshooting,
}: NotificationPushSectionProps): React.ReactElement {

    return (
        <ItemGroup
            title={t('settingsNotifications.push.title')}
            description={t('settingsNotifications.push.footer', { home: homeName })}
        >
            <SettingRow
                testID="settings-notifications-push-enabled"
                setting={NOTIFICATIONS_SETTINGS.settings.pushEnabled}
                subtitle={t('settingsNotifications.push.enabledSubtitle', { home: homeName })}
                rightElement={(
                    <Switch
                        value={pushEnabled}
                        onValueChange={(value) => setPushEnabled(Boolean(value))}
                    />
                )}
                showChevron={false}
            />
            <SettingRow
                testID="settings-notifications-push-troubleshoot"
                icon={<Icon name="question" />}
                setting={NOTIFICATIONS_SETTINGS.settings.troubleshoot}
                onPress={openPushTroubleshooting}
            />
        </ItemGroup>
    );
}
