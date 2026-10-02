import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as privacyKit from "privacy-kit";
import { createHash } from "node:crypto";
import { ARTIFACT_PLAIN_DATA_KEY_MARKER, encodePlainArtifactStoredContent, CURRENT_ACCOUNT_STORED_CONTENT_COMPATIBILITY_DECLARATION, buildAccountStoredContentCompatibilityHttpHeadersV1 } from "@happier-dev/protocol";
import { createSignedAccountContentBinding } from "@/testkit/accountEncryption";
import { sealPublicShareDataKeyV1, openPublicShareDataKeyV1, sealSessionDataKeyBundleV0, openSessionDataKeyBundleV0 } from "@happier-dev/protocol";
import { db } from "@/storage/db";
import { createLightSqliteHarness, type LightSqliteHarness } from "@/testkit/lightSqliteHarness";
import { withAuthenticatedTestApp } from "@/app/api/testkit/sqliteFastify";
import { publicShareRoutes } from "./publicShareRoutes";

describe("stored-content public share owner (real SQLite)", () => {
    let harness: LightSqliteHarness;
    beforeAll(async () => {
        harness = await createLightSqliteHarness({ tempDirPrefix: "happier-stored-public-share-", initEncrypt: true, env: {
            HAPPIER_PUBLIC_SERVER_URL: "https://home.example.test",
            HAPPIER_FEATURE_LOCAL_SERVICES_PREVIEW__HOST_ORIGIN_DOMAIN: "preview.example.test",
            HAPPIER_FEATURE_LOCAL_SERVICES_PUBLIC_PREVIEW__ALLOW_TEST_RATE_LIMIT_CHECKER: "1",
        } });
    }, 180_000);
    afterAll(async () => { if (harness) await harness.close(); });

    it("publishes an ordinary plain Artifact through the canonical owner, with consent, use admission, audit and immediate revoke", async () => {
        const owner = await db.account.create({ data: { encryptionMode: "plain" } });
        const stranger = await db.account.create({ data: { encryptionMode: "plain" } });
        const artifact = await db.artifact.create({ data: { id: crypto.randomUUID(), accountId: owner.id,
            headerVersion: 1, bodyVersion: 1, header: privacyKit.decodeBase64(encodePlainArtifactStoredContent({ title: "Public document" })),
            body: privacyKit.decodeBase64(encodePlainArtifactStoredContent({ body: "Public text" })),
            dataEncryptionKey: privacyKit.decodeBase64(ARTIFACT_PLAIN_DATA_KEY_MARKER) } });
        const lookupId = crypto.randomUUID();
        const headers = { "x-test-user-id": owner.id };
        await withAuthenticatedTestApp(publicShareRoutes, async app => {
            const create = await app.inject({ method: "POST", url: "/v1/public-shares", headers,
                payload: { subject: { kind: "artifact", id: artifact.id }, lookupId, keyDerivation: "fragment_v1", maxUses: 1, isConsentRequired: true } });
            expect(create.statusCode, create.body).toBe(200);
            const share = create.json().publicShare;
            expect(share.subject).toEqual({ kind: "artifact", id: artifact.id });
            expect((await app.inject({ method: "GET", url: `/v1/public-shares?subjectKind=artifact&subjectId=${artifact.id}`, headers: { "x-test-user-id": stranger.id } })).statusCode).toBe(403);
            const origin = create.json().isolatedOrigin;
            const readHeaders = { host: new URL(origin).host };
            expect((await app.inject({ method: "GET", url: `/v1/public-shares/${lookupId}/content`, headers: readHeaders })).json()).toMatchObject({ requiresConsent: true });
            expect((await app.inject({ method: "GET", url: `/v1/public-shares/${lookupId}/content?consent=true`, headers: readHeaders })).json()).toMatchObject({ encryptionMode: "plain", encryptedDataKey: null, content: { kind: "artifact", body: encodePlainArtifactStoredContent({ body: "Public text" }) } });
            expect((await app.inject({ method: "GET", url: `/v1/public-shares/${lookupId}/content?consent=true`, headers: readHeaders })).statusCode).toBe(404);
            const logs = await app.inject({ method: "GET", url: `/v1/public-shares/${share.id}/access-log`, headers });
            expect(logs.json().accessLog).toHaveLength(1);
            expect((await app.inject({ method: "DELETE", url: `/v1/public-shares/${share.id}`, headers })).statusCode).toBe(200);
            expect((await app.inject({ method: "GET", url: `/v1/public-shares/${lookupId}/content?consent=true`, headers: readHeaders })).statusCode).toBe(404);
        });
    });

    it("preserves path-token Session rows after privacy upgrade and refuses ordinary publication of plugin assets", async () => {
        const owner = await db.account.create({ data: { ...createSignedAccountContentBinding(), encryptionMode: "e2ee" } });
        const session = await db.session.create({ data: { accountId: owner.id, tag: crypto.randomUUID(), encryptionMode: "plain", metadata: '{"v":1}', metadataLayoutVersion: 1, ownerMetadata: JSON.stringify({ t: "encrypted", c: "oRoBAgMEBQYHCAkKCwwNDg8QERITFBUWFxh8aC0+8+YDECLScN6uQTItPyWVR7XbQA==" }) } });
        const token = crypto.randomUUID();
        await db.publicSessionShare.create({ data: { sessionId: session.id, createdByUserId: owner.id, tokenHash: createHash("sha256").update(token).digest() } });
        const artifact = await db.artifact.create({ data: { id: crypto.randomUUID(), accountId: owner.id, header: new Uint8Array([1]), body: new Uint8Array([2]), dataEncryptionKey: new Uint8Array([3]) } });
        await db.accountPluginRelease.create({ data: { accountId: owner.id, pluginId: "com.test.public", version: "1.0.0", archiveDigestSha256: "0".repeat(64), normalizedManifest: {}, collectionContracts: {}, uiSlots: [], packageAssetArtifactId: artifact.id } });
        await withAuthenticatedTestApp(publicShareRoutes, async app => {
            expect((await app.inject({ method: "GET", url: `/v1/public-share/${token}`, headers: buildAccountStoredContentCompatibilityHttpHeadersV1(CURRENT_ACCOUNT_STORED_CONTENT_COMPATIBILITY_DECLARATION) })).statusCode).toBe(200);
            const response = await app.inject({ method: "POST", url: "/v1/public-shares", headers: { "x-test-user-id": owner.id }, payload: { subject: { kind: "artifact", id: artifact.id }, lookupId: crypto.randomUUID(), keyDerivation: "fragment_v1" } });
            expect(response.statusCode).toBe(403);
        });
    });

    it("serves only the isolated static shell and asset, both revoked with their owner", async () => {
        const owner = await db.account.create({ data: { encryptionMode: "plain" } });
        const artifact = await db.artifact.create({ data: { id: crypto.randomUUID(), accountId: owner.id, headerVersion: 1, bodyVersion: 1,
            header: privacyKit.decodeBase64(encodePlainArtifactStoredContent({ title: "Shell" })), body: privacyKit.decodeBase64(encodePlainArtifactStoredContent({ body: "Text" })), dataEncryptionKey: privacyKit.decodeBase64(ARTIFACT_PLAIN_DATA_KEY_MARKER) } });
        await withAuthenticatedTestApp(publicShareRoutes, async app => {
            const lookupId = crypto.randomUUID();
            const headers = { "x-test-user-id": owner.id };
            const created = await app.inject({ method: "POST", url: "/v1/public-shares", headers, payload: { subject: { kind: "artifact", id: artifact.id }, lookupId, keyDerivation: "fragment_v1" } });
            expect(created.statusCode, created.body).toBe(200);
            const host = new URL(created.json().isolatedOrigin).host;
            expect((await app.inject({ method: "GET", url: `/s/${lookupId}`, headers: { host: "home.example.test" } })).statusCode).toBe(404);
            const shell = await app.inject({ method: "GET", url: `/s/${lookupId}`, headers: { host } });
            expect(shell.statusCode, shell.body).toBe(200);
            expect(shell.headers["content-security-policy"]).toContain("connect-src 'self'");
            expect(shell.headers["set-cookie"]).toBeUndefined();
            expect((await app.inject({ method: "GET", url: `/s/${lookupId}/viewer.js`, headers: { host } })).headers["content-type"]).toContain("application/javascript");
            await db.account.update({ where: { id: owner.id }, data: { encryptionMode: "e2ee" } });
            const mismatched = await app.inject({ method: "GET", url: `/v1/public-shares/${lookupId}/content`, headers: { host } });
            expect(mismatched.statusCode, mismatched.body).toBe(404);
            expect((await db.publicSessionShare.findUniqueOrThrow({ where: { id: created.json().publicShare.id } })).useCount).toBe(0);
            expect(await db.publicShareAccessLog.count({ where: { publicShareId: created.json().publicShare.id } })).toBe(0);
            await db.account.update({ where: { id: owner.id }, data: { encryptionMode: "plain" } });
            await db.artifact.update({ where: { id: artifact.id }, data: { deletedAt: new Date() } });
            expect((await app.inject({ method: "GET", url: `/v1/public-shares/${lookupId}/content`, headers: { host } })).statusCode).toBe(404);
            expect((await app.inject({ method: "GET", url: `/s/${lookupId}`, headers: { host } })).statusCode).toBe(404);
            expect((await app.inject({ method: "GET", url: `/s/${lookupId}/viewer.js`, headers: { host } })).statusCode).toBe(404);
            expect((await app.inject({ method: "POST", url: "/v1/public-shares", headers,
                payload: { subject: { kind: "artifact", id: artifact.id }, lookupId: crypto.randomUUID(), keyDerivation: "fragment_v1" } })).statusCode).toBe(403);
            expect((await db.publicSessionShare.findUniqueOrThrow({ where: { id: created.json().publicShare.id } })).useCount).toBe(0);
            await db.artifact.update({ where: { id: artifact.id }, data: { deletedAt: null } });
            await app.inject({ method: "DELETE", url: `/v1/public-shares/${created.json().publicShare.id}`, headers });
            expect((await app.inject({ method: "GET", url: `/s/${lookupId}`, headers: { host } })).statusCode).toBe(404);
            expect((await app.inject({ method: "GET", url: `/s/${lookupId}/viewer.js`, headers: { host } })).statusCode).toBe(404);
        });
    });

    it.each(["artifact", "session"] as const)("cannot unwrap an E2EE %s with server-observed lookup/hash; the fragment secret alone opens canonical ciphertext", async kind => {
        const owner = await db.account.create({ data: { ...createSignedAccountContentBinding(), encryptionMode: "e2ee" } });
        const key = new Uint8Array(32).fill(17);
        const lookupId = "lookup-" + crypto.randomUUID();
        const secret = "secret-" + crypto.randomUUID();
        const sealed = new Uint8Array(await sealSessionDataKeyBundleV0({ v: 1, title: "Private document", body: "Private text" }, key));
        const encryptedDataKey = sealPublicShareDataKeyV1({ dataKey: key, secret, randomBytes: length => new Uint8Array(length).fill(23) });
        const storedOwner = JSON.stringify({ t: "encrypted", c: "oRoBAgMEBQYHCAkKCwwNDg8QERITFBUWFxh8aC0+8+YDECLScN6uQTItPyWVR7XbQA==" });
        const subject = kind === "artifact"
            ? await db.artifact.create({ data: { id: crypto.randomUUID(), accountId: owner.id, headerVersion: 1, bodyVersion: 1, header: sealed, body: sealed, dataEncryptionKey: new Uint8Array([31]) } })
            : await db.session.create({ data: { accountId: owner.id, tag: crypto.randomUUID(), encryptionMode: "e2ee", metadata: privacyKit.encodeBase64(sealed), metadataLayoutVersion: 1, ownerMetadata: storedOwner } });
        const headers = { "x-test-user-id": owner.id, ...buildAccountStoredContentCompatibilityHttpHeadersV1(CURRENT_ACCOUNT_STORED_CONTENT_COMPATIBILITY_DECLARATION) };
        if (kind === "session") {
            for (const seq of [1, 2]) await db.sessionMessage.create({ data: { sessionId: subject.id, seq, content: { t: "encrypted", c: privacyKit.encodeBase64(sealed) } } });
            // Canonical reader accepts the released retained bare-ciphertext
            // and ciphertext-object shapes without imposing a current floor.
            await db.$executeRawUnsafe('UPDATE "SessionMessage" SET "content"=? WHERE "sessionId"=? AND "seq"=1', JSON.stringify(privacyKit.encodeBase64(sealed)), subject.id);
            await db.$executeRawUnsafe('UPDATE "SessionMessage" SET "content"=? WHERE "sessionId"=? AND "seq"=2', JSON.stringify({ ciphertext: privacyKit.encodeBase64(sealed) }), subject.id);
        }
        await withAuthenticatedTestApp(publicShareRoutes, async app => {
            const created = await app.inject({ method: "POST", url: "/v1/public-shares", headers, payload: { subject: { kind, id: subject.id }, lookupId, encryptedDataKey, keyDerivation: "fragment_v1", maxUses: 1 } });
            expect(created.statusCode, created.body).toBe(200);
            const stored = await db.publicSessionShare.findUniqueOrThrow({ where: { id: created.json().publicShare.id } });
            expect(Buffer.from(stored.tokenHash).toString("hex")).toBe(createHash("sha256").update(lookupId).digest("hex"));
            expect(JSON.stringify(stored)).not.toContain(secret);
            const envelope = Buffer.from(stored.encryptedDataKey!).toString("base64");
            expect(openPublicShareDataKeyV1({ encryptedDataKey: envelope, secret: lookupId })).toBeNull();
            expect(openPublicShareDataKeyV1({ encryptedDataKey: envelope, secret: Buffer.from(stored.tokenHash).toString("hex") })).toBeNull();
            const readHeaders = { host: new URL(created.json().isolatedOrigin).host };
            const read = await app.inject({ method: "GET", url: `/v1/public-shares/${lookupId}/content?limit=1`, headers: readHeaders });
            expect(read.statusCode, read.body).toBe(200);
            const value = read.json();
            const openedKey = openPublicShareDataKeyV1({ encryptedDataKey: value.encryptedDataKey, secret });
            expect(openedKey).toEqual(key);
            const ciphertext = kind === "artifact" ? value.content.body : value.content.metadata;
            expect(await openSessionDataKeyBundleV0(privacyKit.decodeBase64(ciphertext), openedKey!)).toMatchObject({ status: "authenticated", value: { body: "Private text" } });
            expect((await app.inject({ method: "GET", url: `/v1/public-share/${lookupId}`, headers })).statusCode).toBe(404);
            if (kind === "session") {
                expect(value.content.hasMore).toBe(true);
                const url = `/v1/public-shares/${lookupId}/content?beforeSeq=${value.content.nextBeforeSeq}&limit=1`;
                expect((await app.inject({ method: "GET", url, headers: readHeaders })).statusCode).toBe(404);
                const page = await app.inject({ method: "GET", url, headers: { ...readHeaders, "x-public-share-messages-access-token": value.messagesAccessToken } });
                expect(page.statusCode, page.body).toBe(200);
                expect(page.json().content.messages.map((message: { seq: number }) => message.seq)).toEqual([1]);
                expect((await db.publicSessionShare.findUniqueOrThrow({ where: { id: stored.id } })).useCount).toBe(1);
                expect(await db.publicShareAccessLog.count({ where: { publicShareId: stored.id } })).toBe(1);
            }
        });
    });

    it("enforces the configured shared public visitor rate limit", async () => {
        const previous = { ...process.env };
        process.env.HAPPIER_FEATURE_LOCAL_SERVICES_PUBLIC_PREVIEW__RATE_LIMIT_CHECKER = "fixed_window";
        process.env.HAPPIER_FEATURE_LOCAL_SERVICES_PUBLIC_PREVIEW__RATE_LIMIT_MAX_REQUESTS = "1";
        process.env.HAPPIER_FEATURE_LOCAL_SERVICES_PUBLIC_PREVIEW__RATE_LIMIT_WINDOW_MS = "60000";
        try {
            const owner = await db.account.create({ data: { encryptionMode: "plain" } });
            const artifact = await db.artifact.create({ data: { id: crypto.randomUUID(), accountId: owner.id, headerVersion: 1, bodyVersion: 1,
                header: privacyKit.decodeBase64(encodePlainArtifactStoredContent({ title: "Limited" })), body: privacyKit.decodeBase64(encodePlainArtifactStoredContent({ body: "Text" })), dataEncryptionKey: privacyKit.decodeBase64(ARTIFACT_PLAIN_DATA_KEY_MARKER) } });
            await withAuthenticatedTestApp(publicShareRoutes, async app => {
                const lookupId = crypto.randomUUID();
                const created = await app.inject({ method: "POST", url: "/v1/public-shares", headers: { "x-test-user-id": owner.id }, payload: { subject: { kind: "artifact", id: artifact.id }, lookupId, keyDerivation: "fragment_v1" } });
                expect(created.statusCode, created.body).toBe(200);
                const headers = { host: new URL(created.json().isolatedOrigin).host };
                expect((await app.inject({ method: "GET", url: `/v1/public-shares/${lookupId}/content`, headers })).statusCode).toBe(200);
                expect((await app.inject({ method: "GET", url: `/v1/public-shares/${lookupId}/content`, headers })).statusCode).toBe(429);
                expect((await app.inject({ method: "GET", url: `/s/${lookupId}`, headers })).statusCode).toBe(429);
                expect((await app.inject({ method: "GET", url: `/s/${lookupId}/viewer.js`, headers })).statusCode).toBe(429);
                expect((await db.publicSessionShare.findUniqueOrThrow({ where: { id: created.json().publicShare.id } })).useCount).toBe(1);
            });
        } finally {
            for (const name of ["HAPPIER_FEATURE_LOCAL_SERVICES_PUBLIC_PREVIEW__RATE_LIMIT_CHECKER", "HAPPIER_FEATURE_LOCAL_SERVICES_PUBLIC_PREVIEW__RATE_LIMIT_MAX_REQUESTS", "HAPPIER_FEATURE_LOCAL_SERVICES_PUBLIC_PREVIEW__RATE_LIMIT_WINDOW_MS"]) {
                if (previous[name] === undefined) delete process.env[name]; else process.env[name] = previous[name];
            }
        }
    });


    it("preserves the provenance-pinned legacy token envelope on a privacy-upgraded Session", async () => {
        // Preview asset358465308/source86d1385864dd528b864a8ba72e4c3201f67aece3.
        const token = "released-preview-public-share-vector";
        const envelope = "BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHMJ6ZwXvlgV+Ew6Jtlspr/Sg/SEHyrn8lcqu7Euram/O2gprQ7e4Fe1w3nB1i3RVUrT1cj9PUi4jF5+isG5G/WnzMt54qn3pC0aKPXk8e2w==";
        const key = Uint8Array.from({ length: 32 }, (_, index) => index + 1);
        const owner = await db.account.create({ data: { ...createSignedAccountContentBinding(), encryptionMode: "e2ee" } });
        const session = await db.session.create({ data: { accountId: owner.id, tag: crypto.randomUUID(), encryptionMode: "e2ee", metadata: privacyKit.encodeBase64(new Uint8Array(await sealSessionDataKeyBundleV0({ v: 1 }, key))), metadataLayoutVersion: 1,
            ownerMetadata: JSON.stringify({ t: "encrypted", c: "oRoBAgMEBQYHCAkKCwwNDg8QERITFBUWFxh8aC0+8+YDECLScN6uQTItPyWVR7XbQA==" }) } });
        await db.publicSessionShare.create({ data: { sessionId: session.id, createdByUserId: owner.id, tokenHash: createHash("sha256").update(token).digest(), encryptedDataKey: privacyKit.decodeBase64(envelope) } });
        await withAuthenticatedTestApp(publicShareRoutes, async app => {
            const response = await app.inject({ method: "GET", url: `/v1/public-share/${token}`, headers: buildAccountStoredContentCompatibilityHttpHeadersV1(CURRENT_ACCOUNT_STORED_CONTENT_COMPATIBILITY_DECLARATION) });
            expect(response.statusCode, response.body).toBe(200);
            expect(openPublicShareDataKeyV1({ encryptedDataKey: response.json().encryptedDataKey, secret: token })).toEqual(key);
        });
    });

    it("retains the existing typed privacy-upgrade denial for actual predecessor layout-zero Session metadata", async () => {
        const owner = await db.account.create({ data: { encryptionMode: "plain" } });
        const session = await db.session.create({ data: { accountId: owner.id, tag: crypto.randomUUID(), encryptionMode: "plain", metadata: JSON.stringify({ path: "/owner/private", title: "Predecessor session" }) } });
        const token = crypto.randomUUID();
        const share = await db.publicSessionShare.create({ data: { sessionId: session.id, createdByUserId: owner.id, tokenHash: createHash("sha256").update(token).digest() } });
        await withAuthenticatedTestApp(publicShareRoutes, async app => {
            const response = await app.inject({ method: "GET", url: `/v1/public-share/${token}`, headers: buildAccountStoredContentCompatibilityHttpHeadersV1(CURRENT_ACCOUNT_STORED_CONTENT_COMPATIBILITY_DECLARATION) });
            expect(response.statusCode).toBe(409);
            expect(response.body).not.toContain("/owner/private");
            expect(response.json()).toMatchObject({ code: "metadata_privacy_upgrade_required" });
            expect((await db.publicSessionShare.findUniqueOrThrow({ where: { id: share.id } })).useCount).toBe(0);
        });
    });


    it("rejects retained Session message mode mismatches before public disclosure or use/audit mutation on both read adapters", async () => {
        const owner = await db.account.create({ data: { ...createSignedAccountContentBinding(), encryptionMode: "e2ee" } });
        const key = new Uint8Array(32).fill(9);
        const session = await db.session.create({ data: { accountId: owner.id, tag: crypto.randomUUID(), encryptionMode: "e2ee", metadata: privacyKit.encodeBase64(new Uint8Array(await sealSessionDataKeyBundleV0({ v: 1 }, key))), metadataLayoutVersion: 1,
            ownerMetadata: JSON.stringify({ t: "encrypted", c: "oRoBAgMEBQYHCAkKCwwNDg8QERITFBUWFxh8aC0+8+YDECLScN6uQTItPyWVR7XbQA==" }) } });
        await db.sessionMessage.create({ data: { sessionId: session.id, seq: 1, content: { t: "plain", v: { text: "Retained inconsistent plaintext" } } } });
        const lookupId = crypto.randomUUID();
        const encryptedDataKey = sealPublicShareDataKeyV1({ dataKey: key, secret: "local-fragment-secret", randomBytes: size => new Uint8Array(size).fill(5) });
        await withAuthenticatedTestApp(publicShareRoutes, async app => {
            const headers = { "x-test-user-id": owner.id, ...buildAccountStoredContentCompatibilityHttpHeadersV1(CURRENT_ACCOUNT_STORED_CONTENT_COMPATIBILITY_DECLARATION) };
            const created = await app.inject({ method: "POST", url: "/v1/public-shares", headers, payload: { subject: { kind: "session", id: session.id }, lookupId, encryptedDataKey, keyDerivation: "fragment_v1" } });
            expect(created.statusCode, created.body).toBe(200);
            const response = await app.inject({ method: "GET", url: `/v1/public-shares/${lookupId}/content`, headers: { host: new URL(created.json().isolatedOrigin).host } });
            expect(response.statusCode, response.body).toBe(404);
            expect(response.body).not.toContain("Retained inconsistent plaintext");
            const shareId = created.json().publicShare.id;
            expect((await db.publicSessionShare.findUniqueOrThrow({ where: { id: shareId } })).useCount).toBe(0);
            expect(await db.publicShareAccessLog.count({ where: { publicShareId: shareId } })).toBe(0);
            // Same retained row through the historical route shape must share
            // the canonical projection guard, rather than becoming a bypass.
            await db.publicSessionShare.update({ where: { id: shareId }, data: { keyDerivation: "legacy_token_v1" } });
            const legacy = await app.inject({ method: "GET", url: `/v1/public-share/${lookupId}/messages`, headers });
            expect(legacy.statusCode, legacy.body).toBe(404);
            expect(legacy.body).not.toContain("Retained inconsistent plaintext");
        });
    });


    it("treats derivation transitions as rotations for the canonical primary-Team policy even when lookup hashes are unchanged", async () => {
        const owner = await db.account.create({ data: { ...createSignedAccountContentBinding(), encryptionMode: "e2ee" } });
        const team = await db.team.create({ data: { name: "No external rotations", externalSharingPolicy: "disabled" } });
        await db.teamMembership.create({ data: { teamId: team.id, accountId: owner.id, role: "owner" } });
        const session = await db.session.create({ data: { accountId: owner.id, tag: crypto.randomUUID(), primaryTeamId: team.id, encryptionMode: "plain", metadata: '{"v":1}', metadataLayoutVersion: 1,
            ownerMetadata: JSON.stringify({ t: "encrypted", c: "oRoBAgMEBQYHCAkKCwwNDg8QERITFBUWFxh8aC0+8+YDECLScN6uQTItPyWVR7XbQA==" }) } });
        const lookupId = crypto.randomUUID();
        const expiresAt = new Date(Date.now() + 60_000);
        const share = await db.publicSessionShare.create({ data: { sessionId: session.id, createdByUserId: owner.id, tokenHash: createHash("sha256").update(lookupId).digest(), keyDerivation: "fragment_v1", maxUses: 1, useCount: 1, expiresAt } });
        await withAuthenticatedTestApp(publicShareRoutes, async app => {
            const response = await app.inject({ method: "POST", url: `/v1/sessions/${session.id}/public-share`,
                headers: { "x-test-user-id": owner.id, ...buildAccountStoredContentCompatibilityHttpHeadersV1(CURRENT_ACCOUNT_STORED_CONTENT_COMPATIBILITY_DECLARATION) },
                payload: { token: lookupId, maxUses: 1, expiresAt: expiresAt.getTime() } });
            expect(response.statusCode, response.body).toBe(403);
            expect(response.json()).toEqual({ error: "session_access_external_sharing_disabled" });
            expect(await db.publicSessionShare.findUniqueOrThrow({ where: { id: share.id } })).toMatchObject({ keyDerivation: "fragment_v1", useCount: 1 });
        });
    });

});
