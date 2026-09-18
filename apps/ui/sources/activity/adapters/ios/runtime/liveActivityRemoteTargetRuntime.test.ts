import { describe, expect, it, vi } from 'vitest';
import {
    FeaturesResponseSchema,
    buildLiveActivityRemoteUpdateCapabilityDiagnostics,
} from '@happier-dev/protocol';

import { settingsDefaults } from '@/sync/domains/settings/settings';
import { localSettingsDefaults } from '@/sync/domains/settings/localSettings';
import {
    markLiveActivityTargetEnded,
    registerLiveActivityTarget,
} from '@/sync/api/session/apiLiveActivityTargets';

import type { LiveActivitySnapshot } from '../liveActivities/buildLiveActivitySnapshots';
import {
    buildHappierFocusLiveActivityIdentity,
    buildLiveActivityInstanceKey,
} from '../liveActivities/liveActivityIdentity';
import { createLiveActivityRemoteTargetRegistry } from '../liveActivities/registerLiveActivityRemoteTarget';
import {
    reconcileLiveActivityRemoteTargetRegistration,
    resolveLiveActivityRemoteRegistrationPlan,
    type LiveActivityPushTokenSubscription,
} from './liveActivityRemoteTargetRuntime';

vi.mock('expo-constants', () => ({
    default: {
        expoConfig: {
            ios: {
                bundleIdentifier: 'dev.happier.custom',
            },
            plugins: [
                ['expo-widgets', { enablePushNotifications: true, widgets: [] }],
            ],
        },
        installationId: 'device-1',
    },
}));

vi.mock('@/sync/api/session/apiLiveActivityTargets', () => ({
    registerLiveActivityTarget: vi.fn(async () => ({ targetId: 'target-direct-1' })),
    markLiveActivityTargetEnded: vi.fn(async () => undefined),
}));

vi.mock('@/sync/domains/state/pushTokenRegistration', () => ({
    loadLastRegisteredExpoPushToken: () => null,
}));

function createLiveActivitySnapshot(overrides: Partial<LiveActivitySnapshot> = {}): LiveActivitySnapshot {
    return {
        version: 1,
        generatedAt: 1_000,
        staleAt: 31_000,
        serverId: 'server-a',
        sessionId: 'permission',
        activityName: 'HappierFocusLiveActivity',
        activityInstanceKey: 'server-a:HappierFocusLiveActivity:permission',
        title: 'Permission required',
        subtitle: null,
        previewText: null,
        statusText: null,
        attentionState: 'permission_required',
        presentationTemplate: 'urgentAttention',
        apnsPriority: 10,
        relevanceScore: 100,
        defaultTarget: 'open-session:permission?serverId=server-a',
        sessionTarget: 'open-session:permission?serverId=server-a',
        overflowCount: 0,
        totalAttentionCount: 1,
        allowActionButtons: true,
        labels: {
            title: 'Live Activities',
            openLabel: 'Open',
            inboxLabel: 'Inbox',
            attentionLabel: 'Attention',
        },
        ...overrides,
    };
}

function createDirectApnsInputs(serverIds: readonly string[]) {
    const featuresPayload = FeaturesResponseSchema.parse({
        features: {},
        capabilities: {
            liveActivities: {
                remoteUpdates: buildLiveActivityRemoteUpdateCapabilityDiagnostics({
                    expoWidgetsPushNotificationsEnabled: true,
                    hostedRelay: {
                        allowed: false,
                        capabilityAvailable: false,
                        providerImplemented: false,
                    },
                    directApns: {
                        configured: true,
                    },
                    backgroundWake: {
                        enabled: false,
                    },
                }),
            },
        },
    });

    return {
        accountSettings: {
            ...settingsDefaults,
            attentionDeliveryPolicyV1: {
                ...settingsDefaults.attentionDeliveryPolicyV1,
                v: 1 as const,
                liveActivityRemoteUpdates: {
                    ...settingsDefaults.attentionDeliveryPolicyV1.liveActivityRemoteUpdates,
                    enabled: true,
                    preferredMode: 'direct_apns' as const,
                    allowBackgroundWakeFallback: false,
                },
            },
        },
        localSettings: {
            ...localSettingsDefaults,
            attentionDeviceOverridesV1: {
                ...localSettingsDefaults.attentionDeviceOverridesV1,
                v: 1 as const,
                liveActivities: {
                    ...localSettingsDefaults.attentionDeviceOverridesV1.liveActivities,
                    registerRemoteUpdateTargets: true,
                },
            },
        },
        serverFeaturesSnapshot: {
            status: 'ready' as const,
            serverIds: [...serverIds],
            snapshotsByServerId: Object.fromEntries(serverIds.map((serverId) => [serverId, {
                status: 'ready' as const,
                features: featuresPayload,
            }])),
        },
    };
}

describe('liveActivityRemoteTargetRuntime', () => {
    it('plans remote enrollment from the snapshot Home Account policy, not the active Account', () => {
        const homeA = 'server-a';
        const homeB = 'server-b';
        const directApnsInputs = createDirectApnsInputs([homeA, homeB]);
        // Home B's Account has turned remote Live Activity updates off. Home A's has not.
        // Neither answer may change because the other Home happens to be active locally.
        const accountSettingsByServerId: Record<string, typeof directApnsInputs.accountSettings> = {
            [homeA]: directApnsInputs.accountSettings,
            [homeB]: {
                ...directApnsInputs.accountSettings,
                attentionDeliveryPolicyV1: {
                    ...directApnsInputs.accountSettings.attentionDeliveryPolicyV1,
                    liveActivityRemoteUpdates: {
                        ...directApnsInputs.accountSettings.attentionDeliveryPolicyV1.liveActivityRemoteUpdates,
                        enabled: false,
                    },
                },
            },
        };
        const planFor = (serverId: string) => resolveLiveActivityRemoteRegistrationPlan({
            snapshot: createLiveActivitySnapshot({
                serverId,
                activityInstanceKey: buildLiveActivityInstanceKey(
                    buildHappierFocusLiveActivityIdentity({ serverId, sessionId: 'permission' }),
                ),
            }),
            accountSettings: accountSettingsByServerId[serverId] ?? null,
            localSettings: directApnsInputs.localSettings,
            serverFeaturesSnapshot: directApnsInputs.serverFeaturesSnapshot,
        });

        expect(planFor(homeA)).toEqual({ mode: 'direct_apns', status: 'remote_available', reasons: [] });
        expect(planFor(homeB)).toEqual({ mode: 'disabled', status: 'disabled', reasons: [] });
    });

    it('fails closed when the snapshot Home has no resolvable Account settings', () => {
        const directApnsInputs = createDirectApnsInputs(['server-a']);

        expect(resolveLiveActivityRemoteRegistrationPlan({
            snapshot: createLiveActivitySnapshot(),
            accountSettings: null,
            localSettings: directApnsInputs.localSettings,
            serverFeaturesSnapshot: directApnsInputs.serverFeaturesSnapshot,
        })).toEqual({ mode: 'disabled', status: 'disabled', reasons: [] });
    });

    it('continues without a remote token listener when ActivityKit listener attachment fails', () => {
        const pushTokenSubscriptions = new Map<string, LiveActivityPushTokenSubscription>();
        const directApnsInputs = createDirectApnsInputs(['server-a']);

        expect(() => {
            reconcileLiveActivityRemoteTargetRegistration({
                handle: {
                    addPushTokenListener: () => {
                        throw new Error('ActivityKit token listener unavailable');
                    },
                },
                snapshot: createLiveActivitySnapshot(),
                ...directApnsInputs,
                pushTokenSubscriptions,
                remoteTargetRegistry: createLiveActivityRemoteTargetRegistry(),
            });
        }).not.toThrow();

        expect(pushTokenSubscriptions.size).toBe(0);
    });

    it('retains a failed replacement cleanup for retry without ending the new target or a same-id Session on another Home', async () => {
        const homeA = 'https://home.example/a';
        const homeB = 'https://home.example/a:b';
        const sessionId = 'b:c';
        const activityName = 'HappierFocusLiveActivity';
        const homeAKey = buildLiveActivityInstanceKey(
            buildHappierFocusLiveActivityIdentity({ serverId: homeA, sessionId }),
        );
        const homeBKey = buildLiveActivityInstanceKey(
            buildHappierFocusLiveActivityIdentity({ serverId: homeB, sessionId }),
        );
        const homeASnapshot = createLiveActivitySnapshot({
            serverId: homeA,
            sessionId,
            activityName,
            activityInstanceKey: homeAKey,
        });
        const homeBSnapshot = createLiveActivitySnapshot({
            serverId: homeB,
            sessionId,
            activityName,
            activityInstanceKey: homeBKey,
        });
        const listeners = new Map<string, (event: { activityId: string; pushToken: string }) => void>();
        const registry = createLiveActivityRemoteTargetRegistry();
        const pushTokenSubscriptions = new Map<string, LiveActivityPushTokenSubscription>();
        const directApnsInputs = createDirectApnsInputs([homeA, homeB]);
        const mockedRegisterTarget = vi.mocked(registerLiveActivityTarget);
        const mockedMarkTargetEnded = vi.mocked(markLiveActivityTargetEnded);
        mockedRegisterTarget
            .mockResolvedValueOnce({ targetId: 'target-home-a-old' })
            .mockResolvedValueOnce({ targetId: 'target-home-b' })
            .mockResolvedValueOnce({ targetId: 'target-home-a-current' });
        mockedMarkTargetEnded
            .mockRejectedValueOnce(new Error('Failed to mark Live Activity target ended: 503'))
            .mockResolvedValueOnce(undefined);

        for (const snapshot of [homeASnapshot, homeBSnapshot]) {
            reconcileLiveActivityRemoteTargetRegistration({
                handle: {
                    addPushTokenListener: (listener) => {
                        listeners.set(snapshot.activityInstanceKey, listener);
                        return { remove: () => listeners.delete(snapshot.activityInstanceKey) };
                    },
                },
                snapshot,
                ...directApnsInputs,
                pushTokenSubscriptions,
                remoteTargetRegistry: registry,
            });
        }

        listeners.get(homeAKey)?.({ activityId: 'native-home-a-old', pushToken: 'token-home-a-old' });
        await vi.waitFor(() => expect(registry.getTargetId(homeAKey)).toBe('target-home-a-old'));
        listeners.get(homeBKey)?.({ activityId: 'native-home-b', pushToken: 'token-home-b' });
        await vi.waitFor(() => expect(registry.getTargetId(homeBKey)).toBe('target-home-b'));
        listeners.get(homeAKey)?.({ activityId: 'native-home-a-current', pushToken: 'token-home-a-current' });

        await vi.waitFor(() => expect(mockedMarkTargetEnded).toHaveBeenCalledTimes(1));
        expect(mockedMarkTargetEnded).toHaveBeenLastCalledWith('target-home-a-old', { serverId: homeA });
        expect(registry.getTarget(homeAKey)).toEqual({
            targetId: 'target-home-a-current',
            mode: 'direct_apns',
        });
        expect(registry.getTarget(homeBKey)).toEqual({
            targetId: 'target-home-b',
            mode: 'direct_apns',
        });
        expect(registry.listTargets()).toEqual(expect.arrayContaining([
            expect.objectContaining({ activityInstanceKey: homeAKey, targetId: 'target-home-a-old', serverId: homeA }),
            expect.objectContaining({ activityInstanceKey: homeAKey, targetId: 'target-home-a-current', serverId: homeA }),
            expect.objectContaining({ activityInstanceKey: homeBKey, targetId: 'target-home-b', serverId: homeB }),
        ]));

        reconcileLiveActivityRemoteTargetRegistration({
            handle: {},
            snapshot: homeASnapshot,
            ...directApnsInputs,
            pushTokenSubscriptions,
            remoteTargetRegistry: registry,
        });

        await vi.waitFor(() => expect(mockedMarkTargetEnded).toHaveBeenCalledTimes(2));
        expect(mockedMarkTargetEnded).toHaveBeenLastCalledWith('target-home-a-old', { serverId: homeA });
        expect(registry.listTargets()).toEqual(expect.arrayContaining([
            expect.objectContaining({ activityInstanceKey: homeAKey, targetId: 'target-home-a-current' }),
            expect.objectContaining({ activityInstanceKey: homeBKey, targetId: 'target-home-b' }),
        ]));
        expect(registry.listTargets()).not.toEqual(expect.arrayContaining([
            expect.objectContaining({ targetId: 'target-home-a-old' }),
        ]));
    });
});
