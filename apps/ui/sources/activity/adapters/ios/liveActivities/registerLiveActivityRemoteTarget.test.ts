import { describe, expect, it, vi } from 'vitest';

import type { LiveActivityTargetRegistrationInput } from '@/sync/api/session/apiLiveActivityTargets';

import type { LiveActivitySnapshot } from './buildLiveActivitySnapshots';
import {
    buildHappierFocusLiveActivityIdentity,
    buildLiveActivityInstanceKey,
} from './liveActivityIdentity';
import type { LiveActivityPushSupport, LiveActivityPushSupportReason } from './resolveLiveActivityPushSupport';

async function loadModule() {
    return import('./registerLiveActivityRemoteTarget').catch(() => null);
}

function createSnapshot(overrides: Partial<LiveActivitySnapshot> = {}): LiveActivitySnapshot {
    return {
        version: 1,
        generatedAt: 1_000,
        staleAt: 1_801_000,
        serverId: 'server-a',
        sessionId: 'session-1',
        activityName: 'HappierFocusLiveActivity',
        activityInstanceKey: 'server-a:HappierFocusLiveActivity:session-1',
        title: 'Session work',
        subtitle: null,
        previewText: null,
        statusText: null,
        attentionState: 'thinking',
        presentationTemplate: 'quietFocus',
        apnsPriority: 5,
        relevanceScore: 50,
        defaultTarget: 'open-session:session-1?serverId=server-a',
        sessionTarget: 'open-session:session-1?serverId=server-a',
        overflowCount: 0,
        totalAttentionCount: 1,
        allowActionButtons: true,
        labels: {
            title: 'Happier Focus',
            openLabel: 'Open',
            inboxLabel: 'Inbox',
            attentionLabel: 'Attention',
        },
        ...overrides,
    };
}

function createPushSupport(overrides: Partial<{
    canRegisterRemoteTargets: boolean;
    expoWidgetsPushNotificationsEnabled: boolean;
    tokenApisAvailable: boolean;
    reasons: readonly LiveActivityPushSupportReason[];
}> = {}): LiveActivityPushSupport {
    return {
        canRegisterRemoteTargets: true,
        expoWidgetsPushNotificationsEnabled: true,
        tokenApisAvailable: true,
        reasons: [],
        ...overrides,
    };
}

describe('registerLiveActivityRemoteTarget', () => {
    it('uploads raw ActivityKit tokens only for selected direct APNs mode', async () => {
        const mod = await loadModule();
        expect(mod).not.toBeNull();
        if (!mod) return;

        const registerTarget = vi.fn(async () => ({ targetId: 'target-direct-1' }));
        const result = await mod.registerLiveActivityRemoteTargetFromTokenEvent({
            snapshot: createSnapshot(),
            event: { activityId: 'activity-native-1', pushToken: 'raw-activitykit-token' },
            registrationPlan: {
                mode: 'direct_apns',
                status: 'remote_available',
                reasons: [],
            },
            pushSupport: createPushSupport(),
            clientMetadata: {
                deviceId: 'device-1',
                bundleId: 'dev.happier.custom',
                environment: 'sandbox',
            },
            registerTarget,
        });

        expect(result).toMatchObject({ status: 'registered', targetId: 'target-direct-1' });
        expect(registerTarget).toHaveBeenCalledWith(expect.objectContaining({
            deviceId: 'device-1',
            serverId: 'server-a',
            sessionId: 'session-1',
            activityInstanceKey: 'server-a:HappierFocusLiveActivity:session-1',
            activityId: 'activity-native-1',
            activityName: 'HappierFocusLiveActivity',
            transportMode: 'direct_apns',
            tokenKind: 'activitykit_update_token',
            rawToken: 'raw-activitykit-token',
            bundleId: 'dev.happier.custom',
            environment: 'sandbox',
        }));
    });

    it('uploads encrypted selected-server ActivityKit token targets for hosted relay mode', async () => {
        const mod = await loadModule();
        expect(mod).not.toBeNull();
        if (!mod) return;

        const registerTarget = vi.fn(async () => ({ targetId: 'target-hosted-1' }));
        const result = await mod.registerLiveActivityRemoteTargetFromTokenEvent({
            snapshot: createSnapshot(),
            event: { activityId: 'activity-native-1', pushToken: 'raw-activitykit-token' },
            registrationPlan: {
                mode: 'hosted_happier_relay',
                status: 'remote_available',
                reasons: [],
            },
            pushSupport: createPushSupport(),
            clientMetadata: {
                deviceId: 'device-1',
                bundleId: 'dev.happier.app',
                environment: 'sandbox',
                clientServerUrl: 'https://self-host.example.test',
            },
            registerTarget,
        });

        expect(result).toMatchObject({
            status: 'registered',
            targetId: 'target-hosted-1',
            mode: 'hosted_happier_relay',
        });
        expect(registerTarget).toHaveBeenCalledWith(expect.objectContaining({
            deviceId: 'device-1',
            serverId: 'server-a',
            sessionId: 'session-1',
            activityInstanceKey: 'server-a:HappierFocusLiveActivity:session-1',
            activityId: 'activity-native-1',
            activityName: 'HappierFocusLiveActivity',
            transportMode: 'hosted_happier_relay',
            tokenKind: 'activitykit_update_token',
            rawToken: 'raw-activitykit-token',
            bundleId: 'dev.happier.app',
            environment: 'sandbox',
            clientServerUrl: 'https://self-host.example.test',
        }));
    });

    it('uploads registered Expo push tokens for background wake mode', async () => {
        const mod = await loadModule();
        expect(mod).not.toBeNull();
        if (!mod) return;

        const registerTarget = vi.fn(async () => ({ targetId: 'target-background-1' }));
        const result = await mod.registerLiveActivityBackgroundWakeTarget({
            snapshot: createSnapshot(),
            registrationPlan: {
                mode: 'background_wake_best_effort',
                status: 'remote_available',
                reasons: [],
            },
            clientMetadata: {
                deviceId: 'device-1',
                bundleId: 'dev.happier.app',
                environment: 'sandbox',
                clientServerUrl: 'https://self-host.example.test',
            },
            expoPushToken: 'ExponentPushToken[background-wake]',
            registerTarget,
        });

        expect(result).toMatchObject({
            status: 'registered',
            targetId: 'target-background-1',
            mode: 'background_wake_best_effort',
        });
        expect(registerTarget).toHaveBeenCalledWith(expect.objectContaining({
            deviceId: 'device-1',
            serverId: 'server-a',
            sessionId: 'session-1',
            activityInstanceKey: 'server-a:HappierFocusLiveActivity:session-1',
            activityId: 'server-a:HappierFocusLiveActivity:session-1',
            activityName: 'HappierFocusLiveActivity',
            transportMode: 'background_wake_best_effort',
            tokenKind: 'expo_push_token',
            expoPushToken: 'ExponentPushToken[background-wake]',
            clientServerUrl: 'https://self-host.example.test',
        }));
    });

    it('reports static expo-widgets push support as the blocker instead of retrying forever', async () => {
        const mod = await loadModule();
        expect(mod).not.toBeNull();
        if (!mod) return;

        const registerTarget = vi.fn(async () => ({ targetId: 'target-direct-1' }));
        const result = await mod.registerLiveActivityRemoteTargetFromTokenEvent({
            snapshot: createSnapshot(),
            event: { activityId: 'activity-native-1', pushToken: 'raw-activitykit-token' },
            registrationPlan: {
                mode: 'direct_apns',
                status: 'remote_available',
                reasons: [],
            },
            pushSupport: createPushSupport({
                canRegisterRemoteTargets: false,
                expoWidgetsPushNotificationsEnabled: false,
                reasons: ['expo_widgets_push_notifications_disabled'],
            }),
            clientMetadata: {
                deviceId: 'device-1',
                bundleId: 'dev.happier.custom',
                environment: 'sandbox',
            },
            registerTarget,
        });

        expect(result).toMatchObject({
            status: 'skipped',
            reason: 'expo_widgets_push_notifications_disabled',
        });
        expect(registerTarget).not.toHaveBeenCalled();
    });

    it('keeps serverId, sessionId, and activityName in the identity so same session ids do not collide', async () => {
        const mod = await loadModule();
        expect(mod).not.toBeNull();
        if (!mod) return;

        const registerTarget = vi.fn(async (input: LiveActivityTargetRegistrationInput) => ({
            targetId: `target:${input.activityInstanceKey}`,
        }));
        const base = createSnapshot({ sessionId: 'same-session' });
        const serverA = createSnapshot({
            ...base,
            serverId: 'server-a',
            activityInstanceKey: 'server-a:HappierFocusLiveActivity:same-session',
            defaultTarget: 'open-session:same-session?serverId=server-a',
            sessionTarget: 'open-session:same-session?serverId=server-a',
        });
        const serverB = createSnapshot({
            ...base,
            serverId: 'server-b',
            activityInstanceKey: 'server-b:HappierFocusLiveActivity:same-session',
            defaultTarget: 'open-session:same-session?serverId=server-b',
            sessionTarget: 'open-session:same-session?serverId=server-b',
        });

        await mod.registerLiveActivityRemoteTargetFromTokenEvent({
            snapshot: serverA,
            event: { activityId: 'activity-a', pushToken: 'token-a' },
            registrationPlan: { mode: 'direct_apns', status: 'remote_available', reasons: [] },
            pushSupport: createPushSupport(),
            clientMetadata: { deviceId: 'device-1', bundleId: 'dev.happier.custom', environment: 'sandbox' },
            registerTarget,
        });
        await mod.registerLiveActivityRemoteTargetFromTokenEvent({
            snapshot: serverB,
            event: { activityId: 'activity-b', pushToken: 'token-b' },
            registrationPlan: { mode: 'direct_apns', status: 'remote_available', reasons: [] },
            pushSupport: createPushSupport(),
            clientMetadata: { deviceId: 'device-1', bundleId: 'dev.happier.custom', environment: 'sandbox' },
            registerTarget,
        });

        expect(registerTarget.mock.calls.map(([input]) => ({
            serverId: input.serverId,
            sessionId: input.sessionId,
            activityName: input.activityName,
            activityInstanceKey: input.activityInstanceKey,
        }))).toEqual([
            {
                serverId: 'server-a',
                sessionId: 'same-session',
                activityName: 'HappierFocusLiveActivity',
                activityInstanceKey: 'server-a:HappierFocusLiveActivity:same-session',
            },
            {
                serverId: 'server-b',
                sessionId: 'same-session',
                activityName: 'HappierFocusLiveActivity',
                activityInstanceKey: 'server-b:HappierFocusLiveActivity:same-session',
            },
        ]);
    });

    it('marks remembered remote targets ended when a live activity is ended locally', async () => {
        const mod = await loadModule();
        expect(mod).not.toBeNull();
        if (!mod) return;

        const markTargetEnded = vi.fn(async () => undefined);
        const registry = mod.createLiveActivityRemoteTargetRegistry();
        registry.remember({
            activityInstanceKey: 'server-a:HappierFocusLiveActivity:session-1',
            targetId: 'target-direct-1',
            mode: 'direct_apns',
        });

        await registry.markEnded({
            activityInstanceKey: 'server-a:HappierFocusLiveActivity:session-1',
            markTargetEnded,
        });

        expect(markTargetEnded).toHaveBeenCalledWith('target-direct-1');
        expect(registry.getTargetId('server-a:HappierFocusLiveActivity:session-1')).toBeNull();
    });

    it('does not remove a replacement target when old target cleanup resolves later', async () => {
        const mod = await loadModule();
        expect(mod).not.toBeNull();
        if (!mod) return;

        const registry = mod.createLiveActivityRemoteTargetRegistry();
        const cleanupController: { resolve: () => void } = {
            resolve: () => {},
        };
        const cleanupBlocked = new Promise<void>((resolve) => {
            cleanupController.resolve = () => resolve();
        });
        registry.remember({
            activityInstanceKey: 'server-a:HappierFocusLiveActivity:session-1',
            targetId: 'target-direct-1',
            mode: 'direct_apns',
        });

        const cleanup = registry.markEnded({
            activityInstanceKey: 'server-a:HappierFocusLiveActivity:session-1',
            markTargetEnded: async () => cleanupBlocked,
        });
        registry.remember({
            activityInstanceKey: 'server-a:HappierFocusLiveActivity:session-1',
            targetId: 'target-background-1',
            mode: 'background_wake_best_effort',
        });
        cleanupController.resolve();
        await cleanup;

        expect(registry.getTarget('server-a:HappierFocusLiveActivity:session-1')).toEqual({
            targetId: 'target-background-1',
            mode: 'background_wake_best_effort',
        });
    });

    it('keeps replacement B current while failed-to-end A remains retryable, then removes only A', async () => {
        const mod = await loadModule();
        expect(mod).not.toBeNull();
        if (!mod) return;

        const activityInstanceKey = buildLiveActivityInstanceKey(
            buildHappierFocusLiveActivityIdentity({ serverId: 'https://home.example/a', sessionId: 'b:c' }),
        );
        const registry = mod.createLiveActivityRemoteTargetRegistry();
        registry.remember({
            activityInstanceKey,
            targetId: 'target-direct-a',
            mode: 'direct_apns',
            serverId: 'https://home.example/a',
        });
        registry.remember({
            activityInstanceKey,
            targetId: 'target-direct-b',
            mode: 'direct_apns',
            serverId: 'https://home.example/a',
        });

        const markTargetEnded = vi.fn()
            .mockRejectedValueOnce(new Error('Failed to mark Live Activity target ended: 503'))
            .mockResolvedValueOnce(undefined);

        await expect(registry.retryPendingEnds({
            activityInstanceKey,
            markTargetEnded: (targetId) => markTargetEnded(targetId),
        })).rejects.toThrow('503');
        // The new target remains current while the old exact target stays pending in this registry.
        expect(registry.getTarget(activityInstanceKey)).toEqual({
            targetId: 'target-direct-b',
            mode: 'direct_apns',
        });
        expect(registry.listTargets()).toEqual(expect.arrayContaining([
            expect.objectContaining({ targetId: 'target-direct-a' }),
            expect.objectContaining({ targetId: 'target-direct-b' }),
        ]));

        await registry.retryPendingEnds({
            activityInstanceKey,
            markTargetEnded: (targetId) => markTargetEnded(targetId),
        });

        expect(markTargetEnded.mock.calls).toEqual([['target-direct-a'], ['target-direct-a']]);
        expect(registry.getTarget(activityInstanceKey)).toEqual({
            targetId: 'target-direct-b',
            mode: 'direct_apns',
        });
        expect(registry.listTargets()).not.toEqual(expect.arrayContaining([
            expect.objectContaining({ targetId: 'target-direct-a' }),
        ]));
    });

    it('keeps the current target discoverable after a failed end and forgets it only once the retry succeeds', async () => {
        const mod = await loadModule();
        expect(mod).not.toBeNull();
        if (!mod) return;

        const activityInstanceKey = buildLiveActivityInstanceKey(
            buildHappierFocusLiveActivityIdentity({ serverId: 'https://home.example/a', sessionId: 'session-1' }),
        );
        const registry = mod.createLiveActivityRemoteTargetRegistry();
        registry.remember({
            activityInstanceKey,
            targetId: 'target-direct-a',
            mode: 'direct_apns',
            serverId: 'https://home.example/a',
        });

        const markTargetEnded = vi.fn()
            .mockRejectedValueOnce(new Error('Failed to mark Live Activity target ended: 503'))
            .mockResolvedValueOnce(undefined);

        await expect(registry.markEnded({ activityInstanceKey, markTargetEnded }))
            .rejects.toThrow('503');
        // A transport failure is not proof the Home forgot this target. Keeping the exact qualified
        // mapping is what lets the incumbent termination/reconnect reconciliation retry it, instead
        // of leaving a remote Live Activity target alive with no local record (L07-I38).
        expect(registry.getTarget(activityInstanceKey))
            .toEqual({ targetId: 'target-direct-a', mode: 'direct_apns' });
        expect(registry.listTargets()).toEqual([expect.objectContaining({ targetId: 'target-direct-a' })]);

        await registry.markEnded({ activityInstanceKey, markTargetEnded });

        expect(markTargetEnded.mock.calls).toEqual([['target-direct-a'], ['target-direct-a']]);
        expect(registry.getTarget(activityInstanceKey)).toBeNull();
        expect(registry.listTargets()).toEqual([]);
    });

    it('keeps delimiter-bearing Homes and an unbound Session distinct from a Home named local', async () => {
        const mod = await loadModule();
        expect(mod).not.toBeNull();
        if (!mod) return;

        const keys = [
            { serverId: 'https://home.example/a', sessionId: 'b:c' },
            { serverId: 'https://home.example/a:b', sessionId: 'c' },
            { serverId: 'local', sessionId: 'session-1' },
            { serverId: null, sessionId: 'session-1' },
        ].map((address) => buildLiveActivityInstanceKey(buildHappierFocusLiveActivityIdentity(address)));

        expect(new Set(keys).size).toBe(keys.length);

        const registry = mod.createLiveActivityRemoteTargetRegistry();
        keys.forEach((activityInstanceKey, index) => {
            registry.remember({ activityInstanceKey, targetId: `target-${index}`, mode: 'direct_apns' });
        });

        expect(keys.map((key) => registry.getTargetId(key))).toEqual([
            'target-0', 'target-1', 'target-2', 'target-3',
        ]);
    });

    it('skips remote registration for a Session with no Home binding instead of inventing one', async () => {
        const mod = await loadModule();
        expect(mod).not.toBeNull();
        if (!mod) return;

        const registerTarget = vi.fn(async () => ({ targetId: 'target-x' }));
        const result = await mod.registerLiveActivityRemoteTargetFromTokenEvent({
            snapshot: createSnapshot({ serverId: null }),
            event: { activityId: 'activity-a', pushToken: 'token-a' },
            registrationPlan: { mode: 'direct_apns', status: 'remote_available', reasons: [] },
            pushSupport: createPushSupport(),
            clientMetadata: { deviceId: 'device-1', bundleId: 'dev.happier.custom', environment: 'sandbox' },
            registerTarget,
        });

        expect(result).toEqual({ status: 'skipped', reason: 'home_binding_missing', mode: 'direct_apns' });
        expect(registerTarget).not.toHaveBeenCalled();
    });
});
