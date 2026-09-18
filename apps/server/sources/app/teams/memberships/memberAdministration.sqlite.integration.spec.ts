import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { db } from "@/storage/db";
import { inTx } from "@/storage/inTx";
import { createLightSqliteHarness, type LightSqliteHarness } from "@/testkit/lightSqliteHarness";
import { admitTeamMemberInTx } from "./membershipService";
import {
    addTeamMemberForActorInTx,
    getTeamMemberForActorInTx,
    listTeamMembersForActorInTx,
    reactivateTeamMemberForActorInTx,
    removeTeamMemberForActorInTx,
    setTeamMemberManagementForActorInTx,
    setTeamMemberRoleForActorInTx,
    suspendTeamMemberForActorInTx,
} from "./memberAdministration";

describe("Team member administration (SQLite integration)", () => {
    let harness: LightSqliteHarness;
    beforeAll(async () => {
        harness = await createLightSqliteHarness({
            tempDirPrefix: "happier-team-member-admin-",
            initAuth: false,
        });
    }, 180_000);
    afterAll(async () => { if (harness) await harness.close(); });

    async function account(overrides?: Readonly<{
        status?: "active" | "suspended" | "disabled";
        homeRole?: "owner" | "admin" | "member";
        encryptionMode?: "plain" | "e2ee";
    }>) {
        return db.account.create({
            data: {
                publicKey: crypto.randomUUID(),
                encryptionMode: overrides?.encryptionMode ?? "plain",
                status: overrides?.status ?? "active",
                homeRole: overrides?.homeRole ?? "member",
            },
        });
    }

    async function team(name: string) {
        return db.team.create({ data: { name } });
    }

    /**
     * A real directory source, built the way the source owner requires: a
     * WorkOS-kind source must reference its identity connection, and the
     * provider CHECK constraint enforces that. Faking the row would prove
     * nothing about the management binding this test exercises.
     */
    async function workosSource(teamId: string, displayName: string) {
        const provider = await db.identityProviderInstance.create({
            data: { ownerTeamId: teamId, kind: "workos_sso", displayName, config: { v: 1 } },
        });
        const connection = await db.teamIdentityConnection.create({
            data: {
                teamId,
                providerInstanceId: provider.id,
                externalReference: { v: 1 },
                settings: { v: 1 },
            },
        });
        return db.teamDirectorySource.create({
            data: {
                teamId,
                kind: "workos_directory",
                displayName,
                // Management can move only to a currently usable source. The
                // production creator begins at `initializing`; this fixture is
                // the post-readiness source the transfer contract exercises.
                state: "active",
                externalSourceKey: `workos:${teamId}:${crypto.randomUUID()}`,
                bindingConfig: { v: 1, kind: "workos_directory" },
                teamIdentityConnectionId: connection.id,
            },
        });
    }

    async function member(
        teamId: string,
        accountId: string,
        role: "owner" | "admin" | "member" | "guest",
        historyAccess: "all_existing" | "from_membership" = "from_membership",
    ) {
        const admitted = await inTx((tx) => admitTeamMemberInTx(tx, {
            teamId, accountId, role, historyAccess,
        }));
        if (!admitted.ok) throw new Error(`admission failed: ${admitted.error}`);
        return admitted.membership;
    }

    it("hides a Team the actor cannot see rather than reporting a permission problem", async () => {
        const stranger = await account();
        const acme = await team("Hidden");

        const result = await inTx((tx) => listTeamMembersForActorInTx(tx, {
            teamId: acme.id, actorAccountId: stranger.id, filter: "all",
        }));

        expect(result).toEqual({ ok: false, error: "team_not_found" });
    });

    it("does not turn Home Team-detail administration into roster authority", async () => {
        const owner = await account();
        const homeAdmin = await account({ homeRole: "admin" });
        const acme = await team("Home detail is not roster access");
        await member(acme.id, owner.id, "owner");

        const result = await inTx((tx) => listTeamMembersForActorInTx(tx, {
            teamId: acme.id,
            actorAccountId: homeAdmin.id,
            filter: "all",
        }));

        expect(result).toEqual({ ok: false, error: "team_not_found" });
    });

    it("lets a Home administrator who is not a member read an ownerless Team for recovery, and only then", async () => {
        const homeAdmin = await account({ homeRole: "admin" });
        const retiredOwner = await account();
        const survivor = await account();
        const acme = await team("Ownerless roster");
        await member(acme.id, retiredOwner.id, "owner");
        const survivorMembership = await member(acme.id, survivor.id, "member");
        await db.account.update({ where: { id: retiredOwner.id }, data: { status: "suspended" } });

        const roster = await inTx((tx) => listTeamMembersForActorInTx(tx, {
            teamId: acme.id, actorAccountId: homeAdmin.id, filter: "all",
        }));
        expect(roster.ok, JSON.stringify(roster)).toBe(true);
        if (!roster.ok) return;
        expect(roster.value.items.map((row) => row.accountId)).toContain(survivor.id);

        const detail = await inTx((tx) => getTeamMemberForActorInTx(tx, {
            teamId: acme.id,
            actorAccountId: homeAdmin.id,
            membershipId: survivorMembership.teamMembershipId,
        }));
        expect(detail.ok, JSON.stringify(detail)).toBe(true);

        const recovered = await inTx((tx) => setTeamMemberRoleForActorInTx(tx, {
            teamId: acme.id,
            actorAccountId: homeAdmin.id,
            membershipId: survivorMembership.teamMembershipId,
            role: "owner",
        }));
        expect(recovered.ok, JSON.stringify(recovered)).toBe(true);

        // With an owner restored, the Team is again invisible to the non-member.
        const afterwards = await inTx((tx) => listTeamMembersForActorInTx(tx, {
            teamId: acme.id, actorAccountId: homeAdmin.id, filter: "all",
        }));
        expect(afterwards).toEqual({ ok: false, error: "team_not_found" });
    });

    it("requires the acting credential to satisfy a restricted Team on roster reads and mutations", async () => {
        const owner = await account({ encryptionMode: "e2ee" });
        const target = await account();
        const acme = await db.team.create({
            data: {
                name: "Restricted administration",
                authenticationPolicy: {
                    v: 1,
                    mode: "restricted",
                    accepted: [{ kind: "home_method", methodId: "key_challenge" }],
                },
            },
        });
        await member(acme.id, owner.id, "owner");
        const targetMembership = await member(acme.id, target.id, "member");

        await expect(inTx((tx) => listTeamMembersForActorInTx(tx, {
            teamId: acme.id,
            actorAccountId: owner.id,
            filter: "all",
        }))).resolves.toEqual({ ok: false, error: "team_authentication_required" });
        await expect(inTx((tx) => suspendTeamMemberForActorInTx(tx, {
            teamId: acme.id,
            actorAccountId: owner.id,
            membershipId: targetMembership.teamMembershipId,
        }))).resolves.toEqual({ ok: false, error: "team_authentication_required" });

        const authentication = {
            authenticationEvidence: [{ kind: "home_method" as const, methodId: "key_challenge" }],
            authenticationAuthority: "present_user" as const,
        };
        await expect(inTx((tx) => listTeamMembersForActorInTx(tx, {
            teamId: acme.id, actorAccountId: owner.id, filter: "all", authentication,
        }))).resolves.toMatchObject({ ok: true });
        await expect(inTx((tx) => suspendTeamMemberForActorInTx(tx, {
            teamId: acme.id,
            actorAccountId: owner.id,
            membershipId: targetMembership.teamMembershipId,
            authentication,
        }))).resolves.toMatchObject({ ok: true });
        await expect(inTx((tx) => suspendTeamMemberForActorInTx(tx, {
            teamId: acme.id,
            actorAccountId: owner.id,
            membershipId: targetMembership.teamMembershipId,
        }))).resolves.toEqual({ ok: false, error: "team_authentication_required" });
        const readOnly = await account();
        await member(acme.id, readOnly.id, "member");
        await expect(inTx((tx) => suspendTeamMemberForActorInTx(tx, {
            teamId: acme.id,
            actorAccountId: readOnly.id,
            membershipId: targetMembership.teamMembershipId,
        }))).resolves.toEqual({ ok: false, error: "team_forbidden" });
    });

    it("keeps member mutations fail closed for malformed Team authentication policy", async () => {
        const owner = await account();
        const target = await account();
        const acme = await db.team.create({
            data: { name: "Malformed member policy", authenticationPolicy: { v: 99, mode: "restricted" } },
        });
        await member(acme.id, owner.id, "owner");
        const targetMembership = await member(acme.id, target.id, "member");

        await expect(inTx((tx) => suspendTeamMemberForActorInTx(tx, {
            teamId: acme.id,
            actorAccountId: owner.id,
            membershipId: targetMembership.teamMembershipId,
        }))).resolves.toEqual({ ok: false, error: "team_authentication_unavailable" });
        await expect(db.teamMembership.findUniqueOrThrow({
            where: { id: targetMembership.teamMembershipId },
        })).resolves.toMatchObject({ status: "active" });
    });

    it("refuses an admin every mutation whose target is an owner", async () => {
        const ownerAccount = await account();
        const adminAccount = await account();
        const acme = await team("Owner protection");
        const ownerMembership = await member(acme.id, ownerAccount.id, "owner");
        await member(acme.id, adminAccount.id, "admin");

        const role = await inTx((tx) => setTeamMemberRoleForActorInTx(tx, {
            teamId: acme.id,
            actorAccountId: adminAccount.id,
            membershipId: ownerMembership.teamMembershipId,
            role: "member",
        }));
        const suspend = await inTx((tx) => suspendTeamMemberForActorInTx(tx, {
            teamId: acme.id,
            actorAccountId: adminAccount.id,
            membershipId: ownerMembership.teamMembershipId,
        }));
        const remove = await inTx((tx) => removeTeamMemberForActorInTx(tx, {
            teamId: acme.id,
            actorAccountId: adminAccount.id,
            membershipId: ownerMembership.teamMembershipId,
        }));

        expect(role).toEqual({ ok: false, error: "team_forbidden" });
        expect(suspend).toEqual({ ok: false, error: "team_forbidden" });
        expect(remove).toEqual({ ok: false, error: "team_forbidden" });
    });

    it("never lets ordinary administration strand the final active owner", async () => {
        const soleOwner = await account();
        const acme = await team("Sole owner");
        const membership = await member(acme.id, soleOwner.id, "owner");

        for (const attempt of [
            () => inTx((tx) => setTeamMemberRoleForActorInTx(tx, {
                teamId: acme.id,
                actorAccountId: soleOwner.id,
                membershipId: membership.teamMembershipId,
                role: "admin",
            })),
            () => inTx((tx) => suspendTeamMemberForActorInTx(tx, {
                teamId: acme.id,
                actorAccountId: soleOwner.id,
                membershipId: membership.teamMembershipId,
            })),
            () => inTx((tx) => removeTeamMemberForActorInTx(tx, {
                teamId: acme.id,
                actorAccountId: soleOwner.id,
                membershipId: membership.teamMembershipId,
            })),
        ]) {
            expect(await attempt()).toEqual({ ok: false, error: "team_owner_transfer_required" });
        }

        // The projected capability agrees with the transaction, so the UI can
        // withdraw the control instead of offering it and then failing.
        const detail = await inTx((tx) => getTeamMemberForActorInTx(tx, {
            teamId: acme.id,
            actorAccountId: soleOwner.id,
            membershipId: membership.teamMembershipId,
        }));
        expect(detail.ok).toBe(true);
        if (!detail.ok) return;
        expect(detail.value.capabilities).toMatchObject({
            setRole: false, suspend: false, remove: false,
        });
    });

    it("permits the same demotion once a second active owner exists", async () => {
        const first = await account();
        const second = await account();
        const acme = await team("Two owners");
        const firstMembership = await member(acme.id, first.id, "owner");
        await member(acme.id, second.id, "owner");

        const demoted = await inTx((tx) => setTeamMemberRoleForActorInTx(tx, {
            teamId: acme.id,
            actorAccountId: second.id,
            membershipId: firstMembership.teamMembershipId,
            role: "member",
        }));

        expect(demoted.ok).toBe(true);
        if (!demoted.ok) return;
        expect(demoted.value.role).toBe("member");
        expect(demoted.value.id).toBe(firstMembership.teamMembershipId);
    });

    it("serializes competing owner removals so one active owner always survives", async () => {
        const firstOwner = await account();
        const secondOwner = await account();
        const acme = await team("Concurrent owner removal");
        const firstMembership = await member(acme.id, firstOwner.id, "owner");
        const secondMembership = await member(acme.id, secondOwner.id, "owner");

        const results = await Promise.all([
            inTx((tx) => removeTeamMemberForActorInTx(tx, {
                teamId: acme.id,
                actorAccountId: firstOwner.id,
                membershipId: secondMembership.teamMembershipId,
            })),
            inTx((tx) => removeTeamMemberForActorInTx(tx, {
                teamId: acme.id,
                actorAccountId: secondOwner.id,
                membershipId: firstMembership.teamMembershipId,
            })),
        ]);

        expect(results.filter((result) => result.ok)).toHaveLength(1);
        expect(results.filter((result) => !result.ok)).toHaveLength(1);
        await expect(db.teamMembership.count({
            where: {
                teamId: acme.id,
                role: "owner",
                status: "active",
                account: { status: "active" },
            },
        })).resolves.toBe(1);
    });

    it("preserves the lifetime and horizon across role change and suspension", async () => {
        const owner = await account();
        const target = await account();
        const acme = await team("Lifetime");
        await member(acme.id, owner.id, "owner");
        const membership = await member(acme.id, target.id, "member", "from_membership");
        const mintedAt = membership.sessionAccessStartsAt?.getTime();
        expect(mintedAt).toBeDefined();

        const promoted = await inTx((tx) => setTeamMemberRoleForActorInTx(tx, {
            teamId: acme.id,
            actorAccountId: owner.id,
            membershipId: membership.teamMembershipId,
            role: "admin",
        }));
        const suspended = await inTx((tx) => suspendTeamMemberForActorInTx(tx, {
            teamId: acme.id,
            actorAccountId: owner.id,
            membershipId: membership.teamMembershipId,
        }));
        const reactivated = await inTx((tx) => reactivateTeamMemberForActorInTx(tx, {
            teamId: acme.id,
            actorAccountId: owner.id,
            membershipId: membership.teamMembershipId,
        }));

        expect(promoted.ok && suspended.ok && reactivated.ok).toBe(true);
        if (!reactivated.ok || !suspended.ok) return;
        expect(suspended.value.status).toBe("suspended");
        expect(reactivated.value.status).toBe("active");
        expect(reactivated.value.role).toBe("admin");
        expect(reactivated.value.id).toBe(membership.teamMembershipId);

        const persisted = await db.teamMembership.findUniqueOrThrow({
            where: { id: membership.teamMembershipId },
        });
        expect(persisted.sessionAccessStartsAt?.getTime()).toBe(mintedAt);
    });

    it("answers a repeated suspension as the same state without a second write", async () => {
        const owner = await account();
        const target = await account();
        const acme = await team("Idempotent suspend");
        await member(acme.id, owner.id, "owner");
        const membership = await member(acme.id, target.id, "member");

        await inTx((tx) => suspendTeamMemberForActorInTx(tx, {
            teamId: acme.id, actorAccountId: owner.id, membershipId: membership.teamMembershipId,
        }));
        const again = await inTx((tx) => suspendTeamMemberForActorInTx(tx, {
            teamId: acme.id, actorAccountId: owner.id, membershipId: membership.teamMembershipId,
        }));

        expect(again.ok).toBe(true);
        if (!again.ok) return;
        expect(again.value.status).toBe("suspended");
        expect(again.value.id).toBe(membership.teamMembershipId);
    });

    it("ends the lifetime on removal and mints a new one on rejoin", async () => {
        const owner = await account();
        const target = await account();
        const acme = await team("Remove and rejoin");
        await member(acme.id, owner.id, "owner");
        const first = await member(acme.id, target.id, "member");
        const group = await db.teamGroup.create({
            data: { teamId: acme.id, name: "Developers", nameKey: "developers" },
        });
        await db.teamGroupMembership.create({
            data: {
                teamId: acme.id,
                teamGroupId: group.id,
                teamMembershipId: first.teamMembershipId,
                nativeContribution: true,
            },
        });

        const removed = await inTx((tx) => removeTeamMemberForActorInTx(tx, {
            teamId: acme.id, actorAccountId: owner.id, membershipId: first.teamMembershipId,
        }));
        expect(removed).toEqual({
            ok: true,
            value: { status: "removed", membershipId: first.teamMembershipId },
        });
        expect(await db.teamGroupMembership.count({
            where: { teamMembershipId: first.teamMembershipId },
        })).toBe(0);

        // A retried confirmation is a normal success, not a stale-id failure.
        const again = await inTx((tx) => removeTeamMemberForActorInTx(tx, {
            teamId: acme.id, actorAccountId: owner.id, membershipId: first.teamMembershipId,
        }));
        expect(again).toEqual({ ok: true, value: { status: "unchanged" } });

        const rejoined = await member(acme.id, target.id, "member");
        expect(rejoined.teamMembershipId).not.toBe(first.teamMembershipId);
        expect(await db.teamGroupMembership.count({
            where: { teamMembershipId: rejoined.teamMembershipId },
        })).toBe(0);
    });

    it("keeps a directory-owned lifecycle native read-only while role stays native", async () => {
        const owner = await account();
        const managed = await account();
        const acme = await team("Managed");
        await member(acme.id, owner.id, "owner");
        const membership = await member(acme.id, managed.id, "member");
        const source = await workosSource(acme.id, "Acme Entra ID");
        await db.teamProvisionedIdentity.create({
            data: {
                directorySourceId: source.id,
                teamId: acme.id,
                externalUserId: "ext-1",
                state: "active",
                boundAccountId: managed.id,
                teamMembershipId: membership.teamMembershipId,
                teamMembershipTeamId: acme.id,
            },
        });

        const suspend = await inTx((tx) => suspendTeamMemberForActorInTx(tx, {
            teamId: acme.id, actorAccountId: owner.id, membershipId: membership.teamMembershipId,
        }));
        const role = await inTx((tx) => setTeamMemberRoleForActorInTx(tx, {
            teamId: acme.id,
            actorAccountId: owner.id,
            membershipId: membership.teamMembershipId,
            role: "admin",
        }));

        expect(suspend).toEqual({ ok: false, error: "managed_by_directory" });
        expect(role.ok).toBe(true);
        if (!role.ok) return;
        expect(role.value.role).toBe("admin");
        expect(role.value.management).toEqual({
            kind: "directory_source",
            directorySourceId: source.id,
            label: "Acme Entra ID",
        });
        expect(role.value.capabilities).toMatchObject({ suspend: false, remove: false, setRole: true });
    });

    it("binds and unbinds directory management without moving the lifetime or horizon", async () => {
        const owner = await account();
        const target = await account();
        const acme = await team("Management transfer");
        await member(acme.id, owner.id, "owner");
        const membership = await member(acme.id, target.id, "member");
        const source = await workosSource(acme.id, "Okta");

        // No provisioned identity resolves to this Account yet, so there is
        // nothing to manage through — a conflict, not a permission problem.
        const premature = await inTx((tx) => setTeamMemberManagementForActorInTx(tx, {
            teamId: acme.id,
            actorAccountId: owner.id,
            membershipId: membership.teamMembershipId,
            management: { kind: "directory_source", directorySourceId: source.id },
        }));
        expect(premature).toEqual({ ok: false, error: "management_conflict" });

        await db.teamProvisionedIdentity.create({
            data: {
                directorySourceId: source.id,
                teamId: acme.id,
                externalUserId: "ext-2",
                state: "active",
                boundAccountId: target.id,
            },
        });

        const bound = await inTx((tx) => setTeamMemberManagementForActorInTx(tx, {
            teamId: acme.id,
            actorAccountId: owner.id,
            membershipId: membership.teamMembershipId,
            management: { kind: "directory_source", directorySourceId: source.id },
        }));
        expect(bound.ok).toBe(true);
        if (!bound.ok) return;
        expect(bound.value.management).toEqual({
            kind: "directory_source",
            directorySourceId: source.id,
            label: "Okta",
        });
        expect(bound.value.id).toBe(membership.teamMembershipId);
        expect(bound.value.historyAccess).toBe(membership.historyAccess);

        const native = await inTx((tx) => setTeamMemberManagementForActorInTx(tx, {
            teamId: acme.id,
            actorAccountId: owner.id,
            membershipId: membership.teamMembershipId,
            management: { kind: "native" },
        }));
        expect(native.ok).toBe(true);
        if (!native.ok) return;
        expect(native.value.management).toEqual({ kind: "native" });
        const persisted = await db.teamMembership.findUniqueOrThrow({
            where: { id: membership.teamMembershipId },
        });
        expect(persisted.sessionAccessStartsAt?.getTime())
            .toBe(membership.sessionAccessStartsAt?.getTime());
    });

    it("unbinds identity-connection management when returning a JIT lifetime to native management", async () => {
        const owner = await account();
        const target = await account();
        const acme = await team("JIT management transfer");
        await member(acme.id, owner.id, "owner");
        const membership = await member(acme.id, target.id, "member");
        const provider = await db.identityProviderInstance.create({
            data: {
                ownerTeamId: acme.id,
                kind: "oidc",
                displayName: "Acme OIDC",
                config: { v: 1 },
            },
        });
        const connection = await db.teamIdentityConnection.create({
            data: {
                teamId: acme.id,
                providerInstanceId: provider.id,
                externalReference: { v: 1 },
                settings: { v: 1 },
            },
        });
        await db.teamMembershipIdentityConnectionManagement.create({
            data: {
                teamMembershipId: membership.teamMembershipId,
                teamId: acme.id,
                teamIdentityConnectionId: connection.id,
            },
        });

        const native = await inTx((tx) => setTeamMemberManagementForActorInTx(tx, {
            teamId: acme.id,
            actorAccountId: owner.id,
            membershipId: membership.teamMembershipId,
            management: { kind: "native" },
        }));

        expect(native.ok).toBe(true);
        if (!native.ok) return;
        expect(native.value.management).toEqual({ kind: "native" });
        expect(native.value.capabilities).toMatchObject({ suspend: true, remove: true });
        await expect(db.teamMembershipIdentityConnectionManagement.findUnique({
            where: { teamMembershipId: membership.teamMembershipId },
        })).resolves.toBeNull();
    });

    it("does not advertise management transfer through an inoperable directory source", async () => {
        const owner = await account();
        const target = await account();
        const acme = await team("Paused management transfer");
        await member(acme.id, owner.id, "owner");
        const membership = await member(acme.id, target.id, "member");
        const source = await workosSource(acme.id, "Paused Okta");
        await db.teamProvisionedIdentity.create({
            data: {
                directorySourceId: source.id,
                teamId: acme.id,
                externalUserId: "paused-target",
                state: "active",
                boundAccountId: target.id,
            },
        });
        await db.teamDirectorySource.update({ where: { id: source.id }, data: { state: "paused" } });

        const detail = await inTx((tx) => getTeamMemberForActorInTx(tx, {
            teamId: acme.id,
            actorAccountId: owner.id,
            membershipId: membership.teamMembershipId,
        }));
        expect(detail.ok).toBe(true);
        if (!detail.ok) return;
        expect(detail.value.capabilities.setManagement).toBe(false);
    });

    it("gives a Home administrator owner recovery only, and never over itself", async () => {
        const homeAdmin = await account({ homeRole: "admin" });
        const retiredOwner = await account();
        const survivor = await account();
        const acme = await team("Owner recovery");
        const ownerMembership = await member(acme.id, retiredOwner.id, "owner");
        const survivorMembership = await member(acme.id, survivor.id, "member");
        const adminMembership = await member(acme.id, homeAdmin.id, "guest");

        // While the Team still has an active owner, Home authority confers no
        // membership power at all.
        const early = await inTx((tx) => setTeamMemberRoleForActorInTx(tx, {
            teamId: acme.id,
            actorAccountId: homeAdmin.id,
            membershipId: survivorMembership.teamMembershipId,
            role: "owner",
        }));
        expect(early).toEqual({ ok: false, error: "team_forbidden" });

        // Security offboarding of the last owner is not blocked by the routine
        // invariant, and it leaves the Team owner-required.
        await db.account.update({ where: { id: retiredOwner.id }, data: { status: "suspended" } });
        expect(ownerMembership.role).toBe("owner");

        const selfPromotion = await inTx((tx) => setTeamMemberRoleForActorInTx(tx, {
            teamId: acme.id,
            actorAccountId: homeAdmin.id,
            membershipId: adminMembership.teamMembershipId,
            role: "owner",
        }));
        expect(selfPromotion).toEqual({ ok: false, error: "team_forbidden" });

        const recovered = await inTx((tx) => setTeamMemberRoleForActorInTx(tx, {
            teamId: acme.id,
            actorAccountId: homeAdmin.id,
            membershipId: survivorMembership.teamMembershipId,
            role: "owner",
        }));
        expect(recovered.ok).toBe(true);
        if (!recovered.ok) return;
        expect(recovered.value.role).toBe("owner");
        expect(recovered.value.historyAccess).toBe(survivorMembership.historyAccess);

        // Recovery is not general membership authority: with an owner restored,
        // the Home administrator can no longer act.
        const afterwards = await inTx((tx) => suspendTeamMemberForActorInTx(tx, {
            teamId: acme.id,
            actorAccountId: homeAdmin.id,
            membershipId: survivorMembership.teamMembershipId,
        }));
        expect(afterwards).toEqual({ ok: false, error: "team_forbidden" });
    });

    it("projects self-demotion from the authority committed by the mutation", async () => {
        const firstOwner = await account();
        const secondOwner = await account();
        const acme = await team("Fresh self projection");
        const first = await member(acme.id, firstOwner.id, "owner");
        await member(acme.id, secondOwner.id, "owner");

        const demoted = await inTx((tx) => setTeamMemberRoleForActorInTx(tx, {
            teamId: acme.id,
            actorAccountId: firstOwner.id,
            membershipId: first.teamMembershipId,
            role: "member",
        }));

        expect(demoted.ok).toBe(true);
        if (!demoted.ok) return;
        expect(demoted.value.role).toBe("member");
        expect(demoted.value.capabilities).toEqual({
            setRole: false,
            suspend: false,
            reactivate: false,
            remove: false,
            setManagement: false,
        });
    });

    it("pages the roster in stable order and rejects a cursor from another filter", async () => {
        const owner = await account();
        const acme = await team("Roster");
        await member(acme.id, owner.id, "owner");
        const guests: string[] = [];
        for (let index = 0; index < 3; index += 1) {
            const guest = await account();
            guests.push((await member(acme.id, guest.id, "guest")).teamMembershipId);
        }

        const first = await inTx((tx) => listTeamMembersForActorInTx(tx, {
            teamId: acme.id, actorAccountId: owner.id, filter: "guests", limit: 2,
        }));
        expect(first.ok).toBe(true);
        if (!first.ok) return;
        expect(first.value.items.map((item) => item.id)).toEqual(guests.slice(0, 2));
        expect(first.value.nextCursor).not.toBeNull();

        const second = await inTx((tx) => listTeamMembersForActorInTx(tx, {
            teamId: acme.id,
            actorAccountId: owner.id,
            filter: "guests",
            limit: 2,
            cursor: first.value.nextCursor,
        }));
        expect(second.ok).toBe(true);
        if (!second.ok) return;
        expect(second.value.items.map((item) => item.id)).toEqual(guests.slice(2));
        expect(second.value.nextCursor).toBeNull();

        // A position minted for one filter refers to different rows under
        // another, so it is refused rather than silently restarting page one.
        const crossed = await inTx((tx) => listTeamMembersForActorInTx(tx, {
            teamId: acme.id,
            actorAccountId: owner.id,
            filter: "all",
            cursor: first.value.nextCursor,
        }));
        expect(crossed).toEqual({ ok: false, error: "invalid_team_cursor" });
    });

    it("admits a direct add through the one minting owner and refuses an archived Team", async () => {
        const owner = await account();
        const target = await account();
        const acme = await team("Direct add");
        await member(acme.id, owner.id, "owner");

        const added = await inTx((tx) => addTeamMemberForActorInTx(tx, {
            teamId: acme.id,
            actorAccountId: owner.id,
            accountId: target.id,
            role: "guest",
            historyAccess: "all_existing",
        }));
        expect(added).toMatchObject({
            ok: true,
            value: {
                v: 1,
                teamId: acme.id,
                accountId: target.id,
                role: "guest",
                historyAccess: "from_membership",
            },
        });

        const replay = await inTx((tx) => addTeamMemberForActorInTx(tx, {
            teamId: acme.id,
            actorAccountId: owner.id,
            accountId: target.id,
            role: "admin",
            historyAccess: "from_membership",
        }));
        expect(replay).toMatchObject({
            ok: true,
            value: {
                v: 1,
                teamId: acme.id,
                accountId: target.id,
                role: "guest",
                historyAccess: "from_membership",
            },
        });
        const persisted = await db.teamMembership.findUniqueOrThrow({
            where: { teamId_accountId: { teamId: acme.id, accountId: target.id } },
        });
        expect(persisted.role).toBe("guest");
        expect(persisted.sessionAccessStartsAt).not.toBeNull();

        await db.team.update({ where: { id: acme.id }, data: { archivedAt: new Date() } });
        const another = await account();
        const archived = await inTx((tx) => addTeamMemberForActorInTx(tx, {
            teamId: acme.id,
            actorAccountId: owner.id,
            accountId: another.id,
            role: "member",
            historyAccess: "from_membership",
        }));
        expect(archived).toEqual({ ok: false, error: "team_archived" });
    });
});
