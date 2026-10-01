import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createAuthenticatedTestApp } from "@/app/api/testkit/sqliteFastify";
import { db } from "@/storage/db";
import { inTx } from "@/storage/inTx";
import { createLightSqliteHarness, type LightSqliteHarness } from "@/testkit/lightSqliteHarness";
import { admitTeamMemberInTx } from "@/app/teams/memberships/membershipService";
import { registerSessionAccessGrantRoutes } from "./registerSessionAccessGrantRoutes";

describe("Selected Session access principals (SQLite HTTP integration)", () => {
    let harness: LightSqliteHarness;
    let app: ReturnType<typeof createAuthenticatedTestApp>;

    beforeAll(async () => {
        harness = await createLightSqliteHarness({
            tempDirPrefix: "happier-access-principals-",
            initAuth: false,
            env: { HAPPIER_FEATURE_SHARING__SESSION__ENABLED: "1", HAPPIER_FEATURE_TEAMS__ENABLED: "1" },
        });
        app = createAuthenticatedTestApp();
        registerSessionAccessGrantRoutes(app);
        await app.ready();
    }, 180_000);

    afterAll(async () => {
        if (app) await app.close();
        if (harness) await harness.close();
    });

    it("returns only requested visible identities, deduplicated, without exposing hidden profiles", async () => {
        const account = (username: string) => db.account.create({ data: {
            publicKey: crypto.randomUUID(), encryptionMode: "plain", username,
        } });
        const actor = await account("principal-actor");
        const friend = await account("principal-friend");
        const hidden = await account("principal-hidden");
        await db.userRelationship.create({ data: {
            fromUserId: actor.id, toUserId: friend.id, status: "friend",
        } });
        const team = await db.team.create({ data: { name: "Visible Team" } });
        const hiddenTeam = await db.team.create({ data: { name: "Hidden Team" } });
        await inTx(async (tx) => {
            const result = await admitTeamMemberInTx(tx, {
                teamId: team.id, accountId: actor.id, role: "owner", historyAccess: "all_existing",
            });
            if (!result.ok) throw new Error("fixture membership admission failed");
        });
        const group = await db.teamGroup.create({ data: { teamId: team.id, name: "Visible Group", nameKey: "visible group" } });
        const hiddenGroup = await db.teamGroup.create({ data: { teamId: hiddenTeam.id, name: "Hidden Group", nameKey: "hidden group" } });
        const unrequestedGroup = await db.teamGroup.create({ data: { teamId: team.id, name: "Not requested", nameKey: "not requested" } });
        const response = await app.inject({
            method: "POST", url: "/v1/session-access/principals/resolve",
            headers: { "x-test-user-id": actor.id },
            payload: { v: 1, subjects: [
                { kind: "account", accountId: friend.id },
                { kind: "account", accountId: friend.id },
                { kind: "account", accountId: hidden.id },
                { kind: "team", teamId: team.id },
                { kind: "team", teamId: hiddenTeam.id },
                { kind: "group", teamId: team.id, groupId: group.id },
                { kind: "group", teamId: hiddenTeam.id, groupId: hiddenGroup.id },
                // A valid Group id cannot be used to claim another parent Team.
                { kind: "group", teamId: team.id, groupId: hiddenGroup.id },
            ] },
        });
        expect(response.statusCode).toBe(200);
        expect(response.json()).toEqual({ v: 1, principals: [
            { kind: "account", accountId: friend.id, username: "principal-friend", firstName: null, lastName: null, avatarUrl: null },
            { kind: "team", teamId: team.id, name: "Visible Team" },
            { kind: "group", teamId: team.id, groupId: group.id, name: "Visible Group", teamName: "Visible Team" },
        ] });
        expect(response.body).not.toContain(hidden.username);
        expect(response.body).not.toContain(unrequestedGroup.id);
        const unauthorized = await app.inject({ method: "POST", url: "/v1/session-access/principals/resolve", payload: { v: 1, subjects: [] } });
        expect(unauthorized.statusCode).toBe(401);
    });

    it("qualifies selected collective identities against the current credential and membership", async () => {
        const actor = await db.account.create({ data: { publicKey: crypto.randomUUID(), encryptionMode: "e2ee" } });
        const team = await db.team.create({ data: {
            name: "Restricted selected Team",
            authenticationPolicy: { v: 1, mode: "restricted", accepted: [{ kind: "home_method", methodId: "key_challenge" }] },
        } });
        await inTx((tx) => admitTeamMemberInTx(tx, {
            teamId: team.id, accountId: actor.id, role: "member", historyAccess: "all_existing",
        }));
        const group = await db.teamGroup.create({ data: { teamId: team.id, name: "Restricted selected Group", nameKey: "restricted selected group" } });
        const payload = { v: 1, subjects: [
            { kind: "team", teamId: team.id },
            { kind: "group", teamId: team.id, groupId: group.id },
        ] };
        const resolve = (qualified: boolean) => app.inject({
            method: "POST", url: "/v1/session-access/principals/resolve", payload,
            headers: {
                "x-test-user-id": actor.id,
                ...(qualified ? { "x-test-authentication-evidence": JSON.stringify([{ kind: "home_method", methodId: "key_challenge" }]) } : {}),
            },
        });
        const denied = await resolve(false);
        expect(denied.statusCode).toBe(200);
        expect(denied.json()).toEqual({ v: 1, principals: [] });
        const admitted = await resolve(true);
        expect(admitted.statusCode).toBe(200);
        expect(admitted.json().principals).toEqual([
            { kind: "team", teamId: team.id, name: team.name },
            { kind: "group", teamId: team.id, groupId: group.id, name: group.name, teamName: team.name },
        ]);
        await db.teamMembership.update({ where: { teamId_accountId: { teamId: team.id, accountId: actor.id } }, data: { status: "suspended" } });
        expect((await resolve(true)).json()).toEqual({ v: 1, principals: [] });
    });

    it("returns the server-owned creation decision for a selected primary Team without loading a directory", async () => {
        const actor = await db.account.create({ data: { publicKey: crypto.randomUUID(), encryptionMode: "plain" } });
        const team = await db.team.create({ data: {
            name: "Creation decision Team", sessionCreationPolicy: "team_required", externalSharingPolicy: "team_admins_only",
        } });
        await inTx((tx) => admitTeamMemberInTx(tx, {
            teamId: team.id, accountId: actor.id, role: "owner", historyAccess: "all_existing",
        }));
        const response = await app.inject({
            method: "POST", url: "/v1/session-access/principals/resolve",
            headers: { "x-test-user-id": actor.id },
            payload: { v: 1, subjects: [], creationTeamId: team.id },
        });
        expect(response.statusCode).toBe(200);
        expect(response.json()).toEqual({ v: 1, principals: [], creationDecision: {
            v: 1, teamId: team.id, teamName: team.name, requiredByPolicy: true,
            defaultGrant: { accessLevel: "edit", canApprovePermissions: false },
            externalSharingPolicy: "team_admins_only",
        } });
    });

    it("rejects authority fields and incomplete Group references at the strict request boundary", async () => {
        const actor = await db.account.create({ data: { publicKey: crypto.randomUUID(), encryptionMode: "plain" } });
        for (const payload of [
            { v: 1, subjects: [], actorAccountId: actor.id },
            { v: 1, subjects: [{ kind: "group", groupId: "group" }] },
            { v: 1, subjects: [{ kind: "team", teamId: "team", name: "untrusted" }] },
        ]) {
            const response = await app.inject({ method: "POST", url: "/v1/session-access/principals/resolve", headers: { "x-test-user-id": actor.id }, payload });
            expect(response.statusCode).toBe(400);
        }
    });
});
