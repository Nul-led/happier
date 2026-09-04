import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import tweetnacl from "tweetnacl";

import { encodeBase64 } from "@happier-dev/protocol";
import { db } from "@/storage/db";
import { createLightSqliteHarness, type LightSqliteHarness } from "@/testkit/lightSqliteHarness";
import {
    getOrCreateServerIdentityId,
    initializeServerIdentityCache,
} from "@/app/serverIdentity/serverIdentity";
import { createHomeConnectionDescriptorContinuityStoreForServer } from "@/app/features/homeConnectionDescriptorContinuity";
import {
    readHomeConnectionDescriptor,
    resetHomeConnectionDescriptorRevisionOwnerForTests,
} from "@/app/features/homeConnectionDescriptorPublication";

import { AccountDirectoryError } from "./accountDirectoryErrors";
import {
    accountDirectorySigningKeyMetadata,
    resolveAccountDirectorySigningKeyPair,
    verifyHomeLoginAssertionSignature,
} from "./accountDirectorySigner";
import {
    ensureSameServiceHomeBootstrapForNewAccount,
    listAccountHomeDirectory,
    mintAccountHomeLoginAssertion,
    upsertAccountHomeDirectoryEntry,
} from "./accountDirectoryService";

/**
 * The env of an explicitly dual-role server: one Account-Service-capable
 * instance that also publishes an authoritative Home descriptor (HTTPS ingress
 * composed from the public URL by the canonical descriptor-publication owner).
 */
const DUAL_ROLE_ENV = {
    HAPPIER_CANONICAL_SERVER_URL: "https://cloud.example.test",
    HAPPIER_PUBLIC_SERVER_URL: "https://cloud.example.test",
};

async function readCurrentHomeDescriptor() {
    const continuityStore = createHomeConnectionDescriptorContinuityStoreForServer(process.env);
    if (!continuityStore) return undefined;
    return await readHomeConnectionDescriptor({
        env: process.env,
        continuityStore,
        visibility: "authenticated",
    });
}

describe("Account Directory same-service Home bootstrap (integration)", () => {
    let harness: LightSqliteHarness;

    beforeAll(async () => {
        harness = await createLightSqliteHarness({
            tempDirPrefix: "happier-account-directory-same-service-bootstrap-",
            initAuth: true,
            env: DUAL_ROLE_ENV,
        });
        await initializeServerIdentityCache(process.env);
    }, 120_000);

    afterEach(async () => {
        await db.accountDirectoryLink.deleteMany();
        await db.accountHomeDirectoryEntry.deleteMany();
        await db.account.deleteMany();
        harness.resetEnv(DUAL_ROLE_ENV);
        resetHomeConnectionDescriptorRevisionOwnerForTests();
    });

    afterAll(async () => {
        await harness.close();
    });

    it("ensures the self entry, the pinned same-account link, and first-Home preferred transactionally", async () => {
        const serverIdentityId = await getOrCreateServerIdentityId(process.env);
        const signing = accountDirectorySigningKeyMetadata(process.env);
        const account = await db.account.create({
            data: { publicKey: "same-service-bootstrap-fresh-account" },
            select: { id: true },
        });

        const outcome = await ensureSameServiceHomeBootstrapForNewAccount({ accountId: account.id });

        expect(outcome).toEqual({
            status: "ensured",
            homeServerIdentityId: serverIdentityId,
            preferred: true,
        });

        const entries = await db.accountHomeDirectoryEntry.findMany({ where: { accountId: account.id } });
        expect(entries).toHaveLength(1);
        const entry = entries[0]!;
        expect(entry.homeServerIdentityId).toBe(serverIdentityId);
        expect(entry.canonicalServerUrl).toBe("https://cloud.example.test");
        const currentDescriptor = await readCurrentHomeDescriptor();
        expect(currentDescriptor).toBeDefined();
        expect(entry.connectionDescriptor).toEqual(currentDescriptor);

        const links = await db.accountDirectoryLink.findMany({ where: { accountId: account.id } });
        expect(links).toHaveLength(1);
        const link = links[0]!;
        expect(link.issuerServerIdentityId).toBe(serverIdentityId);
        expect(link.issuerSubjectId).toBe(account.id);
        expect(link.issuerSigningKeyId).toBe(signing.keyId);
        expect(Buffer.from(link.issuerSigningPublicKey)).toEqual(
            Buffer.from(resolveAccountDirectorySigningKeyPair(process.env).publicKey),
        );

        // The unchanged assertion corridor is immediately usable: the existing
        // mint owner accepts the bootstrapped entry and signs with the pinned key.
        const clientBox = tweetnacl.box.keyPair();
        const assertion = await mintAccountHomeLoginAssertion({
            accountId: account.id,
            homeServerIdentityId: serverIdentityId,
            clientBoxPublicKeyBase64: encodeBase64(new Uint8Array(clientBox.publicKey), "base64"),
        });
        expect(verifyHomeLoginAssertionSignature(assertion, new Uint8Array(link.issuerSigningPublicKey))).toBe("ok");
    });

    it("repeats idempotently and never retargets an existing preferred Home", async () => {
        const serverIdentityId = await getOrCreateServerIdentityId(process.env);
        const account = await db.account.create({
            data: { publicKey: "same-service-bootstrap-repeat-account" },
            select: { id: true },
        });
        await upsertAccountHomeDirectoryEntry({
            accountId: account.id,
            homeServerIdentityId: "srv_other_home_account",
            label: "Other Home",
            connectionDescriptor: {
                v: 1,
                homeServerIdentityId: "srv_other_home_account",
                canonicalServerUrl: "https://other.example.test",
                revision: 1,
                endpoints: [{ kind: "https", url: "https://other.example.test" }],
            },
        });

        const first = await ensureSameServiceHomeBootstrapForNewAccount({ accountId: account.id });
        const second = await ensureSameServiceHomeBootstrapForNewAccount({ accountId: account.id });

        expect(first).toEqual({ status: "ensured", homeServerIdentityId: serverIdentityId, preferred: false });
        expect(second).toEqual(first);

        const directory = await listAccountHomeDirectory(account.id);
        expect(directory.preferredHomeServerIdentityId).toBe("srv_other_home_account");
        expect(directory.homes).toHaveLength(2);
        expect(await db.accountDirectoryLink.count({ where: { accountId: account.id } })).toBe(1);
    });

    it("creates no trust rows when the server publishes no Home descriptor (Account-Service-only runtime)", async () => {
        harness.resetEnv({
            HAPPIER_CANONICAL_SERVER_URL: undefined,
            HAPPIER_PUBLIC_SERVER_URL: undefined,
        });
        const account = await db.account.create({
            data: { publicKey: "same-service-bootstrap-service-only-account" },
            select: { id: true },
        });

        const outcome = await ensureSameServiceHomeBootstrapForNewAccount({ accountId: account.id });

        expect(outcome).toEqual({ status: "not_dual_role", reason: "home_descriptor_unavailable" });
        expect(await db.accountHomeDirectoryEntry.count({ where: { accountId: account.id } })).toBe(0);
        expect(await db.accountDirectoryLink.count({ where: { accountId: account.id } })).toBe(0);
    });

    it("keeps a transient descriptor-resolution failure retryable instead of classifying the server as service-only", async () => {
        const account = await db.account.create({
            data: { publicKey: "same-service-bootstrap-transient-descriptor-failure" },
            select: { id: true },
        });

        await expect(ensureSameServiceHomeBootstrapForNewAccount({
            accountId: account.id,
            resolveHomeConnectionDescriptor: async () => {
                throw new Error("temporary descriptor read failure");
            },
        })).rejects.toThrow("temporary descriptor read failure");

        expect(await db.accountHomeDirectoryEntry.count({ where: { accountId: account.id } })).toBe(0);
        expect(await db.accountDirectoryLink.count({ where: { accountId: account.id } })).toBe(0);
    });

    it("revalidates the authoritative descriptor at the write boundary", async () => {
        const account = await db.account.create({
            data: { publicKey: "same-service-bootstrap-write-boundary" },
            select: { id: true },
        });
        const initial = await readCurrentHomeDescriptor();
        expect(initial).toBeDefined();
        let reads = 0;

        await expect(ensureSameServiceHomeBootstrapForNewAccount({
            accountId: account.id,
            resolveHomeConnectionDescriptor: async () => {
                reads += 1;
                return reads === 1 ? initial : undefined;
            },
        })).rejects.toThrow("became unavailable before persistence");

        expect(reads).toBe(2);
        expect(await db.accountHomeDirectoryEntry.count({ where: { accountId: account.id } })).toBe(0);
        expect(await db.accountDirectoryLink.count({ where: { accountId: account.id } })).toBe(0);
    });

    it("creates no trust rows when the Account Service signing metadata is unavailable", async () => {
        const account = await db.account.create({
            data: { publicKey: "same-service-bootstrap-no-signing-account" },
            select: { id: true },
        });

        const outcome = await ensureSameServiceHomeBootstrapForNewAccount({
            accountId: account.id,
            env: {},
        });

        expect(outcome).toEqual({
            status: "not_dual_role",
            reason: "account_service_signing_metadata_unavailable",
        });
        expect(await db.accountHomeDirectoryEntry.count({ where: { accountId: account.id } })).toBe(0);
        expect(await db.accountDirectoryLink.count({ where: { accountId: account.id } })).toBe(0);
    });

    it("fails closed when the resolved descriptor names a different server identity", async () => {
        const account = await db.account.create({
            data: { publicKey: "same-service-bootstrap-wrong-identity-account" },
            select: { id: true },
        });

        const outcome = await ensureSameServiceHomeBootstrapForNewAccount({
            accountId: account.id,
            resolveHomeConnectionDescriptor: async () => ({
                v: 1,
                homeServerIdentityId: "srv_some_other_instance",
                canonicalServerUrl: "https://cloud.example.test",
                revision: 1,
                endpoints: [{ kind: "https", url: "https://cloud.example.test" }],
            }),
        });

        expect(outcome).toEqual({ status: "not_dual_role", reason: "server_identity_mismatch" });
        expect(await db.accountHomeDirectoryEntry.count({ where: { accountId: account.id } })).toBe(0);
        expect(await db.accountDirectoryLink.count({ where: { accountId: account.id } })).toBe(0);
    });

    it("fails closed on an existing different link instead of silently relinking", async () => {
        const serverIdentityId = await getOrCreateServerIdentityId(process.env);
        const signing = accountDirectorySigningKeyMetadata(process.env);
        const account = await db.account.create({
            data: { publicKey: "same-service-bootstrap-link-conflict-account" },
            select: { id: true },
        });
        await db.accountDirectoryLink.create({
            data: {
                accountId: account.id,
                issuerServerIdentityId: serverIdentityId,
                issuerSubjectId: "a-different-subject",
                issuerSigningKeyId: signing.keyId,
                issuerSigningPublicKey: Buffer.from(resolveAccountDirectorySigningKeyPair(process.env).publicKey),
            },
        });

        await expect(ensureSameServiceHomeBootstrapForNewAccount({ accountId: account.id }))
            .rejects.toMatchObject({ name: "AccountDirectoryError", code: "directory_link_conflict" } satisfies Partial<AccountDirectoryError>);

        expect(await db.accountHomeDirectoryEntry.count({ where: { accountId: account.id } })).toBe(0);
        const links = await db.accountDirectoryLink.findMany({ where: { accountId: account.id } });
        expect(links).toHaveLength(1);
        expect(links[0]!.issuerSubjectId).toBe("a-different-subject");
    });
});
