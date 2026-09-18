import { createHash, randomUUID } from 'node:crypto';

import type { FastifyRequest } from 'fastify';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { db } from '@/storage/db';
import { createLightSqliteHarness, type LightSqliteHarness } from '@/testkit/lightSqliteHarness';

import { createAuthenticatedTestApp } from '../../testkit/sqliteFastify';
import { sessionRoutes } from './sessionRoutes';
import { registerPublicShareReadRoutes } from '../share/registerPublicShareReadRoutes';
import { createPublicShareMessagesAccessToken, PUBLIC_SHARE_MESSAGES_ACCESS_TOKEN_HEADER, requirePublicShareAccessGrantSecret } from '../share/publicShareMessageAccessGrant';

async function createAccount() {
    return await db.account.create({ data: { publicKey: `pk-${randomUUID()}`, encryptionMode: 'plain' } });
}

async function createSession(accountId: string, overrides: Record<string, unknown> = {}) {
    return await db.session.create({
        data: { accountId, tag: `s-${randomUUID()}`, metadata: '{}', encryptionMode: 'plain', ...overrides },
    });
}

async function buildApp(accountId: string) {
    const app = createAuthenticatedTestApp();
    app.addHook('onRequest', async (request: FastifyRequest) => { request.headers['x-test-user-id'] = accountId; });
    sessionRoutes(app);
    registerPublicShareReadRoutes(app);
    await app.ready();
    return app;
}

describe('Session Follow source routes', () => {
    let harness: LightSqliteHarness;

    beforeAll(async () => {
        harness = await createLightSqliteHarness({
            tempDirPrefix: 'happier-session-follow-routes-',
            env: { HAPPIER_FEATURE_SESSIONS_FOLLOWING__ENABLED: 'true' },
        });
    }, 180_000);

    afterEach(async () => {
        await db.sessionFollowEdge.deleteMany();
        await db.sessionShare.deleteMany();
        await db.session.deleteMany();
        await db.account.deleteMany();
    });

    afterAll(async () => harness.close());

    it('exposes only the nested authoring resource and maps the closed failure vocabulary', async () => {
        const owner = await createAccount();
        const source = await createSession(owner.id, { seq: 7, latestTurnId: 'turn-a', latestTurnStatus: 'completed' });
        const destination = await createSession(owner.id);
        const archived = await createSession(owner.id, { archivedAt: new Date() });
        const app = await buildApp(owner.id);

        const base = `/v2/sessions/${destination.id}/follows/sessions`;

        expect((await app.inject({ method: 'GET', url: base })).json()).toEqual({ sources: [] });

        const created = await app.inject({ method: 'PUT', url: `${base}/${source.id}`, payload: {} });
        expect(created.statusCode).toBe(200);
        expect(created.json()).toEqual({
            changed: true,
            source: {
                sourceSessionId: source.id,
                destinationSessionId: destination.id,
                mode: 'next_turn',
                deliveryState: 'eligible',
                hasPendingUpdates: false,
            },
        });

        const listed = await app.inject({ method: 'GET', url: base });
        expect(listed.json()).toEqual({ sources: [{
            sourceSessionId: source.id,
            destinationSessionId: destination.id,
            mode: 'next_turn',
            deliveryState: 'eligible',
            hasPendingUpdates: false,
        }] });

        // Same Session, unknown Session and an archived endpoint each map to
        // their exact code without leaking existence.
        const same = await app.inject({ method: 'PUT', url: `${base}/${destination.id}`, payload: {} });
        expect([same.statusCode, same.json().error]).toEqual([400, 'session_follow_same_session']);

        const unknown = await app.inject({ method: 'PUT', url: `${base}/missing-session`, payload: {} });
        expect([unknown.statusCode, unknown.json().error]).toEqual([404, 'session_not_found']);

        const archivedResponse = await app.inject({
            method: 'PUT',
            url: `/v2/sessions/${archived.id}/follows/sessions/${source.id}`,
            payload: {},
        });
        expect([archivedResponse.statusCode, archivedResponse.json().error]).toEqual([409, 'session_archived']);

        // The closed mode vocabulary is accepted explicitly and the stored
        // projection always echoes the normalized mode; a genuinely unknown
        // mode or unexpected field still maps to `invalid_parameters`.
        const explicitMode = await app.inject({ method: 'PUT', url: `${base}/${source.id}`, payload: { mode: 'next_turn' } });
        expect(explicitMode.statusCode).toBe(200);
        expect(explicitMode.json()).toEqual({
            changed: false,
            source: {
                sourceSessionId: source.id,
                destinationSessionId: destination.id,
                mode: 'next_turn',
                deliveryState: 'eligible',
                hasPendingUpdates: false,
            },
        });

        const invalidMode = await app.inject({ method: 'PUT', url: `${base}/${source.id}`, payload: { mode: 'always' } });
        expect([invalidMode.statusCode, invalidMode.json()]).toEqual([400, { error: 'invalid_parameters' }]);

        const unexpectedField = await app.inject({ method: 'PUT', url: `${base}/${source.id}`, payload: { executionAccountId: 'other' } });
        expect([unexpectedField.statusCode, unexpectedField.json()]).toEqual([400, { error: 'invalid_parameters' }]);

        // Removal is idempotent and there is no delivery surface to reach.
        expect((await app.inject({ method: 'DELETE', url: `${base}/${source.id}` })).json()).toEqual({ changed: true });
        expect((await app.inject({ method: 'DELETE', url: `${base}/${source.id}` })).json()).toEqual({ changed: false });
        expect((await app.inject({ method: 'POST', url: `${base}/${source.id}/wake` })).statusCode).toBe(404);

        await app.close();
    });

    it('conceals an inaccessible destination and refuses a caller without destination input authority', async () => {
        const owner = await createAccount();
        const viewer = await createAccount();
        const stranger = await createAccount();
        const source = await createSession(owner.id);
        const destination = await createSession(owner.id);
        await db.sessionShare.create({
            data: {
                session: { connect: { id: destination.id } },
                sharedByUser: { connect: { id: owner.id } },
                sharedWithUser: { connect: { id: viewer.id } },
                accessLevel: 'view',
            },
        });
        await db.sessionShare.create({
            data: {
                session: { connect: { id: source.id } },
                sharedByUser: { connect: { id: owner.id } },
                sharedWithUser: { connect: { id: viewer.id } },
                accessLevel: 'view',
            },
        });

        const base = `/v2/sessions/${destination.id}/follows/sessions`;

        const strangerApp = await buildApp(stranger.id);
        const concealed = await strangerApp.inject({ method: 'GET', url: base });
        expect([concealed.statusCode, concealed.json().error]).toEqual([404, 'session_not_found']);
        await strangerApp.close();

        const viewerApp = await buildApp(viewer.id);
        const forbidden = await viewerApp.inject({ method: 'PUT', url: `${base}/${source.id}`, payload: {} });
        expect([forbidden.statusCode, forbidden.json().error]).toEqual([403, 'session_follow_source_forbidden']);
        await viewerApp.close();
    });

    it('refuses an exhausted public destination while its issued message token can still read, then admits after expiry', async () => {
        const owner = await createAccount();
        const source = await createSession(owner.id);
        const destination = await createSession(owner.id);
        const token = randomUUID();
        const tokenHash = createHash('sha256').update(token, 'utf8').digest();
        const publication = await db.publicSessionShare.create({ data: {
            sessionId: destination.id,
            createdByUserId: owner.id,
            tokenHash,
            maxUses: 1,
            useCount: 1,
            isConsentRequired: false,
            expiresAt: new Date(Date.now() + 60_000),
        } });
        const messagesAccessToken = createPublicShareMessagesAccessToken({
            secret: requirePublicShareAccessGrantSecret(),
            publicShareId: publication.id,
            sessionId: destination.id,
            tokenHashHex: tokenHash.toString('hex'),
        });
        const app = await buildApp(owner.id);
        try {
            const readPublicMessages = () => app.inject({
                method: 'GET',
                url: `/v1/public-share/${token}/messages`,
                headers: { [PUBLIC_SHARE_MESSAGES_ACCESS_TOKEN_HEADER]: messagesAccessToken },
            });
            expect((await readPublicMessages()).statusCode).toBe(200);

            const setSource = () => app.inject({
                method: 'PUT',
                url: `/v2/sessions/${destination.id}/follows/sessions/${source.id}`,
                payload: {},
            });
            const denied = await setSource();
            expect([denied.statusCode, denied.json()]).toEqual([403, { error: 'session_follow_source_forbidden' }]);
            expect(await db.sessionFollowEdge.count()).toBe(0);

            await db.publicSessionShare.update({ where: { id: publication.id }, data: { expiresAt: new Date(0) } });
            expect((await readPublicMessages()).statusCode).toBe(404);
            expect((await setSource()).statusCode).toBe(200);
        } finally {
            await app.close();
        }
    });
});
