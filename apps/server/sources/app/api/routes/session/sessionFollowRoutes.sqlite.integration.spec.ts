import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyRequest } from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import type { Fastify as AppFastify } from '@/app/api/types';
import { db } from '@/storage/db';
import { createLightSqliteHarness, type LightSqliteHarness } from '@/testkit/lightSqliteHarness';
import { sessionRoutes } from './sessionRoutes';

async function buildApp(accountId: string) {
    const app = Fastify({ logger: false });
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    app.decorate('authenticate', async (request: FastifyRequest) => {
        request.userId = accountId;
        request.authAuthority = 'present_user';
    });
    sessionRoutes(app as AppFastify);
    await app.ready();
    return app;
}

describe('Account Session Follow HTTP resource', () => {
    let harness: LightSqliteHarness;
    beforeAll(async () => {
        harness = await createLightSqliteHarness({ tempDirPrefix: 'happier-account-follow-',
            env: { HAPPIER_FEATURE_SESSIONS_FOLLOWING__ENABLED: 'true' } });
    }, 180_000);
    afterEach(async () => {
        harness.restoreEnv();
        await db.sessionShare.deleteMany();
        await db.session.deleteMany();
        await db.account.deleteMany();
    });
    afterAll(async () => { await harness?.close(); });

    it('persists only the authenticated reader Follow and makes explicit Unfollow idempotent', async () => {
        const owner = await db.account.create({ data: { publicKey: randomUUID(), encryptionMode: 'plain' } });
        const viewer = await db.account.create({ data: { publicKey: randomUUID(), encryptionMode: 'plain' } });
        const session = await db.session.create({ data: {
            accountId: owner.id, tag: randomUUID(), metadata: '{}', encryptionMode: 'plain', seq: 8,
        } });
        await db.sessionShare.create({ data: {
            sessionId: session.id, sharedByUserId: owner.id, sharedWithUserId: viewer.id, accessLevel: 'view',
        } });
        const app = await buildApp(viewer.id);
        try {
            const url = `/v2/sessions/${session.id}/follow`;
            const initial = await app.inject({ method: 'GET', url });
            expect(initial.statusCode).toBe(200);
            expect(initial.json()).toEqual({ follow: null, isSessionOwner: false, capabilities: { manageFollow: true }, voiceInitialSnapshotPending: false });
            const payload = { notificationLevel: 'none', includeInVoice: true };
            const created = await app.inject({ method: 'PUT', url, payload });
            expect(created.statusCode).toBe(200);
            expect(created.json()).toEqual({ changed: true, follow: { sessionId: session.id, following: true, ...payload }, voiceInitialSnapshotPending: true });
            expect(await db.accountSessionReadState.findUnique({ where: {
                accountId_sessionId: { accountId: viewer.id, sessionId: session.id },
            } })).toMatchObject({ lastViewedSessionSeq: 8, unreadSince: null });
            expect(await db.accountSessionFollow.findUnique({ where: {
                accountId_sessionId: { accountId: owner.id, sessionId: session.id },
            } })).toBeNull();
            expect((await app.inject({ method: 'PUT', url, payload })).json().changed).toBe(false);
            const removed = await app.inject({ method: 'DELETE', url });
            expect(removed.json()).toEqual({ changed: true });
            expect((await app.inject({ method: 'DELETE', url })).json()).toEqual({ changed: false });
            expect((await app.inject({ method: 'GET', url })).json().follow).toEqual({
                sessionId: session.id, following: false, notificationLevel: 'none', includeInVoice: false,
            });
        } finally { await app.close(); }
    });

    it('keeps preferences prospective, private and strict, and conceals inaccessible sessions', async () => {
        const owner = await db.account.create({ data: { publicKey: randomUUID(), encryptionMode: 'plain' } });
        const stranger = await db.account.create({ data: { publicKey: randomUUID(), encryptionMode: 'plain' } });
        const session = await db.session.create({ data: {
            accountId: owner.id, tag: randomUUID(), metadata: '{}', encryptionMode: 'plain',
        } });
        const app = await buildApp(stranger.id);
        try {
            const url = '/v2/account/session-follow-preferences';
            const defaults = await app.inject({ method: 'GET', url });
            expect(defaults.statusCode).toBe(200);
            expect(defaults.json()).toEqual({ assigned: true, direct: false, team: false, group: false });
            const preferences = { assigned: false, direct: true, team: true, group: true };
            expect((await app.inject({ method: 'PUT', url, payload: preferences })).json()).toEqual(preferences);
            expect(await db.accountSessionFollow.count()).toBe(0);
            expect((await app.inject({ method: 'PUT', url, payload: { ...preferences, accountId: owner.id } })).statusCode).toBe(400);
            for (const method of ['GET', 'DELETE', 'PUT'] as const) {
                const response = await app.inject({ method, url: `/v2/sessions/${session.id}/follow`,
                    ...(method === 'PUT' ? { payload: { notificationLevel: 'important', includeInVoice: false } } : {}) });
                expect([response.statusCode, response.json()]).toEqual([404, { error: 'session_not_found' }]);
            }
            await db.account.update({ where: { id: stranger.id }, data: { status: 'suspended' } });
            expect((await app.inject({ method: 'PUT', url, payload: preferences })).statusCode).toBe(403);
        } finally { await app.close(); }
    });

    it('keeps encrypted Session content and Voice frontiers outside the human resource and fails closed when disabled', async () => {
        const owner = await db.account.create({ data: { publicKey: randomUUID(), encryptionMode: 'e2ee' } });
        const session = await db.session.create({ data: {
            accountId: owner.id, tag: randomUUID(), metadata: 'opaque-encrypted-metadata', encryptionMode: 'e2ee',
        } });
        const app = await buildApp(owner.id);
        try {
            const url = `/v2/sessions/${session.id}/follow`;
            const payload = { notificationLevel: 'important', includeInVoice: true };
            const saved = await app.inject({ method: 'PUT', url, payload });
            expect(saved.statusCode).toBe(200);
            expect(saved.json()).toEqual({ changed: true, follow: { sessionId: session.id, following: true, ...payload }, voiceInitialSnapshotPending: true });
            const change = await db.accountChange.findUnique({ where: {
                accountId_kind_entityId: { accountId: owner.id, kind: 'account', entityId: 'session-follows' },
            } });
            expect(change?.hint).toEqual({ sessionFollows: true, full: true });
            process.env.HAPPIER_FEATURE_SESSIONS_FOLLOWING__ENABLED = 'false';
            const disabled = await app.inject({ method: 'DELETE', url });
            expect([disabled.statusCode, disabled.json()]).toEqual([404, { error: 'feature_unavailable' }]);
            expect(await db.accountSessionFollow.findUnique({ where: {
                accountId_sessionId: { accountId: owner.id, sessionId: session.id },
            } })).toMatchObject({ following: true, includeInVoice: true });
        } finally { await app.close(); }
    });

    it('replaces 101 accessible Voice inclusions and returns the exact canonical set', async () => {
        const owner = await db.account.create({ data: { publicKey: randomUUID(), encryptionMode: 'plain' } });
        const sessionIds = Array.from({ length: 101 }, () => randomUUID());
        await db.session.createMany({ data: sessionIds.map(id => ({
            id,
            accountId: owner.id,
            tag: randomUUID(),
            metadata: '{}',
            encryptionMode: 'plain' as const,
        })) });
        const app = await buildApp(owner.id);
        try {
            const response = await app.inject({
                method: 'PUT',
                url: '/v2/account/session-follow-voice-inclusions',
                payload: { sessionIds: [...sessionIds].reverse() },
            });
            expect(response.statusCode).toBe(200);
            expect(response.json()).toEqual({ changed: true, sessionIds: [...sessionIds].sort() });
            expect((await db.accountSessionFollow.findMany({
                where: { accountId: owner.id, following: true, includeInVoice: true },
                select: { sessionId: true },
                orderBy: { sessionId: 'asc' },
            })).map(row => row.sessionId)).toEqual([...sessionIds].sort());
        } finally { await app.close(); }
    });
});
