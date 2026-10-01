import * as React from 'react';

import { useUnistyles } from 'react-native-unistyles';

import { RoundButton } from '@/components/ui/buttons/RoundButton';
import { ActivitySpinner } from '@/components/ui/feedback/ActivitySpinner';
import { Switch } from '@/components/ui/forms/Switch';
import { Icon } from '@/components/ui/icons/Icon';
import { Item } from '@/components/ui/lists/Item';
import { ItemGroup } from '@/components/ui/lists/ItemGroup';
import { t } from '@/text';
import { SettingRow } from '@/components/settings/shell/SettingRow';
import { NOTIFICATIONS_SETTINGS } from '@/components/settings/notifications/notificationsSettings';

export type RemoteAlertRegistrationStatus = Readonly<{
    accountPolicy: 'loading' | 'unavailable' | 'disabled' | 'current' | 'stale' | 'pending';
    supported: boolean;
    nativeAvailable: boolean;
    deviceEnrollment: 'loading' | 'unavailable' | 'disabled' | 'enrolled' | 'enrolling' | 'removing';
    refreshing: boolean;
}>;

type NotificationRemoteAlertsSectionProps = Readonly<{
    homeName: string;
    accountEnabled: boolean;
    deviceEnabled: boolean;
    nativeDevice: boolean;
    registration: RemoteAlertRegistrationStatus;
    setAccountEnabled: (enabled: boolean) => void;
    setDeviceEnabled: (enabled: boolean) => void;
    refresh: () => void;
}>;

export function NotificationRemoteAlertsSection({
    homeName, accountEnabled, deviceEnabled, nativeDevice, registration,
    setAccountEnabled, setDeviceEnabled, refresh,
}: NotificationRemoteAlertsSectionProps): React.ReactElement {
    const { theme } = useUnistyles();
    const accountDisabled = !registration.supported && !accountEnabled;
    const deviceDisabled = (!registration.supported || !registration.nativeAvailable) && !deviceEnabled;
    const policyLabel = registration.accountPolicy === 'loading'
        ? t('common.loading')
        : t(`settingsNotifications.remoteAlerts.${registration.accountPolicy}`);
    const deviceEnrollmentLabel = registration.deviceEnrollment === 'loading'
        ? t('common.loading')
        : registration.deviceEnrollment === 'unavailable'
            ? t('settingsNotifications.remoteAlerts.deviceUnavailable')
            : registration.deviceEnrollment === 'enrolled'
                ? t('settingsNotifications.remoteAlerts.deviceEnrolled')
                : registration.deviceEnrollment === 'disabled'
                    ? t('settingsNotifications.remoteAlerts.deviceNotEnrolled')
                    : t('settingsNotifications.remoteAlerts.pending');

    return <ItemGroup
        title={t('settingsNotifications.remoteAlerts.title')}
        description={t('settingsNotifications.remoteAlerts.footer')}
        action={(
            <RoundButton
                testID="settings-notifications-remote-refresh"
                size="small"
                display="inverted"
                title={t('common.refresh')}
                leading={registration.refreshing
                    ? <ActivitySpinner size="small" />
                    : <Icon name="arrows-clockwise" size={14} color={theme.colors.text.secondary} />}
                disabled={registration.refreshing}
                onPress={refresh}
            />
        )}
    >
        <SettingRow
            testID="settings-notifications-remote-account"
            setting={NOTIFICATIONS_SETTINGS.settings.account}
            titleLines={0}
            subtitleLines={0}
            showChevron={false}
            rightElement={<Switch
                testID="settings-notifications-remote-account-switch"
                value={accountEnabled}
                disabled={accountDisabled}
                onValueChange={(enabled) => { if (!enabled || registration.supported) setAccountEnabled(enabled); }}
            />}
        />
        <Item
            testID={`settings-notifications-remote-policy-${registration.accountPolicy}`}
            title={t('settingsNotifications.remoteAlerts.statusTitle')}
            subtitle={`${policyLabel}\n${t('settingsNotifications.remoteAlerts.statusHelp')}`}
            detail={homeName}
            titleLines={0}
            subtitleLines={0}
            mode="info"
            accessibilityLiveRegion="polite"
        />
        {nativeDevice ? <SettingRow
            testID="settings-notifications-remote-device"
            setting={NOTIFICATIONS_SETTINGS.settings.device}
            subtitle={`${t('settingsNotifications.remoteAlerts.deviceSubtitle')}\n${deviceEnrollmentLabel}`}
            titleLines={0}
            subtitleLines={0}
            showChevron={false}
            accessibilityLiveRegion="polite"
            loading={registration.deviceEnrollment === 'loading'
                || registration.deviceEnrollment === 'enrolling'
                || registration.deviceEnrollment === 'removing'}
            rightElement={<Switch
                testID="settings-notifications-remote-device-switch"
                value={deviceEnabled}
                disabled={deviceDisabled}
                onValueChange={(enabled) => {
                    if (!enabled || (registration.supported && registration.nativeAvailable)) setDeviceEnabled(enabled);
                }}
            />}
        /> : null}
        {registration.nativeAvailable ? <Item
            title={t('settingsNotifications.remoteAlerts.supportedEvents')}
            titleLines={0}
            mode="info"
        /> : null}
    </ItemGroup>;
}
