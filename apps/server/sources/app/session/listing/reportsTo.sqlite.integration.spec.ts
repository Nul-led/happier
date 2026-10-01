import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { db } from "@/storage/db";
import { createLightSqliteHarness, type LightSqliteHarness } from "@/testkit/lightSqliteHarness";
import { createPresentUserSessionAccessAuthentication } from "@/app/session/access/sessionAccessAuthentication.testkit";
import { listSessionsForAccount } from "./service";
import { createV2SessionListServerTiming } from "./timing";
import { withAuthenticatedTestApp } from "@/app/api/testkit/sqliteFastify";
import { registerSessionListingRoutes } from "@/app/api/routes/session/registerSessionListingRoutes";
import { createSessionPublisherPresence } from "@/app/presence/sessionPublisherPresence";
import { runPresenceTimeoutTick } from "@/app/presence/timeout";
import { resolveWorkStatusTone } from "../../../../../ui/sources/components/work/status/resolveWorkStatusTone";

const authentication = createPresentUserSessionAccessAuthentication();

describe("Reports-to listing (SQLite)", () => {
    let harness: LightSqliteHarness;
    beforeAll(async () => {
        harness = await createLightSqliteHarness({ tempDirPrefix: "happier-reports-list-", initAuth: false });
    }, 180_000);
    afterAll(async () => { await harness?.close(); });

    async function fixture() {
        const owner = await db.account.create({ data: { publicKey: randomUUID(), encryptionMode: "plain" } });
        const create = () => db.session.create({ data: {
            accountId: owner.id, tag: randomUUID(), metadata: '{"v":1}', encryptionMode: "plain",
            metadataLayoutVersion: 1, ownerMetadata: '{"t":"plain","v":{"v":1}}',
        } });
        return { owner, lead: await create(), unrelated: await create(), create };
    }

    const list = (userId: string, underSessionId: string) => listSessionsForAccount({
        userId, authentication,
        source: { kind: "query", query: {
            v: 1, storage: "active", includeInactive: true, scope: "all_accessible", attention: "any",
            audiences: [], tagIds: [], limit: 50, underSessionId,
        } },
        rowRepresentabilityWhere: {}, timing: createV2SessionListServerTiming({}),
    });

    it("restricts the public listing to a readable root instead of every accessible session", async () => {
        const { owner, lead, unrelated } = await fixture();
        const page = await list(owner.id, lead.id);
        expect(page?.sessions.map((row) => row.id)).toEqual([lead.id]);
        expect(page?.sessions.map((row) => row.id)).not.toContain(unrelated.id);
    });

    it("publishes immutable step origin and depth from the same row in list and detail", async () => {
        const { owner, lead } = await fixture();
        await db.session.update({ where: { id: lead.id }, data: {
            originKind: "run_step", originRunId: "workflow-run", workDepth: 3,
        } });
        const page = await list(owner.id, lead.id);
        expect(page?.sessions[0]).toMatchObject({ origin: { kind: "run_step", runId: "workflow-run" }, workDepth: 3 });
        await withAuthenticatedTestApp(registerSessionListingRoutes, async (app) => {
            const response = await app.inject({ method: "GET", url: `/v2/sessions/${lead.id}?accessProjectionVersion=1`,
                headers: { "x-test-user-id": owner.id, "x-happier-account-stored-content-protocol": "2" } });
            expect(response.statusCode, response.body).toBe(200);
            expect(response.json().session).toMatchObject({ origin: { kind: "run_step", runId: "workflow-run" }, workDepth: 3 });
        });
    });

    it("does not disclose other readable sessions under an unreadable root", async () => {
        const { owner } = await fixture();
        const foreign = await fixture();
        const page = await list(owner.id, foreign.lead.id);
        expect(page?.sessions).toEqual([]);
    });

    it("includes nested readable reports without granting access to an unreadable child", async () => {
        const { owner, lead, unrelated, create } = await fixture();
        const child = await create();
        const grandchild = await create();
        const foreign = await fixture();
        const readableBehindForeign = await create();
        await db.sessionReportsTo.createMany({ data: [
            { sessionId: child.id, leadSessionId: lead.id },
            { sessionId: grandchild.id, leadSessionId: child.id },
            { sessionId: foreign.lead.id, leadSessionId: lead.id },
            { sessionId: readableBehindForeign.id, leadSessionId: foreign.lead.id },
        ] });
        const page = await list(owner.id, lead.id);
        expect(page?.sessions.map((row) => row.id).sort()).toEqual([lead.id, child.id, grandchild.id, readableBehindForeign.id].sort());
        expect(page?.sessions.map((row) => row.id)).not.toContain(unrelated.id);
        expect(page?.sessions.find((row) => row.id === child.id)).toMatchObject({ reportsTo: { sessionId: lead.id } });
        expect(page?.sessions.find((row) => row.id === lead.id)).toMatchObject({ reports: { total: 1, working: 0, needsYou: 0, stalled: 0 } });
        expect(page?.sessions.find((row) => row.id === readableBehindForeign.id)).not.toHaveProperty("reportsTo");
    });

    it("counts direct reports from canonical awareness and omits unreadable lead facts", async () => {
        const { owner, lead, create } = await fixture();
        const working = await create();
        const needsYou = await create();
        const grandchild = await create();
        await db.session.update({ where: { id: working.id }, data: { active: true, latestTurnStatus: "in_progress" } });
        await db.session.update({ where: { id: needsYou.id }, data: {
            active: true, pendingPermissionRequestCount: 1, pendingRequestObservedAt: new Date(),
        } });
        await db.sessionReportsTo.createMany({ data: [
            { sessionId: working.id, leadSessionId: lead.id },
            { sessionId: needsYou.id, leadSessionId: lead.id },
            { sessionId: grandchild.id, leadSessionId: working.id },
        ] });
        const page = await list(owner.id, lead.id);
        expect(page?.sessions.find((row) => row.id === lead.id)).toMatchObject({ reports: { total: 2, working: 1, needsYou: 1, stalled: 0 } });
        const foreign = await fixture();
        await db.sessionReportsTo.create({ data: { sessionId: foreign.lead.id, leadSessionId: lead.id } });
        const foreignPage = await list(foreign.owner.id, foreign.lead.id);
        expect(foreignPage?.sessions[0]).not.toHaveProperty("reportsTo");
    });

    it("projects the same direct-report facts through HTTP detail without widening cross-owner reads", async () => {
        const { owner, lead, create } = await fixture();
        const child = await create();
        const foreign = await fixture();
        await db.sessionReportsTo.createMany({ data: [
            { sessionId: child.id, leadSessionId: lead.id },
            { sessionId: foreign.lead.id, leadSessionId: lead.id },
        ] });
        await withAuthenticatedTestApp(registerSessionListingRoutes, async (app) => {
            const headers = { "x-test-user-id": owner.id, "x-happier-account-stored-content-protocol": "2" };
            const leadDetail = await app.inject({ method: "GET", url: `/v2/sessions/${lead.id}?accessProjectionVersion=1`, headers });
            expect(leadDetail.statusCode, leadDetail.body).toBe(200);
            expect(leadDetail.json().session).toMatchObject({ reports: { total: 1, working: 0, needsYou: 0, stalled: 0 } });
            const childDetail = await app.inject({ method: "GET", url: `/v2/sessions/${child.id}?accessProjectionVersion=1`, headers });
            expect(childDetail.statusCode, childDetail.body).toBe(200);
            expect(childDetail.json().session).toMatchObject({ reportsTo: { sessionId: lead.id } });
            const deniedDetail = await app.inject({ method: "GET", url: `/v2/sessions/${foreign.lead.id}?accessProjectionVersion=1`, headers });
            expect(deniedDetail.statusCode).toBe(404);
        });
    });

    it("keeps supplemental pins and attention inside the subtree and counts reports outside a page", async () => {
        const { owner, lead, unrelated, create } = await fixture();
        const child = await create();
        await db.sessionReportsTo.create({ data: { sessionId: child.id, leadSessionId: lead.id } });
        await db.session.update({ where: { id: lead.id }, data: { meaningfulActivityAt: new Date(Date.now() + 1_000) } });
        await db.sessionPin.create({ data: { accountId: owner.id, sessionId: unrelated.id, sortKey: "0" } });
        await db.sessionAttentionStanding.create({ data: { accountId: owner.id, sessionId: unrelated.id, standing: true } });
        const page = await listSessionsForAccount({
            userId: owner.id, authentication,
            source: { kind: "query", query: {
                v: 1, storage: "active", includeInactive: true, scope: "all_accessible", attention: "any",
                audiences: [], tagIds: [], limit: 1, includeAttention: true, underSessionId: lead.id,
            } },
            rowRepresentabilityWhere: {}, timing: createV2SessionListServerTiming({}),
        });
        expect(page?.sessions.map((row) => row.id)).not.toContain(unrelated.id);
        expect(page?.sessions).toHaveLength(1);
        expect(page?.sessions[0]).toMatchObject({ id: lead.id, reports: { total: 1 } });
    });

    it("does not invent stalled machine evidence from an inactive session or elapsed turn time", async () => {
        const { owner, lead, create } = await fixture();
        const child = await create();
        await db.session.update({ where: { id: child.id }, data: {
            active: false, latestTurnStatus: "in_progress", latestTurnStatusObservedAt: BigInt(0),
            lastActiveAt: new Date(0),
        } });
        await db.sessionReportsTo.create({ data: { sessionId: child.id, leadSessionId: lead.id } });
        const page = await list(owner.id, lead.id);
        expect(page?.sessions.find((row) => row.id === lead.id)).toMatchObject({ reports: {
            total: 1, working: 1, needsYou: 0, stalled: 0,
        } });
    });

    it("counts a timed-out publisher mid-turn without mistaking another authorized machine for its publisher", async () => {
        const { owner, lead, create } = await fixture();
        const child = await create();
        const otherMachineId = randomUUID();
        const publisherMachineId = randomUUID();
        const now = Date.now();
        await db.machine.createMany({ data: [
            { id: otherMachineId, accountId: owner.id, metadata: "{}", active: true, lastActiveAt: new Date(now) },
            { id: publisherMachineId, accountId: owner.id, metadata: "{}", active: true, lastActiveAt: new Date(now - 600_001) },
        ] });
        await db.accessKey.createMany({ data: [otherMachineId, publisherMachineId].map((machineId) => ({
            accountId: owner.id, machineId, sessionId: child.id, data: "opaque-access-key",
        })) });
        const presence = createSessionPublisherPresence();
        const socket = { data: {} };
        const registration = await presence.registerPublisher({
            socket, binding: { accountId: owner.id, machineId: publisherMachineId, sessionId: child.id },
            completeActivitySnapshot: { state: "active", activeCount: 1 },
        });
        expect(registration.status).toBe("registered");
        await db.session.update({ where: { id: child.id }, data: { latestTurnStatus: "in_progress" } });
        await db.sessionReportsTo.create({ data: { sessionId: child.id, leadSessionId: lead.id } });
        // The existing timeout owner commits Machine.active=false; no projection-local clock decides presence.
        await runPresenceTimeoutTick({ machineTimeoutMs: 600_000, sessionTimeoutMs: 600_000, tickMs: 60_000 });
        expect(await db.machine.findUniqueOrThrow({ where: { id: publisherMachineId }, select: { active: true } }))
            .toEqual({ active: false });
        expect(await db.machine.findUniqueOrThrow({ where: { id: otherMachineId }, select: { active: true } }))
            .toEqual({ active: true });
        const page = await list(owner.id, lead.id);
        expect(page?.sessions.find((row) => row.id === lead.id)?.reports)
            .toEqual({ total: 1, working: 0, needsYou: 0, stalled: 1 });
    });

    it("counts needs-you by I3's session buckets and suppresses unreadable reports in every bucket", async () => {
        const { owner, lead, create } = await fixture();
        const primaries = ["failed", "permission_required", "action_required", "working", "ready"] as const;
        for (const primary of primaries) {
            const child = await create();
            await db.session.update({ where: { id: child.id }, data: {
                active: true,
                latestTurnStatus: primary === "failed" ? "failed" : primary === "working" ? "in_progress" : "completed",
                latestTurnStatusObservedAt: BigInt(Date.now()),
                pendingPermissionRequestCount: primary === "permission_required" ? 1 : 0,
                pendingUserActionRequestCount: primary === "action_required" ? 1 : 0,
                pendingRequestObservedAt: new Date(),
            } });
            await db.sessionReportsTo.create({ data: { sessionId: child.id, leadSessionId: lead.id } });
        }
        const foreign = await fixture();
        await db.session.update({ where: { id: foreign.lead.id }, data: { active: true, latestTurnStatus: "failed" } });
        await db.sessionReportsTo.create({ data: { sessionId: foreign.lead.id, leadSessionId: lead.id } });
        const needsYou = primaries.filter((primary) => resolveWorkStatusTone({ kind: "session", facts: {
            word: primary, awareness: { runtime: "unknown", operational: { primary, reasons: [] } },
        } }).bucket === "needs_you").length;
        const page = await list(owner.id, lead.id);
        expect(page?.sessions.find((row) => row.id === lead.id)?.reports)
            .toEqual({ total: primaries.length, working: 1, needsYou, stalled: 0 });
        expect(page?.sessions.map((row) => row.id)).not.toContain(foreign.lead.id);
    });

    it("does not disclose a shared report whose publication tuple is malformed", async () => {
        const { owner, lead } = await fixture();
        const foreign = await fixture();
        await db.session.update({ where: { id: foreign.lead.id }, data: {
            currentStorageState: "snapshot_complete", seq: 0, acceptedThroughServerSeq: 0,
            publishedThroughServerSeq: 0, materializedThroughSourceAt: BigInt(1),
            materializationPublicationId: "   ",
        } });
        await db.sessionShare.create({ data: {
            sessionId: foreign.lead.id, sharedByUserId: foreign.owner.id,
            sharedWithUserId: owner.id, accessLevel: "view",
        } });
        await db.sessionReportsTo.create({ data: { sessionId: foreign.lead.id, leadSessionId: lead.id } });
        const page = await list(owner.id, lead.id);
        expect(page?.sessions.map((row) => row.id)).toEqual([lead.id]);
        expect(page?.sessions[0]).toMatchObject({ reports: { total: 0, working: 0, needsYou: 0, stalled: 0 } });
    });
});
