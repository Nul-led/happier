import * as React from 'react';

import { useUnistyles } from 'react-native-unistyles';

import { Item } from '@/components/ui/lists/Item';
import { ItemGroup } from '@/components/ui/lists/ItemGroup';
import type { AttentionDeviceOverridesV1 } from '@/sync/domains/settings/attentionDeviceOverridesV1';
import { t } from '@/text';
import type { AttentionDeliveryPolicyV1 } from '@happier-dev/protocol';
import { Icon } from '@/components/ui/icons/Icon';
import {
    isNightlyQuietHoursWindowSet,
    NIGHTLY_QUIET_HOURS_WINDOW,
} from '@/activity/delivery/resolveQuietHoursState';

type QuietHoursOverride = AttentionDeviceOverridesV1['quietHoursOverride'];
type QuietHoursPolicy = AttentionDeliveryPolicyV1['quietHours'];

type NotificationQuietHoursSectionProps = Readonly<{
    policy: AttentionDeliveryPolicyV1;
    deviceOverride: QuietHoursOverride;
    setAccountQuietHours: (quietHours: QuietHoursPolicy) => void;
    setDeviceQuietHoursOverride: (override: QuietHoursOverride) => void;
}>;

function readDeviceTimezone(): string {
    try {
        return Intl.DateTimeFormat().resolvedOptions().timeZone || '';
    } catch {
        return '';
    }
}

function resolveDefaultTimezone(policy: AttentionDeliveryPolicyV1): string {
    const configured = policy.quietHours.timezone.trim();
    if (configured.length > 0 && configured !== 'UTC') {
        return configured;
    }

    return readDeviceTimezone() || configured || 'UTC';
}

/**
 * The schedule's own zone, shown only when it is not this device's. Quiet hours are local times in
 * an Account-wide zone, so a device in another zone is otherwise told "10 PM to 7 AM" while the
 * effective window is somewhere else entirely — the one reachable cross-device untruth here.
 */
function foreignScheduleTimezone(timezone: string | undefined): string | undefined {
    const configured = timezone?.trim();
    if (!configured) return undefined;
    const device = readDeviceTimezone();
    return device && configured !== device ? configured : undefined;
}

export function NotificationQuietHoursSection({
    policy,
    deviceOverride,
    setAccountQuietHours,
    setDeviceQuietHoursOverride,
}: NotificationQuietHoursSectionProps): React.ReactElement {
    const { theme } = useUnistyles();
    const accountEnabled = policy.quietHours.enabled === true;
    // Selected means "this row IS the configured schedule", so a foreign or richer schedule is
    // neither mislabelled nor silently replaced by pressing the preset.
    const accountNightlySelected = accountEnabled && isNightlyQuietHoursWindowSet(policy.quietHours.windows);
    const deviceNightlySelected = deviceOverride.mode === 'custom'
        && isNightlyQuietHoursWindowSet(deviceOverride.windows);
    const accountScheduleTimezone = accountEnabled ? foreignScheduleTimezone(policy.quietHours.timezone) : undefined;
    const deviceScheduleTimezone = deviceOverride.mode === 'custom'
        ? foreignScheduleTimezone(deviceOverride.timezone)
        : undefined;

    const setAccountOff = React.useCallback(() => {
        setAccountQuietHours({
            enabled: false,
            timezone: resolveDefaultTimezone(policy),
            windows: [],
        });
    }, [policy, setAccountQuietHours]);

    const setAccountNightly = React.useCallback(() => {
        setAccountQuietHours({
            enabled: true,
            timezone: resolveDefaultTimezone(policy),
            windows: [
                {
                    ...NIGHTLY_QUIET_HOURS_WINDOW,
                },
            ],
        });
    }, [policy, setAccountQuietHours]);

    const setDeviceCustomNightly = React.useCallback(() => {
        setDeviceQuietHoursOverride({
            mode: 'custom',
            timezone: resolveDefaultTimezone(policy),
            windows: [
                {
                    ...NIGHTLY_QUIET_HOURS_WINDOW,
                },
            ],
        });
    }, [policy, setDeviceQuietHoursOverride]);

    return (
        <ItemGroup
            title={t('settingsNotifications.quietHours.title')}
            footer={t('settingsNotifications.quietHours.footer')}
        >
            <Item
                testID="settings-notifications-quiet-hours-account-off"
                title={t('settingsNotifications.quietHours.accountOffTitle')}
                subtitle={t('settingsNotifications.quietHours.accountOffSubtitle')}
                icon={<Icon name="bell" size={29} color={theme.colors.accent.blue} />}
                selected={!accountEnabled}
                onPress={setAccountOff}
                showChevron={false}
            />
            <Item
                testID="settings-notifications-quiet-hours-account-nightly"
                title={t('settingsNotifications.quietHours.accountNightlyTitle')}
                subtitle={t('settingsNotifications.quietHours.accountNightlySubtitle')}
                icon={<Icon name="moon" size={29} color={theme.colors.text.secondary} />}
                detail={accountScheduleTimezone}
                selected={accountNightlySelected}
                onPress={setAccountNightly}
                showChevron={false}
            />
            <Item
                testID="settings-notifications-quiet-hours-device-account"
                title={t('settingsNotifications.quietHours.deviceAccountTitle')}
                subtitle={t('settingsNotifications.quietHours.deviceAccountSubtitle')}
                icon={<Icon name="device-mobile" size={29} color={theme.colors.text.secondary} />}
                selected={deviceOverride.mode === 'account'}
                onPress={() => setDeviceQuietHoursOverride({ mode: 'account' })}
                showChevron={false}
            />
            <Item
                testID="settings-notifications-quiet-hours-device-disabled"
                title={t('settingsNotifications.quietHours.deviceDisabledTitle')}
                subtitle={t('settingsNotifications.quietHours.deviceDisabledSubtitle')}
                icon={<Icon name="bell-slash" size={29} color={theme.colors.text.secondary} />}
                selected={deviceOverride.mode === 'disabled'}
                onPress={() => setDeviceQuietHoursOverride({ mode: 'disabled' })}
                showChevron={false}
            />
            <Item
                testID="settings-notifications-quiet-hours-device-custom-nightly"
                title={t('settingsNotifications.quietHours.deviceCustomNightlyTitle')}
                subtitle={t('settingsNotifications.quietHours.deviceCustomNightlySubtitle')}
                icon={<Icon name="moon" size={29} color={theme.colors.text.secondary} />}
                detail={deviceScheduleTimezone}
                selected={deviceNightlySelected}
                onPress={setDeviceCustomNightly}
                showChevron={false}
            />
        </ItemGroup>
    );
}
