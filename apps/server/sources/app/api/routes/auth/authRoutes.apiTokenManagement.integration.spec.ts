import Fastify from "fastify";
import { randomUUID } from "node:crypto";
import tweetnacl from "tweetnacl";
import * as privacyKit from "privacy-kit";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { serializerCompiler, validatorCompiler, ZodTypeProvider } from "fastify-type-provider-zod";

import {
    signAccountContentKeyBindingV1,
    ACCOUNT_API_TOKEN_ENCRYPTION_ACCESS_HTTP_PATH_V1,
    ACCOUNT_API_TOKENS_CREATE_HTTP_PATH_V1,
    ACCOUNT_API_TOKENS_LIST_HTTP_PATH_V1,
    ACCOUNT_API_TOKENS_REVOKE_ALL_HTTP_PATH_V1,
    ACCOUNT_API_TOKENS_REVOKE_HTTP_PATH_V1,
} from "@happier-dev/protocol";

import { auth } from "@/app/auth/auth";
import { setAccountStatusInTx } from "@/app/home/governance/accountLifecycle";
import { getOrCreateServerIdentityId } from "@/app/serverIdentity/serverIdentity";
import { enableAuthentication } from "@/app/api/utils/enableAuthentication";
import { db } from "@/storage/db";
import { inTx } from "@/storage/inTx";
import { acquireAccountSessionOwnerMetadataFenceInTx } from "@/app/encryption/accountSessionOwnerMetadataFence";
import { createLightSqliteHarness, type LightSqliteHarness } from "@/testkit/lightSqliteHarness";

import { registerAccountApiTokenManagementRoutes } from "./registerAccountApiTokenManagementRoutes";

function createTestApp() {
    const app = Fastify({ logger: false });
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    const typed = app.withTypeProvider<ZodTypeProvider>() as any;
    enableAuthentication(typed);
    registerAccountApiTokenManagementRoutes(typed);
    return typed;
}

function bearer(token: string): Readonly<{ authorization: string }> {
    return { authorization: `Bearer ${token}` };
}

describe("authRoutes (API-token management) (integration)", () => {
    let harness: LightSqliteHarness;

    beforeAll(async () => {
        harness = await createLightSqliteHarness({
            tempDirPrefix: "happier-auth-api-token-management-",
            initAuth: true,
            env: {
                AUTH_REQUIRED_LOGIN_PROVIDERS: "",
                AUTH_LOGIN_ELIGIBILITY_CACHE_TTL_MS: "0",
            },
        });
    }, 120_000);

    afterEach(async () => {
        harness.resetEnv();
        await db.account.deleteMany();
    });

    afterAll(async () => {
        await harness.close();
    });

    it("rejects explicit unattended delegation when the initiating credential has no evidence", async () => {
        const account = await db.account.create({ data: { publicKey: `pat-no-evidence-${Date.now()}` } });
        const signed = await auth.createToken(account.id, undefined, { kind: "account", authority: "present_user" });
        const app = createTestApp();
        await app.ready();
        const response = await app.inject({
            method: "POST",
            url: ACCOUNT_API_TOKENS_CREATE_HTTP_PATH_V1,
            headers: bearer(signed),
            payload: { tokenId: randomUUID(), label: "Must not silently downgrade", authorizeUnattendedTeamAccess: true },
        });
        expect(response.statusCode, response.body).toBe(409);
        expect(response.json()).toEqual({ error: "credential_authentication_evidence_unavailable" });
        expect(await db.accountApiToken.count({ where: { accountId: account.id } })).toBe(0);
        await app.close();
    });

    it("atomically issues sealed access, keeps V1 exact, retrieves only PAT-self and rejects stale bindings", async () => {
        const signing = tweetnacl.sign.keyPair();
        const content = tweetnacl.box.keyPair();
        const account = await db.account.create({ data: {
            publicKey: Buffer.from(signing.publicKey).toString('hex'), encryptionMode: 'e2ee',
            contentPublicKey: new Uint8Array(content.publicKey),
            contentPublicKeySig: new Uint8Array(signAccountContentKeyBindingV1({
                accountSigningSecretKey: signing.secretKey,
                contentPublicKey: content.publicKey,
            })),
        } });
        const tokenId = randomUUID();
        const encryptionAccess = { v: 1, serverIdentityId: await getOrCreateServerIdentityId(),
            contentPublicKey: privacyKit.encodeBase64(new Uint8Array(content.publicKey)),
            wrappedContentPrivateKey: privacyKit.encodeBase64(new Uint8Array(72).fill(7), "base64url") };
        const signed = await auth.createToken(account.id, undefined, {
            kind: 'account',
            authority: 'present_user',
            authenticationEvidence: [{ kind: 'home_method', methodId: 'key_challenge' }],
        });
        const app = createTestApp();
        await app.ready();
        try {
            const create = () => app.inject({
                method: "POST",
                url: ACCOUNT_API_TOKENS_CREATE_HTTP_PATH_V1,
                headers: bearer(signed),
                payload: {
                    tokenId,
                    label: "Encrypted SDK",
                    authorizeUnattendedTeamAccess: true,
                    encryption: { access: encryptionAccess },
                },
            });
            const created = await create();
            expect(created.statusCode).toBe(200);
            const body = created.json();
            expect(body.apiToken.tokenId).toBe(tokenId);
            expect(body.apiToken.hasEncryptionAccess).toBe(true);
            expect(body.apiToken.hasUnattendedTeamAccess).toBe(true);
            expect((await auth.verifyToken(body.token))?.authenticationEvidence).toEqual([
                { kind: 'home_method', methodId: 'key_challenge' },
            ]);
            expect(body.token).toMatch(new RegExp(`^hap_v1_${tokenId}_`));
            const conflict = await create();
            expect(conflict.statusCode).toBe(409);
            expect(conflict.json()).toEqual({ error: 'api_token_id_conflict' });
            expect(await db.accountApiToken.count({ where: { accountId: account.id, id: tokenId } })).toBe(1);
            const list = await app.inject({ method: "POST", url: ACCOUNT_API_TOKENS_LIST_HTTP_PATH_V1, headers: bearer(signed), payload: {} });
            expect(list.json()).toEqual({
                tokens: [{
                    ...body.apiToken,
                    // The preceding PAT verification is a real admitted use and
                    // the canonical token owner records it before list projection.
                    lastUsedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/u),
                }],
            });
            expect((await app.inject({ method: "POST", url: "/v2/auth/api-tokens/create", headers: bearer(signed), payload: { label: "Removed" } })).statusCode).toBe(404);
            expect((await app.inject({ method: "POST", url: `${ACCOUNT_API_TOKENS_LIST_HTTP_PATH_V1}?projectionVersion=2`, headers: bearer(signed), payload: {} })).statusCode).toBe(400);
            for (const payload of [
                { tokenId: randomUUID(), label: "Partial token", encryption: {} },
                { label: "Missing token selector", encryption: { access: encryptionAccess } },
                {
                    tokenId: randomUUID(),
                    label: "Caller-supplied evidence",
                    authenticationEvidence: [{ kind: "home_method", methodId: "key_challenge" }],
                },
            ]) {
                const partial = await app.inject({ method: "POST", url: ACCOUNT_API_TOKENS_CREATE_HTTP_PATH_V1, headers: bearer(signed), payload });
                expect(partial.statusCode).toBe(400);
                expect(partial.json()).toEqual({ error: "invalid_request" });
            }
            const fetch = (token: string, payload = {}) => app.inject({ method: "POST", url: ACCOUNT_API_TOKEN_ENCRYPTION_ACCESS_HTTP_PATH_V1, headers: bearer(token), payload });
            expect((await fetch(body.token)).json()).toEqual({ v: 1, accountId: account.id, tokenId, encryptionAccess });
            expect((await app.inject({ method: "POST", url: ACCOUNT_API_TOKEN_ENCRYPTION_ACCESS_HTTP_PATH_V1, payload: {} })).statusCode).toBe(401);
            expect((await fetch(signed)).json()).toEqual({ error: 'api_token_required' });
            expect((await fetch(body.token, { tokenId: randomUUID() })).statusCode).toBe(400);
            const ordinary = await auth.createApiToken({ accountId: account.id, tokenId: randomUUID(), label: 'Ordinary' });
            const listed = await app.inject({ method: "POST", url: ACCOUNT_API_TOKENS_LIST_HTTP_PATH_V1, headers: bearer(signed), payload: {} });
            expect(listed.json()).toEqual({
                tokens: [
                    expect.objectContaining({ tokenId: ordinary.tokenId, hasEncryptionAccess: false }),
                    expect.objectContaining({ tokenId, hasEncryptionAccess: true }),
                ],
            });
            expect((await fetch(ordinary.token)).json()).toEqual({ error: 'api_token_encryption_unavailable' });
            const crossAccount = await db.account.create({ data: { publicKey: 'other-api-token-account' } });
            const crossToken = await auth.createApiToken({ accountId: crossAccount.id, tokenId: randomUUID(), label: 'Other Account' });
            expect((await fetch(crossToken.token)).json()).toEqual({ error: 'api_token_encryption_unavailable' });
            await auth.signOutEverywhere(account.id);
            expect((await fetch(body.token)).statusCode).toBe(200);
            await db.accountApiToken.update({ where: { id: tokenId }, data: { expiresAt: new Date(0) } });
            expect((await fetch(body.token)).statusCode).toBe(401);
            await db.accountApiToken.update({ where: { id: tokenId }, data: { expiresAt: null } });
            await db.account.update({ where: { id: account.id }, data: { encryptionMode: 'plain' } });
            expect((await fetch(body.token)).json()).toEqual({ error: 'api_token_encryption_stale' });
            await auth.revokeApiToken({ accountId: account.id, tokenId });
            expect((await fetch(body.token)).statusCode).toBe(401);
            await db.account.update({ where: { id: account.id }, data: { encryptionMode: 'e2ee' } });
            const races = await Promise.allSettled([
                auth.createApiToken({ accountId: account.id, tokenId: randomUUID(), label: 'Racing encrypted', encryption: {
                    access: { ...encryptionAccess, v: 1 },
                } }),
                auth.createApiToken({ accountId: account.id, tokenId: randomUUID(), label: 'Racing ordinary' }),
                inTx((tx) => setAccountStatusInTx(tx, { actorAccountId: account.id, targetAccountId: account.id, status: 'disabled', authority: 'account_erasure' })),
            ]);
            expect(races[2]?.status).toBe('fulfilled');
            for (const result of races.slice(0, 2)) {
                if (result.status === 'rejected') expect(result.reason).toMatchObject({ code: 'account-disabled' });
            }
            expect(await auth.listApiTokens(account.id)).toEqual([]);
        } finally { await app.close(); }
    });

    it("never repairs missing E2EE bindings or creates encryption access for Plain Accounts", async () => {
        const signing = tweetnacl.sign.keyPair();
        const access = { v: 1 as const, serverIdentityId: await getOrCreateServerIdentityId(),
            contentPublicKey: privacyKit.encodeBase64(new Uint8Array(tweetnacl.box.keyPair().publicKey)),
            wrappedContentPrivateKey: privacyKit.encodeBase64(new Uint8Array(72), "base64url") };
        for (const encryptionMode of ['plain', 'e2ee']) {
            const account = await db.account.create({ data: { encryptionMode,
                publicKey: encryptionMode === 'plain' ? null : Buffer.from(signing.publicKey).toString('hex') } });
            await expect(auth.createApiToken({ accountId: account.id, tokenId: randomUUID(), label: 'Unavailable',
                encryption: { access } })).rejects.toMatchObject({ code: 'api_token_encryption_not_ready' });
            expect(await db.accountApiToken.count({ where: { accountId: account.id } })).toBe(0);
            expect(await db.account.findUnique({ where: { id: account.id }, select: { contentPublicKey: true, contentPublicKeySig: true } })).toEqual({ contentPublicKey: null, contentPublicKeySig: null });
        }
    });

    it("refuses a mint that was waiting behind a committed Account disable fence", async () => {
        const account = await db.account.create({ data: { publicKey: 'waiting-api-token' } });
        let releaseFence!: () => void;
        let signalFence!: () => void;
        const held = new Promise<void>((resolve) => { signalFence = resolve; });
        const release = new Promise<void>((resolve) => { releaseFence = resolve; });
        const disabling = inTx(async (tx) => {
            await acquireAccountSessionOwnerMetadataFenceInTx(tx, account.id);
            await setAccountStatusInTx(tx, { actorAccountId: account.id, targetAccountId: account.id, status: 'disabled', authority: 'account_erasure' });
            signalFence();
            await release;
        });
        await held;
        const minting = auth.createApiToken({ accountId: account.id, tokenId: randomUUID(), label: 'Waiting' });
        releaseFence();
        await disabling;
        await expect(minting).rejects.toMatchObject({ code: 'account-disabled' });
        expect(await db.accountApiToken.count({ where: { accountId: account.id } })).toBe(0);
    });

    it("Disable deletes PATs and refuses late issuance; Re-enable cannot resurrect them", async () => {
        const owner = await db.account.create({ data: { homeRole: 'owner' } });
        const account = await db.account.create({ data: { publicKey: 'disable-api-token' } });
        const minted = await auth.createApiToken({ accountId: account.id, tokenId: randomUUID(), label: 'Before disable' });
        await inTx((tx) => setAccountStatusInTx(tx, { actorAccountId: owner.id, targetAccountId: account.id, status: 'suspended', authority: 'home_administration' }));
        expect(await auth.listApiTokens(account.id)).toEqual([]);
        await expect(auth.createApiToken({ accountId: account.id, tokenId: randomUUID(), label: 'Late mint' })).rejects.toThrow();
        await inTx((tx) => setAccountStatusInTx(tx, { actorAccountId: owner.id, targetAccountId: account.id, status: 'active', authority: 'home_administration' }));
        expect(await auth.verifyPat(minted.token)).toEqual({ ok: false, reason: 'invalid_token' });
    });

    it("creates a one-time bearer, permits terminal list only, and rejects PATs on every direct management route", async () => {
        const account = await db.account.create({
            data: { publicKey: "api-token-management-owner" },
            select: { id: true },
        });
        const signedToken = await auth.createToken(account.id, undefined, { kind: "account", authority: "present_user" });
        const app = createTestApp();
        await app.ready();

        try {
            const requestedTokenId = randomUUID();
            const created = await app.inject({
                method: "POST",
                url: ACCOUNT_API_TOKENS_CREATE_HTTP_PATH_V1,
                headers: bearer(signedToken),
                payload: { tokenId: requestedTokenId, label: "CI deploy", expiresAt: "2030-08-22T12:00:00.000Z" },
            });

            expect(created.statusCode).toBe(200);
            const createdBody = created.json();
            expect(createdBody).toEqual({
                token: expect.stringMatching(/^hap_v1_[0-9a-f-]{36}_[A-Za-z0-9_-]{43}$/u),
                apiToken: {
                    tokenId: requestedTokenId,
                    label: "CI deploy",
                    displayPrefix: expect.stringMatching(/^hap_v1_[0-9a-f]{8}$/u),
                    createdAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/u),
                    lastUsedAt: null,
                    expiresAt: "2030-08-22T12:00:00.000Z",
                    hasEncryptionAccess: false,
                    hasUnattendedTeamAccess: false,
                },
            });

            const signedList = await app.inject({
                method: "POST",
                url: ACCOUNT_API_TOKENS_LIST_HTTP_PATH_V1,
                headers: bearer(signedToken),
                payload: {},
            });
            expect(signedList.statusCode).toBe(200);
            expect(signedList.json()).toEqual({ tokens: [createdBody.apiToken] });
            expect(signedList.body).not.toContain(createdBody.token);
            expect(signedList.body).not.toContain(createdBody.token.split("_")[3]);

            const [createWithPat, listWithPat, revokeWithPat, revokeAllWithPat] = await Promise.all([
                app.inject({
                    method: "POST",
                    url: ACCOUNT_API_TOKENS_CREATE_HTTP_PATH_V1,
                    headers: bearer(createdBody.token),
                    payload: { tokenId: randomUUID(), label: "forbidden replacement" },
                }),
                app.inject({
                    method: "POST",
                    url: ACCOUNT_API_TOKENS_LIST_HTTP_PATH_V1,
                    headers: bearer(createdBody.token),
                    payload: {},
                }),
                app.inject({
                    method: "POST",
                    url: ACCOUNT_API_TOKENS_REVOKE_HTTP_PATH_V1,
                    headers: bearer(createdBody.token),
                    payload: { tokenId: createdBody.apiToken.tokenId },
                }),
                app.inject({
                    method: "POST",
                    url: ACCOUNT_API_TOKENS_REVOKE_ALL_HTTP_PATH_V1,
                    headers: bearer(createdBody.token),
                    payload: {},
                }),
            ]);

            for (const response of [createWithPat, listWithPat, revokeWithPat, revokeAllWithPat]) {
                expect(response.statusCode).toBe(403);
                expect(response.json()).toEqual({ error: "present_user_required" });
            }

            const terminalToken = await auth.createToken(account.id, { session: "api-token-management-terminal" }, { kind: "terminal", authority: "account_automation" });
            const terminalList = await app.inject({
                method: "POST",
                url: ACCOUNT_API_TOKENS_LIST_HTTP_PATH_V1,
                headers: bearer(terminalToken),
                payload: {},
            });
            expect(terminalList.statusCode).toBe(200);
            expect(terminalList.json()).toEqual({
                tokens: [{
                    ...createdBody.apiToken,
                    // Authentication must inspect a PAT before the shared
                    // direct-route deny applies, so the denied attempt can
                    // legitimately advance this activity projection.
                    lastUsedAt: expect.any(String),
                }],
            });

            const [createWithTerminal, revokeWithTerminal, revokeAllWithTerminal] = await Promise.all([
                app.inject({
                    method: "POST",
                    url: ACCOUNT_API_TOKENS_CREATE_HTTP_PATH_V1,
                    headers: bearer(terminalToken),
                    payload: { tokenId: randomUUID(), label: "terminal replacement" },
                }),
                app.inject({
                    method: "POST",
                    url: ACCOUNT_API_TOKENS_REVOKE_HTTP_PATH_V1,
                    headers: bearer(terminalToken),
                    payload: { tokenId: createdBody.apiToken.tokenId },
                }),
                app.inject({
                    method: "POST",
                    url: ACCOUNT_API_TOKENS_REVOKE_ALL_HTTP_PATH_V1,
                    headers: bearer(terminalToken),
                    payload: {},
                }),
            ]);
            for (const response of [createWithTerminal, revokeWithTerminal, revokeAllWithTerminal]) {
                expect(response.statusCode).toBe(403);
                expect(response.json()).toEqual({ error: "present_user_required" });
            }
        } finally {
            await app.close();
        }
    });

    it("revokes a PAT through the current-Account route and rejects a past expiry as an invalid request", async () => {
        const account = await db.account.create({
            data: { publicKey: "api-token-management-revocation" },
            select: { id: true },
        });
        const signedToken = await auth.createToken(account.id, undefined, { kind: "account", authority: "present_user" });
        const app = createTestApp();
        await app.ready();

        try {
            const created = await app.inject({
                method: "POST",
                url: ACCOUNT_API_TOKENS_CREATE_HTTP_PATH_V1,
                headers: bearer(signedToken),
                payload: { tokenId: randomUUID(), label: "Revocable" },
            });
            expect(created.statusCode).toBe(200);
            const createdBody = created.json();

            expect(await auth.verifyToken(createdBody.token)).toMatchObject({
                userId: account.id,
                authTokenKind: "api_token",
                authority: "account_automation",
            });

            const revoked = await app.inject({
                method: "POST",
                url: ACCOUNT_API_TOKENS_REVOKE_HTTP_PATH_V1,
                headers: bearer(signedToken),
                payload: { tokenId: createdBody.apiToken.tokenId },
            });
            expect(revoked.statusCode).toBe(200);
            expect(revoked.json()).toEqual({ revoked: true });

            expect(await auth.verifyToken(createdBody.token)).toBeNull();

            const expired = await app.inject({
                method: "POST",
                url: ACCOUNT_API_TOKENS_CREATE_HTTP_PATH_V1,
                headers: bearer(signedToken),
                payload: { tokenId: randomUUID(), label: "already expired", expiresAt: "2020-08-22T12:00:00.000Z" },
            });
            expect(expired.statusCode).toBe(400);
            expect(expired.json()).toEqual({ error: "invalid_request" });
        } finally {
            await app.close();
        }
    });
});
