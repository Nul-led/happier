import * as React from 'react';

import { Switch } from '@/components/ui/forms/Switch';
import { Item } from '@/components/ui/lists/Item';
import { ItemGroup } from '@/components/ui/lists/ItemGroup';
import { t } from '@/text';

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
        footer={t('settingsNotifications.remoteAlerts.footer')}
    >
        <Item
            testID="settings-notifications-remote-account"
            title={t('settingsNotifications.remoteAlerts.accountTitle')}
            subtitle={t('settingsNotifications.remoteAlerts.disclosure')}
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
        {nativeDevice ? <Item
            testID="settings-notifications-remote-device"
            title={t('settingsNotifications.remoteAlerts.deviceTitle')}
            subtitle={`${t('settingsNotifications.remoteAlerts.deviceSubtitle')}\n${deviceEnrollmentLabel}`}
            titleLines={0}
            subtitleLines={0}
            showChevron={false}
            accessibilityLiveRegion="polite"
            accessibilityState={{
                busy: registration.deviceEnrollment === 'loading'
                    || registration.deviceEnrollment === 'enrolling'
                    || registration.deviceEnrollment === 'removing',
            }}
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
        <Item
            testID="settings-notifications-remote-refresh"
            title={t('common.refresh')}
            onPress={refresh}
            loading={registration.refreshing}
            disabled={registration.refreshing}
            showChevron={false}
        />
    </ItemGroup>;
}
