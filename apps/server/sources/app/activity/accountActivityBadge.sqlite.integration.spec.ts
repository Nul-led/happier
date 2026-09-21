import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { db } from "@/storage/db";
import { createPresentUserSessionAccessAuthentication } from "@/app/session/access/sessionAccessAuthentication.testkit";
import { createLightSqliteHarness, type LightSqliteHarness } from "@/testkit/lightSqliteHarness";

import { computeAccountActivityBadgeCounts, computeAuthenticatedAccountActivityBadgeCount } from "./accountActivityBadge";

describe("Account activity badge admission (SQLite)", () => {
    let harness: LightSqliteHarness;
    beforeAll(async () => {
        harness = await createLightSqliteHarness({ tempDirPrefix: "activity-badge-", initAuth: false });
    }, 120_000);
    afterAll(async () => { await harness?.close(); });
    afterEach(() => vi.unstubAllEnvs());

    /**
     * The background badge count is produced with no request credential, so it
     * admits a restricted Team only when that Team currently qualifies without
     * evidence. Owner and inherited (unrestricted) Team arms keep contributing,
     * and the background answer matches the request-bound one for the same
     * recipient because both read the one access owner.
     */
    it("contributes a restricted-Team session only for a currently qualified recipient", async () => {
        vi.stubEnv("HAPPIER_FEATURE_SESSIONS_COLLABORATION__ENABLED", "1");
        const owner = await db.account.create({ data: { publicKey: randomUUID(), encryptionMode: "plain" } });
        const restrictedFollower = await db.account.create({ data: { publicKey: randomUUID(), encryptionMode: "plain" } });
        const inheritFollower = await db.account.create({ data: { publicKey: randomUUID(), encryptionMode: "plain" } });
        const restrictedTeam = await db.team.create({ data: {
            name: `badge-restricted-${randomUUID()}`,
            authenticationPolicy: { v: 1, mode: "restricted", accepted: [{ kind: "home_method", methodId: "github" }] },
        } });
        const inheritTeam = await db.team.create({ data: { name: `badge-inherit-${randomUUID()}` } });
        await db.teamMembership.createMany({ data: [
            { teamId: restrictedTeam.id, accountId: restrictedFollower.id, role: "member" as const },
            { teamId: inheritTeam.id, accountId: inheritFollower.id, role: "member" as const },
        ] });
        const session = await db.session.create({ data: {
            accountId: owner.id,
            tag: randomUUID(),
            metadata: "{}",
            encryptionMode: "plain",
            seq: 4,
            pendingBlockedCount: 1,
        } });
        await db.sessionTeamGrant.createMany({ data: [restrictedTeam, inheritTeam].map(team => ({
            sessionId: session.id, teamId: team.id, accessLevel: "view" as const, effectiveAt: new Date(0),
        })) });
        await db.accountSessionFollow.createMany({ data: [restrictedFollower, inheritFollower].map(account => ({
            sessionId: session.id, accountId: account.id, following: true, notificationLevel: "important" as const,
        })) });
        // A `view` grant cannot act on the blocked count, so the followers'
        // attention is their own unread frontier; the owner's is the block.
        await db.accountSessionReadState.createMany({ data: [restrictedFollower, inheritFollower].map(account => ({
            sessionId: session.id, accountId: account.id, lastViewedSessionSeq: 0,
        })) });

        expect(await computeAccountActivityBadgeCounts([owner.id, inheritFollower.id, restrictedFollower.id]))
            .toEqual(new Map([
                [owner.id, 1],
                [inheritFollower.id, 1],
                [restrictedFollower.id, 0],
            ]));
        expect(await computeAuthenticatedAccountActivityBadgeCount(
            restrictedFollower.id,
            createPresentUserSessionAccessAuthentication(),
        )).toBe(0);
        expect(await computeAuthenticatedAccountActivityBadgeCount(
            inheritFollower.id,
            createPresentUserSessionAccessAuthentication(),
        )).toBe(1);
    });
});
