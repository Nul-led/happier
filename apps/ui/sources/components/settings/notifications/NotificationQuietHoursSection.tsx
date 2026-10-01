import * as React from 'react';

import { ItemGroup } from '@/components/ui/lists/ItemGroup';
import { SegmentedChoiceItem } from '@/components/ui/lists/SegmentedChoiceItem';
import { SettingAnchor } from '@/components/settings/shell/SettingRow';
import { NOTIFICATIONS_SETTINGS } from '@/components/settings/notifications/notificationsSettings';
import type { AttentionDeviceOverridesV1 } from '@/sync/domains/settings/attentionDeviceOverridesV1';
import { t } from '@/text';
import type { AttentionDeliveryPolicyV1 } from '@happier-dev/protocol';
import {
    isNightlyQuietHoursWindowSet,
    NIGHTLY_QUIET_HOURS_WINDOW,
} from '@/activity/delivery/resolveQuietHoursState';

type QuietHoursOverride = AttentionDeviceOverridesV1['quietHoursOverride'];
type QuietHoursPolicy = AttentionDeliveryPolicyV1['quietHours'];
/** `custom` is a schedule the presets do not describe; it is shown, never offered. */
type AccountQuietHoursChoice = 'off' | 'nightly' | 'custom';
type DeviceQuietHoursChoice = 'account' | 'disabled' | 'nightly' | 'custom';

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

    const accountChoice: AccountQuietHoursChoice = !accountEnabled ? 'off' : accountNightlySelected ? 'nightly' : 'custom';
    const deviceChoice: DeviceQuietHoursChoice = deviceOverride.mode === 'account'
        ? 'account'
        : deviceOverride.mode === 'disabled'
            ? 'disabled'
            : deviceNightlySelected ? 'nightly' : 'custom';
    const withZone = (text: string, zone: string | undefined) => (zone ? `${text} · ${zone}` : text);

    return (
        <ItemGroup
            title={t('settingsNotifications.quietHours.title')}
            description={t('settingsNotifications.quietHours.footer')}
        >
            <SettingAnchor setting={NOTIFICATIONS_SETTINGS.settings.quietHoursAccount}>
                <SegmentedChoiceItem<AccountQuietHoursChoice>
                    // Remount when the schedule leaves the presets so no stale selection stays drawn.
                    key={accountChoice === 'custom' ? 'account-custom' : 'account-preset'}
                    testID="settings-notifications-quiet-hours-account"
                    testIDPrefix="settings-notifications-quiet-hours-account"
                    title={t(NOTIFICATIONS_SETTINGS.settings.quietHoursAccount.titleKey)}
                    // A schedule these presets do not describe is shown as such; choosing a preset replaces it.
                    subtitle={t('settingsNotifications.quietHours.customSubtitle')}
                    subtitleLines={0}
                    value={accountChoice}
                    onChange={(next) => {
                        if (next === 'off') setAccountOff();
                        else if (next === 'nightly') setAccountNightly();
                    }}
                    options={[
                        { id: 'off', label: t('settingsNotifications.quietHours.offShort'), description: t('settingsNotifications.quietHours.accountOffSubtitle') },
                        {
                            id: 'nightly',
                            label: t('settingsNotifications.quietHours.nightlyShort'),
                            description: withZone(t('settingsNotifications.quietHours.accountNightlySubtitle'), accountScheduleTimezone),
                        },
                    ]}
                />
            </SettingAnchor>
            <SettingAnchor setting={NOTIFICATIONS_SETTINGS.settings.quietHoursDevice}>
                <SegmentedChoiceItem<DeviceQuietHoursChoice>
                    key={deviceChoice === 'custom' ? 'device-custom' : 'device-preset'}
                    testID="settings-notifications-quiet-hours-device"
                    testIDPrefix="settings-notifications-quiet-hours-device"
                    title={t(NOTIFICATIONS_SETTINGS.settings.quietHoursDevice.titleKey)}
                    subtitle={t('settingsNotifications.quietHours.customSubtitle')}
                    subtitleLines={0}
                    value={deviceChoice}
                    onChange={(next) => {
                        if (next === 'account') setDeviceQuietHoursOverride({ mode: 'account' });
                        else if (next === 'disabled') setDeviceQuietHoursOverride({ mode: 'disabled' });
                        else if (next === 'nightly') setDeviceCustomNightly();
                    }}
                    options={[
                        { id: 'account', label: t('settingsNotifications.quietHours.syncedShort'), description: t('settingsNotifications.quietHours.deviceAccountSubtitle') },
                        { id: 'disabled', label: t('settingsNotifications.quietHours.offShort'), description: t('settingsNotifications.quietHours.deviceDisabledSubtitle') },
                        {
                            id: 'nightly',
                            label: t('settingsNotifications.quietHours.nightlyShort'),
                            description: withZone(t('settingsNotifications.quietHours.deviceCustomNightlySubtitle'), deviceScheduleTimezone),
                        },
                    ]}
                />
            </SettingAnchor>
        </ItemGroup>
    );
}
