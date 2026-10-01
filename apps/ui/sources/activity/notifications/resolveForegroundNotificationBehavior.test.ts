import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PUSH_NOTIFICATION_CATEGORY_IDS } from '@happier-dev/protocol';

import { settingsParse } from '@/sync/domains/settings/settings';
import { localSettingsParse } from '@/sync/domains/settings/localSettings';
import { saveAccountSettings } from '@/sync/domains/state/accountSettingsPersistence';
import type { ServerAccountScope } from '@/sync/domains/scope/serverAccountScope';

import { consumeOtherLegActivityAlertPresentation, noteActivityAlertPresented, resetActivityAlertPresentationNotesForTests } from './remoteAlerts/activityAlertPresentationNotes';

// Device secure-credential storage is the only mocked boundary: which Account
// this device holds for a Home. The saved-Home profiles, the strict remote-alert
// parser, the exact-Home settings read, the Account policy and the delivery plan
// all stay real.
const credentialScopes = new Map<string, ServerAccountScope>();
vi.mock('@/sync/domains/scope/serverCredentialAccountScope', () => ({
    resolveServerCredentialAccountScope: async (serverId: string) => {
        const scope = credentialScopes.get(serverId);
        return scope ? { kind: 'bound' as const, scope } : { kind: 'signed_out' as const };
    },
}));

const serverProfiles = await import('@/sync/domains/server/serverProfiles');
const { resolveForegroundNotificationBehavior } = await import('./resolveForegroundNotificationBehavior');

type Home = Readonly<{ scope: ServerAccountScope; serverUrl: string; portableId: string }>;

async function clearProfiles(): Promise<void> {
    for (const profile of serverProfiles.listServerProfiles()) {
        await serverProfiles.removeServerProfile(profile.id);
    }
}

async function enrollHome(name: string, settings: unknown): Promise<Home> {
    const serverUrl = `https://${name}.example.test`;
    const profile = await serverProfiles.upsertServerProfile({ serverUrl, name });
    const portableId = `srv_${name}`;
    await serverProfiles.setServerProfileIdentityForUrl(profile.serverUrl, portableId);
    const scope: ServerAccountScope = { serverId: profile.id, accountId: `account-${name}` };
    credentialScopes.set(scope.serverId, scope);
    saveAccountSettings(scope, settingsParse(settings), 1);
    return { scope, serverUrl: profile.serverUrl, portableId };
}

function readyAlert(home: Home) {
    return {
        type: 'activity_alert',
        v: 2,
        serverId: home.portableId,
        sessionId: 'session-1',
        accountId: home.scope.accountId,
        event: { type: 'ready', sequenceDomain: 'session_transcript', messageSeq: 7 },
        previewBehavior: 'include_preview',
    };
}

const NOON = new Date('2026-09-23T12:00:00.000Z');
const nothingVisible = () => false;

const QUIET_HOURS_NIGHTLY_UTC = {
    enabled: true,
    timezone: 'UTC',
    windows: [{ startLocalTime: '22:00', endLocalTime: '07:00' }],
} as const;

describe('resolveForegroundNotificationBehavior', () => {
    beforeEach(async () => {
        credentialScopes.clear();
        resetActivityAlertPresentationNotesForTests();
        await clearProfiles();
    });

    afterEach(async () => {
        await clearProfiles();
        resetActivityAlertPresentationNotesForTests();
    });

    it('answers with the incoming alert Home policy, not the other enrolled Home', async () => {
        const homeA = await enrollHome('alpha', { attentionDeliveryPolicyV1: { v: 1, foregroundBehavior: 'off' } });
        const homeB = await enrollHome('bravo', { attentionDeliveryPolicyV1: { v: 1, foregroundBehavior: 'full' } });

        await expect(resolveForegroundNotificationBehavior({
            content: { data: readyAlert(homeB) },
            localSettings: null,
            now: NOON,
            isSessionVisible: nothingVisible,
        })).resolves.toBe('full');

        await expect(resolveForegroundNotificationBehavior({
            content: { data: readyAlert(homeA) },
            localSettings: null,
            now: NOON,
            isSessionVisible: nothingVisible,
        })).resolves.toBe('off');
    });

    it('evaluates a Home push against the push channel, so disabling device local notifications never silences it', async () => {
        const homeB = await enrollHome('bravo', { attentionDeliveryPolicyV1: { v: 1, foregroundBehavior: 'full' } });

        await expect(resolveForegroundNotificationBehavior({
            content: { data: readyAlert(homeB) },
            localSettings: { localNotificationsEnabled: false },
            now: NOON,
            isSessionVisible: nothingVisible,
        })).resolves.toBe('full');
    });

    it('presents the current daemon rich push, which names its Home only by URL, on the push channel of that saved Home', async () => {
        // `withServerUrlInPushData` adds only the client URL; the rich sender never
        // knows this device's saved Home id.
        const homeB = await enrollHome('bravo', { attentionDeliveryPolicyV1: { v: 1, foregroundBehavior: 'full' } });

        await expect(resolveForegroundNotificationBehavior({
            content: {
                data: { sessionId: 'session-1', requestId: 'request-1', type: 'permission_request', kind: 'permission', serverUrl: homeB.serverUrl },
                categoryIdentifier: PUSH_NOTIFICATION_CATEGORY_IDS.permissionRequestV1,
            },
            localSettings: { localNotificationsEnabled: false },
            now: NOON,
            isSessionVisible: nothingVisible,
        })).resolves.toBe('full');
    });

    it('fails closed for a URL-only push whose Home this device cannot name exactly', async () => {
        await enrollHome('bravo', { attentionDeliveryPolicyV1: { v: 1, foregroundBehavior: 'full' } });

        await expect(resolveForegroundNotificationBehavior({
            content: { data: { sessionId: 'session-1', serverUrl: 'https://unknown.example.test' } },
            localSettings: null,
            now: NOON,
            isSessionVisible: nothingVisible,
        })).resolves.toBe('off');
    });

    it.each(['ready', 'ready_local_id', 'permission_request'] as const)('shares the committed %s identity between rich push and local presentation in both orders', async (event) => {
        const home = await enrollHome('rich-identity', { attentionDeliveryPolicyV1: { v: 1, foregroundBehavior: 'full' } });
        const address = { serverId: home.scope.serverId, sessionId: 'session-1' };
        const personalEvent = event === 'permission_request' ? 'permission_required' : 'ready';
        const identity = event === 'ready' ? 'message-seq:session_transcript:7'
            : event === 'ready_local_id' ? 'message-local-id:session_transcript:local-1'
                : 'request:request-1';
        const content = {
            data: {
                sessionId: address.sessionId,
                serverUrl: home.serverUrl,
                ...(event === 'ready_local_id'
                    ? { activityEventLocalId: 'local-1' }
                    : event === 'ready'
                    ? { activityEvent: { type: 'ready', sequenceDomain: 'session_transcript', messageSeq: 7 } }
                    : { requestId: 'request-1' }),
            },
            ...(event === 'permission_request' ? { categoryIdentifier: PUSH_NOTIFICATION_CATEGORY_IDS.permissionRequestV1 } : {}),
        };
        const localIdentity = event === 'ready_local_id' ? 'message-seq:session_transcript:7' : identity;
        const correlation = { accountId: home.scope.accountId, ...(event === 'ready_local_id' ? { committedLocalId: 'local-1' } : {}) };
        noteActivityAlertPresented({ address, event: personalEvent, identity: localIdentity, ...correlation, source: 'local_notification' });
        await expect(resolveForegroundNotificationBehavior({ content, localSettings: null, now: NOON, isSessionVisible: nothingVisible })).resolves.toBe('off');

        resetActivityAlertPresentationNotesForTests();
        await expect(resolveForegroundNotificationBehavior({ content, localSettings: null, now: NOON, isSessionVisible: nothingVisible })).resolves.toBe('full');
        expect(consumeOtherLegActivityAlertPresentation({ address, event: personalEvent, identity: localIdentity, ...correlation, source: 'local_notification' })).toBe(true);
        expect(consumeOtherLegActivityAlertPresentation({ address, accountId: home.scope.accountId, event: personalEvent, identity: `${identity}-next`, source: 'local_notification' })).toBe(false);
    });

    it('consumes both existing ready identity representations together without crossing a Home or Session', async () => {
        const home = await enrollHome('ready-aliases', { attentionDeliveryPolicyV1: { v: 1, foregroundBehavior: 'full' } });
        const address = { serverId: home.scope.serverId, sessionId: 'session-1' };
        const content = { data: { sessionId: address.sessionId, serverUrl: home.serverUrl, activityEventLocalId: 'local-1' } };
        noteActivityAlertPresented({ address, accountId: home.scope.accountId, event: 'ready', identity: 'message-seq:session_transcript:7', committedLocalId: 'local-1', source: 'local_notification' });
        expect(consumeOtherLegActivityAlertPresentation({ address: { ...address, sessionId: 'session-2' }, accountId: home.scope.accountId, event: 'ready', identity: 'message-seq:session_transcript:7', source: 'rich_push' })).toBe(false);
        expect(consumeOtherLegActivityAlertPresentation({ address: { ...address, serverId: 'another-home' }, accountId: home.scope.accountId, event: 'ready', identity: 'message-seq:session_transcript:7', source: 'rich_push' })).toBe(false);
        await expect(resolveForegroundNotificationBehavior({ content, localSettings: null, now: NOON, isSessionVisible: nothingVisible })).resolves.toBe('off');
        expect(consumeOtherLegActivityAlertPresentation({ address, accountId: home.scope.accountId, event: 'ready', identity: 'message-seq:session_transcript:7', source: 'home_remote_alert' })).toBe(false);
        await expect(resolveForegroundNotificationBehavior({ content: { data: { ...content.data, activityEventLocalId: 'local-2' } }, localSettings: null, now: NOON, isSessionVisible: nothingVisible })).resolves.toBe('full');
    });

    it('presents only one simultaneous local and rich ready arrival after asynchronous policy resolution', async () => {
        const home = await enrollHome('simultaneous-ready', { attentionDeliveryPolicyV1: { v: 1, foregroundBehavior: 'full' } });
        const data = { sessionId: 'session-1', serverUrl: home.serverUrl, activityEventLocalId: 'local-1' };
        const arrivals = await Promise.all([
            resolveForegroundNotificationBehavior({ content: { data: { ...data, serverId: home.scope.serverId, activityEvent: { type: 'ready', sequenceDomain: 'session_transcript', messageSeq: 7 } } }, localSettings: null, now: NOON, isSessionVisible: nothingVisible }),
            resolveForegroundNotificationBehavior({ content: { data }, localSettings: null, now: NOON, isSessionVisible: nothingVisible }),
        ]);
        expect(arrivals.sort()).toEqual(['full', 'off']);
    });

    it('does not consume another leg while the Home Account policy is unavailable', async () => {
        const home = await enrollHome('unavailable-policy', { attentionDeliveryPolicyV1: { v: 1, foregroundBehavior: 'full' } });
        const address = { serverId: home.scope.serverId, sessionId: 'session-1' };
        noteActivityAlertPresented({ address, accountId: home.scope.accountId, event: 'ready', identity: 'message-seq:session_transcript:7', source: 'local_notification' });
        credentialScopes.delete(home.scope.serverId);
        await expect(resolveForegroundNotificationBehavior({ content: { data: readyAlert(home) }, localSettings: null, now: NOON, isSessionVisible: nothingVisible })).resolves.toBe('off');
        credentialScopes.set(home.scope.serverId, home.scope);
        await expect(resolveForegroundNotificationBehavior({ content: { data: readyAlert(home) }, localSettings: null, now: NOON, isSessionVisible: nothingVisible })).resolves.toBe('off');
    });

    it('never borrows a presentation note from another Account on the same Home', async () => {
        const home = await enrollHome('account-switch', { attentionDeliveryPolicyV1: { v: 1, foregroundBehavior: 'full' } });
        const localContent = { data: { serverId: home.scope.serverId, sessionId: 'session-1', activityEvent: { type: 'ready', sequenceDomain: 'session_transcript', messageSeq: 7 } } };
        await expect(resolveForegroundNotificationBehavior({ content: localContent, localSettings: null, now: NOON, isSessionVisible: nothingVisible })).resolves.toBe('full');
        const nextScope = { ...home.scope, accountId: 'replacement-account' };
        credentialScopes.set(nextScope.serverId, nextScope);
        saveAccountSettings(nextScope, settingsParse({ attentionDeliveryPolicyV1: { v: 1, foregroundBehavior: 'full' } }), 1);
        await expect(resolveForegroundNotificationBehavior({ content: { data: { ...readyAlert(home), accountId: nextScope.accountId } }, localSettings: null, now: NOON, isSessionVisible: nothingVisible })).resolves.toBe('full');
    });

    it('classifies a device-local permission request as a permission request, not as ready', async () => {
        const homeB = await enrollHome('bravo', { attentionDeliveryPolicyV1: { v: 1, foregroundBehavior: 'full' } });
        const readyLocalNotificationsOff = localSettingsParse({
            attentionDeviceOverridesV1: {
                localNotifications: { events: { ready: false, permission_request: true, user_action_request: true } },
            },
        });

        await expect(resolveForegroundNotificationBehavior({
            content: {
                data: { serverId: homeB.scope.serverId, sessionId: 'session-1', requestId: 'request-1', serverUrl: homeB.serverUrl },
                categoryIdentifier: PUSH_NOTIFICATION_CATEGORY_IDS.permissionRequestV1,
            },
            localSettings: readyLocalNotificationsOff,
            now: NOON,
            isSessionVisible: nothingVisible,
        })).resolves.toBe('full');

        // The same device setting still silences an actual ready notification.
        await expect(resolveForegroundNotificationBehavior({
            content: { data: { serverId: homeB.scope.serverId, sessionId: 'session-1', serverUrl: homeB.serverUrl } },
            localSettings: readyLocalNotificationsOff,
            now: NOON,
            isSessionVisible: nothingVisible,
        })).resolves.toBe('off');
    });

    it('suppresses a device-local notification only when its own exact Home Session is visible, never for the same Session id on another Home', async () => {
        const homeA = await enrollHome('alpha', { attentionDeliveryPolicyV1: { v: 1, foregroundBehavior: 'full' } });
        const homeB = await enrollHome('bravo', { attentionDeliveryPolicyV1: { v: 1, foregroundBehavior: 'full' } });
        const visibleOnA = (address: Readonly<{ serverId: string; sessionId: string }>) =>
            address.serverId === homeA.scope.serverId && address.sessionId === 'session-1';

        await expect(resolveForegroundNotificationBehavior({
            content: { data: { serverId: homeB.scope.serverId, sessionId: 'session-1', serverUrl: homeB.serverUrl } },
            localSettings: null,
            now: NOON,
            isSessionVisible: visibleOnA,
        })).resolves.toBe('full');

        await expect(resolveForegroundNotificationBehavior({
            content: { data: { serverId: homeA.scope.serverId, sessionId: 'session-1', serverUrl: homeA.serverUrl } },
            localSettings: null,
            now: NOON,
            isSessionVisible: visibleOnA,
        })).resolves.toBe('off');
    });

    it('suppresses a device-local notification whose own channel this device disabled', async () => {
        const homeB = await enrollHome('bravo', { attentionDeliveryPolicyV1: { v: 1, foregroundBehavior: 'full' } });

        await expect(resolveForegroundNotificationBehavior({
            content: { data: { serverId: homeB.scope.serverId, sessionId: 'session-1' } },
            localSettings: { localNotificationsEnabled: false },
            now: NOON,
            isSessionVisible: nothingVisible,
        })).resolves.toBe('off');
    });

    it('evaluates quiet hours against the supplied instant rather than a fixed one', async () => {
        const homeB = await enrollHome('bravo', {
            attentionDeliveryPolicyV1: {
                v: 1,
                foregroundBehavior: 'full',
                quietHours: QUIET_HOURS_NIGHTLY_UTC,
            },
        });

        const insideQuietHours = await resolveForegroundNotificationBehavior({
            content: { data: readyAlert(homeB) },
            localSettings: null,
            now: new Date('2026-09-23T23:30:00.000Z'),
            isSessionVisible: nothingVisible,
        });
        resetActivityAlertPresentationNotesForTests();
        const outsideQuietHours = await resolveForegroundNotificationBehavior({
            content: { data: readyAlert(homeB) },
            localSettings: null,
            now: NOON,
            isSessionVisible: nothingVisible,
        });

        // `expo_push` quiet hours default to suppression, so a frozen clock could
        // never reach this arm.
        expect(insideQuietHours).toBe('off');
        expect(outsideQuietHours).toBe('full');
    });

    it('does not present a Home alert addressed to another Account than the one this device now holds for that Home', async () => {
        const homeB = await enrollHome('bravo', { attentionDeliveryPolicyV1: { v: 1, foregroundBehavior: 'full' } });
        const staleAlert = { ...readyAlert(homeB), accountId: 'account-previously-signed-in' };

        await expect(resolveForegroundNotificationBehavior({
            content: { data: staleAlert },
            localSettings: null,
            now: NOON,
            isSessionVisible: nothingVisible,
        })).resolves.toBe('off');
    });

    it('fails closed when this device cannot name the alert Home Account', async () => {
        const homeB = await enrollHome('bravo', { attentionDeliveryPolicyV1: { v: 1, foregroundBehavior: 'full' } });
        credentialScopes.clear();

        await expect(resolveForegroundNotificationBehavior({
            content: { data: readyAlert(homeB) },
            localSettings: null,
            now: NOON,
            isSessionVisible: nothingVisible,
        })).resolves.toBe('off');
    });
});
