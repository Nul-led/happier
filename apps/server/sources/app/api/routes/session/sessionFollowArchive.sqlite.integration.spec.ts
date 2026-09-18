import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { db } from "@/storage/db";
import { createLightSqliteHarness, type LightSqliteHarness } from "@/testkit/lightSqliteHarness";
import { withAuthenticatedTestApp } from "@/app/api/testkit/sqliteFastify";
import { registerSessionArchiveRoutes } from "./registerSessionArchiveRoutes";

const frontier = (transcriptSeq: number) => JSON.stringify({ v: 1, transcriptSeq, readyEventSeq: 0, agentStateVersion: 0, turn: null });

describe("Follow at the Session archive HTTP owner", () => {
    let harness: LightSqliteHarness;
    beforeAll(async () => {
        harness = await createLightSqliteHarness({ tempDirPrefix: "happier-follow-archive-", initAuth: false });
    }, 180_000);
    afterAll(async () => { await harness?.close(); });

    it("retains private choices and unread while restoring Voice at current, only once", async () => {
        const owner = await db.account.create({ data: { publicKey: crypto.randomUUID(), encryptionMode: "plain" } });
        const suppressed = await db.account.create({ data: { publicKey: crypto.randomUUID(), encryptionMode: "plain" } });
        const source = await db.session.create({ data: {
            accountId: owner.id, tag: crypto.randomUUID(), metadata: "{}", encryptionMode: "plain", seq: 9,
        } });
        const destination = await db.session.create({ data: {
            accountId: owner.id, tag: crypto.randomUUID(), metadata: "{}", encryptionMode: "plain", archivedAt: new Date(),
        } });
        const where = { accountId_sessionId: { accountId: owner.id, sessionId: source.id } };
        await db.$executeRaw`INSERT INTO AccountSessionFollow (accountId, sessionId, following, notificationLevel, includeInVoice, voiceDeliveredFrontier)
            VALUES (${owner.id}, ${source.id}, true, 'important', true, ${frontier(9)})`;
        await db.$executeRaw`INSERT INTO AccountSessionFollow (accountId, sessionId, following, notificationLevel, includeInVoice)
            VALUES (${suppressed.id}, ${source.id}, false, 'none', false)`;
        const readFollow = async (accountId = owner.id) => {
            const rows = await db.$queryRaw<Array<{ following: boolean; includeInVoice: boolean; voiceDeliveredFrontier: string | null }>>`
                SELECT following, includeInVoice, voiceDeliveredFrontier FROM AccountSessionFollow
                WHERE accountId = ${accountId} AND sessionId = ${source.id}`;
            return rows[0];
        };
        await db.accountSessionReadState.create({ data: { accountId: owner.id, sessionId: source.id, lastViewedSessionSeq: 2 } });
        const edgeWhere = { destinationSessionId_sourceSessionId: { destinationSessionId: destination.id, sourceSessionId: source.id } };
        await db.sessionFollowEdge.create({ data: { sourceSessionId: source.id, destinationSessionId: destination.id, deliveredTranscriptSeq: 1 } });
        await withAuthenticatedTestApp(registerSessionArchiveRoutes, async (app) => {
            const post = async (sessionId: string, action: string) => {
                const response = await app.inject({ method: "POST", url: `/v2/sessions/${sessionId}/${action}`, headers: { "x-test-user-id": owner.id } });
                expect(response.statusCode).toBe(200);
            };
            await post(source.id, "archive");
            expect(await readFollow()).toMatchObject({ voiceDeliveredFrontier: frontier(9) });
            await db.session.update({ where: { id: source.id }, data: { seq: 12 } });
            // A database failure at the Follow write must roll back the owning archive transaction.
            await db.$executeRawUnsafe(`CREATE TRIGGER reject_follow_restore BEFORE UPDATE ON AccountSessionFollow
                WHEN NEW.voiceDeliveredFrontier IS NULL BEGIN SELECT RAISE(ABORT, 'test restore failure'); END`);
            try {
                const failed = await app.inject({ method: "POST", url: `/v2/sessions/${source.id}/unarchive`, headers: { "x-test-user-id": owner.id } });
                expect(failed.statusCode).toBe(500);
                expect((await db.session.findUniqueOrThrow({ where: { id: source.id } })).archivedAt).not.toBeNull();
                expect(await readFollow()).toMatchObject({ voiceDeliveredFrontier: frontier(9) });
            } finally {
                await db.$executeRawUnsafe("DROP TRIGGER reject_follow_restore");
            }
            await post(source.id, "unarchive");
            expect(await readFollow()).toMatchObject({ following: true, includeInVoice: true, voiceDeliveredFrontier: null });
            expect(await db.sessionFollowEdge.findUnique({ where: edgeWhere })).toMatchObject({ deliveredTranscriptSeq: 1 });
            await post(destination.id, "unarchive");
            expect(await db.sessionFollowEdge.findUnique({ where: edgeWhere })).toMatchObject({ deliveredTranscriptSeq: 12 });
            await db.$executeRaw`UPDATE AccountSessionFollow SET voiceDeliveredFrontier = ${frontier(12)} WHERE accountId = ${owner.id} AND sessionId = ${source.id}`;
            await db.session.update({ where: { id: source.id }, data: { seq: 13 } });
            await post(source.id, "unarchive");
            expect(await readFollow()).toMatchObject({ voiceDeliveredFrontier: frontier(12) });
            expect(await db.sessionFollowEdge.findUnique({ where: edgeWhere })).toMatchObject({ deliveredTranscriptSeq: 12 });
        });
        expect(await db.accountSessionReadState.findUnique({ where })).toMatchObject({ lastViewedSessionSeq: 2 });
        expect(await readFollow(suppressed.id)).toMatchObject({ following: false });
    });
});
