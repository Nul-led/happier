import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { changesRoutes } from "@/app/api/routes/changes/changesRoutes";
import { createAuthenticatedTestApp } from "@/app/api/testkit/sqliteFastify";
import { HOME_GOVERNANCE_POLICY_ID } from "@/app/home/governance/governancePolicy";
import { db } from "@/storage/db";
import { createLightSqliteHarness, type LightSqliteHarness } from "@/testkit/lightSqliteHarness";

import { registerTeamGroupRoutes } from "./groups/registerTeamGroupRoutes";
import { registerTeamInvitationRoutes } from "./invitations/registerTeamInvitationRoutes";
import { registerTeamMemberRoutes } from "./memberships/registerTeamMemberRoutes";
import { registerTeamRoutes } from "./registerTeamRoutes";
import { TEAM_CHANGE_ENTITY_ID } from "./teamChanges";

describe("Team route AccountChange feed (SQLite integration)", () => {
    let harness: LightSqliteHarness;
    let app: ReturnType<typeof createAuthenticatedTestApp>;

    beforeAll(async () => {
        harness = await createLightSqliteHarness({
            tempDirPrefix: "happier-team-route-change-feed-",
            initAuth: false,
        });
        await db.homeGovernancePolicy.upsert({
            where: { id: HOME_GOVERNANCE_POLICY_ID },
            create: {
                id: HOME_GOVERNANCE_POLICY_ID,
                revision: 1,
                teamCreationPolicy: "self_service",
            },
            update: { teamCreationPolicy: "self_service" },
        });

        app = createAuthenticatedTestApp();
        changesRoutes(app);
        registerTeamRoutes(app);
        registerTeamMemberRoutes(app);
        registerTeamGroupRoutes(app);
        registerTeamInvitationRoutes(app, {
            resolveJoinLinkTarget: async () => ({
                applicationOrigin: "https://app.example.test",
                homeTarget: "portable-home-target",
            }),
            resolveJoinScreenHomeIdentity: async () => ({
                serverId: "home-1",
                displayName: "Acme Home",
                storageMode: "plain",
                hosting: null,
            }),
            email: {
                isDeliveryReady: () => true,
                delivery: {
                    isReady: true,
                    deliver: async () => ({ status: "sent" }),
                },
            },
        });
        await app.ready();
    }, 180_000);

    afterAll(async () => {
        if (app) await app.close();
        if (harness) await harness.close();
    });

    async function account() {
        return db.account.create({
            data: { publicKey: randomUUID(), encryptionMode: "plain" },
        });
    }

    async function post(url: string, actorAccountId: string, payload: unknown) {
        return app.inject({
            method: "POST",
            url,
            headers: { "x-test-user-id": actorAccountId },
            payload,
        });
    }

    async function readTeamChange(accountId: string, after: number) {
        const response = await app.inject({
            method: "GET",
            url: `/v2/changes?after=${after}&limit=50`,
            headers: { "x-test-user-id": accountId },
        });
        expect(response.statusCode, response.body).toBe(200);
        const body = response.json();
        expect(body.changes).toEqual([
            expect.objectContaining({
                kind: "account",
                entityId: TEAM_CHANGE_ENTITY_ID,
                hint: null,
            }),
        ]);
        expect(body.nextCursor).toBeGreaterThan(after);
        return body.nextCursor as number;
    }

    async function expectNoChange(accountId: string, after: number) {
        const response = await app.inject({
            method: "GET",
            url: `/v2/changes?after=${after}&limit=50`,
            headers: { "x-test-user-id": accountId },
        });
        expect(response.statusCode, response.body).toBe(200);
        expect(response.json()).toMatchObject({ changes: [], nextCursor: after });
    }

    it("publishes each committed Team, membership, Group, and invitation route mutation through /v2/changes", async () => {
        const owner = await account();
        const member = await account();

        const created = await post("/v1/teams/create", owner.id, {
            v: 1,
            name: "Change feed Team",
            requestKey: randomUUID(),
        });
        expect(created.statusCode, created.body).toBe(200);
        const teamId = created.json().id as string;
        let ownerCursor = await readTeamChange(owner.id, 0);

        const added = await post("/v1/teams/members/add", owner.id, {
            v: 1,
            teamId,
            accountId: member.id,
            role: "member",
            historyAccess: "from_membership",
        });
        expect(added.statusCode, added.body).toBe(200);
        ownerCursor = await readTeamChange(owner.id, ownerCursor);
        let memberCursor = await readTeamChange(member.id, 0);

        const refusedGroup = await post("/v1/teams/groups/create", member.id, {
            v: 1,
            teamId,
            name: "Not authorized",
            requestKey: randomUUID(),
        });
        expect(refusedGroup.statusCode, refusedGroup.body).toBe(403);
        await expectNoChange(owner.id, ownerCursor);
        await expectNoChange(member.id, memberCursor);

        const group = await post("/v1/teams/groups/create", owner.id, {
            v: 1,
            teamId,
            name: "Reviewers",
            requestKey: randomUUID(),
        });
        expect(group.statusCode, group.body).toBe(200);
        const groupId = group.json().id as string;

        const groupMember = await post("/v1/teams/groups/members/add", owner.id, {
            v: 1,
            teamId,
            groupId,
            accountId: member.id,
            historyAccess: "all_existing",
        });
        expect(groupMember.statusCode, groupMember.body).toBe(200);
        ownerCursor = await readTeamChange(owner.id, ownerCursor);
        memberCursor = await readTeamChange(member.id, memberCursor);

        const invitation = await post("/v1/teams/invitations/create", owner.id, {
            v: 1,
            teamId,
            role: "member",
            historyAccess: "from_membership",
            recipientEmail: null,
            requestKey: randomUUID(),
        });
        expect(invitation.statusCode, invitation.body).toBe(200);
        expect(invitation.json().joinUrl).toMatch(/^https:\/\/app\.example\.test\/join\//u);

        await readTeamChange(owner.id, ownerCursor);
        await readTeamChange(member.id, memberCursor);
    });
});
