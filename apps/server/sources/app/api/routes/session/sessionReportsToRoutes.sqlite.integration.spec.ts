import { randomUUID } from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
    buildAccountStoredContentCompatibilityHttpHeadersV1,
    CURRENT_ACCOUNT_STORED_CONTENT_COMPATIBILITY_DECLARATION,
    encodeSessionOwnerMetadataEnvelopeV1,
    SessionSharedMetadataV1Schema,
} from '@happier-dev/protocol';

import { db } from '@/storage/db';
import { createLightSqliteHarness, type LightSqliteHarness } from '@/testkit/lightSqliteHarness';
import { createAuthenticatedTestApp } from '../../testkit/sqliteFastify';
import { sessionRoutes } from './sessionRoutes';
import { registerPublicShareOwnerRoutes } from '../share/registerPublicShareOwnerRoutes';

describe('authenticated reports-to resource', () => {
    let harness: LightSqliteHarness;
    beforeAll(async () => { harness = await createLightSqliteHarness({ tempDirPrefix: 'happier-reports-route-' }); }, 180_000);
    afterAll(async () => { await harness?.close(); });

    it('removes an unsafe child relation when its lead becomes publicly shared', async () => {
        const owner = await db.account.create({ data: { publicKey: randomUUID(), encryptionMode: 'plain' } });
        const create = () => db.session.create({ data: {
            accountId: owner.id, tag: randomUUID(), encryptionMode: 'plain', metadataLayoutVersion: 1,
            metadata: JSON.stringify(SessionSharedMetadataV1Schema.parse({ v: 1 })),
            ownerMetadata: encodeSessionOwnerMetadataEnvelopeV1({ t: 'plain', v: { v: 1 } }),
        } });
        const [child, lead] = await Promise.all([create(), create()]);
        const app = createAuthenticatedTestApp();
        sessionRoutes(app);
        registerPublicShareOwnerRoutes(app);
        await app.ready();
        const headers = {
            'x-test-user-id': owner.id,
            ...buildAccountStoredContentCompatibilityHttpHeadersV1(CURRENT_ACCOUNT_STORED_CONTENT_COMPATIBILITY_DECLARATION),
        };
        try {
            const attach = await app.inject({ method: 'POST', url: `/v1/sessions/${child.id}/reports-to`, headers,
                payload: { leadSessionId: lead.id, expectedLeadSessionId: null } });
            expect(attach.statusCode).toBe(200);
            const share = await app.inject({ method: 'POST', url: `/v1/sessions/${lead.id}/public-share`, headers,
                payload: { token: randomUUID() } });
            expect(share.statusCode).toBe(200);
            expect(await db.sessionReportsTo.findUnique({ where: { sessionId: child.id } })).toBeNull();
            expect(await db.publicSessionShare.findUnique({ where: { sessionId: child.id } })).toBeNull();
        } finally { await app.close(); }
    });

    it('attaches across owners with existing grants and returns typed cycle/CAS/authority refusals', async () => {
        const [workerOwner, leadOwner, outsider] = await Promise.all(Array.from({ length: 3 }, () => db.account.create({
            data: { publicKey: randomUUID(), encryptionMode: 'plain' },
        })));
        const create = (accountId: string) => db.session.create({ data: {
            accountId, tag: randomUUID(), metadata: '{}', encryptionMode: 'plain',
        } });
        const child = await create(workerOwner.id);
        const lead = await create(leadOwner.id);
        await db.sessionShare.createMany({ data: [
            { sessionId: child.id, sharedByUserId: workerOwner.id, sharedWithUserId: leadOwner.id, accessLevel: 'edit' },
            { sessionId: lead.id, sharedByUserId: leadOwner.id, sharedWithUserId: workerOwner.id, accessLevel: 'edit' },
        ] });
        let actorId = workerOwner.id;
        const app = createAuthenticatedTestApp();
        app.addHook('onRequest', async (request: FastifyRequest) => { request.headers['x-test-user-id'] = actorId; });
        sessionRoutes(app);
        await app.ready();
        try {
            const url = `/v1/sessions/${child.id}/reports-to`;
            const attach = await app.inject({ method: 'POST', url, payload: { leadSessionId: lead.id, expectedLeadSessionId: null } });
            expect(attach.statusCode).toBe(200);
            expect(attach.json()).toMatchObject({ ok: true, sessionId: child.id, leadSessionId: lead.id });
            const conflict = await app.inject({ method: 'POST', url, payload: { leadSessionId: null, expectedLeadSessionId: null } });
            expect([conflict.statusCode, conflict.json()]).toEqual([409, { ok: false, error: 'reports_to_cas_conflict' }]);
            const cycle = await app.inject({ method: 'POST', url: `/v1/sessions/${lead.id}/reports-to`,
                payload: { leadSessionId: child.id, expectedLeadSessionId: null } });
            expect([cycle.statusCode, cycle.json()]).toEqual([400, { ok: false, error: 'reports_to_cycle' }]);
            actorId = outsider.id;
            const denied = await app.inject({ method: 'POST', url, payload: { leadSessionId: null, expectedLeadSessionId: lead.id } });
            expect([denied.statusCode, denied.json()]).toEqual([403, { ok: false, error: 'reports_to_forbidden', reason: 'read' }]);
            expect((await db.sessionReportsTo.findUniqueOrThrow({ where: { sessionId: child.id } })).leadSessionId).toBe(lead.id);
        } finally {
            await app.close();
        }
    });
});
