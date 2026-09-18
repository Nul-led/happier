import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { db } from "@/storage/db";
import { inTx } from "@/storage/inTx";
import { createLightSqliteHarness, type LightSqliteHarness } from "@/testkit/lightSqliteHarness";

import { qualifyTeamOperationAuthenticationInTx, resolveTeamActorContextInTx } from "./actorContext";
import { resolveTeamViewerInTx } from "./viewer";

/**
 * The consolidated Team actor authority.
 *
 * Team authority used to be resolved twice — once for read-oriented routes and
 * once for mutations — each fetching the Team, the Account and the membership
 * and each composing capabilities. These tests pin the two behaviors that had to
 * survive the consolidation: the viewer's absent/unreadable collapse, and the
 * richer denied context that mutations and owner recovery depend on. They also
 * pin that both now report the *same* decision, which is the property a second
 * resolver could silently break.
 */
describe("Team actor context (SQLite integration)", () => {
    let harness: LightSqliteHarness;
    beforeAll(async () => {
        harness = await createLightSqliteHarness({
            tempDirPrefix: "happier-team-actor-context-",
            initAuth: false,
        });
    }, 180_000);
    afterAll(async () => { if (harness) await harness.close(); });

    async function account(homeRole: "owner" | "admin" | "member" = "member") {
        return db.account.create({
            data: { publicKey: crypto.randomUUID(), encryptionMode: "plain", homeRole },
        });
    }

    async function team(name: string, options?: Readonly<{ archived?: boolean }>) {
        return db.team.create({
            data: { name, ...(options?.archived ? { archivedAt: new Date() } : {}) },
        });
    }

    async function member(
        teamId: string,
        accountId: string,
        role: "owner" | "admin" | "member" | "guest",
    ) {
        return db.teamMembership.create({ data: { teamId, accountId, role } });
    }

    it("reports one capability decision to the viewer and the context alike", async () => {
        for (const role of ["owner", "admin", "member", "guest"] as const) {
            const person = await account();
            const acme = await team(`Agreement ${role}`);
            await member(acme.id, person.id, role);

            const [viewer, context] = await inTx(async (tx) => [
                await resolveTeamViewerInTx(tx, { teamId: acme.id, actorAccountId: person.id }),
                await resolveTeamActorContextInTx(tx, { teamId: acme.id, actorAccountId: person.id }),
            ]);

            expect(viewer).not.toBeNull();
            expect(context).not.toBeNull();
            // One lookup, one decision: a second resolver is exactly what could
            // make these two disagree about the same actor.
            expect(viewer?.capabilities).toEqual(context?.capabilities);
            expect(viewer?.viewerRole).toBe(role);
            expect(viewer?.team.id).toBe(context?.team.id);
        }
    });

    it("collapses an absent and an unreadable Team to the same viewer answer", async () => {
        const outsider = await account();
        const acme = await team("Unreadable");

        const resolved = await inTx(async (tx) => ({
            absentViewer: await resolveTeamViewerInTx(tx, {
                teamId: "team-that-does-not-exist",
                actorAccountId: outsider.id,
            }),
            unreadableViewer: await resolveTeamViewerInTx(tx, {
                teamId: acme.id,
                actorAccountId: outsider.id,
            }),
            absentContext: await resolveTeamActorContextInTx(tx, {
                teamId: "team-that-does-not-exist",
                actorAccountId: outsider.id,
            }),
            unreadableContext: await resolveTeamActorContextInTx(tx, {
                teamId: acme.id,
                actorAccountId: outsider.id,
            }),
        }));

        // The viewer cannot distinguish them, so a Team id cannot be probed.
        expect(resolved.absentViewer).toBeNull();
        expect(resolved.unreadableViewer).toBeNull();

        // The context still describes the denial, which is what lets a mutation
        // answer "archived" to a retained member and "no such Team" to everyone
        // else without a second lookup.
        expect(resolved.absentContext).toBeNull();
        expect(resolved.unreadableContext).not.toBeNull();
        expect(resolved.unreadableContext?.membership).toBeNull();
        expect(resolved.unreadableContext?.capabilities.viewTeam).toBe(false);
        expect(resolved.unreadableContext?.accountStatus).toBe("active");
        expect(resolved.unreadableContext?.homeAuthority.manageAllTeams).toBe(false);
    });

    it("keeps a Home administrator's owner-recovery facts available without membership", async () => {
        const homeAdmin = await account("admin");
        const acme = await team("Recovery facts");

        const context = await inTx((tx) => resolveTeamActorContextInTx(tx, {
            teamId: acme.id,
            actorAccountId: homeAdmin.id,
        }));

        expect(context).not.toBeNull();
        expect(context?.membership).toBeNull();
        expect(context?.homeAuthority.manageAllTeams).toBe(true);
        // Home authority is governance only. The narrow owner-required recovery
        // reads `homeAuthority`; it must never arrive as `manageMembers`.
        expect(context?.capabilities.manageMembers).toBe(false);
        expect(context?.capabilities.manageOwners).toBe(false);
        expect(context?.capabilities.viewTeam).toBe(true);

        const viewer = await inTx((tx) => resolveTeamViewerInTx(tx, {
            teamId: acme.id,
            actorAccountId: homeAdmin.id,
        }));
        expect(viewer?.viewerRole).toBeNull();
    });

    it("maps a malformed Team policy to runtime authentication unavailability", async () => {
        const owner = await account();
        const acme = await db.team.create({
            data: { name: "Malformed auth", authenticationPolicy: { v: 99, mode: "restricted" } },
        });
        await member(acme.id, owner.id, "owner");

        const result = await inTx(async (tx) => {
            const context = await resolveTeamActorContextInTx(tx, {
                teamId: acme.id,
                actorAccountId: owner.id,
            });
            if (!context) throw new Error("fixture Team context missing");
            return qualifyTeamOperationAuthenticationInTx(tx, {
                context,
                authenticationAuthority: "present_user",
            });
        });
        expect(result).toEqual({ ok: false, error: "team_authentication_unavailable" });
    });

    it("cannot qualify a released legacy Home credential after request admission", async () => {
        const owner = await account();
        const acme = await team("Legacy credential restriction");
        await member(acme.id, owner.id, "owner");

        const result = await inTx(async (tx) => {
            const context = await resolveTeamActorContextInTx(tx, {
                teamId: acme.id,
                actorAccountId: owner.id,
            });
            if (!context) throw new Error("fixture Team context missing");
            return qualifyTeamOperationAuthenticationInTx(tx, {
                context,
                authenticationAuthority: "present_user",
                legacyHomeCredential: true,
            });
        });

        expect(result).toEqual({ ok: false, error: "team_authentication_unavailable" });
    });

    it("denies an erased or inactive Account without pretending the Team is absent", async () => {
        const person = await account();
        const acme = await team("Inactive actor");
        await member(acme.id, person.id, "owner");
        await db.account.update({ where: { id: person.id }, data: { status: "suspended" } });

        const resolved = await inTx(async (tx) => ({
            viewer: await resolveTeamViewerInTx(tx, { teamId: acme.id, actorAccountId: person.id }),
            context: await resolveTeamActorContextInTx(tx, { teamId: acme.id, actorAccountId: person.id }),
            erased: await resolveTeamActorContextInTx(tx, {
                teamId: acme.id,
                actorAccountId: "account-that-does-not-exist",
            }),
        }));

        expect(resolved.viewer).toBeNull();
        expect(resolved.context?.accountStatus).toBe("suspended");
        expect(resolved.context?.membership?.role).toBe("owner");
        expect(resolved.context?.capabilities.viewTeam).toBe(false);
        // A missing Account row is powerless, not absent: the Team still exists.
        expect(resolved.erased).not.toBeNull();
        expect(resolved.erased?.accountStatus).toBe("disabled");
        expect(resolved.erased?.capabilities.viewTeam).toBe(false);
    });

    it("carries the whole Team record so no consumer needs a second read of it", async () => {
        const person = await account();
        const acme = await db.team.create({
            data: {
                name: "Full record",
                description: "Ships things.",
                defaultSessionHistoryAccess: "all_existing",
            },
        });
        await member(acme.id, person.id, "admin");

        const context = await inTx((tx) => resolveTeamActorContextInTx(tx, {
            teamId: acme.id,
            actorAccountId: person.id,
        }));

        expect(context?.team).toMatchObject({
            id: acme.id,
            name: "Full record",
            description: "Ships things.",
            defaultSessionHistoryAccess: "all_existing",
            archivedAt: null,
        });
        // The accepted-authentication document is part of the same record, which
        // is why the identity-administration authority no longer re-reads it.
        expect(context?.team).toHaveProperty("authenticationPolicy");
    });

    it("keeps an archived Team readable by its retained members and restorable by a manager", async () => {
        const manager = await account();
        const acme = await team("Archived", { archived: true });
        await member(acme.id, manager.id, "admin");

        const viewer = await inTx((tx) => resolveTeamViewerInTx(tx, {
            teamId: acme.id,
            actorAccountId: manager.id,
        }));

        expect(viewer).not.toBeNull();
        expect(viewer?.capabilities.restoreTeam).toBe(true);
        expect(viewer?.capabilities.manageMembers).toBe(false);
    });

    it("separates a Home administrator from a stranger on an archived Team", async () => {
        // These are the exact facts every authority branch reads to distinguish
        // "this Team is archived" from "no such Team". Consolidating invitation
        // authority onto this context therefore moves a Home administrator into
        // the archived answer — a fact they can already read through
        // `manageAllTeams` — while conferring no `manageInvitations` on them and
        // leaving the stranger indistinguishable from an absent Team.
        const homeAdmin = await account("admin");
        const stranger = await account();
        const acme = await team("Archived visibility", { archived: true });

        const resolved = await inTx(async (tx) => ({
            administrator: await resolveTeamActorContextInTx(tx, {
                teamId: acme.id,
                actorAccountId: homeAdmin.id,
            }),
            stranger: await resolveTeamActorContextInTx(tx, {
                teamId: acme.id,
                actorAccountId: stranger.id,
            }),
        }));

        expect(resolved.administrator?.team.archivedAt).not.toBeNull();
        expect(resolved.administrator?.capabilities.viewTeam).toBe(true);
        expect(resolved.administrator?.capabilities.manageInvitations).toBe(false);
        expect(resolved.stranger?.capabilities.viewTeam).toBe(false);
        expect(resolved.stranger?.capabilities.manageInvitations).toBe(false);
    });
});
