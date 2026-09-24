import { beforeEach, describe, expect, it } from 'vitest';

import type { AuthCredentials } from '@/auth/storage/tokenStorage';
import {
    projectLegacySessionAccessCapabilitiesV1,
    type AccountEncryptionCurrentnessResponse,
    type V2SessionRecord,
} from '@happier-dev/protocol';

import { storage } from '@/sync/domains/state/storage';
import { createSessionListQueryHomeController } from '@/sync/domains/session/listing/sessionListQueryController';
import { subscribeSessionListQueryHomeInvalidation } from '@/sync/domains/session/listing/sessionListQueryInvalidation';
import { fetchAndApplySessions } from './sessionSnapshot';
import { handleDeleteSessionSocketUpdate } from './syncSessions';

const PLAIN_ACCOUNT_CURRENTNESS = {
    mode: 'plain',
    version: 1,
    signingKeyFingerprint: null,
    contentKeyFingerprint: null,
    updatedAt: 1,
} satisfies AccountEncryptionCurrentnessResponse;

const initialState = storage.getState();

function buildSessionRow(id: string): V2SessionRecord {
    return {
        id,
        seq: 1,
        createdAt: 1,
        updatedAt: 1,
        active: true,
        activeAt: 1,
        archivedAt: null,
        metadata: JSON.stringify({ path: `/${id}`, host: 'test' }),
        metadataVersion: 1,
        agentState: JSON.stringify({}),
        agentStateVersion: 1,
        dataEncryptionKey: null,
        encryptionMode: 'plain',
        share: null,
        effectiveAccess: {
            v: 1,
            level: 'owner',
            sources: [{ kind: 'owner' }],
            capabilities: projectLegacySessionAccessCapabilitiesV1({ level: 'owner' }),
        },
        viewer: {
            readState: { state: 'not_started' },
            relevance: { relevant: false, reasons: [] },
            attention: { needsAttention: false, reasons: [], primary: null, presentation: 'full' },
            follow: { follows: false, notificationLevel: 'none' },
            notification: { level: 'none', source: 'preference' },
        },
        responsibleAccountId: null,
        responsibleAccount: null,
    };
}

function jsonResponse(body: unknown): Response {
    return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

/** One list read exactly as the production readers issue it: rows land in the real store. */
function readHomeList(serverId: string, respond: () => Promise<Response>) {
    return fetchAndApplySessions({
        serverId,
        source: { kind: 'ordinary', path: '/v2/sessions', allowV1Fallback: false },
        credentials: { token: `token-${serverId}`, secret: 'secret' } as AuthCredentials,
        accountCurrentness: PLAIN_ACCOUNT_CURRENTNESS,
        encryption: null,
        sessionDataKeys: new Map(),
        request: async () => await respond(),
        applySessions: () => {},
        applySessionListRenderables: (sessions) => {
            storage.getState().applyServerScopedSessionListRows(serverId, sessions, { source: 'ordinary', mode: 'replace' });
        },
        log: { log: () => {} },
    });
}

function page(ids: readonly string[]) {
    return jsonResponse({ sessions: ids.map(buildSessionRow), nextCursor: null, hasNext: false });
}

describe('fetchAndApplySessions exact-Home retirement fence', () => {
    beforeEach(() => {
        storage.setState(initialState, true);
    });

    it('does not let a list read that started before a deletion reinsert that Home\'s row', async () => {
        await readHomeList('home-a', async () => page(['same-id', 'kept']));
        await readHomeList('home-b', async () => page(['same-id']));

        let respondStale!: (response: Response) => void;
        const staleRead = readHomeList('home-a', () => new Promise<Response>((resolve) => { respondStale = resolve; }));
        await new Promise((resolve) => setTimeout(resolve, 0));

        // A committed delete/revoke of A/same-id lands while the page is in flight.
        storage.getState().deleteSession('same-id', 'home-a');
        respondStale(page(['same-id', 'kept']));
        const result = await staleRead;

        const state = storage.getState();
        expect(result.sessionIds).toEqual(['kept']);
        expect(state.sessionListRowsByServerId['home-a']?.['same-id']).toBeUndefined();
        expect(state.ordinarySessionListMembershipByServerId['home-a']).toEqual(['kept']);
        // The same id on another Home is a different Session and stays listed.
        expect(state.sessionListRowsByServerId['home-b']?.['same-id']).toBeDefined();
        expect(state.ordinarySessionListMembershipByServerId['home-b']).toEqual(['same-id']);
    });

    it('admits the row again from a read that started after the deletion (a later regrant)', async () => {
        await readHomeList('home-a', async () => page(['same-id']));
        storage.getState().deleteSession('same-id', 'home-a');

        const result = await readHomeList('home-a', async () => page(['same-id']));

        expect(result.sessionIds).toEqual(['same-id']);
        expect(storage.getState().sessionListRowsByServerId['home-a']?.['same-id']).toBeDefined();
        expect(storage.getState().ordinarySessionListMembershipByServerId['home-a']).toEqual(['same-id']);
    });

    it('retires the Session from a mounted filtered list of that exact Home only', async () => {
        const controllerFor = (serverId: string) => createSessionListQueryHomeController({
            serverId,
            fetchPage: () => readHomeList(serverId, async () => page(['same-id', 'kept'])),
        });
        const homeA = controllerFor('home-a');
        const homeB = controllerFor('home-b');
        const query = {
            v: 1, storage: 'active', includeInactive: true, scope: 'all_accessible', attention: 'any',
            audiences: [], tagIds: [], includeAttention: false,
        } as const;
        await homeA.update({ query, selected: true, online: true, supported: true });
        await homeB.update({ query, selected: true, online: true, supported: true });
        const unsubscribe = subscribeSessionListQueryHomeInvalidation(() => new Map([['home-a', homeA], ['home-b', homeB]]));
        try {
            // The canonical local retirement owner a delete/revoke on Home A reaches.
            handleDeleteSessionSocketUpdate({
                sessionId: 'same-id',
                serverId: 'home-a',
                deleteSession: (sessionId, serverId) => storage.getState().deleteSession(sessionId, serverId),
                removeSessionEncryption: () => {},
                removeProjectManagerSession: () => {},
                clearScmStatusForSession: () => {},
                log: { log: () => {} },
            });
        } finally {
            unsubscribe();
        }

        expect(homeA.getSnapshot().addresses.map((address) => address.sessionId)).toEqual(['kept']);
        expect(homeB.getSnapshot().addresses.map((address) => address.sessionId)).toEqual(['same-id', 'kept']);
    });
});
