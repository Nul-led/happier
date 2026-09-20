import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/storage/db";
import { createLightSqliteHarness, type LightSqliteHarness } from "@/testkit/lightSqliteHarness";
import { listSessionPersonalEventRecipients } from "./eventEligibility";

describe("personal event recipients", () => {
    let harness: LightSqliteHarness;
    beforeAll(async () => { harness = await createLightSqliteHarness({ tempDirPrefix: "personal-events-", initAuth: false }); }, 120_000);
    afterAll(async () => { await harness?.close(); });
    it("admits actual subscriptions and one-shot targets independently of broad readable recipients", async () => {
        const owner = await db.account.create({ data: { publicKey: randomUUID() } });
        const reader = await db.account.create({ data: { publicKey: randomUUID() } });
        const follower = await db.account.create({ data: { publicKey: randomUUID() } });
        const session = await db.session.create({ data: { accountId: owner.id, tag: randomUUID(), metadata: "{}" } });
        await db.sessionShare.createMany({ data: [reader, follower].map(account => ({
            sessionId: session.id, sharedByUserId: owner.id, sharedWithUserId: account.id, accessLevel: "view" as const,
        })) });
        await db.accountSessionFollow.create({ data: { sessionId: session.id, accountId: follower.id, following: true, notificationLevel: "important" } });
        expect((await listSessionPersonalEventRecipients({ sessionId: session.id, event: "ready" })).map(row => row.accountId).sort())
            .toEqual([owner.id, follower.id].sort());
        expect((await listSessionPersonalEventRecipients({ sessionId: session.id, event: "discussion_mention", targetAccountIds: [reader.id] })).map(row => row.accountId))
            .toEqual([reader.id]);
        // A direct share is one targeted relevance fact: the granted recipient only,
        // never the granting owner and never the unrelated follower.
        expect(await listSessionPersonalEventRecipients({ sessionId: session.id, event: "directly_shared", targetAccountIds: [reader.id] }))
            .toEqual([{ accountId: reader.id, reason: "direct_share_target" }]);
        expect(await listSessionPersonalEventRecipients({ sessionId: session.id, event: "directly_shared" })).toEqual([]);
        const contentFreeCandidates = await listSessionPersonalEventRecipients({
            sessionId: session.id,
            event: "ready",
        });
        expect(contentFreeCandidates.every((candidate) => (
            Object.keys(candidate).every((key) => key === "accountId" || key === "reason")
        ))).toBe(true);
        await db.sessionShare.deleteMany({ where: { sessionId: session.id, sharedWithUserId: follower.id } });
        expect((await listSessionPersonalEventRecipients({ sessionId: session.id, event: "ready" })).map(row => row.accountId))
            .toEqual([owner.id]);
        await db.account.update({ where: { id: owner.id }, data: { status: "suspended" } });
        expect(await listSessionPersonalEventRecipients({ sessionId: session.id, event: "ready" })).toEqual([]);
    });
});
