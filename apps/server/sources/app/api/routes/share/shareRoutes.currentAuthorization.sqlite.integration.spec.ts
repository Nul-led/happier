import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import tweetnacl from "tweetnacl";
import { decodeBase64, encodeBase64 } from "privacy-kit";
import {
    CURRENT_ACCOUNT_STORED_CONTENT_COMPATIBILITY_DECLARATION,
    buildAccountStoredContentCompatibilityHttpHeadersV1,
    openEncryptedDataKeyEnvelopeV1,
    sealEncryptedDataKeyEnvelopeV1,
} from "@happier-dev/protocol";

import { db } from "@/storage/db";
import { createLightSqliteHarness, type LightSqliteHarness } from "@/testkit/lightSqliteHarness";
import { withAuthenticatedTestApp } from "../../testkit/sqliteFastify";
import { shareRoutes } from "./shareRoutes";
import { createSignedAccountContentBinding } from "@/testkit/accountEncryption";
import { createSessionDataKeyEnvelopeViewerSelect, projectViewerSessionDataKey } from "@/app/session/encryption/sessionDataKeyEnvelopePersistence";

/**
 * A request-level admission check is not mutation authority.
 *
 * These tests revoke the acting shared administrator between the route's preflight
 * answer and its write transaction, then assert the released V1 routes still refuse.
 * The fault is injected on the canonical access evaluator's own `db.session`
 * lookup, which is the query the preflight actually decides from. Prisma hands the
 * interactive transaction a separate client, so the in-transaction recheck is
 * deliberately not proxied: that is what makes this discriminate between a route
 * that trusts its preflight and one that rechecks inside the transaction.
 */
let originalSessionFindUnique:
    | ((args: Parameters<typeof db.session.findUnique>[0]) => ReturnType<typeof db.session.findUnique>)
    | undefined;

function afterQueryResolves<T extends object>(query: T, after: () => Promise<void>): T {
    return new Proxy(query, {
        get(target, property, receiver) {
            if (property !== "then") return Reflect.get(target, property, receiver);

            const then = Reflect.get(target, property, target);
            if (typeof then !== "function") return then;

            return (
                onfulfilled?: (value: unknown) => unknown,
                onrejected?: (reason: unknown) => unknown,
            ) => then.call(
                target,
                async (value: unknown) => {
                    await after();
                    return onfulfilled ? onfulfilled(value) : value;
                },
                onrejected,
            );
        },
    });
}

/** Run `after` once, immediately after the Nth preflight access lookup resolves. */
function revokeAfterPreflightLookup(
    lookupOrdinal: number,
    after: () => Promise<void>,
): () => void {
    const delegate = db.session;
    const original = originalSessionFindUnique ?? delegate.findUnique.bind(delegate);
    originalSessionFindUnique = original;
    let lookups = 0;
    Object.defineProperty(delegate, "findUnique", {
        configurable: true,
        writable: true,
        value: (args: Parameters<typeof delegate.findUnique>[0]) => afterQueryResolves(
            original(args),
            async () => {
                lookups += 1;
                if (lookups === lookupOrdinal) await after();
            },
        ),
    });
    return () => {
        Object.defineProperty(delegate, "findUnique", {
            configurable: true,
            writable: true,
            value: original,
        });
    };
}

describe("shareRoutes current authorization (SQLite integration)", () => {
    let harness: LightSqliteHarness;
    let restoreSessionFindUnique: (() => void) | undefined;

    beforeAll(async () => {
        harness = await createLightSqliteHarness({
            tempDirPrefix: "happier-share-routes-current-authorization-",
            initAuth: false,
            env: { HAPPIER_FEATURE_SESSIONS_COLLABORATION__ENABLED: "1" },
        });
    }, 120_000);

    afterAll(async () => {
        if (harness) await harness.close();
    });

    afterEach(async () => {
        restoreSessionFindUnique?.();
        restoreSessionFindUnique = undefined;
        vi.unstubAllEnvs();
        await harness.resetDbTables([
            () => db.accountChange.deleteMany(),
            () => db.sessionTeamGrant.deleteMany(),
            () => db.sessionShare.deleteMany(),
            () => db.sessionMessage.deleteMany(),
            () => db.session.deleteMany(),
            () => db.teamMembership.deleteMany(),
            () => db.team.deleteMany(),
            () => db.userRelationship.deleteMany(),
            () => db.account.deleteMany(),
        ]);
    });

    async function createFixture() {
        const owner = await db.account.create({
            data: { publicKey: `share-owner-${crypto.randomUUID()}`, encryptionMode: "plain" },
            select: { id: true },
        });
        const admin = await db.account.create({
            data: { publicKey: `share-admin-${crypto.randomUUID()}`, encryptionMode: "plain" },
            select: { id: true },
        });
        const recipient = await db.account.create({
            data: { publicKey: `share-recipient-${crypto.randomUUID()}`, encryptionMode: "plain" },
            select: { id: true },
        });
        const session = await db.session.create({
            data: {
                accountId: owner.id,
                tag: `share-current-authorization-${crypto.randomUUID()}`,
                encryptionMode: "plain",
                metadata: JSON.stringify({}),
                currentStorageState: "hosted",
            },
            select: { id: true },
        });
        const adminShare = await db.sessionShare.create({
            data: {
                sessionId: session.id,
                sharedByUserId: owner.id,
                sharedWithUserId: admin.id,
                accessLevel: "admin",
                canApprovePermissions: true,
            },
            select: { id: true },
        });
        const recipientShare = await db.sessionShare.create({
            data: {
                sessionId: session.id,
                sharedByUserId: owner.id,
                sharedWithUserId: recipient.id,
                accessLevel: "edit",
                canApprovePermissions: true,
            },
            select: { id: true },
        });
        return { admin, adminShare, recipient, recipientShare, session };
    }

    async function createDirectFixture(encryptionMode: "plain" | "e2ee") {
        const ownerBinding = createSignedAccountContentBinding();
        const recipientKeyPair = tweetnacl.box.keyPair();
        const recipientBinding = createSignedAccountContentBinding(recipientKeyPair.publicKey);
        const accounts = [];
        for (const binding of [ownerBinding, recipientBinding]) {
            accounts.push(await db.account.create({ data: encryptionMode === "plain"
                ? { encryptionMode: "plain" }
                : {
                    encryptionMode: "e2ee", publicKey: binding.publicKey,
                    contentPublicKey: Buffer.from(binding.contentPublicKey),
                    contentPublicKeySig: Buffer.from(binding.contentPublicKeySig),
                }, select: { id: true } }));
        }
        const [owner, recipient] = accounts;
        const session = await db.session.create({ data: {
            accountId: owner!.id, tag: crypto.randomUUID(), encryptionMode,
            metadata: JSON.stringify({ v: 1 }), currentStorageState: "hosted",
            metadataLayoutVersion: 1,
            ownerMetadata: JSON.stringify(encryptionMode === "plain"
                ? { t: "plain", v: { v: 1 } }
                : { t: "encrypted", c: "oRoBAgMEBQYHCAkKCwwNDg8QERITFBUWFxh8aC0+8+YDECLScN6uQTItPyWVR7XbQA==" }),
        }, select: { id: true } });
        await db.userRelationship.create({ data: {
            fromUserId: owner!.id, toUserId: recipient!.id, status: "friend",
        } });
        const dataKey = tweetnacl.randomBytes(32);
        const seal = (recipientPublicKey: Uint8Array) => sealEncryptedDataKeyEnvelopeV1({
            dataKey, recipientPublicKey, randomBytes: size => tweetnacl.randomBytes(size),
        });
        if (encryptionMode === "e2ee") {
            await db.sessionDataKeyEnvelope.create({ data: {
                sessionId: session.id, recipientAccountId: owner!.id,
                encryptedDataKey: Buffer.from(seal(ownerBinding.contentPublicKey)),
            } });
        }
        return {
            owner: owner!, recipient: recipient!, session, dataKey, recipientBinding, recipientKeyPair, seal,
            headers: {
                "x-test-user-id": owner!.id,
                ...buildAccountStoredContentCompatibilityHttpHeadersV1(
                    CURRENT_ACCOUNT_STORED_CONTENT_COMPATIBILITY_DECLARATION,
                ),
            },
        };
    }

    async function createRestrictedTeamAdminFixture() {
        const owner = await db.account.create({
            data: { publicKey: `share-team-owner-${crypto.randomUUID()}`, encryptionMode: "plain" },
            select: { id: true },
        });
        const admin = await db.account.create({
            data: { publicKey: `share-team-admin-${crypto.randomUUID()}`, encryptionMode: "plain" },
            select: { id: true },
        });
        const recipient = await db.account.create({
            data: { publicKey: `share-team-recipient-${crypto.randomUUID()}`, encryptionMode: "plain" },
            select: { id: true },
        });
        const team = await db.team.create({
            data: {
                name: `Restricted share team ${crypto.randomUUID()}`,
                authenticationPolicy: {
                    v: 1,
                    mode: "restricted",
                    accepted: [{ kind: "home_method", methodId: "key_challenge" }],
                },
            },
            select: { id: true },
        });
        await db.teamMembership.create({
            data: { teamId: team.id, accountId: admin.id, role: "admin" },
        });
        const session = await db.session.create({
            data: {
                accountId: owner.id,
                tag: `share-team-authentication-${crypto.randomUUID()}`,
                encryptionMode: "plain",
                metadata: JSON.stringify({}),
                currentStorageState: "hosted",
            },
            select: { id: true },
        });
        await db.sessionTeamGrant.create({
            data: {
                sessionId: session.id,
                teamId: team.id,
                accessLevel: "admin",
                canApprovePermissions: true,
                effectiveAt: new Date(),
            },
        });
        await db.userRelationship.create({
            data: { fromUserId: admin.id, toUserId: recipient.id, status: "friend" },
        });
        return { admin, recipient, session };
    }

    // Released request/body basis: server-v0.2.11-preview.2 at
    // 98ea8fb76733b1dd785d38c31360179cafa84824, POST shareRoutes.
    // The incumbent metadata privacy contract separately requires a current
    // stored-content declaration for layout-one Sessions; these vectors exercise
    // the released sharing body without bypassing that admission.
    it("preserves released Plain sharing to a keyless friend while ignoring supplied key text", async () => {
        const fixture = await createDirectFixture("plain");
        await withAuthenticatedTestApp(shareRoutes, async app => {
            const response = await app.inject({
                method: "POST", url: `/v1/sessions/${fixture.session.id}/shares`,
                headers: fixture.headers,
                payload: { userId: fixture.recipient.id, accessLevel: "view", encryptedDataKey: "ignored" },
            });
            expect(response.statusCode, response.body).toBe(200);
        });
        expect(await db.sessionShare.count({ where: { sessionId: fixture.session.id } })).toBe(1);
        expect(await db.sessionDataKeyEnvelope.count({ where: { sessionId: fixture.session.id } })).toBe(0);
    });

    it("distinguishes unavailable Team authentication from an authentication-required denial", async () => {
        const fixture = await createRestrictedTeamAdminFixture();
        vi.stubEnv("HAPPIER_FEATURE_AUTH_LOGIN__KEY_CHALLENGE_ENABLED", "0");

        await withAuthenticatedTestApp(shareRoutes, async app => {
            const unavailable = await app.inject({
                method: "POST",
                url: `/v1/sessions/${fixture.session.id}/shares`,
                headers: { "x-test-user-id": fixture.admin.id },
                payload: { userId: fixture.recipient.id, accessLevel: "view" },
            });
            expect(unavailable.statusCode, unavailable.body).toBe(503);
            expect(unavailable.json()).toEqual({ error: "session_access_authentication_unavailable" });

            vi.stubEnv("HAPPIER_FEATURE_AUTH_LOGIN__KEY_CHALLENGE_ENABLED", "1");
            const required = await app.inject({
                method: "POST",
                url: `/v1/sessions/${fixture.session.id}/shares`,
                headers: { "x-test-user-id": fixture.admin.id },
                payload: { userId: fixture.recipient.id, accessLevel: "view" },
            });
            expect(required.statusCode, required.body).toBe(403);
            expect(required.json()).toEqual({ error: "Forbidden" });
        });

        expect(await db.sessionShare.count({ where: { sessionId: fixture.session.id } })).toBe(0);
    });

    it("preserves the released missing-key response for an E2EE recipient needing setup", async () => {
        const fixture = await createDirectFixture("e2ee");
        await db.account.update({ where: { id: fixture.recipient.id }, data: {
            contentPublicKey: null, contentPublicKeySig: null,
        } });
        await withAuthenticatedTestApp(shareRoutes, async app => {
            const response = await app.inject({
                method: "POST", url: `/v1/sessions/${fixture.session.id}/shares`,
                headers: fixture.headers,
                payload: { userId: fixture.recipient.id, accessLevel: "view" },
            });
            expect(response.statusCode, response.body).toBe(400);
            expect(response.json()).toEqual({ error: "encryptedDataKey required" });
        });
        expect(await db.sessionShare.count({ where: { sessionId: fixture.session.id } })).toBe(0);
    });

    it("normalizes omitted delegation to false when released POST upserts a View grant", async () => {
        const fixture = await createDirectFixture("plain");
        await db.sessionShare.create({ data: {
            sessionId: fixture.session.id,
            sharedByUserId: fixture.owner.id,
            sharedWithUserId: fixture.recipient.id,
            accessLevel: "edit",
            canApprovePermissions: true,
        } });

        await withAuthenticatedTestApp(shareRoutes, async app => {
            const response = await app.inject({
                method: "POST",
                url: `/v1/sessions/${fixture.session.id}/shares`,
                headers: fixture.headers,
                payload: { userId: fixture.recipient.id, accessLevel: "view" },
            });
            expect(response.statusCode, response.body).toBe(200);
        });

        await expect(db.sessionShare.findFirstOrThrow({ where: {
            sessionId: fixture.session.id,
            sharedWithUserId: fixture.recipient.id,
        } })).resolves.toMatchObject({ accessLevel: "view", canApprovePermissions: false });
    });

    it("opens the original Session key after the released create request commits its canonical tuple", async () => {
        const fixture = await createDirectFixture("e2ee");
        await withAuthenticatedTestApp(shareRoutes, async app => {
            const response = await app.inject({
                method: "POST", url: `/v1/sessions/${fixture.session.id}/shares`,
                headers: fixture.headers,
                payload: {
                    userId: fixture.recipient.id, accessLevel: "view",
                    encryptedDataKey: encodeBase64(new Uint8Array(fixture.seal(fixture.recipientBinding.contentPublicKey))),
                },
            });
            expect(response.statusCode, response.body).toBe(200);
        });
        const row = await db.session.findUniqueOrThrow({
            where: { id: fixture.session.id },
            select: createSessionDataKeyEnvelopeViewerSelect({ viewerAccountId: fixture.recipient.id }),
        });
        const projected = projectViewerSessionDataKey(row);
        expect(projected).not.toBeNull();
        expect(openEncryptedDataKeyEnvelopeV1({
            envelope: decodeBase64(projected!),
            recipientSecretKeyOrSeed: fixture.recipientKeyPair.secretKey,
        })).toEqual(fixture.dataKey);
        expect(await db.accountChange.count({ where: {
            accountId: fixture.recipient.id, kind: "session", entityId: fixture.session.id,
        } })).toBe(1);
    });

    it("preserves released E2EE PATCH without demanding repair of a missing recipient tuple", async () => {
        const fixture = await createDirectFixture("e2ee");
        const share = await db.sessionShare.create({ data: {
            sessionId: fixture.session.id, sharedByUserId: fixture.owner.id,
            sharedWithUserId: fixture.recipient.id, accessLevel: "view",
        } });
        await withAuthenticatedTestApp(shareRoutes, async app => {
            const response = await app.inject({
                method: "PATCH", url: `/v1/sessions/${fixture.session.id}/shares/${share.id}`,
                headers: fixture.headers, payload: { accessLevel: "edit" },
            });
            expect(response.statusCode, response.body).toBe(200);
        });
        expect(await db.sessionShare.findUniqueOrThrow({ where: { id: share.id } }))
            .toMatchObject({ accessLevel: "edit", canApprovePermissions: false });
        expect(await db.sessionDataKeyEnvelope.count({ where: {
            sessionId: fixture.session.id, recipientAccountId: fixture.recipient.id,
        } })).toBe(0);
    });

    it("normalizes omitted delegation to false when released PATCH downgrades a grant to View", async () => {
        const fixture = await createDirectFixture("plain");
        const share = await db.sessionShare.create({ data: {
            sessionId: fixture.session.id,
            sharedByUserId: fixture.owner.id,
            sharedWithUserId: fixture.recipient.id,
            accessLevel: "edit",
            canApprovePermissions: true,
        } });

        await withAuthenticatedTestApp(shareRoutes, async app => {
            const response = await app.inject({
                method: "PATCH",
                url: `/v1/sessions/${fixture.session.id}/shares/${share.id}`,
                headers: fixture.headers,
                payload: { accessLevel: "view" },
            });
            expect(response.statusCode, response.body).toBe(200);
        });

        await expect(db.sessionShare.findUniqueOrThrow({ where: { id: share.id } }))
            .resolves.toMatchObject({ accessLevel: "view", canApprovePermissions: false });
    });

    it("does not disclose a roster after the current shared-admin grant is revoked", async () => {
        const fixture = await createFixture();
        restoreSessionFindUnique = revokeAfterPreflightLookup(1, async () => {
            await db.sessionShare.delete({ where: { id: fixture.adminShare.id } });
        });

        await withAuthenticatedTestApp(
            (app) => shareRoutes(app),
            async (app) => {
                const response = await app.inject({
                    method: "GET",
                    url: `/v1/sessions/${fixture.session.id}/shares`,
                    headers: { "x-test-user-id": fixture.admin.id },
                });

                expect(response.statusCode).toBe(403);
                expect(response.json()).toEqual({ error: "Forbidden" });
            },
        );
    });

    it("does not revoke another participant after the acting shared-admin grant is revoked", async () => {
        const fixture = await createFixture();
        restoreSessionFindUnique = revokeAfterPreflightLookup(1, async () => {
            await db.sessionShare.delete({ where: { id: fixture.adminShare.id } });
        });

        await withAuthenticatedTestApp(
            (app) => shareRoutes(app),
            async (app) => {
                const response = await app.inject({
                    method: "DELETE",
                    url: `/v1/sessions/${fixture.session.id}/shares/${fixture.recipientShare.id}`,
                    headers: { "x-test-user-id": fixture.admin.id },
                });

                expect(response.statusCode).toBe(403);
            },
        );

        await expect(db.sessionShare.findUniqueOrThrow({
            where: { id: fixture.recipientShare.id },
            select: { id: true },
        })).resolves.toEqual({ id: fixture.recipientShare.id });
    });

    it("permits a nondelegating admin to remove delegated approval", async () => {
        const fixture = await createFixture();
        // The route answers `manageAccess` before opening its transaction. Losing
        // permission-delegation authority must not block this strictly safer
        // transition: only effective delegation-capability gains require it.
        restoreSessionFindUnique = revokeAfterPreflightLookup(1, async () => {
            await db.sessionShare.update({
                where: { id: fixture.adminShare.id },
                data: { canApprovePermissions: false },
            });
        });

        await withAuthenticatedTestApp(
            (app) => shareRoutes(app),
            async (app) => {
                const response = await app.inject({
                    method: "PATCH",
                    url: `/v1/sessions/${fixture.session.id}/shares/${fixture.recipientShare.id}`,
                    headers: {
                        "content-type": "application/json",
                        "x-test-user-id": fixture.admin.id,
                    },
                    payload: { canApprovePermissions: false },
                });

                expect(response.statusCode, response.body).toBe(200);
            },
        );

        await expect(db.sessionShare.findUniqueOrThrow({
            where: { id: fixture.recipientShare.id },
            select: { canApprovePermissions: true },
        })).resolves.toEqual({ canApprovePermissions: false });
    });

    it("permits a nondelegating admin to retry an unchanged delegated grant", async () => {
        const fixture = await createFixture();
        // Retrying the existing tuple gains no effective capability. The canonical
        // grant writer, rather than request-field presence, decides whether the
        // transition requires delegation authority.
        restoreSessionFindUnique = revokeAfterPreflightLookup(1, async () => {
            await db.sessionShare.update({
                where: { id: fixture.adminShare.id },
                data: { canApprovePermissions: false },
            });
        });

        await withAuthenticatedTestApp(
            (app) => shareRoutes(app),
            async (app) => {
                const response = await app.inject({
                    method: "PATCH",
                    url: `/v1/sessions/${fixture.session.id}/shares/${fixture.recipientShare.id}`,
                    headers: {
                        "content-type": "application/json",
                        "x-test-user-id": fixture.admin.id,
                    },
                    payload: { canApprovePermissions: true },
                });

                expect(response.statusCode, response.body).toBe(200);
            },
        );

        await expect(db.sessionShare.findUniqueOrThrow({
            where: { id: fixture.recipientShare.id },
            select: { canApprovePermissions: true },
        })).resolves.toEqual({ canApprovePermissions: true });
    });

    it("still rejects a real delegation-capability gain by a nondelegating admin", async () => {
        const fixture = await createFixture();
        await db.session.update({
            where: { id: fixture.session.id },
            data: {
                metadata: JSON.stringify({ v: 1 }),
                metadataLayoutVersion: 1,
                ownerMetadata: JSON.stringify({ t: "plain", v: { v: 1 } }),
            },
        });
        await db.sessionShare.updateMany({
            where: { id: { in: [fixture.adminShare.id, fixture.recipientShare.id] } },
            data: { canApprovePermissions: false },
        });

        await withAuthenticatedTestApp(
            (app) => shareRoutes(app),
            async (app) => {
                const response = await app.inject({
                    method: "POST",
                    url: `/v1/sessions/${fixture.session.id}/shares`,
                    headers: {
                        "content-type": "application/json",
                        "x-test-user-id": fixture.admin.id,
                        ...buildAccountStoredContentCompatibilityHttpHeadersV1(
                            CURRENT_ACCOUNT_STORED_CONTENT_COMPATIBILITY_DECLARATION,
                        ),
                    },
                    payload: {
                        userId: fixture.recipient.id,
                        accessLevel: "edit",
                        canApprovePermissions: true,
                    },
                });

                expect(response.statusCode, response.body).toBe(403);
            },
        );

        await expect(db.sessionShare.findUniqueOrThrow({
            where: { id: fixture.recipientShare.id },
            select: { canApprovePermissions: true },
        })).resolves.toEqual({ canApprovePermissions: false });
    });
});
