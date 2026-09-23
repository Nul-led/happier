import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { db } from "@/storage/db";
import type { Tx } from "@/storage/inTx";
import { createLightSqliteHarness, type LightSqliteHarness } from "@/testkit/lightSqliteHarness";
import { admitSessionBackgroundDeliveryInTx } from "./backgroundDelivery";
import { listSessionPersonalEventRecipients } from "./eventEligibility";

describe("personal event recipients", () => {
    let harness: LightSqliteHarness;
    beforeAll(async () => { harness = await createLightSqliteHarness({ tempDirPrefix: "personal-events-", initAuth: false }); }, 120_000);
    afterAll(async () => { await harness?.close(); });
    afterEach(() => vi.unstubAllEnvs());
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

    /**
     * Background delivery carries no request credential, so a restricted Team is
     * the one arm it cannot currently qualify. Owner, direct and inherited
     * (unrestricted) arms keep delivering.
     */
    it("admits a restricted-Team arm only when that Team qualifies without request evidence", async () => {
        vi.stubEnv("HAPPIER_FEATURE_SESSIONS_COLLABORATION__ENABLED", "1");
        const owner = await db.account.create({ data: { publicKey: randomUUID() } });
        const restrictedFollower = await db.account.create({ data: { publicKey: randomUUID() } });
        const inheritFollower = await db.account.create({ data: { publicKey: randomUUID() } });
        const directFollower = await db.account.create({ data: { publicKey: randomUUID() } });
        const restrictedTeam = await db.team.create({ data: {
            name: `restricted-${randomUUID()}`,
            authenticationPolicy: { v: 1, mode: "restricted", accepted: [{ kind: "home_method", methodId: "github" }] },
        } });
        const inheritTeam = await db.team.create({ data: { name: `inherit-${randomUUID()}` } });
        await db.teamMembership.createMany({ data: [
            { teamId: restrictedTeam.id, accountId: restrictedFollower.id, role: "member" as const },
            { teamId: inheritTeam.id, accountId: inheritFollower.id, role: "member" as const },
        ] });
        const session = await db.session.create({ data: { accountId: owner.id, tag: randomUUID(), metadata: "{}" } });
        await db.sessionTeamGrant.createMany({ data: [restrictedTeam, inheritTeam].map(team => ({
            sessionId: session.id, teamId: team.id, accessLevel: "view" as const, effectiveAt: new Date(0),
        })) });
        await db.sessionShare.create({ data: {
            sessionId: session.id, sharedByUserId: owner.id, sharedWithUserId: directFollower.id, accessLevel: "view",
        } });
        await db.accountSessionFollow.createMany({ data: [restrictedFollower, inheritFollower, directFollower].map(account => ({
            sessionId: session.id, accountId: account.id, following: true, notificationLevel: "important" as const,
        })) });

        expect((await listSessionPersonalEventRecipients({ sessionId: session.id, event: "ready" })).map(row => row.accountId).sort())
            .toEqual([owner.id, inheritFollower.id, directFollower.id].sort());

        // A one-shot target is not a second way in: the same unqualified arm
        // decides the targeted event too.
        expect(await listSessionPersonalEventRecipients({
            sessionId: session.id, event: "discussion_mention", targetAccountIds: [restrictedFollower.id],
        })).toEqual([]);
        expect((await listSessionPersonalEventRecipients({
            sessionId: session.id, event: "discussion_mention", targetAccountIds: [inheritFollower.id],
        })).map(row => row.accountId)).toEqual([inheritFollower.id]);
    });

    /**
     * One background event fans out to every recipient of one Session, so the
     * admission reads that Session's access row once for the batch instead of
     * once per recipient. The admitted set is the same credential-qualified
     * answer: owner, direct and inherited arms in, a restricted-Team-only
     * recipient out.
     */
    it("reads the Session access row once for a batch of recipients", async () => {
        vi.stubEnv("HAPPIER_FEATURE_SESSIONS_COLLABORATION__ENABLED", "1");
        const owner = await db.account.create({ data: { publicKey: randomUUID() } });
        const inheritFollower = await db.account.create({ data: { publicKey: randomUUID() } });
        const directFollower = await db.account.create({ data: { publicKey: randomUUID() } });
        const restrictedFollower = await db.account.create({ data: { publicKey: randomUUID() } });
        const inheritTeam = await db.team.create({ data: { name: `batch-inherit-${randomUUID()}` } });
        const restrictedTeam = await db.team.create({ data: {
            name: `batch-restricted-${randomUUID()}`,
            authenticationPolicy: { v: 1, mode: "restricted", accepted: [{ kind: "home_method", methodId: "github" }] },
        } });
        await db.teamMembership.createMany({ data: [
            { teamId: inheritTeam.id, accountId: inheritFollower.id, role: "member" as const },
            { teamId: restrictedTeam.id, accountId: restrictedFollower.id, role: "member" as const },
        ] });
        const session = await db.session.create({ data: { accountId: owner.id, tag: randomUUID(), metadata: "{}" } });
        await db.sessionTeamGrant.createMany({ data: [inheritTeam, restrictedTeam].map(team => ({
            sessionId: session.id, teamId: team.id, accessLevel: "view" as const, effectiveAt: new Date(0),
        })) });
        await db.sessionShare.create({ data: {
            sessionId: session.id, sharedByUserId: owner.id, sharedWithUserId: directFollower.id, accessLevel: "view",
        } });

        let sessionRowReads = 0;
        const reader = new Proxy(db, {
            get(target, property, receiver) {
                const value = Reflect.get(target, property, receiver);
                if (property !== "session" || typeof value !== "object" || value === null) return value;
                return new Proxy(value, {
                    get(delegate, method, delegateReceiver) {
                        const member = Reflect.get(delegate, method, delegateReceiver);
                        if (method !== "findUnique" || typeof member !== "function") return member;
                        return (...args: readonly unknown[]) => {
                            sessionRowReads += 1;
                            return Reflect.apply(member, delegate, args);
                        };
                    },
                });
            },
        }) as unknown as Tx;

        const admitted = await admitSessionBackgroundDeliveryInTx(reader, {
            sessionId: session.id,
            accountIds: [owner.id, inheritFollower.id, directFollower.id, restrictedFollower.id],
        });
        expect([...admitted.keys()].sort()).toEqual([owner.id, inheritFollower.id, directFollower.id].sort());
        expect(sessionRowReads).toBe(1);
    });
});
