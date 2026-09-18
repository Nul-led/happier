import { describe, expect, it } from 'vitest';

import { accountSettingsParse } from '@happier-dev/protocol';

import { localSettingsDefaults, localSettingsParse } from '@/sync/domains/settings/localSettings';

import { resolveActivityAttentionDeliveryPlan } from './resolveActivityAttentionDeliveryPlan';
import { ACTIVITY_SURFACE_SELECTION_IDS } from '../selection/activitySurfaceSelectionTypes';

describe('resolveActivityAttentionDeliveryPlan', () => {
    it.each(['permission_request', 'user_action_request'] as const)('keeps %s privacy independent from ready previews', (event) => {
        const params = {
            accountSettings: accountSettingsParse({}),
            localSettings: localSettingsParse({ attentionDeviceOverridesV1: { localNotifications: {
                previewBehavior: 'account', requestPreviewBehavior: 'status_only',
            } } }),
            channel: 'local_notification' as const,
            now: new Date('2026-05-03T12:00:00.000Z'),
        };
        expect(resolveActivityAttentionDeliveryPlan({ ...params, event }).previewBehavior).toBe('status_only');
        expect(resolveActivityAttentionDeliveryPlan({ ...params, event }).delivery).toBe('deliver');
        expect(resolveActivityAttentionDeliveryPlan({ ...params, event: 'ready' }).previewBehavior).toBe('include_preview');
    });

    it('uses the account delivery policy by default', () => {
        const plan = resolveActivityAttentionDeliveryPlan({
            accountSettings: accountSettingsParse({}),
            localSettings: localSettingsDefaults,
            event: 'ready',
            channel: 'local_notification',
            now: new Date('2026-05-03T12:00:00.000Z'),
        });

        expect(plan.delivery).toBe('deliver');
        expect(plan.reason).toBe('deliver');
    });

    it('falls back safely when the account delivery policy is malformed', () => {
        const plan = resolveActivityAttentionDeliveryPlan({
            accountSettings: {
                notificationsSettingsV1: {
                    v: 1,
                    pushEnabled: false,
                    ready: false,
                },
                attentionDeliveryPolicyV1: 'malformed-policy',
            },
            localSettings: localSettingsDefaults,
            event: 'ready',
            channel: 'local_notification',
            now: new Date('2026-05-03T12:00:00.000Z'),
        });

        expect(plan.delivery).toBe('suppress');
        expect(plan.reason).toBe('event_disabled');
    });

    it('lets device overrides suppress local notification events without mutating account settings', () => {
        const accountSettings = accountSettingsParse({});
        const localSettings = localSettingsParse({
            attentionDeviceOverridesV1: {
                v: 1,
                localNotifications: {
                    events: {
                        ready: false,
                    },
                },
            },
        });

        const plan = resolveActivityAttentionDeliveryPlan({
            accountSettings,
            localSettings,
            event: 'ready',
            channel: 'local_notification',
            now: new Date('2026-05-03T12:00:00.000Z'),
        });

        expect(plan.delivery).toBe('suppress');
        expect(plan.reason).toBe('event_disabled');
        expect(accountSettings.attentionDeliveryPolicyV1.channels.local_notification.events.ready.enabled).toBe(true);
    });

    it('lets a device disable account quiet hours for local channels', () => {
        const accountSettings = accountSettingsParse({
            attentionDeliveryPolicyV1: {
                v: 1,
                quietHours: {
                    enabled: true,
                    timezone: 'UTC',
                    windows: [{ startLocalTime: '09:00', endLocalTime: '17:00' }],
                },
            },
        });
        const localSettings = localSettingsParse({
            attentionDeviceOverridesV1: {
                v: 1,
                quietHoursOverride: { mode: 'disabled' },
            },
        });

        const plan = resolveActivityAttentionDeliveryPlan({
            accountSettings,
            localSettings,
            event: 'ready',
            channel: 'local_notification',
            now: new Date('2026-05-03T12:00:00.000Z'),
        });

        expect(plan.delivery).toBe('deliver');
        expect(plan.reason).toBe('deliver');
    });

    it('uses custom device quiet hours when configured', () => {
        const accountSettings = accountSettingsParse({
            attentionDeliveryPolicyV1: {
                v: 1,
                quietHours: {
                    enabled: false,
                    timezone: 'UTC',
                    windows: [],
                },
            },
        });
        const localSettings = localSettingsParse({
            attentionDeviceOverridesV1: {
                v: 1,
                quietHoursOverride: {
                    mode: 'custom',
                    timezone: 'UTC',
                    windows: [{ startLocalTime: '09:00', endLocalTime: '17:00' }],
                },
            },
        });

        const plan = resolveActivityAttentionDeliveryPlan({
            accountSettings,
            localSettings,
            event: 'ready',
            channel: 'local_notification',
            now: new Date('2026-05-03T12:00:00.000Z'),
        });

        expect(plan.delivery).toBe('suppress');
        expect(plan.reason).toBe('quiet_hours');
        expect(accountSettings.attentionDeliveryPolicyV1.quietHours).toEqual({
            enabled: false,
            timezone: 'UTC',
            windows: [],
        });
    });

    it('uses account defaults when device overrides are disabled', () => {
        const localSettings = localSettingsParse({
            attentionDeviceOverridesV1: {
                v: 1,
                enabled: false,
                localNotifications: {
                    enabled: false,
                    events: {
                        ready: false,
                    },
                },
                quietHoursOverride: {
                    mode: 'custom',
                    timezone: 'UTC',
                    windows: [{ startLocalTime: '09:00', endLocalTime: '17:00' }],
                },
            },
        });

        const plan = resolveActivityAttentionDeliveryPlan({
            accountSettings: accountSettingsParse({}),
            localSettings,
            event: 'ready',
            channel: 'local_notification',
            now: new Date('2026-05-03T12:00:00.000Z'),
        });

        expect(plan.delivery).toBe('deliver');
        expect(plan.reason).toBe('deliver');
    });

    it('mutes local notification sounds when disabled on this device', () => {
        const localSettings = localSettingsParse({
            attentionDeviceOverridesV1: {
                v: 1,
                sounds: {
                    enabled: false,
                },
            },
        });

        const plan = resolveActivityAttentionDeliveryPlan({
            accountSettings: accountSettingsParse({}),
            localSettings,
            event: 'ready',
            channel: 'local_notification',
            now: new Date('2026-05-03T12:00:00.000Z'),
        });

        expect(plan.delivery).toBe('deliver');
        expect(plan.sound).toMatchObject({ kind: 'none', volume: 1 });
    });

    it('applies device sound volume without changing the account-selected notification sound', () => {
        const localSettings = localSettingsParse({
            attentionDeviceOverridesV1: {
                v: 1,
                sounds: {
                    volume: 0.25,
                },
            },
        });

        const cases = [
            {
                accountSettings: accountSettingsParse({}),
                expectedSound: { kind: 'bundled', id: 'soft', volume: 0.25 },
            },
            {
                accountSettings: accountSettingsParse({
                    attentionDeliveryPolicyV1: {
                        v: 1,
                        sounds: {
                            defaultSoundId: 'default',
                        },
                    },
                }),
                expectedSound: { kind: 'system_default', id: 'default', volume: 0.25 },
            },
        ];

        for (const testCase of cases) {
            const plan = resolveActivityAttentionDeliveryPlan({
                accountSettings: testCase.accountSettings,
                localSettings,
                event: 'ready',
                channel: 'local_notification',
                now: new Date('2026-05-03T12:00:00.000Z'),
            });

            expect(plan.sound).toMatchObject(testCase.expectedSound);
        }
    });

    it('preserves shared protocol suppression inputs', () => {
        const plan = resolveActivityAttentionDeliveryPlan({
            accountSettings: accountSettingsParse({}),
            localSettings: localSettingsDefaults,
            event: 'ready',
            channel: 'local_notification',
            sameSessionVisible: true,
            now: new Date('2026-05-03T12:00:00.000Z'),
        });

        expect(plan.delivery).toBe('suppress');
        expect(plan.reason).toBe('same_session_visible');
    });

    it('lets this device disable terminal-frontmost smart suppression', () => {
        const localSettings = localSettingsParse({
            attentionDeviceOverridesV1: {
                v: 1,
                terminalSmartSuppression: {
                    enabled: false,
                },
            },
        });

        const plan = resolveActivityAttentionDeliveryPlan({
            accountSettings: accountSettingsParse({}),
            localSettings,
            event: 'ready',
            channel: 'local_notification',
            terminalFrontmost: true,
            now: new Date('2026-05-03T12:00:00.000Z'),
        });

        expect(plan.delivery).toBe('deliver');
        expect(plan.reason).toBe('deliver');
    });

    it('returns feature-disabled and platform-unsupported decisions from injected facts', () => {
        expect(resolveActivityAttentionDeliveryPlan({
            accountSettings: accountSettingsParse({}),
            localSettings: localSettingsDefaults,
            event: 'ready',
            channel: 'live_activity',
            featureEnabled: false,
            now: new Date('2026-05-03T12:00:00.000Z'),
        })).toMatchObject({ delivery: 'suppress', reason: 'feature_disabled' });

        expect(resolveActivityAttentionDeliveryPlan({
            accountSettings: accountSettingsParse({}),
            localSettings: localSettingsDefaults,
            event: 'ready',
            channel: 'live_activity',
            platformSupported: false,
            now: new Date('2026-05-03T12:00:00.000Z'),
        })).toMatchObject({ delivery: 'suppress', reason: 'unsupported_surface' });
    });

    it('applies device badge filters and per-surface privacy overrides', () => {
        const localSettings = localSettingsParse({
            attentionDeviceOverridesV1: {
                v: 1,
                badge: {
                    enabled: true,
                    includeUnread: false,
                },
                liveActivities: {
                    privacyMode: 'status_only',
                },
            },
        });

        expect(resolveActivityAttentionDeliveryPlan({
            accountSettings: accountSettingsParse({}),
            localSettings,
            event: 'ready',
            channel: 'badge',
            now: new Date('2026-05-03T12:00:00.000Z'),
        })).toMatchObject({ delivery: 'suppress', reason: 'event_disabled' });

        expect(resolveActivityAttentionDeliveryPlan({
            accountSettings: accountSettingsParse({}),
            localSettings,
            event: 'ready',
            channel: 'live_activity',
            now: new Date('2026-05-03T12:00:00.000Z'),
        })).toMatchObject({ previewBehavior: 'status_only' });
    });

    it.each([
        ['live_activity', 'liveActivities'],
        ['home_widget', 'widgets'],
    ] as const)(
        'treats Account and device privacy as independent ceilings for %s',
        (channel, deviceOverrideKey) => {
            const accountStatusOnly = accountSettingsParse({
                attentionDeliveryPolicyV1: {
                    v: 1,
                    privacy: { surfaces: { [channel]: 'status_only' } },
                },
            });
            const deviceIncludePreview = localSettingsParse({
                attentionDeviceOverridesV1: {
                    v: 1,
                    [deviceOverrideKey]: { privacyMode: 'include_preview' },
                },
            });

            const accountCeilingPlan = resolveActivityAttentionDeliveryPlan({
                accountSettings: accountStatusOnly,
                localSettings: deviceIncludePreview,
                event: 'ready',
                channel,
                surface: channel,
                now: new Date('2026-05-03T12:00:00.000Z'),
            });

            expect(accountCeilingPlan.previewBehavior).toBe('status_only');
            expect(accountCeilingPlan.surfacePolicy.privacyMode).toBe('status_only');

            const accountIncludePreview = accountSettingsParse({
                attentionDeliveryPolicyV1: {
                    v: 1,
                    privacy: { surfaces: { [channel]: 'include_preview' } },
                },
            });
            const deviceStatusOnly = localSettingsParse({
                attentionDeviceOverridesV1: {
                    v: 1,
                    [deviceOverrideKey]: { privacyMode: 'status_only' },
                },
            });

            const deviceCeilingPlan = resolveActivityAttentionDeliveryPlan({
                accountSettings: accountIncludePreview,
                localSettings: deviceStatusOnly,
                event: 'ready',
                channel,
                surface: channel,
                now: new Date('2026-05-03T12:00:00.000Z'),
            });

            expect(deviceCeilingPlan.previewBehavior).toBe('status_only');
            expect(deviceCeilingPlan.surfacePolicy.privacyMode).toBe('status_only');
        },
    );

    it.each(['live_activity', 'home_widget'] as const)(
        'preserves the Account default privacy ceiling for %s when the device default is broader',
        (channel) => {
            const plan = resolveActivityAttentionDeliveryPlan({
                accountSettings: accountSettingsParse({
                    attentionDeliveryPolicyV1: {
                        v: 1,
                        privacy: { defaultPreviewBehavior: 'status_only' },
                    },
                }),
                localSettings: localSettingsParse({
                    attentionDeviceOverridesV1: {
                        v: 1,
                        privacy: { previewBehavior: 'include_preview' },
                    },
                }),
                event: 'ready',
                channel,
                surface: channel,
                now: new Date('2026-05-03T12:00:00.000Z'),
            });

            expect(plan.previewBehavior).toBe('status_only');
            expect(plan.surfacePolicy.privacyMode).toBe('status_only');
        },
    );

    it.each([
        ['permission_request', 'live_activity', 'liveActivities'],
        ['permission_request', 'home_widget', 'widgets'],
        ['user_action_request', 'live_activity', 'liveActivities'],
        ['user_action_request', 'home_widget', 'widgets'],
    ] as const)(
        'caps final %s preview precedence for %s with both Account and device surface ceilings',
        (event, channel, deviceOverrideKey) => {
            const deviceCeilingPlan = resolveActivityAttentionDeliveryPlan({
                accountSettings: accountSettingsParse({
                    attentionDeliveryPolicyV1: {
                        v: 1,
                        events: { [event]: { previewBehavior: 'include_preview' } },
                        privacy: { surfaces: { [channel]: 'include_preview' } },
                    },
                }),
                localSettings: localSettingsParse({
                    attentionDeviceOverridesV1: {
                        v: 1,
                        [deviceOverrideKey]: { privacyMode: 'status_only' },
                    },
                }),
                event,
                channel,
                surface: channel,
                now: new Date('2026-05-03T12:00:00.000Z'),
            });

            expect(deviceCeilingPlan.previewBehavior).toBe('status_only');
            expect(deviceCeilingPlan.surfacePolicy.privacyMode).toBe('status_only');

            const accountCeilingPlan = resolveActivityAttentionDeliveryPlan({
                accountSettings: accountSettingsParse({
                    attentionDeliveryPolicyV1: {
                        v: 1,
                        events: { [event]: { previewBehavior: 'include_preview' } },
                        privacy: { surfaces: { [channel]: 'status_only' } },
                    },
                }),
                localSettings: localSettingsParse({
                    attentionDeviceOverridesV1: {
                        v: 1,
                        [deviceOverrideKey]: { privacyMode: 'include_preview' },
                    },
                }),
                event,
                channel,
                surface: channel,
                now: new Date('2026-05-03T12:00:00.000Z'),
            });

            expect(accountCeilingPlan.previewBehavior).toBe('status_only');
            expect(accountCeilingPlan.surfacePolicy.privacyMode).toBe('status_only');
        },
    );

    it('returns pure surface, privacy, stale, dwell, update-budget, and channel decisions', () => {
        const plan = resolveActivityAttentionDeliveryPlan({
            accountSettings: accountSettingsParse({}),
            localSettings: localSettingsDefaults,
            event: 'ready',
            channel: 'live_activity',
            now: new Date('2026-05-03T12:00:00.000Z'),
            surface: 'live_activity',
            requestedSelection: {
                surfaceId: ACTIVITY_SURFACE_SELECTION_IDS.liveActivities,
                enabled: true,
                mode: 'attention',
                selectionReason: 'dynamic_primary',
                maxSelected: 1,
                includeUrgent: true,
                includeReady: true,
                includeThinking: true,
                includeQuietActive: false,
                activeOnly: false,
            },
            staleAfterMs: 30 * 60 * 1_000,
            dwellMs: 2_500,
            updateBudget: {
                minUpdateIntervalMs: 30_000,
                maxUpdatesPerWindow: 4,
                windowMs: 120_000,
                reason: 'locked',
            },
        });

        expect(plan).toMatchObject({
            delivery: 'deliver',
            channelDecision: {
                channel: 'live_activity',
                delivery: 'deliver',
                reason: 'deliver',
            },
            surfacePolicy: {
                surface: 'live_activity',
                selection: {
                    surfaceId: ACTIVITY_SURFACE_SELECTION_IDS.liveActivities,
                    selectionReason: 'dynamic_primary',
                },
                privacyMode: 'include_preview',
                staleAfterMs: 1_800_000,
                dwellMs: 2_500,
                updateBudget: {
                    minUpdateIntervalMs: 30_000,
                    maxUpdatesPerWindow: 4,
                    windowMs: 120_000,
                    reason: 'locked',
                },
            },
        });
    });
});
