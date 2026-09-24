import {
    formatSharedSavedSecretRefV1,
    promotePersonalSavedSecretReference,
    sealEncryptedDataKeyEnvelopeV1,
    sealSavedSecretResourceStoredContentV1,
    signAccountContentKeyBindingV1,
    verifyAccountContentKeyBindingV1,
} from "@happier-dev/protocol";
import tweetnacl from "tweetnacl";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { db } from "@/storage/db";
import { inTx } from "@/storage/inTx";
import { createLightSqliteHarness, type LightSqliteHarness } from "@/testkit/lightSqliteHarness";
import { openPlainAccountSettingsDbValue } from "@/app/encryption/accountSettingsStorage";

import {
    SavedSecretResourceTransactionAbort,
    createSavedSecretResourceInTx,
    deleteSavedSecretResourceInTx,
    listSavedSecretResourceMaterialsForAccountInTx,
    listSavedSecretResourcesForAccountInTx,
    promoteSavedSecretResourceInTx,
    repairSavedSecretResourceKeyEnvelopesInTx,
    setSavedSecretResourceGrantsInTx,
    updateSavedSecretResourceInTx,
} from "./savedSecretResourceService";
import { hashPasswordMaterial } from "@/app/auth/password/passwordMaterialVerifier";

const ACCEPTED_EMAIL_PASSWORD = { kind: "home_method" as const, methodId: "email_password" };
const EMAIL_PASSWORD_EVIDENCE = [ACCEPTED_EMAIL_PASSWORD];
const HOME_OFFERS_EMAIL_PASSWORD = {
    HAPPIER_FEATURE_AUTH_EMAIL_PASSWORD__ENABLED: "1",
    HAPPIER_FEATURE_E2EE__KEYLESS_ACCOUNTS_ENABLED: "1",
    HAPPIER_FEATURE_ENCRYPTION__STORAGE_POLICY: "optional",
};

function createE2eeAccountMaterial() {
    const signing = tweetnacl.sign.keyPair();
    const content = tweetnacl.box.keyPair();
    const contentPublicKeySig = signAccountContentKeyBindingV1({
        accountSigningSecretKey: signing.secretKey,
        contentPublicKey: content.publicKey,
    });
    const verified = verifyAccountContentKeyBindingV1({
        accountSigningPublicKey: signing.publicKey,
        contentPublicKey: content.publicKey,
        signature: contentPublicKeySig,
    });
    if (!verified) throw new Error("test binding must verify");
    return {
        account: {
            encryptionMode: "e2ee" as const,
            publicKey: Buffer.from(signing.publicKey).toString("hex"),
            contentPublicKey: Buffer.from(content.publicKey),
            contentPublicKeySig: Buffer.from(contentPublicKeySig),
        },
        contentPublicKey: content.publicKey,
        fingerprint: verified.contentPublicKeyFingerprint,
    };
}

function sealTestDataKey(recipientPublicKey: Uint8Array): Uint8Array {
    return sealEncryptedDataKeyEnvelopeV1({
        dataKey: new Uint8Array(32).fill(7),
        recipientPublicKey,
        randomBytes: (length) => new Uint8Array(length).fill(9),
    });
}

function sealTestResource(resourceId: string, name = "Shared token") {
    return sealSavedSecretResourceStoredContentV1({
        resourceId,
        mode: "e2ee",
        resourceDataKey: new Uint8Array(32).fill(7),
        content: { v: 1, name, kind: "token", value: "secret-value" },
        randomBytes: (length) => new Uint8Array(length).fill(8),
    });
}

describe("Saved Secret resource service (SQLite integration)", () => {
    let harness: LightSqliteHarness;

    beforeAll(async () => {
        harness = await createLightSqliteHarness({
            tempDirPrefix: "happier-saved-secret-resource-",
            initAuth: false,
            initEncrypt: true,
        });
    }, 120_000);

    afterAll(async () => {
        await harness.close();
    });

    beforeEach(() => {
        harness.resetEnv();
    });

    afterEach(async () => {
        harness.resetEnv();
        await harness.resetDbTables([
            () => db.accountChange.deleteMany(),
            () => db.savedSecretResourceKeyEnvelope.deleteMany(),
            () => db.savedSecretGroupGrant.deleteMany(),
            () => db.savedSecretTeamGrant.deleteMany(),
            () => db.savedSecretAccountGrant.deleteMany(),
            () => db.savedSecretResource.deleteMany(),
            () => db.accountSettingsSnapshot.deleteMany(),
            () => db.teamGroupMembership.deleteMany(),
            () => db.teamGroup.deleteMany(),
            () => db.teamMembership.deleteMany(),
            () => db.team.deleteMany(),
            () => db.accountPasswordCredential.deleteMany(),
            () => db.accountIdentity.deleteMany(),
            () => db.userRelationship.deleteMany(),
            () => db.account.deleteMany(),
        ]);
    });

    it("rolls back the resource, grants, and invalidation when the Settings CAS conflicts", async () => {
        const owner = await db.account.create({
            data: {
                encryptionMode: "plain",
                settings: JSON.stringify({ t: "plain", v: { secrets: [] } }),
                settingsVersion: 3,
            },
            select: { id: true },
        });
        const recipient = await db.account.create({
            data: { encryptionMode: "plain" },
            select: { id: true },
        });
        await db.userRelationship.create({
            data: { fromUserId: owner.id, toUserId: recipient.id, status: "friend" },
        });

        let abort: unknown = null;
        try {
            await inTx((tx) => promoteSavedSecretResourceInTx(tx, {
                accountId: owner.id,
                resourceId: "resource_atomic_conflict",
                displayName: "Shared token",
                kind: "token",
                encryptionMode: "plain",
                storedContent: {
                    t: "plain",
                    v: { v: 1, name: "Shared token", kind: "token", value: "never-committed" },
                },
                accountGrants: [recipient.id],
                expectedSettingsVersion: 1,
                nextSettings: { t: "plain", v: { secrets: [] } },
            }));
        } catch (error) {
            abort = error;
        }

        expect(abort).toBeInstanceOf(SavedSecretResourceTransactionAbort);
        expect(abort).toMatchObject({ error: "settings_conflict" });
        await expect(db.savedSecretResource.findUnique({
            where: { id: "resource_atomic_conflict" },
        })).resolves.toBeNull();
        await expect(db.savedSecretAccountGrant.count()).resolves.toBe(0);
        await expect(db.accountChange.count({
            where: { entityId: "resource_atomic_conflict" },
        })).resolves.toBe(0);
    });

    it("returns the committed promotion on a lost-response retry without duplicating the mutable source", async () => {
        const resourceId = "resource_lost_response_retry";
        const personalSecretId = "personal_before_lost_response";
        const settings = {
            secrets: [{
                id: personalSecretId,
                name: "Shared token",
                kind: "token" as const,
                encryptedValue: { _isSecretValue: true as const, value: "promoted-value" },
                createdAt: 1,
                updatedAt: 7,
            }],
            secretBindingsByProfileId: {
                default: { API_TOKEN: personalSecretId },
            },
        };
        const nextSettings = promotePersonalSavedSecretReference(settings, {
            secretId: personalSecretId,
            expectedUpdatedAt: 7,
            sharedSecretRef: formatSharedSavedSecretRefV1(resourceId),
        }).settings;
        const owner = await db.account.create({
            data: {
                encryptionMode: "plain",
                settingsVersion: 1,
                settings: JSON.stringify({ t: "plain", v: settings }),
            },
            select: { id: true },
        });
        const recipient = await db.account.create({
            data: { encryptionMode: "plain" },
            select: { id: true },
        });
        await db.userRelationship.create({
            data: { fromUserId: owner.id, toUserId: recipient.id, status: "friend" },
        });
        const input = {
            accountId: owner.id,
            resourceId,
            displayName: "Shared token",
            kind: "token" as const,
            encryptionMode: "plain" as const,
            storedContent: {
                t: "plain" as const,
                v: { v: 1 as const, name: "Shared token", kind: "token" as const, value: "promoted-value" },
            },
            expectedSettingsVersion: 1,
            nextSettings: { t: "plain" as const, v: nextSettings },
        };

        await expect(inTx((tx) => promoteSavedSecretResourceInTx(tx, input))).resolves.toEqual({
            ok: true,
            value: { resourceId, settingsVersion: 2 },
        });
        // Simulate a client retry after the first committed response was lost.
        await expect(inTx((tx) => promoteSavedSecretResourceInTx(tx, input))).resolves.toEqual({
            ok: true,
            value: { resourceId, settingsVersion: 2 },
        });
        await expect(inTx((tx) => promoteSavedSecretResourceInTx(tx, {
            ...input,
            accountGrants: [recipient.id],
        }))).resolves.toEqual({ ok: false, error: "resource_changed" });

        await expect(db.savedSecretResource.count({ where: { id: resourceId } })).resolves.toBe(1);
        await expect(db.accountSettingsSnapshot.count({ where: { accountId: owner.id } })).resolves.toBe(2);
        const account = await db.account.findUniqueOrThrow({
            where: { id: owner.id },
            select: { settingsVersion: true, settings: true },
        });
        expect(account.settingsVersion).toBe(2);
        const currentContent = openPlainAccountSettingsDbValue({
            accountId: owner.id,
            dbValue: account.settings,
        });
        expect(currentContent).toEqual(input.nextSettings);
        expect(JSON.stringify(currentContent)).not.toContain(personalSecretId);
        expect(JSON.stringify(currentContent)).toContain(formatSharedSavedSecretRefV1(resourceId));
    });

    it("server-seals a Plain resource at rest while returning its explicit Plain envelope to its owner", async () => {
        const owner = await db.account.create({
            data: { encryptionMode: "plain" },
            select: { id: true },
        });

        const created = await inTx((tx) => createSavedSecretResourceInTx(tx, {
            accountId: owner.id,
            resourceId: "resource_plain_sealed",
            displayName: "Shared token",
            kind: "token",
            encryptionMode: "plain",
            storedContent: {
                t: "plain",
                v: { v: 1, name: "Shared token", kind: "token", value: "must-not-be-readable-at-rest" },
            },
        }));
        expect(created.ok).toBe(true);

        const stored = await db.savedSecretResource.findUniqueOrThrow({
            where: { id: "resource_plain_sealed" },
            select: { storedContent: true },
        });
        expect(stored.storedContent).not.toContain("must-not-be-readable-at-rest");
        expect(JSON.parse(stored.storedContent)).toMatchObject({
            v: 1,
            storage: "server_sealed_json_v1",
        });

        const materials = await inTx((tx) => listSavedSecretResourceMaterialsForAccountInTx(tx, owner.id));
        expect(materials).toHaveLength(1);
        expect(materials[0] && "resourceId" in materials[0]).toBe(true);
        if (!materials[0] || !("resourceId" in materials[0])) throw new Error("Expected healthy material projection");
        expect(materials[0]?.storedContent).toEqual({
            t: "plain",
            v: { v: 1, name: "Shared token", kind: "token", value: "must-not-be-readable-at-rest" },
        });
    });

    it("rejects a non-canonical resource id before writing any row", async () => {
        const owner = await db.account.create({ data: { encryptionMode: "plain" }, select: { id: true } });
        const result = await inTx((tx) => createSavedSecretResourceInTx(tx, {
            accountId: owner.id,
            resourceId: " resource_with_space",
            displayName: "Shared token",
            kind: "token",
            encryptionMode: "plain",
            storedContent: {
                t: "plain",
                v: { v: 1, name: "Shared token", kind: "token", value: "value" },
            },
        }));
        expect(result).toEqual({ ok: false, error: "invalid_resource" });
        await expect(db.savedSecretResource.count()).resolves.toBe(0);
    });

    it("rejects an unrelated Account instead of treating an existing ID as grant eligibility", async () => {
        const owner = await db.account.create({ data: { encryptionMode: "plain" }, select: { id: true } });
        const unrelated = await db.account.create({ data: { encryptionMode: "plain" }, select: { id: true } });

        const result = await inTx((tx) => createSavedSecretResourceInTx(tx, {
            accountId: owner.id,
            resourceId: "resource_unrelated_account",
            displayName: "Shared token",
            kind: "token",
            encryptionMode: "plain",
            storedContent: {
                t: "plain",
                v: { v: 1, name: "Shared token", kind: "token", value: "value" },
            },
            accountGrants: [unrelated.id],
        }));

        expect(result).toEqual({ ok: false, error: "forbidden" });
        await expect(db.savedSecretResource.count()).resolves.toBe(0);
    });

    it("persists all 257 eligible Account grants without truncation", async () => {
        const owner = await db.account.create({ data: { encryptionMode: "plain" }, select: { id: true } });
        const recipientIds = Array.from({ length: 257 }, (_, index) => `saved-secret-recipient-${index}`);
        await db.account.createMany({
            data: recipientIds.map((id) => ({ id, encryptionMode: "plain" })),
        });
        await db.userRelationship.createMany({
            data: recipientIds.map((toUserId) => ({ fromUserId: owner.id, toUserId, status: "friend" })),
        });

        const result = await inTx((tx) => createSavedSecretResourceInTx(tx, {
            accountId: owner.id,
            resourceId: "resource_complete_257_account_grants",
            displayName: "Complete audience",
            kind: "token",
            encryptionMode: "plain",
            storedContent: {
                t: "plain",
                v: { v: 1, name: "Complete audience", kind: "token", value: "secret" },
            },
            accountGrants: recipientIds,
        }));

        expect(result).toMatchObject({ ok: true });
        await expect(db.savedSecretAccountGrant.count({
            where: { resourceId: "resource_complete_257_account_grants" },
        })).resolves.toBe(257);
        await expect(db.savedSecretAccountGrant.findMany({
            where: { resourceId: "resource_complete_257_account_grants" },
            select: { accountId: true },
        })).resolves.toEqual(expect.arrayContaining(recipientIds.map((accountId) => ({ accountId }))));
    });

    it("rejects an unrelated Team and Group instead of treating membership enumeration as authority", async () => {
        const owner = await db.account.create({ data: { encryptionMode: "plain" }, select: { id: true } });
        const unrelated = await db.account.create({ data: { encryptionMode: "plain" }, select: { id: true } });
        const team = await db.team.create({ data: { name: "Unrelated team" }, select: { id: true } });
        await db.teamMembership.create({
            data: { teamId: team.id, accountId: unrelated.id, role: "owner" },
        });
        const group = await db.teamGroup.create({
            data: { teamId: team.id, name: "Unrelated group", nameKey: "unrelated-group" },
            select: { id: true },
        });

        for (const audience of [{ teamGrants: [team.id] }, { groupGrants: [group.id] }]) {
            const result = await inTx((tx) => createSavedSecretResourceInTx(tx, {
                accountId: owner.id,
                resourceId: audience.teamGrants ? "resource_unrelated_team" : "resource_unrelated_group",
                displayName: "Shared token",
                kind: "token",
                encryptionMode: "plain",
                storedContent: {
                    t: "plain",
                    v: { v: 1, name: "Shared token", kind: "token", value: "value" },
                },
                ...audience,
            }));
            expect(result).toEqual({ ok: false, error: "forbidden" });
        }
        await expect(db.savedSecretResource.count()).resolves.toBe(0);
    });

    it("allows active members but denies Guests from sharing their secret with a Team or its Group", async () => {
        const member = await db.account.create({ data: { encryptionMode: "plain" }, select: { id: true } });
        const guest = await db.account.create({ data: { encryptionMode: "plain" }, select: { id: true } });
        const team = await db.team.create({ data: { name: "Credential audience" }, select: { id: true } });
        await db.teamMembership.createMany({
            data: [
                { teamId: team.id, accountId: member.id, role: "member" },
                { teamId: team.id, accountId: guest.id, role: "guest" },
            ],
        });
        const group = await db.teamGroup.create({
            data: { teamId: team.id, name: "Credential group", nameKey: "credential-group" },
            select: { id: true },
        });

        for (const audience of [{ teamGrants: [team.id] }, { groupGrants: [group.id] }]) {
            const guestResult = await inTx((tx) => createSavedSecretResourceInTx(tx, {
                accountId: guest.id,
                resourceId: audience.teamGrants ? "resource_guest_team" : "resource_guest_group",
                displayName: "Shared token",
                kind: "token",
                encryptionMode: "plain",
                storedContent: {
                    t: "plain",
                    v: { v: 1, name: "Shared token", kind: "token", value: "value" },
                },
                ...audience,
            }));
            expect(guestResult).toEqual({ ok: false, error: "forbidden" });

            const memberResult = await inTx((tx) => createSavedSecretResourceInTx(tx, {
                accountId: member.id,
                resourceId: audience.teamGrants ? "resource_member_team" : "resource_member_group",
                displayName: "Shared token",
                kind: "token",
                encryptionMode: "plain",
                storedContent: {
                    t: "plain",
                    v: { v: 1, name: "Shared token", kind: "token", value: "value" },
                },
                ...audience,
            }));
            expect(memberResult).toMatchObject({ ok: true });
        }

        await db.teamMembership.update({
            where: { teamId_accountId: { teamId: team.id, accountId: member.id } },
            data: { status: "suspended" },
        });
        const revokedResult = await inTx((tx) => createSavedSecretResourceInTx(tx, {
            accountId: member.id,
            resourceId: "resource_revoked_member_team",
            displayName: "Shared token",
            kind: "token",
            encryptionMode: "plain",
            storedContent: {
                t: "plain",
                v: { v: 1, name: "Shared token", kind: "token", value: "value" },
            },
            teamGrants: [team.id],
        }));
        expect(revokedResult).toEqual({ ok: false, error: "forbidden" });
    });

    it("withholds a restricted Team's shared secret from a member whose credential does not qualify", async () => {
        const custodian = await db.account.create({ data: { encryptionMode: "plain" }, select: { id: true } });
        const member = await db.account.create({ data: { encryptionMode: "plain" }, select: { id: true } });
        const team = await db.team.create({
            data: {
                name: "Restricted audience",
                authenticationPolicy: { v: 1, mode: "restricted", accepted: [ACCEPTED_EMAIL_PASSWORD] },
            },
            select: { id: true },
        });
        await db.teamMembership.createMany({
            data: [
                { teamId: team.id, accountId: custodian.id, role: "owner" },
                { teamId: team.id, accountId: member.id, role: "member" },
            ],
        });
        await db.accountIdentity.create({
            data: { accountId: custodian.id, provider: "email", providerUserId: "owner@example.test", profile: {} },
        });
        await db.accountPasswordCredential.create({
            data: {
                accountId: custodian.id,
                credential: {
                    v: 1,
                    kind: "plain_password_hash",
                    hash: await hashPasswordMaterial(new TextEncoder().encode("owner password factor")),
                },
            },
        });
        await db.accountIdentity.create({
            data: { accountId: member.id, provider: "email", providerUserId: "member@example.test", profile: {} },
        });
        await db.accountPasswordCredential.create({
            data: {
                accountId: member.id,
                credential: {
                    v: 1,
                    kind: "plain_password_hash",
                    hash: await hashPasswordMaterial(new TextEncoder().encode("member password factor")),
                },
            },
        });

        const qualified = {
            env: { ...process.env, ...HOME_OFFERS_EMAIL_PASSWORD },
            authenticationAuthority: "present_user" as const,
            authenticationEvidence: EMAIL_PASSWORD_EVIDENCE,
        };
        const unqualified = {
            env: { ...process.env, ...HOME_OFFERS_EMAIL_PASSWORD },
            authenticationAuthority: "present_user" as const,
            authenticationEvidence: undefined,
        };

        expect(await inTx((tx) => createSavedSecretResourceInTx(tx, {
            accountId: custodian.id,
            authentication: qualified,
            resourceId: "resource_restricted_team",
            displayName: "Team token",
            kind: "token",
            encryptionMode: "plain",
            storedContent: { t: "plain", v: { v: 1, name: "Team token", kind: "token", value: "team-value" } },
            teamGrants: [team.id],
        }))).toMatchObject({ ok: true });
        expect(await inTx((tx) => createSavedSecretResourceInTx(tx, {
            accountId: custodian.id,
            authentication: qualified,
            resourceId: "resource_direct_grant",
            displayName: "Direct token",
            kind: "token",
            encryptionMode: "plain",
            storedContent: { t: "plain", v: { v: 1, name: "Direct token", kind: "token", value: "direct-value" } },
            accountGrants: [member.id],
        }))).toMatchObject({ ok: true });

        // The member is structurally an active non-guest member of the Team, but
        // presents no evidence of the accepted method.
        const withoutEvidence = await inTx((tx) => listSavedSecretResourcesForAccountInTx(tx, member.id, unqualified));
        expect(withoutEvidence.map((entry) => (entry.materialStatus === "resource_corrupt" ? null : entry.ref))).toEqual([formatSharedSavedSecretRefV1("resource_direct_grant")]);
        const materialsWithoutEvidence = await inTx((tx) =>
            listSavedSecretResourceMaterialsForAccountInTx(tx, member.id, unqualified));
        expect(materialsWithoutEvidence.map((row) => (row.entry.materialStatus === "resource_corrupt" ? null : row.entry.ref))).toEqual([formatSharedSavedSecretRefV1("resource_direct_grant")]);

        const withEvidence = await inTx((tx) => listSavedSecretResourcesForAccountInTx(tx, member.id, qualified));
        expect([...withEvidence.map((entry) => (entry.materialStatus === "resource_corrupt" ? null : entry.ref))].sort())
            .toEqual([
                formatSharedSavedSecretRefV1("resource_direct_grant"),
                formatSharedSavedSecretRefV1("resource_restricted_team"),
            ].sort());

        // The custodian's own resources never depend on the Team credential.
        const ownerView = await inTx((tx) => listSavedSecretResourcesForAccountInTx(tx, custodian.id, unqualified));
        expect([...ownerView.map((entry) => (entry.materialStatus === "resource_corrupt" ? null : entry.ref))].sort())
            .toEqual([
                formatSharedSavedSecretRefV1("resource_direct_grant"),
                formatSharedSavedSecretRefV1("resource_restricted_team"),
            ].sort());

        // A Team audience cannot be written with an unqualified credential either.
        expect(await inTx((tx) => createSavedSecretResourceInTx(tx, {
            accountId: member.id,
            authentication: unqualified,
            resourceId: "resource_member_unqualified_team",
            displayName: "Member token",
            kind: "token",
            encryptionMode: "plain",
            storedContent: { t: "plain", v: { v: 1, name: "Member token", kind: "token", value: "member-value" } },
            teamGrants: [team.id],
        }))).toEqual({ ok: false, error: "forbidden" });
    });

    it("names only the restricted arms the caller's credential actually qualified in recipient provenance", async () => {
        const custodian = await db.account.create({ data: { encryptionMode: "plain" }, select: { id: true } });
        const member = await db.account.create({ data: { encryptionMode: "plain" }, select: { id: true } });
        const team = await db.team.create({
            data: {
                name: "Provenance restricted",
                authenticationPolicy: { v: 1, mode: "restricted", accepted: [ACCEPTED_EMAIL_PASSWORD] },
            },
            select: { id: true },
        });
        const custodianMembership = await db.teamMembership.create({
            data: { teamId: team.id, accountId: custodian.id, role: "owner" },
            select: { id: true },
        });
        const memberMembership = await db.teamMembership.create({
            data: { teamId: team.id, accountId: member.id, role: "member" },
            select: { id: true },
        });
        const group = await db.teamGroup.create({
            data: { teamId: team.id, name: "Provenance group", nameKey: "provenance-group" },
            select: { id: true },
        });
        await db.teamGroupMembership.createMany({
            data: [
                { teamId: team.id, teamGroupId: group.id, teamMembershipId: custodianMembership.id },
                { teamId: team.id, teamGroupId: group.id, teamMembershipId: memberMembership.id },
            ],
        });
        for (const [accountId, address, factor] of [
            [custodian.id, "provenance-owner@example.test", "owner password factor"],
            [member.id, "provenance-member@example.test", "member password factor"],
        ] as const) {
            await db.accountIdentity.create({
                data: { accountId, provider: "email", providerUserId: address, profile: {} },
            });
            await db.accountPasswordCredential.create({
                data: {
                    accountId,
                    credential: {
                        v: 1,
                        kind: "plain_password_hash",
                        hash: await hashPasswordMaterial(new TextEncoder().encode(factor)),
                    },
                },
            });
        }

        const qualified = {
            env: { ...process.env, ...HOME_OFFERS_EMAIL_PASSWORD },
            authenticationAuthority: "present_user" as const,
            authenticationEvidence: EMAIL_PASSWORD_EVIDENCE,
        };
        const unqualified = { ...qualified, authenticationEvidence: undefined };

        expect(await inTx((tx) => createSavedSecretResourceInTx(tx, {
            accountId: custodian.id,
            authentication: qualified,
            resourceId: "resource_multi_arm",
            displayName: "Multi-arm token",
            kind: "token",
            encryptionMode: "plain",
            storedContent: { t: "plain", v: { v: 1, name: "Multi-arm token", kind: "token", value: "multi-value" } },
            accountGrants: [member.id],
            teamGrants: [team.id],
            groupGrants: [group.id],
        }))).toMatchObject({ ok: true });

        // The direct grant keeps the material authorized, so the row is still
        // listed. The Team and Group arms are exactly what the current
        // credential failed to qualify, so naming them would disclose a
        // restricted Team's identity and this resource's relationship to it.
        const [withoutEvidence] = await inTx((tx) => listSavedSecretResourcesForAccountInTx(tx, member.id, unqualified));
        if (!withoutEvidence || withoutEvidence.materialStatus === "resource_corrupt") throw new Error("expected the directly granted row");
        expect(withoutEvidence.accessSources).toEqual([{ kind: "account" }]);
        const [materialWithoutEvidence] = await inTx((tx) =>
            listSavedSecretResourceMaterialsForAccountInTx(tx, member.id, unqualified));
        if (!materialWithoutEvidence || materialWithoutEvidence.entry.materialStatus === "resource_corrupt") throw new Error("expected the directly granted material");
        expect(materialWithoutEvidence.entry.accessSources).toEqual([{ kind: "account" }]);

        const [withEvidence] = await inTx((tx) => listSavedSecretResourcesForAccountInTx(tx, member.id, qualified));
        if (!withEvidence || withEvidence.materialStatus === "resource_corrupt") throw new Error("expected the qualified row");
        expect(withEvidence.accessSources).toEqual([
            { kind: "account" },
            { kind: "team", teamId: team.id, name: "Provenance restricted" },
            { kind: "group", teamId: team.id, teamName: "Provenance restricted", groupId: group.id, name: "Provenance group" },
        ]);

        // The custodian owns the resource: their audience projection is the
        // Team roster they wrote and never depends on their own credential.
        const [ownerView] = await inTx((tx) => listSavedSecretResourcesForAccountInTx(tx, custodian.id, unqualified));
        if (!ownerView || ownerView.materialStatus === "resource_corrupt") throw new Error("expected the owner row");
        expect(ownerView.accessSources).toEqual([]);
        expect(ownerView.audience).toMatchObject({
            teams: [{ kind: "team", teamId: team.id, name: "Provenance restricted" }],
            groups: [{ kind: "group", teamId: team.id, teamName: "Provenance restricted", groupId: group.id, name: "Provenance group" }],
        });
    });

    it("stops authorizing a shared secret and its material through an archived Group or archived Team", async () => {
        const custodian = await db.account.create({ data: { encryptionMode: "plain" }, select: { id: true } });
        const member = await db.account.create({ data: { encryptionMode: "plain" }, select: { id: true } });
        const restricted = await db.team.create({
            data: {
                name: "Restricted arm",
                authenticationPolicy: { v: 1, mode: "restricted", accepted: [ACCEPTED_EMAIL_PASSWORD] },
            },
            select: { id: true },
        });
        const inherited = await db.team.create({ data: { name: "Inherited arm" }, select: { id: true } });
        await db.teamMembership.createMany({
            data: [
                { teamId: restricted.id, accountId: custodian.id, role: "owner" },
                { teamId: restricted.id, accountId: member.id, role: "member" },
            ],
        });
        const custodianInherited = await db.teamMembership.create({
            data: { teamId: inherited.id, accountId: custodian.id, role: "owner" },
            select: { id: true },
        });
        const memberInherited = await db.teamMembership.create({
            data: { teamId: inherited.id, accountId: member.id, role: "member" },
            select: { id: true },
        });
        const group = await db.teamGroup.create({
            data: { teamId: inherited.id, name: "Inherited group", nameKey: "inherited-group" },
            select: { id: true },
        });
        await db.teamGroupMembership.createMany({
            data: [
                { teamId: inherited.id, teamGroupId: group.id, teamMembershipId: custodianInherited.id },
                { teamId: inherited.id, teamGroupId: group.id, teamMembershipId: memberInherited.id },
            ],
        });
        for (const [accountId, address, factor] of [
            [custodian.id, "archived-owner@example.test", "owner password factor"],
            [member.id, "archived-member@example.test", "member password factor"],
        ] as const) {
            await db.accountIdentity.create({
                data: { accountId, provider: "email", providerUserId: address, profile: {} },
            });
            await db.accountPasswordCredential.create({
                data: {
                    accountId,
                    credential: {
                        v: 1,
                        kind: "plain_password_hash",
                        hash: await hashPasswordMaterial(new TextEncoder().encode(factor)),
                    },
                },
            });
        }

        const qualified = {
            env: { ...process.env, ...HOME_OFFERS_EMAIL_PASSWORD },
            authenticationAuthority: "present_user" as const,
            authenticationEvidence: EMAIL_PASSWORD_EVIDENCE,
        };
        const unqualified = { ...qualified, authenticationEvidence: undefined };

        expect(await inTx((tx) => createSavedSecretResourceInTx(tx, {
            accountId: custodian.id,
            authentication: qualified,
            resourceId: "resource_archived_arm",
            displayName: "Archived arm token",
            kind: "token",
            encryptionMode: "plain",
            storedContent: { t: "plain", v: { v: 1, name: "Archived arm token", kind: "token", value: "archived-value" } },
            teamGrants: [restricted.id],
            groupGrants: [group.id],
        }))).toMatchObject({ ok: true });

        const listedRefs = async (authentication: typeof qualified | typeof unqualified) => {
            const [entries, materials] = await Promise.all([
                inTx((tx) => listSavedSecretResourcesForAccountInTx(tx, member.id, authentication)),
                inTx((tx) => listSavedSecretResourceMaterialsForAccountInTx(tx, member.id, authentication)),
            ]);
            return {
                catalog: entries.map((entry) => (entry.materialStatus === "resource_corrupt" ? null : entry.ref)),
                materials: materials.map((row) => (row.entry.materialStatus === "resource_corrupt" ? null : row.entry.ref)),
            };
        };

        // The unqualified member reaches the row only through the inherited-policy
        // Group; the restricted Team arm never qualifies.
        expect(await listedRefs(unqualified)).toEqual({
            catalog: [formatSharedSavedSecretRefV1("resource_archived_arm")],
            materials: [formatSharedSavedSecretRefV1("resource_archived_arm")],
        });

        await db.teamGroup.update({ where: { id: group.id }, data: { archivedAt: new Date() } });
        expect(await listedRefs(unqualified)).toEqual({ catalog: [], materials: [] });

        await db.teamGroup.update({ where: { id: group.id }, data: { archivedAt: null } });
        await db.team.update({ where: { id: inherited.id }, data: { archivedAt: new Date() } });
        expect(await listedRefs(unqualified)).toEqual({ catalog: [], materials: [] });

        // A direct grant still authorizes the row while the Group arm is archived,
        // and provenance never names the archived Group.
        await db.savedSecretAccountGrant.create({
            data: {
                resourceId: "resource_archived_arm",
                accountId: member.id,
                createdByAccountId: custodian.id,
            },
        });
        const [directOnly] = await inTx((tx) => listSavedSecretResourcesForAccountInTx(tx, member.id, unqualified));
        if (!directOnly || directOnly.materialStatus === "resource_corrupt") throw new Error("expected the directly granted row");
        expect(directOnly.accessSources).toEqual([{ kind: "account" }]);
    });

    it("replaces explicit grants under one owner-only resource revision CAS", async () => {
        const [owner, firstRecipient, secondRecipient] = await Promise.all([
            db.account.create({ data: { encryptionMode: "plain" }, select: { id: true } }),
            db.account.create({ data: { encryptionMode: "plain" }, select: { id: true } }),
            db.account.create({ data: { encryptionMode: "plain" }, select: { id: true } }),
        ]);
        const team = await db.team.create({ data: { name: "Grant eligibility" }, select: { id: true } });
        await db.teamMembership.createMany({ data: [
            { teamId: team.id, accountId: owner.id, role: "owner" },
            { teamId: team.id, accountId: firstRecipient.id, role: "member" },
            { teamId: team.id, accountId: secondRecipient.id, role: "member" },
        ] });
        await inTx((tx) => createSavedSecretResourceInTx(tx, {
            accountId: owner.id,
            resourceId: "resource_grant_cas",
            displayName: "Shared token",
            kind: "token",
            encryptionMode: "plain",
            storedContent: {
                t: "plain",
                v: { v: 1, name: "Shared token", kind: "token", value: "secret" },
            },
        }));
        const added = await inTx((tx) => setSavedSecretResourceGrantsInTx(tx, {
            accountId: owner.id,
            resourceId: "resource_grant_cas",
            expectedRevision: 1,
            accountGrants: [firstRecipient.id],
            teamGrants: [],
            groupGrants: [],
        }));
        expect(added).toEqual({ ok: true, value: { resourceId: "resource_grant_cas", revision: 2 } });
    });

    it("degrades a mixed E2EE audience per recipient without rejecting its Plain recipient", async () => {
        const ownerMaterial = createE2eeAccountMaterial();
        const recipientMaterial = createE2eeAccountMaterial();
        const owner = await db.account.create({ data: ownerMaterial.account, select: { id: true } });
        const encryptedRecipient = await db.account.create({ data: recipientMaterial.account, select: { id: true } });
        const plainRecipient = await db.account.create({ data: { encryptionMode: "plain" }, select: { id: true } });
        await db.userRelationship.createMany({ data: [
            { fromUserId: owner.id, toUserId: encryptedRecipient.id, status: "friend" },
            { fromUserId: owner.id, toUserId: plainRecipient.id, status: "friend" },
        ] });

        const created = await inTx((tx) => createSavedSecretResourceInTx(tx, {
            accountId: owner.id,
            resourceId: "resource_mixed_mode",
            displayName: "Shared token",
            kind: "token",
            encryptionMode: "e2ee",
            storedContent: sealTestResource("resource_mixed_mode"),
            accountGrants: [encryptedRecipient.id, plainRecipient.id],
            keyEnvelopes: [{
                recipientAccountId: owner.id,
                encryptedDataKey: sealTestDataKey(ownerMaterial.contentPublicKey),
                recipientContentPublicKeyFingerprint: ownerMaterial.fingerprint,
            }, {
                recipientAccountId: encryptedRecipient.id,
                encryptedDataKey: sealTestDataKey(recipientMaterial.contentPublicKey),
                recipientContentPublicKeyFingerprint: recipientMaterial.fingerprint,
            }],
        }));

        expect(created).toMatchObject({ ok: true });
        const encrypted = await inTx((tx) => listSavedSecretResourceMaterialsForAccountInTx(tx, encryptedRecipient.id));
        const plain = await inTx((tx) => listSavedSecretResourceMaterialsForAccountInTx(tx, plainRecipient.id));
        expect(encrypted[0]?.entry.materialStatus).toBe("ready");
        expect(plain[0]?.entry.materialStatus).toBe("recipient_mode_unsupported");
    });

    it("atomically adds current E2EE recipient material with the audience revision", async () => {
        const ownerMaterial = createE2eeAccountMaterial();
        const recipientMaterial = createE2eeAccountMaterial();
        const owner = await db.account.create({ data: ownerMaterial.account, select: { id: true } });
        const recipient = await db.account.create({ data: recipientMaterial.account, select: { id: true } });
        await db.userRelationship.create({
            data: { fromUserId: owner.id, toUserId: recipient.id, status: "friend" },
        });
        await inTx((tx) => createSavedSecretResourceInTx(tx, {
            accountId: owner.id,
            resourceId: "resource_grant_material",
            displayName: "Shared token",
            kind: "token",
            encryptionMode: "e2ee",
            storedContent: sealTestResource("resource_grant_material"),
            keyEnvelopes: [{
                recipientAccountId: owner.id,
                encryptedDataKey: sealTestDataKey(ownerMaterial.contentPublicKey),
                recipientContentPublicKeyFingerprint: ownerMaterial.fingerprint,
            }],
        }));

        const changed = await inTx((tx) => setSavedSecretResourceGrantsInTx(tx, {
            accountId: owner.id,
            resourceId: "resource_grant_material",
            expectedRevision: 1,
            accountGrants: [recipient.id],
            teamGrants: [],
            groupGrants: [],
            keyEnvelopes: [{
                recipientAccountId: recipient.id,
                encryptedDataKey: sealTestDataKey(recipientMaterial.contentPublicKey),
                recipientContentPublicKeyFingerprint: recipientMaterial.fingerprint,
            }],
        }));

        expect(changed).toEqual({
            ok: true,
            value: { resourceId: "resource_grant_material", revision: 2 },
        });
        const material = await inTx((tx) => listSavedSecretResourceMaterialsForAccountInTx(tx, recipient.id));
        expect(material[0]).toMatchObject({
            resourceId: "resource_grant_material",
            entry: { materialStatus: "ready", revision: 2 },
            recipientContentPublicKeyFingerprint: recipientMaterial.fingerprint,
        });
    });

    it("matches the stored envelope fingerprint to the caller's current verified binding", async () => {
        const ownerMaterial = createE2eeAccountMaterial();
        const recipientMaterial = createE2eeAccountMaterial();
        const replacementMaterial = createE2eeAccountMaterial();
        const owner = await db.account.create({ data: ownerMaterial.account, select: { id: true } });
        const recipient = await db.account.create({ data: recipientMaterial.account, select: { id: true } });
        await db.userRelationship.create({
            data: { fromUserId: owner.id, toUserId: recipient.id, status: "friend" },
        });
        await inTx((tx) => createSavedSecretResourceInTx(tx, {
            accountId: owner.id,
            resourceId: "resource_stale_envelope",
            displayName: "Shared token",
            kind: "token",
            encryptionMode: "e2ee",
            storedContent: sealTestResource("resource_stale_envelope"),
            accountGrants: [recipient.id],
            keyEnvelopes: [{
                recipientAccountId: owner.id,
                encryptedDataKey: sealTestDataKey(ownerMaterial.contentPublicKey),
                recipientContentPublicKeyFingerprint: ownerMaterial.fingerprint,
            }, {
                recipientAccountId: recipient.id,
                encryptedDataKey: sealTestDataKey(recipientMaterial.contentPublicKey),
                recipientContentPublicKeyFingerprint: recipientMaterial.fingerprint,
            }],
        }));

        const current = await inTx((tx) => listSavedSecretResourceMaterialsForAccountInTx(tx, recipient.id));
        expect(current[0]?.entry.materialStatus).toBe("ready");
        await db.account.update({
            where: { id: recipient.id },
            data: {
                publicKey: replacementMaterial.account.publicKey,
                contentPublicKey: replacementMaterial.account.contentPublicKey,
                contentPublicKeySig: replacementMaterial.account.contentPublicKeySig,
            },
        });

        const stale = await inTx((tx) => listSavedSecretResourceMaterialsForAccountInTx(tx, recipient.id));
        expect(stale[0]?.entry.materialStatus).toBe("preparing_encrypted_access");
    });

    it("repairs newly eligible E2EE recipient material at the exact resource revision", async () => {
        const ownerMaterial = createE2eeAccountMaterial();
        const recipientMaterial = createE2eeAccountMaterial();
        const owner = await db.account.create({ data: ownerMaterial.account, select: { id: true } });
        const recipient = await db.account.create({ data: recipientMaterial.account, select: { id: true } });
        await db.userRelationship.create({
            data: { fromUserId: owner.id, toUserId: recipient.id, status: "friend" },
        });
        await inTx((tx) => createSavedSecretResourceInTx(tx, {
            accountId: owner.id,
            resourceId: "resource_envelope_repair",
            displayName: "Shared token",
            kind: "token",
            encryptionMode: "e2ee",
            storedContent: sealTestResource("resource_envelope_repair"),
            keyEnvelopes: [{
                recipientAccountId: owner.id,
                encryptedDataKey: sealTestDataKey(ownerMaterial.contentPublicKey),
                recipientContentPublicKeyFingerprint: ownerMaterial.fingerprint,
            }],
        }));
        await inTx((tx) => setSavedSecretResourceGrantsInTx(tx, {
            accountId: owner.id,
            resourceId: "resource_envelope_repair",
            expectedRevision: 1,
            accountGrants: [recipient.id],
            teamGrants: [],
            groupGrants: [],
        }));

        const repaired = await inTx((tx) => repairSavedSecretResourceKeyEnvelopesInTx(tx, {
            accountId: owner.id,
            resourceId: "resource_envelope_repair",
            expectedRevision: 2,
            keyEnvelopes: [{
                recipientAccountId: recipient.id,
                encryptedDataKey: sealTestDataKey(recipientMaterial.contentPublicKey),
                recipientContentPublicKeyFingerprint: recipientMaterial.fingerprint,
            }],
        }));

        expect(repaired).toEqual({
            ok: true,
            value: { resourceId: "resource_envelope_repair", revision: 2 },
        });
        expect((await inTx((tx) => listSavedSecretResourceMaterialsForAccountInTx(tx, recipient.id)))[0])
            .toMatchObject({ entry: { revision: 2, materialStatus: "ready" } });
        await expect(inTx((tx) => repairSavedSecretResourceKeyEnvelopesInTx(tx, {
            accountId: owner.id,
            resourceId: "resource_envelope_repair",
            expectedRevision: 1,
            keyEnvelopes: [],
        }))).resolves.toEqual({ ok: false, error: "resource_changed" });
    });

    it("rejects an E2EE envelope that does not match the recipient's current verified binding", async () => {
        const ownerMaterial = createE2eeAccountMaterial();
        const owner = await db.account.create({ data: ownerMaterial.account, select: { id: true } });

        const result = await inTx((tx) => createSavedSecretResourceInTx(tx, {
            accountId: owner.id,
            resourceId: "resource_wrong_envelope_binding",
            displayName: "Shared token",
            kind: "token",
            encryptionMode: "e2ee",
            storedContent: sealTestResource("resource_wrong_envelope_binding"),
            keyEnvelopes: [{
                recipientAccountId: owner.id,
                encryptedDataKey: sealTestDataKey(ownerMaterial.contentPublicKey),
                recipientContentPublicKeyFingerprint: "sha256:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
            }],
        }));

        expect(result).toEqual({ ok: false, error: "invalid_resource" });
        await expect(db.savedSecretResource.findUnique({
            where: { id: "resource_wrong_envelope_binding" },
        })).resolves.toBeNull();
    });

    it("isolates malformed resource content and invalid recipient bindings from healthy catalog rows", async () => {
        const ownerMaterial = createE2eeAccountMaterial();
        const recipientMaterial = createE2eeAccountMaterial();
        const owner = await db.account.create({ data: ownerMaterial.account, select: { id: true } });
        const recipient = await db.account.create({ data: recipientMaterial.account, select: { id: true } });
        await db.userRelationship.create({
            data: { fromUserId: owner.id, toUserId: recipient.id, status: "friend" },
        });
        for (const resourceId of ["resource_binding_repair", "resource_healthy_sibling"]) {
            await inTx((tx) => createSavedSecretResourceInTx(tx, {
                accountId: owner.id,
                resourceId,
                displayName: resourceId,
                kind: "token",
                encryptionMode: "e2ee",
                storedContent: sealTestResource(resourceId, resourceId),
                accountGrants: [recipient.id],
                keyEnvelopes: [{
                    recipientAccountId: owner.id,
                    encryptedDataKey: sealTestDataKey(ownerMaterial.contentPublicKey),
                    recipientContentPublicKeyFingerprint: ownerMaterial.fingerprint,
                }, {
                    recipientAccountId: recipient.id,
                    encryptedDataKey: sealTestDataKey(recipientMaterial.contentPublicKey),
                    recipientContentPublicKeyFingerprint: recipientMaterial.fingerprint,
                }],
            }));
        }
        await db.savedSecretResource.update({
            where: { id: "resource_binding_repair" },
            data: { storedContent: "malformed-at-rest-container" },
        });

        const beforeBindingDamage = await inTx((tx) => listSavedSecretResourceMaterialsForAccountInTx(tx, recipient.id));
        expect(beforeBindingDamage.find((row) => row.entry.materialStatus === "resource_corrupt")?.entry)
            .toEqual({ materialStatus: "resource_corrupt", relationship: "recipient", repair: null });
        expect(beforeBindingDamage.find((row) => "resourceId" in row && row.resourceId === "resource_healthy_sibling")?.entry.materialStatus)
            .toBe("ready");

        await db.account.update({
            where: { id: recipient.id },
            data: { contentPublicKeySig: null },
        });
        const afterBindingDamage = await inTx((tx) => listSavedSecretResourceMaterialsForAccountInTx(tx, recipient.id));
        expect(afterBindingDamage.find((row) => "resourceId" in row && row.resourceId === "resource_healthy_sibling")?.entry.materialStatus)
            .toBe("update_required");
    });

    it("projects malformed retained rows as owner-repairable and recipient-safe without hiding healthy siblings", async () => {
        const owner = await db.account.create({ data: { encryptionMode: "plain" }, select: { id: true } });
        const recipient = await db.account.create({ data: { encryptionMode: "plain" }, select: { id: true } });
        await db.userRelationship.create({
            data: { fromUserId: owner.id, toUserId: recipient.id, status: "friend" },
        });
        await inTx((tx) => createSavedSecretResourceInTx(tx, {
            accountId: owner.id,
            resourceId: "resource_healthy_next_to_corrupt",
            displayName: "Healthy sibling",
            kind: "token",
            encryptionMode: "plain",
            storedContent: {
                t: "plain",
                v: { v: 1, name: "Healthy sibling", kind: "token", value: "healthy-secret" },
            },
            accountGrants: [recipient.id],
        }));
        const malformedResourceId = " malformed-retained-id ";
        await db.savedSecretResource.create({
            data: {
                id: malformedResourceId,
                ownerAccountId: owner.id,
                displayName: "Must not leak to recipient",
                kind: "token",
                encryptionMode: "plain",
                revision: 3,
                storedContent: "malformed-at-rest-container",
                accountGrants: {
                    create: { accountId: recipient.id, createdByAccountId: owner.id },
                },
            },
        });

        const ownerRows = await inTx((tx) => listSavedSecretResourceMaterialsForAccountInTx(tx, owner.id));
        expect(ownerRows).toHaveLength(2);
        expect(ownerRows).toContainEqual(expect.objectContaining({
            entry: {
                materialStatus: "resource_corrupt",
                relationship: "owner",
                repair: {
                    kind: "delete_resource",
                    resourceId: malformedResourceId,
                    expectedRevision: 3,
                },
            },
        }));
        expect(ownerRows.some((row) => "resourceId" in row && row.resourceId === "resource_healthy_next_to_corrupt")).toBe(true);

        const recipientRows = await inTx((tx) => listSavedSecretResourceMaterialsForAccountInTx(tx, recipient.id));
        expect(recipientRows).toHaveLength(2);
        const corruptRecipientRow = recipientRows.find((row) => row.entry.materialStatus === "resource_corrupt");
        expect(corruptRecipientRow).toEqual({
            entry: {
                materialStatus: "resource_corrupt",
                relationship: "recipient",
                repair: null,
            },
        });
        expect(JSON.stringify(corruptRecipientRow)).not.toContain(malformedResourceId);
        expect(JSON.stringify(corruptRecipientRow)).not.toContain("Must not leak to recipient");
        expect(recipientRows.some((row) => "resourceId" in row && row.resourceId === "resource_healthy_next_to_corrupt")).toBe(true);
    });

    it("converts an owned E2EE resource to Plain in place, keeping its identity, audience and revision line", async () => {
        harness.resetEnv({ HAPPIER_FEATURE_ENCRYPTION__STORAGE_POLICY: "optional" });
        const ownerMaterial = createE2eeAccountMaterial();
        const recipientMaterial = createE2eeAccountMaterial();
        const owner = await db.account.create({ data: ownerMaterial.account, select: { id: true } });
        const recipient = await db.account.create({ data: recipientMaterial.account, select: { id: true } });
        await db.userRelationship.create({
            data: { fromUserId: owner.id, toUserId: recipient.id, status: "friend" },
        });
        await inTx((tx) => createSavedSecretResourceInTx(tx, {
            accountId: owner.id,
            resourceId: "resource_mode_to_plain",
            displayName: "Shared token",
            kind: "token",
            encryptionMode: "e2ee",
            storedContent: sealTestResource("resource_mode_to_plain"),
            accountGrants: [recipient.id],
            keyEnvelopes: [{
                recipientAccountId: owner.id,
                encryptedDataKey: sealTestDataKey(ownerMaterial.contentPublicKey),
                recipientContentPublicKeyFingerprint: ownerMaterial.fingerprint,
            }, {
                recipientAccountId: recipient.id,
                encryptedDataKey: sealTestDataKey(recipientMaterial.contentPublicKey),
                recipientContentPublicKeyFingerprint: recipientMaterial.fingerprint,
            }],
        }));

        const stale = await inTx((tx) => updateSavedSecretResourceInTx(tx, {
            accountId: owner.id,
            resourceId: "resource_mode_to_plain",
            expectedRevision: 0,
            displayName: "Shared token",
            kind: "token",
            toMode: "plain",
            storedContent: {
                t: "plain",
                v: { v: 1, name: "Shared token", kind: "token", value: "secret-value" },
            },
        }));
        expect(stale).toEqual({ ok: false, error: "resource_changed" });

        const mismatched = await inTx((tx) => updateSavedSecretResourceInTx(tx, {
            accountId: owner.id,
            resourceId: "resource_mode_to_plain",
            expectedRevision: 1,
            displayName: "Shared token",
            kind: "token",
            toMode: "plain",
            storedContent: sealTestResource("resource_mode_to_plain"),
        }));
        expect(mismatched).toEqual({ ok: false, error: "invalid_resource" });

        const converted = await inTx((tx) => updateSavedSecretResourceInTx(tx, {
            accountId: owner.id,
            resourceId: "resource_mode_to_plain",
            expectedRevision: 1,
            displayName: "Shared token",
            kind: "token",
            toMode: "plain",
            storedContent: {
                t: "plain",
                v: { v: 1, name: "Shared token", kind: "token", value: "secret-value" },
            },
        }));
        expect(converted).toEqual({ ok: true, value: { resourceId: "resource_mode_to_plain", revision: 2 } });

        const row = await db.savedSecretResource.findUniqueOrThrow({
            where: { id: "resource_mode_to_plain" },
            select: {
                encryptionMode: true,
                revision: true,
                accountGrants: { select: { accountId: true } },
                keyEnvelopes: { select: { recipientAccountId: true } },
            },
        });
        expect(row.encryptionMode).toBe("plain");
        expect(row.revision).toBe(2);
        expect(row.accountGrants.map((grant) => grant.accountId)).toEqual([recipient.id]);
        expect(row.keyEnvelopes).toEqual([]);

        const material = await inTx((tx) => listSavedSecretResourceMaterialsForAccountInTx(tx, recipient.id));
        expect(material[0]).toMatchObject({
            resourceId: "resource_mode_to_plain",
            entry: { materialStatus: "ready", revision: 2, encryptionMode: "plain" },
            storedContent: {
                t: "plain",
                v: { v: 1, name: "Shared token", kind: "token", value: "secret-value" },
            },
        });
    });

    // Plan 10.08 §10.5: a conversion is "subject to Home policy". A Home whose
    // storage policy admits only one mode refuses a conversion into the other,
    // with the same mode decision Session storage already applies.
    it("refuses a conversion into a mode the Home storage policy does not allow", async () => {
        harness.resetEnv({ HAPPIER_FEATURE_ENCRYPTION__STORAGE_POLICY: "required_e2ee" });
        const ownerMaterial = createE2eeAccountMaterial();
        const owner = await db.account.create({ data: ownerMaterial.account, select: { id: true } });
        await inTx((tx) => createSavedSecretResourceInTx(tx, {
            accountId: owner.id,
            resourceId: "resource_policy_keeps_e2ee",
            displayName: "Shared token",
            kind: "token",
            encryptionMode: "e2ee",
            storedContent: sealTestResource("resource_policy_keeps_e2ee"),
            keyEnvelopes: [{
                recipientAccountId: owner.id,
                encryptedDataKey: sealTestDataKey(ownerMaterial.contentPublicKey),
                recipientContentPublicKeyFingerprint: ownerMaterial.fingerprint,
            }],
        }));

        const refused = await inTx((tx) => updateSavedSecretResourceInTx(tx, {
            accountId: owner.id,
            resourceId: "resource_policy_keeps_e2ee",
            expectedRevision: 1,
            displayName: "Shared token",
            kind: "token",
            toMode: "plain",
            storedContent: {
                t: "plain",
                v: { v: 1, name: "Shared token", kind: "token", value: "secret-value" },
            },
        }));
        expect(refused).toEqual({ ok: false, error: "forbidden" });

        const row = await db.savedSecretResource.findUniqueOrThrow({
            where: { id: "resource_policy_keeps_e2ee" },
            select: { encryptionMode: true, revision: true, keyEnvelopes: { select: { recipientAccountId: true } } },
        });
        expect(row).toEqual({
            encryptionMode: "e2ee",
            revision: 1,
            keyEnvelopes: [{ recipientAccountId: owner.id }],
        });

        // Rename and rotation in the resource's existing mode are not a
        // conversion and stay untouched by the policy.
        expect(await inTx((tx) => updateSavedSecretResourceInTx(tx, {
            accountId: owner.id,
            resourceId: "resource_policy_keeps_e2ee",
            expectedRevision: 1,
            displayName: "Shared token",
            kind: "token",
            storedContent: sealTestResource("resource_policy_keeps_e2ee"),
        }))).toEqual({ ok: true, value: { resourceId: "resource_policy_keeps_e2ee", revision: 2 } });
    });

    it("converts an owned Plain resource to E2EE with the owner envelope, and refuses one without it", async () => {
        const ownerMaterial = createE2eeAccountMaterial();
        const recipientMaterial = createE2eeAccountMaterial();
        const owner = await db.account.create({ data: ownerMaterial.account, select: { id: true } });
        const recipient = await db.account.create({ data: recipientMaterial.account, select: { id: true } });
        const plainRecipient = await db.account.create({ data: { encryptionMode: "plain" }, select: { id: true } });
        await db.userRelationship.createMany({
            data: [
                { fromUserId: owner.id, toUserId: recipient.id, status: "friend" },
                { fromUserId: owner.id, toUserId: plainRecipient.id, status: "friend" },
            ],
        });
        await inTx((tx) => createSavedSecretResourceInTx(tx, {
            accountId: owner.id,
            resourceId: "resource_mode_to_e2ee",
            displayName: "Shared token",
            kind: "token",
            encryptionMode: "plain",
            storedContent: {
                t: "plain",
                v: { v: 1, name: "Shared token", kind: "token", value: "secret-value" },
            },
            accountGrants: [recipient.id, plainRecipient.id],
        }));

        // A Plain recipient can hold no envelope, so naming one is refused
        // rather than silently dropped.
        expect(await inTx((tx) => updateSavedSecretResourceInTx(tx, {
            accountId: owner.id,
            resourceId: "resource_mode_to_e2ee",
            expectedRevision: 1,
            displayName: "Shared token",
            kind: "token",
            toMode: "e2ee",
            storedContent: sealTestResource("resource_mode_to_e2ee"),
            keyEnvelopes: [{
                recipientAccountId: owner.id,
                encryptedDataKey: sealTestDataKey(ownerMaterial.contentPublicKey),
                recipientContentPublicKeyFingerprint: ownerMaterial.fingerprint,
            }, {
                recipientAccountId: plainRecipient.id,
                encryptedDataKey: sealTestDataKey(recipientMaterial.contentPublicKey),
                recipientContentPublicKeyFingerprint: recipientMaterial.fingerprint,
            }],
        }))).toEqual({ ok: false, error: "invalid_resource" });

        const withoutOwnerEnvelope = await inTx((tx) => updateSavedSecretResourceInTx(tx, {
            accountId: owner.id,
            resourceId: "resource_mode_to_e2ee",
            expectedRevision: 1,
            displayName: "Shared token",
            kind: "token",
            toMode: "e2ee",
            storedContent: sealTestResource("resource_mode_to_e2ee"),
        }));
        expect(withoutOwnerEnvelope).toEqual({ ok: false, error: "invalid_resource" });

        const converted = await inTx((tx) => updateSavedSecretResourceInTx(tx, {
            accountId: owner.id,
            resourceId: "resource_mode_to_e2ee",
            expectedRevision: 1,
            displayName: "Shared token",
            kind: "token",
            toMode: "e2ee",
            storedContent: sealTestResource("resource_mode_to_e2ee"),
            keyEnvelopes: [{
                recipientAccountId: owner.id,
                encryptedDataKey: sealTestDataKey(ownerMaterial.contentPublicKey),
                recipientContentPublicKeyFingerprint: ownerMaterial.fingerprint,
            }, {
                recipientAccountId: recipient.id,
                encryptedDataKey: sealTestDataKey(recipientMaterial.contentPublicKey),
                recipientContentPublicKeyFingerprint: recipientMaterial.fingerprint,
            }],
        }));
        expect(converted).toEqual({ ok: true, value: { resourceId: "resource_mode_to_e2ee", revision: 2 } });

        const row = await db.savedSecretResource.findUniqueOrThrow({
            where: { id: "resource_mode_to_e2ee" },
            select: {
                encryptionMode: true,
                revision: true,
                accountGrants: { select: { accountId: true } },
                keyEnvelopes: { select: { recipientAccountId: true } },
            },
        });
        expect(row.encryptionMode).toBe("e2ee");
        expect(row.revision).toBe(2);
        expect(row.accountGrants.map((grant) => grant.accountId).sort())
            .toEqual([recipient.id, plainRecipient.id].sort());
        expect(row.keyEnvelopes.map((envelope) => envelope.recipientAccountId).sort())
            .toEqual([owner.id, recipient.id].sort());

        const material = await inTx((tx) => listSavedSecretResourceMaterialsForAccountInTx(tx, recipient.id));
        expect(material[0]).toMatchObject({
            resourceId: "resource_mode_to_e2ee",
            entry: { materialStatus: "ready", revision: 2, encryptionMode: "e2ee" },
        });
        // The Plain recipient keeps its grant and its own Account mode, and
        // now sees the typed mode-incompatible state instead of a value.
        const plainMaterial = await inTx((tx) => listSavedSecretResourceMaterialsForAccountInTx(tx, plainRecipient.id));
        expect(plainMaterial[0]).toMatchObject({
            resourceId: "resource_mode_to_e2ee",
            entry: { materialStatus: "recipient_mode_unsupported", revision: 2, encryptionMode: "e2ee" },
        });
        expect(JSON.stringify(plainMaterial)).not.toContain("secret-value");
        expect(await db.account.findUniqueOrThrow({ where: { id: plainRecipient.id }, select: { encryptionMode: true } }))
            .toEqual({ encryptionMode: "plain" });
    });

    it("refuses a conversion into E2EE for an owner whose Account holds no content key", async () => {
        const owner = await db.account.create({ data: { encryptionMode: "plain" }, select: { id: true } });
        await inTx((tx) => createSavedSecretResourceInTx(tx, {
            accountId: owner.id,
            resourceId: "resource_plain_owner",
            displayName: "Shared token",
            kind: "token",
            encryptionMode: "plain",
            storedContent: {
                t: "plain",
                v: { v: 1, name: "Shared token", kind: "token", value: "secret-value" },
            },
        }));
        expect(await inTx((tx) => updateSavedSecretResourceInTx(tx, {
            accountId: owner.id,
            resourceId: "resource_plain_owner",
            expectedRevision: 1,
            displayName: "Shared token",
            kind: "token",
            toMode: "e2ee",
            storedContent: sealTestResource("resource_plain_owner"),
            keyEnvelopes: [{
                recipientAccountId: owner.id,
                encryptedDataKey: sealTestDataKey(createE2eeAccountMaterial().contentPublicKey),
                recipientContentPublicKeyFingerprint: "fingerprint",
            }],
        }))).toEqual({ ok: false, error: "recipient_mode_unsupported" });
    });

    it("keeps refusing a mode/content mismatch and stray envelopes on an ordinary update", async () => {
        const owner = await db.account.create({ data: { encryptionMode: "plain" }, select: { id: true } });
        await inTx((tx) => createSavedSecretResourceInTx(tx, {
            accountId: owner.id,
            resourceId: "resource_mode_unchanged",
            displayName: "Shared token",
            kind: "token",
            encryptionMode: "plain",
            storedContent: {
                t: "plain",
                v: { v: 1, name: "Shared token", kind: "token", value: "secret-value" },
            },
        }));

        expect(await inTx((tx) => updateSavedSecretResourceInTx(tx, {
            accountId: owner.id,
            resourceId: "resource_mode_unchanged",
            expectedRevision: 1,
            displayName: "Shared token",
            kind: "token",
            storedContent: sealTestResource("resource_mode_unchanged"),
        }))).toEqual({ ok: false, error: "invalid_resource" });

        // Envelope material only ever travels with an explicit conversion; the
        // repair owner keeps every other envelope write.
        expect(await inTx((tx) => updateSavedSecretResourceInTx(tx, {
            accountId: owner.id,
            resourceId: "resource_mode_unchanged",
            expectedRevision: 1,
            displayName: "Renamed token",
            kind: "token",
            storedContent: {
                t: "plain",
                v: { v: 1, name: "Renamed token", kind: "token", value: "secret-value" },
            },
            keyEnvelopes: [{
                recipientAccountId: owner.id,
                encryptedDataKey: sealTestDataKey(createE2eeAccountMaterial().contentPublicKey),
                recipientContentPublicKeyFingerprint: "fingerprint",
            }],
        }))).toEqual({ ok: false, error: "invalid_resource" });

        const unchanged = await db.savedSecretResource.findUniqueOrThrow({
            where: { id: "resource_mode_unchanged" },
            select: { encryptionMode: true, revision: true },
        });
        expect(unchanged).toEqual({ encryptionMode: "plain", revision: 1 });
    });
});
