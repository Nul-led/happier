import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    consumeOtherLegActivityAlertPresentation,
    noteActivityAlertPresented,
    resetActivityAlertPresentationNotesForTests,
} from './activityAlertPresentationNotes';
import { resolveRemoteAlertForegroundPresentation } from './resolveRemoteAlertForegroundPresentation';

const serverProfiles = await import('@/sync/domains/server/serverProfiles');

const ALERT = {
    type: 'activity_alert',
    v: 2,
    serverId: 'srv_acme',
    sessionId: 'session-1',
    accountId: 'account-1',
    event: { type: 'ready', sequenceDomain: 'session_transcript', messageSeq: 7 },
    previewBehavior: 'title_only',
};

let acmeId = '';

async function clearProfiles(): Promise<void> {
    for (const profile of serverProfiles.listServerProfiles()) {
        await serverProfiles.removeServerProfile(profile.id);
    }
}

beforeEach(async () => {
    await clearProfiles();
    resetActivityAlertPresentationNotesForTests();
    const acme = await serverProfiles.upsertServerProfile({ serverUrl: 'https://acme.example.test', name: 'Acme' });
    await serverProfiles.setServerProfileIdentityForUrl(acme.serverUrl, 'srv_acme');
    acmeId = acme.id;
});

afterEach(async () => {
    vi.useRealTimers();
    await clearProfiles();
    resetActivityAlertPresentationNotesForTests();
});

describe('resolveRemoteAlertForegroundPresentation', () => {
    it('leaves every other payload category to the existing owners', () => {
        expect(resolveRemoteAlertForegroundPresentation({
            data: { type: 'badge_refresh' },
            isSessionVisible: () => false,
        })).toEqual({ kind: 'not_remote_alert' });
        expect(resolveRemoteAlertForegroundPresentation({
            // The existing rich runtime-Account push keeps its own path.
            data: { sessionId: 'session-1', serverId: acmeId, serverUrl: 'https://acme.example.test' },
            isSessionVisible: () => false,
        })).toEqual({ kind: 'not_remote_alert' });
    });

    it('presents an alert for the exact Home and records that this device showed it', () => {
        const presentation = resolveRemoteAlertForegroundPresentation({ data: ALERT, isSessionVisible: () => false });
        expect(presentation).toMatchObject({ kind: 'present', target: { address: { serverId: acmeId, sessionId: 'session-1' }, event: 'ready' } });
        if (presentation.kind !== 'present') return;
        noteActivityAlertPresented({ accountId: 'account-1',
            address: presentation.target.address,
            event: presentation.target.event,
            identity: presentation.target.eventIdentity!,
            source: 'home_remote_alert',
        });
        // The other leg sees exactly this event as already presented.
        const otherLeg = { identity: presentation.target.eventIdentity!, source: 'local_notification' } as const;
        expect(consumeOtherLegActivityAlertPresentation({ accountId: 'account-1', address: presentation.target.address, event: 'permission_required', ...otherLeg })).toBe(false);
        expect(consumeOtherLegActivityAlertPresentation({ accountId: 'account-1', address: { serverId: 'other-home', sessionId: 'session-1' }, event: 'ready', ...otherLeg })).toBe(false);
        expect(consumeOtherLegActivityAlertPresentation({ accountId: 'account-1', address: presentation.target.address, event: 'ready', ...otherLeg })).toBe(true);
        // One note suppresses at most one alert, so a repeated event still shows.
        expect(consumeOtherLegActivityAlertPresentation({ accountId: 'account-1', address: presentation.target.address, event: 'ready', ...otherLeg })).toBe(false);
    });

    it('never lets a leg suppress its own repeated alert', () => {
        const address = { serverId: acmeId, sessionId: 'session-1' };
        noteActivityAlertPresented({ accountId: 'account-1', address, event: 'ready', identity: 'message-seq:session_transcript:7', source: 'local_notification' });
        expect(consumeOtherLegActivityAlertPresentation({ accountId: 'account-1',
            address,
            event: 'ready',
            identity: 'message-seq:session_transcript:7',
            source: 'local_notification',
        })).toBe(false);
        expect(consumeOtherLegActivityAlertPresentation({ accountId: 'account-1',
            address,
            event: 'ready',
            identity: 'message-seq:session_transcript:7',
            source: 'home_remote_alert',
        })).toBe(true);
    });

    it('never records or consumes an identityless state observation', () => {
        const address = { serverId: acmeId, sessionId: 'session-1' };

        // Exercise the runtime boundary defensively: malformed JS callers must
        // not collapse identityless observations into an `undefined` key.
        noteActivityAlertPresented({ accountId: 'account-1',
            address,
            event: 'permission_required',
            identity: undefined as unknown as string,
            source: 'home_remote_alert',
        });

        expect(consumeOtherLegActivityAlertPresentation({ accountId: 'account-1',
            address,
            event: 'permission_required',
            identity: 'undefined',
            source: 'local_notification',
        })).toBe(false);
    });

    it('leaves the presentation note untouched until the admitted foreground owner consumes it', () => {
        noteActivityAlertPresented({ accountId: 'account-1',
            address: { serverId: acmeId, sessionId: 'session-1' },
            event: 'ready',
            identity: 'message-seq:session_transcript:7',
            source: 'local_notification',
        });
        expect(resolveRemoteAlertForegroundPresentation({ data: ALERT, isSessionVisible: () => false }))
            .toMatchObject({ kind: 'present' });
        expect(consumeOtherLegActivityAlertPresentation({
            accountId: 'account-1', address: { serverId: acmeId, sessionId: 'session-1' },
            event: 'ready', identity: 'message-seq:session_transcript:7', source: 'home_remote_alert',
        })).toBe(true);
        // The consumed note cannot suppress the next Home alert for that Session.
        expect(resolveRemoteAlertForegroundPresentation({ data: ALERT, isSessionVisible: () => false }))
            .toMatchObject({ kind: 'present' });
    });

    it('does not suppress a different committed ready message that shares the Session', () => {
        noteActivityAlertPresented({ accountId: 'account-1',
            address: { serverId: acmeId, sessionId: 'session-1' },
            event: 'ready',
            identity: 'message-seq:session_transcript:7',
            source: 'local_notification',
        });
        const newer = { ...ALERT, event: { type: 'ready', sequenceDomain: 'session_transcript', messageSeq: 8 } };
        expect(resolveRemoteAlertForegroundPresentation({ data: newer, isSessionVisible: () => false }))
            .toMatchObject({ kind: 'present', target: { eventIdentity: 'message-seq:session_transcript:8' } });
    });

    it('shows one alert per committed request whichever leg observed it first', () => {
        const address = { serverId: acmeId, sessionId: 'session-1' };
        const requestAlert = {
            ...ALERT,
            event: { type: 'permission_request', requestId: 'req-1' },
        };

        // Local leg first: the Home alert for the same committed request is suppressed.
        noteActivityAlertPresented({ accountId: 'account-1',
            address,
            event: 'permission_required',
            identity: 'request:req-1',
            source: 'local_notification',
        });
        expect(resolveRemoteAlertForegroundPresentation({ data: requestAlert, isSessionVisible: () => false }))
            .toMatchObject({ kind: 'present' });
        expect(consumeOtherLegActivityAlertPresentation({
            accountId: 'account-1', address, event: 'permission_required', identity: 'request:req-1', source: 'home_remote_alert',
        })).toBe(true);

        // Home leg first: the local leg sees the same identity and stands down.
        const presentation = resolveRemoteAlertForegroundPresentation({ data: requestAlert, isSessionVisible: () => false });
        expect(presentation).toMatchObject({ kind: 'present', target: { eventIdentity: 'request:req-1' } });
        if (presentation.kind !== 'present') return;
        noteActivityAlertPresented({ accountId: 'account-1',
            address: presentation.target.address,
            event: presentation.target.event,
            identity: presentation.target.eventIdentity!,
            source: 'home_remote_alert',
        });
        expect(consumeOtherLegActivityAlertPresentation({ accountId: 'account-1',
            address,
            event: 'permission_required',
            identity: 'request:req-1',
            source: 'local_notification',
        })).toBe(true);

        // A different committed request still gets its own alert.
        expect(resolveRemoteAlertForegroundPresentation({
            data: { ...ALERT, event: { type: 'user_action_request', requestId: 'req-2' } },
            isSessionVisible: () => false,
        })).toMatchObject({ kind: 'present', target: { eventIdentity: 'request:req-2' } });
    });

    it('keeps a released V1 sequence distinct from the current transcript identity', () => {
        noteActivityAlertPresented({ accountId: 'account-1',
            address: { serverId: acmeId, sessionId: 'session-1' },
            event: 'ready',
            identity: 'message-seq:session_transcript:7',
            source: 'local_notification',
        });

        expect(resolveRemoteAlertForegroundPresentation({
            data: {
                ...ALERT,
                v: 1,
                event: { type: 'ready', messageSeq: 7 },
            },
            isSessionVisible: () => false,
        })).toMatchObject({
            kind: 'present',
            target: { eventIdentity: 'legacy-message-seq:7' },
        });
    });

    it('suppresses an alert whose Home this device cannot name and one for the visible Session', async () => {
        await clearProfiles();
        expect(resolveRemoteAlertForegroundPresentation({ data: ALERT, isSessionVisible: () => false }))
            .toEqual({ kind: 'suppress', reason: 'unroutable' });

        const acme = await serverProfiles.upsertServerProfile({ serverUrl: 'https://acme.example.test', name: 'Acme' });
        await serverProfiles.setServerProfileIdentityForUrl(acme.serverUrl, 'srv_acme');
        expect(resolveRemoteAlertForegroundPresentation({
            data: ALERT,
            // Visibility is qualified by Home: only the alert's own Home counts.
            isSessionVisible: (address) => address.serverId === acme.id && address.sessionId === 'session-1',
        })).toEqual({ kind: 'suppress', reason: 'session_visible' });
    });

    it('retains an exact committed-event note until the other leg consumes it', () => {
        vi.useFakeTimers();
        vi.setSystemTime(1_000_000);
        noteActivityAlertPresented({ accountId: 'account-1',
            address: { serverId: acmeId, sessionId: 'session-1' },
            event: 'ready',
            identity: 'message-seq:session_transcript:7',
            source: 'local_notification',
        });
        vi.advanceTimersByTime(600_000);
        expect(consumeOtherLegActivityAlertPresentation({
            accountId: 'account-1', address: { serverId: acmeId, sessionId: 'session-1' },
            event: 'ready', identity: 'message-seq:session_transcript:7', source: 'home_remote_alert',
        })).toBe(true);
    });

    it('does not discard an exact committed-event note because unrelated events were presented', () => {
        const address = { serverId: acmeId, sessionId: 'session-1' };
        noteActivityAlertPresented({ accountId: 'account-1',
            address,
            event: 'ready',
            identity: 'message-seq:session_transcript:7',
            source: 'local_notification',
        });
        for (let seq = 8; seq < 80; seq += 1) {
            noteActivityAlertPresented({ accountId: 'account-1',
                address,
                event: 'ready',
                identity: `message-seq:session_transcript:${seq}`,
                source: 'local_notification',
            });
        }

        expect(consumeOtherLegActivityAlertPresentation({
            accountId: 'account-1', address, event: 'ready', identity: 'message-seq:session_transcript:7', source: 'home_remote_alert',
        })).toBe(true);
    });
});
