import * as React from 'react';

import { Switch } from '@/components/ui/forms/Switch';
import { ItemGroup } from '@/components/ui/lists/ItemGroup';
import type { LocalSettings } from '@/sync/domains/settings/localSettings';
import { t } from '@/text';
import { SettingRow } from '@/components/settings/shell/SettingRow';
import { NOTIFICATIONS_SETTINGS } from '@/components/settings/notifications/notificationsSettings';

type NotificationLocalDeviceSectionProps = Readonly<{
    localSettings: LocalSettings;
    setLocalSetting: (delta: Partial<LocalSettings>) => void;
}>;

export function NotificationLocalDeviceSection({
    localSettings,
    setLocalSetting,
}: NotificationLocalDeviceSectionProps): React.ReactElement {
    const deviceOverrides = localSettings.attentionDeviceOverridesV1;
    const localNotifications = deviceOverrides.localNotifications;
    const disabled = deviceOverrides.enabled === false || localNotifications.enabled === false;
    const setLocalNotifications = React.useCallback((
        next: Partial<typeof localNotifications>,
    ) => {
        setLocalSetting({
            attentionDeviceOverridesV1: {
                ...deviceOverrides,
                localNotifications: {
                    ...localNotifications,
                    ...next,
                },
            },
        });
    }, [deviceOverrides, localNotifications, setLocalSetting]);
    const setLocalNotificationEvent = React.useCallback((
        event: keyof typeof localNotifications.events,
        enabled: boolean,
    ) => {
        setLocalNotifications({
            events: {
                ...localNotifications.events,
                [event]: enabled,
            },
        });
    }, [localNotifications.events, setLocalNotifications]);

    return (
        <ItemGroup
            title={t('settingsNotifications.local.title')}
            description={t('settingsNotifications.local.footer')}
        >
            <SettingRow
                testID="settings-notifications-local-enabled"
                setting={NOTIFICATIONS_SETTINGS.settings.localEnabled}
                rightElement={(
                    <Switch
                        value={!disabled}
                        onValueChange={(value) => setLocalNotifications({ enabled: Boolean(value) })}
                    />
                )}
                showChevron={false}
            />
            <SettingRow
                setting={NOTIFICATIONS_SETTINGS.settings.ready}
                rightElement={(
                    <Switch
                        value={localNotifications.events.ready !== false}
                        disabled={disabled}
                        onValueChange={(value) => setLocalNotificationEvent('ready', Boolean(value))}
                    />
                )}
                showChevron={false}
            />
            <SettingRow
                setting={NOTIFICATIONS_SETTINGS.settings.readyPreview}
                rightElement={(
                    <Switch
                        value={localNotifications.previewBehavior !== 'status_only'}
                        disabled={disabled || localNotifications.events.ready === false}
                        onValueChange={(value) => setLocalNotifications({
                            previewBehavior: Boolean(value) ? 'account' : 'status_only',
                        })}
                    />
                )}
                showChevron={false}
            />
            <SettingRow
                setting={NOTIFICATIONS_SETTINGS.settings.requestPreview}
                rightElement={(
                    <Switch
                        value={localNotifications.requestPreviewBehavior !== 'status_only'}
                        disabled={disabled || (localNotifications.events.permission_request === false && localNotifications.events.user_action_request === false)}
                        onValueChange={(value) => setLocalNotifications({
                            requestPreviewBehavior: Boolean(value) ? 'account' : 'status_only',
                        })}
                    />
                )}
                showChevron={false}
            />
            <SettingRow
                setting={NOTIFICATIONS_SETTINGS.settings.localPermissionRequests}
                rightElement={(
                    <Switch
                        value={localNotifications.events.permission_request !== false}
                        disabled={disabled}
                        onValueChange={(value) => setLocalNotificationEvent('permission_request', Boolean(value))}
                    />
                )}
                showChevron={false}
            />
            <SettingRow
                setting={NOTIFICATIONS_SETTINGS.settings.localUserActions}
                rightElement={(
                    <Switch
                        value={localNotifications.events.user_action_request !== false}
                        disabled={disabled}
                        onValueChange={(value) => setLocalNotificationEvent('user_action_request', Boolean(value))}
                    />
                )}
                showChevron={false}
            />
        </ItemGroup>
    );
}
