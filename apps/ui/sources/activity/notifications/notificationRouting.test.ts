import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { isUnsafeNotificationServerUrl, parseNotificationTap } from './notificationRouting';

const serverProfiles = await import('@/sync/domains/server/serverProfiles');

const DEFAULT_ACTION_IDENTIFIER = 'expo.modules.notifications.actions.DEFAULT';

function tapResponse(data: unknown) {
    return {
        actionIdentifier: DEFAULT_ACTION_IDENTIFIER,
        notification: { request: { identifier: 'notif-1', content: { data } } },
    };
}

function remoteAlert(overrides: Record<string, unknown> = {}) {
    return {
        type: 'activity_alert',
        v: 1,
        serverId: 'srv_acme',
        sessionId: 'session-1',
        accountId: 'account-1',
        event: { type: 'ready', messageSeq: 3 },
        previewBehavior: 'status_only',
        ...overrides,
    };
}

async function clearProfiles(): Promise<void> {
    for (const profile of serverProfiles.listServerProfiles()) {
        await serverProfiles.removeServerProfile(profile.id);
    }
}

describe('activity remote alert taps', () => {
    beforeEach(clearProfiles);
    afterEach(clearProfiles);

    it('opens the alert Session on its own Home even while another Home is active', async () => {
        const acme = await serverProfiles.upsertServerProfile({ serverUrl: 'https://acme.example.test', name: 'Acme' });
        const personal = await serverProfiles.upsertServerProfile({ serverUrl: 'https://personal.example.test', name: 'Personal' });
        await serverProfiles.setServerProfileIdentityForUrl(acme.serverUrl, 'srv_acme');
        await serverProfiles.setServerProfileIdentityForUrl(personal.serverUrl, 'srv_personal');
        await serverProfiles.setActiveServerId(personal.id, { scope: 'device' });

        const parsed = parseNotificationTap({
            response: tapResponse(remoteAlert()),
            defaultActionIdentifier: DEFAULT_ACTION_IDENTIFIER,
        });
        expect(parsed?.command).toMatchObject({
            kind: 'openSession',
            sessionId: 'session-1',
            serverId: acme.id,
            serverUrl: 'https://acme.example.test',
        });
        expect(parsed?.dedupeKey).toBe(`notif-1:${DEFAULT_ACTION_IDENTIFIER}`);
    });

    it('opens a current Discussion alert at the exact Discussion on its own Home', async () => {
        const acme = await serverProfiles.upsertServerProfile({ serverUrl: 'https://acme.example.test', name: 'Acme' });
        await serverProfiles.setServerProfileIdentityForUrl(acme.serverUrl, 'srv_acme');
        const parsed = parseNotificationTap({
            response: tapResponse(remoteAlert({
                v: 2,
                event: {
                    type: 'discussion_mention', sequenceDomain: 'discussion',
                    discussionId: 'discussion/a', messageSeq: 1,
                },
            })),
            defaultActionIdentifier: DEFAULT_ACTION_IDENTIFIER,
        });
        expect(parsed?.command).toMatchObject({
            kind: 'openSession',
            sessionId: 'session-1',
            serverId: acme.id,
            route: `/session/session-1/discussions/discussion%2Fa?serverId=${encodeURIComponent(acme.id)}&sourceSurface=collaboration`,
        });
    });

    it('ignores an alert whose Home this device cannot name rather than routing it anywhere', async () => {
        const personal = await serverProfiles.upsertServerProfile({ serverUrl: 'https://personal.example.test', name: 'Personal' });
        await serverProfiles.setServerProfileIdentityForUrl(personal.serverUrl, 'srv_personal');
        await serverProfiles.setActiveServerId(personal.id, { scope: 'device' });

        expect(parseNotificationTap({
            response: tapResponse(remoteAlert()),
            defaultActionIdentifier: DEFAULT_ACTION_IDENTIFIER,
        })?.command).toEqual({ kind: 'ignore', reason: 'unknown_server' });
    });

    it('leaves the existing rich owner push payload on its released path', async () => {
        const acme = await serverProfiles.upsertServerProfile({ serverUrl: 'https://acme.example.test', name: 'Acme' });
        await serverProfiles.setActiveServerId(acme.id, { scope: 'device' });
        expect(parseNotificationTap({
            response: tapResponse({ sessionId: 'session-9', serverId: acme.id, serverUrl: acme.serverUrl }),
            defaultActionIdentifier: DEFAULT_ACTION_IDENTIFIER,
        })?.command).toMatchObject({ kind: 'openSession', sessionId: 'session-9', serverId: acme.id });
    });
});

describe('notification server URL safety', () => {
    it('rejects every loopback form that another device cannot reach', () => {
        expect(isUnsafeNotificationServerUrl('http://127.0.0.2:3005')).toBe(true);
        expect(isUnsafeNotificationServerUrl('http://relay.localhost:3005')).toBe(true);
        expect(isUnsafeNotificationServerUrl('https://machine.tailnet.ts.net')).toBe(false);
    });
});
