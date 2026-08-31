import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import tweetnacl from "tweetnacl";

import { encodeBase64, type HomeConnectionDescriptorV1 } from "@happier-dev/protocol";
import { db, initDbMysql, initDbPostgres } from "@/storage/db";
import {
    createLightSqliteHarness,
    type LightSqliteHarness,
} from "@/testkit/lightSqliteHarness";
import {
    deleteAccountDirectoryLink,
    deleteAccountHomeDirectoryEntry,
    listAccountHomeDirectory,
    redeemHomeLoginAssertion,
    setPreferredAccountHome,
    upsertAccountDirectoryLink,
    upsertAccountHomeDirectoryEntry,
} from "./accountDirectoryService";
import { canonicalHomeLoginAssertionBytes } from "./accountDirectorySigner";
import { createHomeApprovalGate } from "@/app/api/routes/auth/homeApprovalGate";

type ContractProvider = "postgres" | "mysql" | "sqlite";

function resolveContractProviderFromEnv(): ContractProvider {
    const raw = (process.env.HAPPIER_DB_PROVIDER ?? process.env.HAPPY_DB_PROVIDER ?? "postgres")
        .toString()
        .trim()
        .toLowerCase();

    if (raw === "postgresql" || raw === "postgres") return "postgres";
    if (raw === "mysql") return "mysql";
    if (raw === "sqlite") return "sqlite";
    throw new Error(
        `Unsupported Account Directory contract provider: ${raw}. Set HAPPIER_DB_PROVIDER=postgres|mysql|sqlite (or HAPPY_DB_PROVIDER).`,
    );
}

function uniqueValue(prefix: string): string {
    return `${prefix}-${randomUUID()}`;
}

function descriptor(homeServerIdentityId: string): HomeConnectionDescriptorV1 {
    const canonicalServerUrl = `https://${homeServerIdentityId}.example.test`;
    return {
        v: 1,
        homeServerIdentityId,
        canonicalServerUrl,
        revision: 1,
        endpoints: [{ kind: "https", url: canonicalServerUrl }],
    };
}

function signingKey(seed: number) {
    const keyPair = tweetnacl.sign.keyPair.fromSeed(new Uint8Array(32).fill(seed));
    return {
        id: createHash("sha256").update(keyPair.publicKey).digest("hex"),
        publicKey: keyPair.publicKey,
        publicKeyBase64Url: encodeBase64(keyPair.publicKey, "base64url"),
    };
}

function signedAssertion(params: Readonly<{
    issuerServerIdentityId: string;
    issuerSubjectId: string;
    signingSeed: number;
    nowMs: number;
}>) {
    const keyPair = tweetnacl.sign.keyPair.fromSeed(new Uint8Array(32).fill(params.signingSeed));
    const clientKeyPair = tweetnacl.box.keyPair.fromSecretKey(new Uint8Array(32).fill(29));
    const unsigned = {
        v: 1 as const,
        purpose: "happier.home-login" as const,
        issuerServerIdentityId: params.issuerServerIdentityId,
        issuerSubjectId: params.issuerSubjectId,
        audienceHomeServerIdentityId: "srv_home_tx_test",
        clientBoxPublicKeyBase64: encodeBase64(clientKeyPair.publicKey, "base64"),
        issuedAtMs: params.nowMs,
        expiresAtMs: params.nowMs + 180_000,
        keyId: createHash("sha256").update(keyPair.publicKey).digest("hex"),
    };
    return {
        ...unsigned,
        signatureBase64Url: encodeBase64(
            tweetnacl.sign.detached(canonicalHomeLoginAssertionBytes(unsigned), keyPair.secretKey),
            "base64url",
        ),
    };
}

async function approveAssertionRequest(params: Readonly<{
    assertion: ReturnType<typeof signedAssertion>;
    nowMs: number;
}>): Promise<string> {
    const pending = await redeemHomeLoginAssertion({
        assertion: params.assertion,
        nowMs: params.nowMs,
        env: { HAPPIER_SERVER_IDENTITY_ID: "srv_home_tx_test" } as NodeJS.ProcessEnv,
        homeApprovalGate: createHomeApprovalGate({ HAPPIER_HOME_DEVICE_APPROVAL_REQUIRED: "1" }),
        issueHomeToken: async () => {
            throw new Error("approval request must not issue a Home token");
        },
    });
    expect(pending).toMatchObject({ outcome: "approval_required" });
    if (!("outcome" in pending) || pending.outcome !== "approval_required") {
        throw new Error("expected an approval_required result");
    }
    await db.authPairingSession.update({
        where: { id: pending.approvalId },
        data: { approvalStatus: "approved", decidedAt: new Date(params.nowMs) },
    });
    return pending.approvalId;
}

describe("Account Directory database contract", () => {
    const provider = resolveContractProviderFromEnv();
    const mysqlIt = provider === "mysql" ? it : it.skip;
    let sqliteHarness: LightSqliteHarness | null = null;
    let nativeDbConnected = false;

    beforeAll(async () => {
        if (provider === "sqlite") {
            sqliteHarness = await createLightSqliteHarness({
                tempDirPrefix: "happier-account-directory-dbcontract-",
            });
            return;
        }
        if (!process.env.DATABASE_URL) {
            throw new Error("Missing DATABASE_URL (required for PostgreSQL/MySQL db contract tests).");
        }
        if (provider === "mysql") await initDbMysql();
        else initDbPostgres();
        await db.$connect();
        nativeDbConnected = true;
    });

    afterAll(async () => {
        if (sqliteHarness) {
            await sqliteHarness.close();
            return;
        }
        if (nativeDbConnected) await db.$disconnect();
    });

    it("enforces account-scoped directory uniqueness and transactional preferred state", async () => {
        const accountA = await db.account.create({
            data: { publicKey: uniqueValue("account-directory-a") },
            select: { id: true },
        });
        const accountB = await db.account.create({
            data: { publicKey: uniqueValue("account-directory-b") },
            select: { id: true },
        });
        const homeA = uniqueValue("srv_home_a");
        const homeB = uniqueValue("srv_home_b");

        const firstA = await upsertAccountHomeDirectoryEntry({
            accountId: accountA.id,
            homeServerIdentityId: homeA,
            label: "Account A Home",
            connectionDescriptor: descriptor(homeA),
        });
        await upsertAccountHomeDirectoryEntry({
            accountId: accountB.id,
            homeServerIdentityId: homeB,
            label: "Account B Home",
            connectionDescriptor: descriptor(homeB),
        });
        await upsertAccountHomeDirectoryEntry({
            accountId: accountA.id,
            homeServerIdentityId: homeA,
            label: "Account A Home Updated",
            connectionDescriptor: descriptor(homeA),
        });

        expect(firstA.preferred).toBe(true);
        await expect(db.accountHomeDirectoryEntry.count({
            where: { accountId: accountA.id, homeServerIdentityId: homeA },
        })).resolves.toBe(1);

        const [directoryA, directoryB] = await Promise.all([
            listAccountHomeDirectory(accountA.id),
            listAccountHomeDirectory(accountB.id),
        ]);
        expect(directoryA).toMatchObject({
            preferredHomeServerIdentityId: homeA,
            homes: [{ homeServerIdentityId: homeA, label: "Account A Home Updated", preferred: true }],
        });
        expect(directoryB).toMatchObject({
            preferredHomeServerIdentityId: homeB,
            homes: [{ homeServerIdentityId: homeB, label: "Account B Home", preferred: true }],
        });
        expect(directoryA.homes.some((home) => home.homeServerIdentityId === homeB)).toBe(false);
        expect(directoryB.homes.some((home) => home.homeServerIdentityId === homeA)).toBe(false);

        await expect(setPreferredAccountHome({
            accountId: accountB.id,
            homeServerIdentityId: homeA,
        })).rejects.toMatchObject({ code: "preferred_home_not_found" });
        await expect(db.account.findUniqueOrThrow({
            where: { id: accountB.id },
            select: { preferredHomeServerIdentityId: true },
        })).resolves.toEqual({ preferredHomeServerIdentityId: homeB });

        await deleteAccountHomeDirectoryEntry({ accountId: accountA.id, homeServerIdentityId: homeA });
        const [deletedEntry, accountAfterDelete] = await Promise.all([
            db.accountHomeDirectoryEntry.findUnique({
                where: { accountId_homeServerIdentityId: { accountId: accountA.id, homeServerIdentityId: homeA } },
                select: { accountId: true },
            }),
            db.account.findUniqueOrThrow({
                where: { id: accountA.id },
                select: { preferredHomeServerIdentityId: true },
            }),
        ]);
        expect(deletedEntry).toBeNull();
        expect(accountAfterDelete.preferredHomeServerIdentityId).toBeNull();

        await db.account.deleteMany({ where: { id: { in: [accountA.id, accountB.id] } } });
    });

    it("requires explicit relink for trust changes and cascades directory state with Account deletion", async () => {
        const account = await db.account.create({
            data: { publicKey: uniqueValue("account-directory-cascade") },
            select: { id: true },
        });
        const homeServerIdentityId = uniqueValue("srv_home_cascade");
        const issuerServerIdentityId = uniqueValue("srv_account_service");
        const originalKey = signingKey(17);
        const replacementKey = signingKey(18);

        await upsertAccountHomeDirectoryEntry({
            accountId: account.id,
            homeServerIdentityId,
            label: "Cascade Home",
            connectionDescriptor: descriptor(homeServerIdentityId),
        });
        const originalLink = {
            accountId: account.id,
            issuerServerIdentityId,
            issuerSubjectId: "directory-subject-original",
            issuerSigningKeyId: originalKey.id,
            issuerSigningPublicKeyBase64Url: originalKey.publicKeyBase64Url,
        };
        await upsertAccountDirectoryLink(originalLink);
        await upsertAccountDirectoryLink(originalLink);
        await expect(db.accountDirectoryLink.count({
            where: { accountId: account.id, issuerServerIdentityId },
        })).resolves.toBe(1);

        await expect(upsertAccountDirectoryLink({
            ...originalLink,
            issuerSubjectId: "directory-subject-replacement",
        })).rejects.toMatchObject({ code: "directory_link_conflict" });
        await expect(upsertAccountDirectoryLink({
            ...originalLink,
            issuerSigningKeyId: replacementKey.id,
            issuerSigningPublicKeyBase64Url: replacementKey.publicKeyBase64Url,
        })).rejects.toMatchObject({ code: "directory_link_conflict" });
        const unchanged = await db.accountDirectoryLink.findUniqueOrThrow({
            where: {
                issuerServerIdentityId_issuerSubjectId: {
                    issuerServerIdentityId,
                    issuerSubjectId: originalLink.issuerSubjectId,
                },
            },
            select: { issuerSubjectId: true, issuerSigningKeyId: true, issuerSigningPublicKey: true },
        });
        expect({
            ...unchanged,
            issuerSigningPublicKey: Array.from(unchanged.issuerSigningPublicKey),
        }).toEqual({
            issuerSubjectId: originalLink.issuerSubjectId,
            issuerSigningKeyId: originalKey.id,
            issuerSigningPublicKey: Array.from(originalKey.publicKey),
        });

        await upsertAccountDirectoryLink({
            ...originalLink,
            issuerSubjectId: "directory-subject-replacement",
            issuerSigningKeyId: replacementKey.id,
            issuerSigningPublicKeyBase64Url: replacementKey.publicKeyBase64Url,
            relink: true,
        });
        const relinked = await db.accountDirectoryLink.findFirstOrThrow({
            where: { accountId: account.id, issuerServerIdentityId },
            select: { issuerSubjectId: true, issuerSigningKeyId: true, issuerSigningPublicKey: true },
        });
        expect({
            ...relinked,
            issuerSigningPublicKey: Array.from(relinked.issuerSigningPublicKey),
        }).toEqual({
            issuerSubjectId: "directory-subject-replacement",
            issuerSigningKeyId: replacementKey.id,
            issuerSigningPublicKey: Array.from(replacementKey.publicKey),
        });

        await db.account.delete({ where: { id: account.id }, select: { id: true } });
        const [directoryRows, linkRows] = await Promise.all([
            db.accountHomeDirectoryEntry.count({ where: { accountId: account.id } }),
            db.accountDirectoryLink.count({ where: { accountId: account.id } }),
        ]);
        expect(directoryRows).toBe(0);
        expect(linkRows).toBe(0);
    });

    it("revalidates the exact issuer link after approval before issuing a Home token", async () => {
        const account = await db.account.create({
            data: { publicKey: uniqueValue("account-directory-redemption-race") },
            select: { id: true },
        });
        const issuerServerIdentityId = uniqueValue("srv_issuer_race");
        const issuerSubjectId = uniqueValue("issuer-subject");
        const originalKey = signingKey(23);
        const replacementKey = signingKey(24);
        const nowMs = Date.now();
        const assertion = signedAssertion({ issuerServerIdentityId, issuerSubjectId, signingSeed: 23, nowMs });
        const originalLink = {
            accountId: account.id,
            issuerServerIdentityId,
            issuerSubjectId,
            issuerSigningKeyId: originalKey.id,
            issuerSigningPublicKeyBase64Url: originalKey.publicKeyBase64Url,
        };
        let issueCalls = 0;
        const issueHomeToken = async () => {
            issueCalls += 1;
            return "must-never-issue";
        };

        try {
            await upsertAccountDirectoryLink(originalLink);
            await expect(redeemHomeLoginAssertion({
                assertion,
                nowMs,
                env: { HAPPIER_SERVER_IDENTITY_ID: "srv_home_tx_test" } as NodeJS.ProcessEnv,
                homeApprovalGate: {
                    evaluate: async () => {
                        await deleteAccountDirectoryLink({ accountId: account.id, issuerServerIdentityId });
                        return { kind: "allowed" as const };
                    },
                },
                issueHomeToken,
            })).rejects.toMatchObject({ code: "directory_link_not_found" });
            expect(issueCalls).toBe(0);

            await upsertAccountDirectoryLink(originalLink);
            await expect(redeemHomeLoginAssertion({
                assertion,
                nowMs,
                env: { HAPPIER_SERVER_IDENTITY_ID: "srv_home_tx_test" } as NodeJS.ProcessEnv,
                homeApprovalGate: {
                    evaluate: async () => {
                        await upsertAccountDirectoryLink({
                            ...originalLink,
                            issuerSigningKeyId: replacementKey.id,
                            issuerSigningPublicKeyBase64Url: replacementKey.publicKeyBase64Url,
                            relink: true,
                        });
                        return { kind: "allowed" as const };
                    },
                },
                issueHomeToken,
            })).rejects.toMatchObject({ code: "assertion_issuer_untrusted" });
            expect(issueCalls).toBe(0);
        } finally {
            await db.account.delete({ where: { id: account.id }, select: { id: true } });
        }
    });

    it("does not issue after an approved link is deleted and recreated before the issuance transaction", async () => {
        const account = await db.account.create({
            data: { publicKey: uniqueValue("account-directory-link-instance-race") },
            select: { id: true },
        });
        const issuerServerIdentityId = uniqueValue("srv_instance_race");
        const issuerSubjectId = uniqueValue("issuer-subject");
        const key = signingKey(30);
        const nowMs = Date.now();
        const assertion = signedAssertion({ issuerServerIdentityId, issuerSubjectId, signingSeed: 30, nowMs });
        const link = {
            accountId: account.id,
            issuerServerIdentityId,
            issuerSubjectId,
            issuerSigningKeyId: key.id,
            issuerSigningPublicKeyBase64Url: key.publicKeyBase64Url,
        };
        let issueCalls = 0;

        try {
            await upsertAccountDirectoryLink(link);
            const approvalId = await approveAssertionRequest({ assertion, nowMs });

            await expect(redeemHomeLoginAssertion({
                assertion,
                approvalId,
                nowMs,
                env: { HAPPIER_SERVER_IDENTITY_ID: "srv_home_tx_test" } as NodeJS.ProcessEnv,
                homeApprovalGate: {
                    evaluate: async (facts) => {
                        const decision = await createHomeApprovalGate({ HAPPIER_HOME_DEVICE_APPROVAL_REQUIRED: "1" }).evaluate(facts);
                        expect(decision.kind).toBe("allowed");
                        await deleteAccountDirectoryLink({ accountId: account.id, issuerServerIdentityId });
                        await upsertAccountDirectoryLink(link);
                        return decision;
                    },
                },
                issueHomeToken: async () => {
                    issueCalls += 1;
                    return "must-never-issue";
                },
            })).rejects.toMatchObject({ code: "home_unavailable" });
            expect(issueCalls).toBe(0);
        } finally {
            await db.account.delete({ where: { id: account.id }, select: { id: true } });
        }
    });

    it("binds an approval to the exact signed assertion", async () => {
        const account = await db.account.create({
            data: { publicKey: uniqueValue("account-directory-assertion-binding") },
            select: { id: true },
        });
        const issuerServerIdentityId = uniqueValue("srv_issuer_bind");
        const issuerSubjectId = uniqueValue("issuer-subject");
        const key = signingKey(31);
        const nowMs = Date.now();
        const originalAssertion = signedAssertion({ issuerServerIdentityId, issuerSubjectId, signingSeed: 31, nowMs });
        const freshAssertion = signedAssertion({ issuerServerIdentityId, issuerSubjectId, signingSeed: 31, nowMs: nowMs + 1 });
        let issueCalls = 0;

        try {
            await upsertAccountDirectoryLink({
                accountId: account.id,
                issuerServerIdentityId,
                issuerSubjectId,
                issuerSigningKeyId: key.id,
                issuerSigningPublicKeyBase64Url: key.publicKeyBase64Url,
            });
            const approvalId = await approveAssertionRequest({ assertion: originalAssertion, nowMs });

            await expect(redeemHomeLoginAssertion({
                assertion: freshAssertion,
                approvalId,
                nowMs: nowMs + 1,
                env: { HAPPIER_SERVER_IDENTITY_ID: "srv_home_tx_test" } as NodeJS.ProcessEnv,
                homeApprovalGate: createHomeApprovalGate({ HAPPIER_HOME_DEVICE_APPROVAL_REQUIRED: "1" }),
                issueHomeToken: async () => {
                    issueCalls += 1;
                    return "must-never-issue";
                },
            })).rejects.toMatchObject({ code: "home_unavailable" });
            expect(issueCalls).toBe(0);
        } finally {
            await db.account.delete({ where: { id: account.id }, select: { id: true } });
        }
    });

    it("invalidates an approved assertion request on explicit relink", async () => {
        const account = await db.account.create({
            data: { publicKey: uniqueValue("account-directory-relink-binding") },
            select: { id: true },
        });
        const issuerServerIdentityId = uniqueValue("srv_issuer_relink_binding");
        const issuerSubjectId = uniqueValue("issuer-subject");
        const originalKey = signingKey(32);
        const replacementKey = signingKey(33);
        const nowMs = Date.now();
        const originalAssertion = signedAssertion({ issuerServerIdentityId, issuerSubjectId, signingSeed: 32, nowMs });
        const replacementAssertion = signedAssertion({ issuerServerIdentityId, issuerSubjectId, signingSeed: 33, nowMs: nowMs + 1 });
        let issueCalls = 0;

        try {
            const link = {
                accountId: account.id,
                issuerServerIdentityId,
                issuerSubjectId,
                issuerSigningKeyId: originalKey.id,
                issuerSigningPublicKeyBase64Url: originalKey.publicKeyBase64Url,
            };
            await upsertAccountDirectoryLink(link);
            const approvalId = await approveAssertionRequest({ assertion: originalAssertion, nowMs });
            await upsertAccountDirectoryLink({
                ...link,
                issuerSigningKeyId: replacementKey.id,
                issuerSigningPublicKeyBase64Url: replacementKey.publicKeyBase64Url,
                relink: true,
            });

            await expect(redeemHomeLoginAssertion({
                assertion: replacementAssertion,
                approvalId,
                nowMs: nowMs + 1,
                env: { HAPPIER_SERVER_IDENTITY_ID: "srv_home_tx_test" } as NodeJS.ProcessEnv,
                homeApprovalGate: createHomeApprovalGate({ HAPPIER_HOME_DEVICE_APPROVAL_REQUIRED: "1" }),
                issueHomeToken: async () => {
                    issueCalls += 1;
                    return "must-never-issue";
                },
            })).rejects.toMatchObject({ code: "home_unavailable" });
            expect(issueCalls).toBe(0);
            await expect(db.authPairingSession.findUnique({ where: { id: approvalId } })).resolves.toBeNull();
        } finally {
            await db.account.delete({ where: { id: account.id }, select: { id: true } });
        }
    });

    it("invalidates an approved assertion request when the same issuer link is deleted and recreated", async () => {
        const account = await db.account.create({
            data: { publicKey: uniqueValue("account-directory-recreated-link-binding") },
            select: { id: true },
        });
        const issuerServerIdentityId = uniqueValue("srv_issuer_recreate");
        const issuerSubjectId = uniqueValue("issuer-subject");
        const key = signingKey(34);
        const nowMs = Date.now();
        const assertion = signedAssertion({ issuerServerIdentityId, issuerSubjectId, signingSeed: 34, nowMs });
        let issueCalls = 0;

        try {
            const link = {
                accountId: account.id,
                issuerServerIdentityId,
                issuerSubjectId,
                issuerSigningKeyId: key.id,
                issuerSigningPublicKeyBase64Url: key.publicKeyBase64Url,
            };
            await upsertAccountDirectoryLink(link);
            const approvalId = await approveAssertionRequest({ assertion, nowMs });
            await deleteAccountDirectoryLink({ accountId: account.id, issuerServerIdentityId });
            await upsertAccountDirectoryLink(link);

            await expect(redeemHomeLoginAssertion({
                assertion,
                approvalId,
                nowMs,
                env: { HAPPIER_SERVER_IDENTITY_ID: "srv_home_tx_test" } as NodeJS.ProcessEnv,
                homeApprovalGate: createHomeApprovalGate({ HAPPIER_HOME_DEVICE_APPROVAL_REQUIRED: "1" }),
                issueHomeToken: async () => {
                    issueCalls += 1;
                    return "must-never-issue";
                },
            })).rejects.toMatchObject({ code: "home_unavailable" });
            expect(issueCalls).toBe(0);
            await expect(db.authPairingSession.findUnique({ where: { id: approvalId } })).resolves.toBeNull();
        } finally {
            await db.account.delete({ where: { id: account.id }, select: { id: true } });
        }
    });

    mysqlIt("stores issuer subjects at the protocol maximum UTF-8 byte bound", async () => {
        const account = await db.account.create({
            data: { publicKey: uniqueValue("account-directory-mysql-max-subject") },
            select: { id: true },
        });
        const key = signingKey(19);
        const issuerSubjectId = "s".repeat(256);

        try {
            await upsertAccountDirectoryLink({
                accountId: account.id,
                issuerServerIdentityId: uniqueValue("srv_mysql_max_subject"),
                issuerSubjectId,
                issuerSigningKeyId: key.id,
                issuerSigningPublicKeyBase64Url: key.publicKeyBase64Url,
            });
            await expect(db.accountDirectoryLink.findFirstOrThrow({
                where: { accountId: account.id },
                select: { issuerSubjectId: true },
            })).resolves.toEqual({ issuerSubjectId });
        } finally {
            await db.account.delete({ where: { id: account.id }, select: { id: true } });
        }
    });
});
