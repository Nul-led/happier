import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TEAM_INVITATION_TTL_MS, deriveTeamInvitationStateV1 } from "@happier-dev/protocol/teams";
import { db } from "@/storage/db";
import { inTx } from "@/storage/inTx";
import { createLightSqliteHarness, type LightSqliteHarness } from "@/testkit/lightSqliteHarness";
import { digestTeamInvitationToken, mintTeamInvitationToken } from "./token";
import {
    consumeTeamInvitationForAcceptanceInTx,
    createTeamInvitationInTx,
    readTeamInvitationByTokenHashInTx,
    recordTeamInvitationEmailDeliveryResultInTx,
    reissueTeamInvitationInTx,
    revokeActiveTeamInvitationsForTeamInTx,
    revokeTeamInvitationInTx,
} from "./invitationLifecycle";

describe("Team invitation lifecycle (SQLite integration)", () => {
    let harness: LightSqliteHarness;
    beforeAll(async () => {
        harness = await createLightSqliteHarness({ tempDirPrefix: "happier-team-invitation-", initAuth: false });
    }, 180_000);
    afterAll(async () => { if (harness) await harness.close(); });

    async function account() {
        return db.account.create({ data: { publicKey: crypto.randomUUID(), encryptionMode: "plain" } });
    }

    async function team(name = "Acme") {
        return db.team.create({ data: { name } });
    }

    async function invite(input: Readonly<{
        teamId: string;
        createdByAccountId?: string | null;
        role?: "admin" | "member" | "guest";
        historyAccess?: "all_existing" | "from_membership";
        recipientEmailNormalized?: string | null;
        now?: Date;
    }>) {
        const token = mintTeamInvitationToken();
        const row = await inTx(async (tx) => createTeamInvitationInTx(tx, {
            teamId: input.teamId,
            role: input.role ?? "member",
            historyAccess: input.historyAccess ?? "from_membership",
            recipientEmailNormalized: input.recipientEmailNormalized ?? null,
            createdByAccountId: input.createdByAccountId ?? null,
            tokenHash: digestTeamInvitationToken(token),
            now: input.now ?? new Date(),
        }));
        return { token, row };
    }

    it("mints the ratified seven-day lifetime from the supplied transaction time and stores only the digest", async () => {
        const t = await team();
        const inviter = await account();
        const now = new Date("2026-09-06T00:00:00.000Z");
        const { token, row } = await invite({ teamId: t.id, createdByAccountId: inviter.id, now });

        expect(row.expiresAt.getTime()).toBe(now.getTime() + TEAM_INVITATION_TTL_MS);
        expect(row.acceptedAt).toBeNull();
        expect(row.revokedAt).toBeNull();
        expect(row.createdByAccountId).toBe(inviter.id);
        expect(Buffer.from(row.tokenHash).equals(digestTeamInvitationToken(token))).toBe(true);

        const persisted = await db.teamInvitation.findUniqueOrThrow({ where: { id: row.id } });
        expect(JSON.stringify(persisted)).not.toContain(token);
        expect(deriveTeamInvitationStateV1({
            acceptedAt: null,
            revokedAt: null,
            expiresAt: persisted.expiresAt.getTime(),
        }, now.getTime())).toBe("active");
    });

    it("finds an invitation only by the exact digest of its own bearer", async () => {
        const t = await team();
        const { token, row } = await invite({ teamId: t.id });
        const found = await inTx(async (tx) => readTeamInvitationByTokenHashInTx(tx, digestTeamInvitationToken(token)));
        expect(found?.id).toBe(row.id);

        const other = await inTx(async (tx) => readTeamInvitationByTokenHashInTx(
            tx,
            digestTeamInvitationToken(mintTeamInvitationToken()),
        ));
        expect(other).toBeNull();
    });

    it("revokes an active invitation once and reports every later attempt unchanged", async () => {
        const t = await team();
        const { row } = await invite({ teamId: t.id });
        const now = new Date();

        expect(await inTx(async (tx) => revokeTeamInvitationInTx(tx, {
            teamId: t.id, invitationId: row.id, now,
        }))).toBe("revoked");
        expect(await inTx(async (tx) => revokeTeamInvitationInTx(tx, {
            teamId: t.id, invitationId: row.id, now,
        }))).toBe("unchanged");

        const persisted = await db.teamInvitation.findUniqueOrThrow({ where: { id: row.id } });
        expect(persisted.revokedAt).not.toBeNull();
        expect(persisted.acceptedAt).toBeNull();
    });

    it("leaves an expired invitation terminally expired instead of rewriting or reissuing it", async () => {
        const t = await team();
        const createdAt = new Date("2026-09-06T00:00:00.000Z");
        const { row } = await invite({ teamId: t.id, now: createdAt });
        const afterExpiry = new Date(row.expiresAt.getTime());

        expect(await inTx(async (tx) => revokeTeamInvitationInTx(tx, {
            teamId: t.id,
            invitationId: row.id,
            now: afterExpiry,
        }))).toBe("unchanged");

        expect(await inTx(async (tx) => reissueTeamInvitationInTx(tx, {
            teamId: t.id,
            invitationId: row.id,
            recipientEmailNormalized: null,
            createdByAccountId: null,
            tokenHash: digestTeamInvitationToken(mintTeamInvitationToken()),
            now: afterExpiry,
        }))).toBe("unchanged");

        expect(await db.teamInvitation.count({ where: { teamId: t.id } })).toBe(1);
        expect(await db.teamInvitation.findUniqueOrThrow({ where: { id: row.id } }))
            .toMatchObject({ acceptedAt: null, revokedAt: null });
    });

    it("refuses to revoke an invitation belonging to another Team", async () => {
        const owning = await team("Acme");
        const other = await team("Globex");
        const { row } = await invite({ teamId: owning.id });
        expect(await inTx(async (tx) => revokeTeamInvitationInTx(tx, {
            teamId: other.id, invitationId: row.id, now: new Date(),
        }))).toBe("unchanged");
        const persisted = await db.teamInvitation.findUniqueOrThrow({ where: { id: row.id } });
        expect(persisted.revokedAt).toBeNull();
    });

    it("lets exactly one concurrent acceptance consume one invitation", async () => {
        const t = await team();
        const first = await account();
        const second = await account();
        const { row } = await invite({ teamId: t.id });
        const now = new Date();

        const results = await Promise.all([
            inTx(async (tx) => consumeTeamInvitationForAcceptanceInTx(tx, {
                invitationId: row.id, acceptedByAccountId: first.id, now,
            })),
            inTx(async (tx) => consumeTeamInvitationForAcceptanceInTx(tx, {
                invitationId: row.id, acceptedByAccountId: second.id, now,
            })),
        ]);

        expect(results.filter(Boolean)).toHaveLength(1);
        const persisted = await db.teamInvitation.findUniqueOrThrow({ where: { id: row.id } });
        expect(persisted.acceptedAt).not.toBeNull();
        expect([first.id, second.id]).toContain(persisted.acceptedByAccountId);
    });

    it("lets exactly one terminal transition win an acceptance-versus-revocation race", async () => {
        const t = await team();
        const joiner = await account();
        const { row } = await invite({ teamId: t.id });
        const now = new Date();

        const [accepted, revoked] = await Promise.all([
            inTx(async (tx) => consumeTeamInvitationForAcceptanceInTx(tx, {
                invitationId: row.id, acceptedByAccountId: joiner.id, now,
            })),
            inTx(async (tx) => revokeTeamInvitationInTx(tx, { teamId: t.id, invitationId: row.id, now })),
        ]);

        expect(accepted && revoked === "revoked").toBe(false);
        const persisted = await db.teamInvitation.findUniqueOrThrow({ where: { id: row.id } });
        expect(persisted.acceptedAt === null || persisted.revokedAt === null).toBe(true);
    });

    it("refuses to consume a revoked, already accepted, or expired invitation", async () => {
        const t = await team();
        const joiner = await account();
        const now = new Date();

        const revoked = await invite({ teamId: t.id });
        await inTx(async (tx) => revokeTeamInvitationInTx(tx, { teamId: t.id, invitationId: revoked.row.id, now }));
        expect(await inTx(async (tx) => consumeTeamInvitationForAcceptanceInTx(tx, {
            invitationId: revoked.row.id, acceptedByAccountId: joiner.id, now,
        }))).toBe(false);

        const used = await invite({ teamId: t.id });
        expect(await inTx(async (tx) => consumeTeamInvitationForAcceptanceInTx(tx, {
            invitationId: used.row.id, acceptedByAccountId: joiner.id, now,
        }))).toBe(true);
        expect(await inTx(async (tx) => consumeTeamInvitationForAcceptanceInTx(tx, {
            invitationId: used.row.id, acceptedByAccountId: joiner.id, now,
        }))).toBe(false);

        const stale = await invite({ teamId: t.id, now: new Date(now.getTime() - TEAM_INVITATION_TTL_MS - 1_000) });
        expect(await inTx(async (tx) => consumeTeamInvitationForAcceptanceInTx(tx, {
            invitationId: stale.row.id, acceptedByAccountId: joiner.id, now,
        }))).toBe(false);
    });

    it("treats the exact expiry instant as expired at the deciding write", async () => {
        const t = await team();
        const joiner = await account();
        const createdAt = new Date("2026-09-06T00:00:00.000Z");
        const { row } = await invite({ teamId: t.id, now: createdAt });
        expect(await inTx(async (tx) => consumeTeamInvitationForAcceptanceInTx(tx, {
            invitationId: row.id, acceptedByAccountId: joiner.id, now: row.expiresAt,
        }))).toBe(false);
        expect(await inTx(async (tx) => consumeTeamInvitationForAcceptanceInTx(tx, {
            invitationId: row.id,
            acceptedByAccountId: joiner.id,
            now: new Date(row.expiresAt.getTime() - 1),
        }))).toBe(true);
    });

    it("revokes exactly the archived Team's outstanding invitations and no terminal or foreign row", async () => {
        const archived = await team("Acme");
        const untouched = await team("Globex");
        const joiner = await account();
        const now = new Date();

        const activeA = await invite({ teamId: archived.id });
        const activeB = await invite({ teamId: archived.id });
        const acceptedRow = await invite({ teamId: archived.id });
        await inTx(async (tx) => consumeTeamInvitationForAcceptanceInTx(tx, {
            invitationId: acceptedRow.row.id, acceptedByAccountId: joiner.id, now,
        }));
        const expired = await invite({
            teamId: archived.id,
            now: new Date(now.getTime() - TEAM_INVITATION_TTL_MS),
        });
        const foreign = await invite({ teamId: untouched.id });

        const count = await inTx(async (tx) => revokeActiveTeamInvitationsForTeamInTx(tx, { teamId: archived.id, now }));
        expect(count).toBe(2);

        for (const id of [activeA.row.id, activeB.row.id]) {
            expect((await db.teamInvitation.findUniqueOrThrow({ where: { id } })).revokedAt).not.toBeNull();
        }
        const accepted = await db.teamInvitation.findUniqueOrThrow({ where: { id: acceptedRow.row.id } });
        expect(accepted.revokedAt).toBeNull();
        expect(accepted.acceptedAt).not.toBeNull();
        expect((await db.teamInvitation.findUniqueOrThrow({ where: { id: expired.row.id } })).revokedAt)
            .toBeNull();
        expect((await db.teamInvitation.findUniqueOrThrow({ where: { id: foreign.row.id } })).revokedAt).toBeNull();

        // Restoring the Team must not resurrect them: a second sweep finds nothing active.
        expect(await inTx(async (tx) => revokeActiveTeamInvitationsForTeamInTx(tx, {
            teamId: archived.id, now,
        }))).toBe(0);
    });

    it("reissues by invalidating the old bearer and copying the intent into a fresh invitation", async () => {
        const t = await team();
        const inviter = await account();
        const joiner = await account();
        const now = new Date("2026-09-06T00:00:00.000Z");
        const original = await invite({
            teamId: t.id,
            createdByAccountId: inviter.id,
            role: "guest",
            historyAccess: "all_existing",
            recipientEmailNormalized: "person@example.test",
            now,
        });
        await db.teamInvitation.update({
            where: { id: original.row.id }, data: { historyAccess: "all_existing" },
        });

        const replacementToken = mintTeamInvitationToken();
        const reissuedAt = new Date(now.getTime() + 60_000);
        const result = await inTx(async (tx) => reissueTeamInvitationInTx(tx, {
            teamId: t.id,
            invitationId: original.row.id,
            recipientEmailNormalized: "person@example.test",
            createdByAccountId: inviter.id,
            tokenHash: digestTeamInvitationToken(replacementToken),
            now: reissuedAt,
        }));

        expect(result).not.toBe("unchanged");
        if (result === "unchanged") return;
        expect(result.replacement.role).toBe("guest");
        expect(result.replacement.historyAccess).toBe("from_membership");
        expect(result.replacement.recipientEmailNormalized).toBe("person@example.test");
        expect(result.replacement.expiresAt.getTime()).toBe(reissuedAt.getTime() + TEAM_INVITATION_TTL_MS);

        // The old bearer is terminal and cannot be consumed; the replacement can.
        expect(await inTx(async (tx) => consumeTeamInvitationForAcceptanceInTx(tx, {
            invitationId: original.row.id, acceptedByAccountId: joiner.id, now: reissuedAt,
        }))).toBe(false);
        expect(await inTx(async (tx) => consumeTeamInvitationForAcceptanceInTx(tx, {
            invitationId: result.replacement.id, acceptedByAccountId: joiner.id, now: reissuedAt,
        }))).toBe(true);

        // The old terminal record is retained for governance provenance.
        expect((await db.teamInvitation.findUniqueOrThrow({ where: { id: original.row.id } })).revokedAt).not.toBeNull();
    });

    it("reports reissue of an already terminal invitation as unchanged without minting a replacement", async () => {
        const t = await team();
        const { row } = await invite({ teamId: t.id });
        const now = new Date();
        await inTx(async (tx) => revokeTeamInvitationInTx(tx, { teamId: t.id, invitationId: row.id, now }));

        const before = await db.teamInvitation.count({ where: { teamId: t.id } });
        expect(await inTx(async (tx) => reissueTeamInvitationInTx(tx, {
            teamId: t.id,
            invitationId: row.id,
            recipientEmailNormalized: null,
            createdByAccountId: null,
            tokenHash: digestTeamInvitationToken(mintTeamInvitationToken()),
            now,
        }))).toBe("unchanged");
        expect(await db.teamInvitation.count({ where: { teamId: t.id } })).toBe(before);
    });

    it("lets a late delivery result update only its own invitation, never a reissued replacement", async () => {
        const t = await team();
        const manager = await account();
        await db.teamMembership.create({
            data: { teamId: t.id, accountId: manager.id, role: "owner" },
        });
        const now = new Date("2026-09-06T00:00:00.000Z");
        const original = await invite({ teamId: t.id, recipientEmailNormalized: "person@example.test", now });
        const result = await inTx(async (tx) => reissueTeamInvitationInTx(tx, {
            teamId: t.id,
            invitationId: original.row.id,
            recipientEmailNormalized: "person@example.test",
            createdByAccountId: null,
            tokenHash: digestTeamInvitationToken(mintTeamInvitationToken()),
            now,
        }));
        if (result === "unchanged") throw new Error("expected a replacement invitation");

        const attemptedAt = new Date(now.getTime() + 5_000);
        const seqBefore = (await db.account.findUniqueOrThrow({
            where: { id: manager.id }, select: { seq: true },
        })).seq;
        await inTx(async (tx) => recordTeamInvitationEmailDeliveryResultInTx(tx, {
            invitationId: original.row.id, status: "sent", attemptedAt,
        }));
        expect((await db.account.findUniqueOrThrow({
            where: { id: manager.id }, select: { seq: true },
        })).seq).toBe(seqBefore + 1);

        const late = await db.teamInvitation.findUniqueOrThrow({ where: { id: original.row.id } });
        expect(late.lastEmailDeliveryStatus).toBe("sent");
        expect(late.lastEmailDeliveryAttemptAt?.getTime()).toBe(attemptedAt.getTime());

        const replacement = await db.teamInvitation.findUniqueOrThrow({ where: { id: result.replacement.id } });
        expect(replacement.lastEmailDeliveryStatus).toBeNull();
        expect(replacement.lastEmailDeliveryAttemptAt).toBeNull();
    });
});
