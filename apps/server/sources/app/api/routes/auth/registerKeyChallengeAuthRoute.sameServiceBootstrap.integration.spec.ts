import Fastify from "fastify";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { serializerCompiler, validatorCompiler, ZodTypeProvider } from "fastify-type-provider-zod";
import * as privacyKit from "privacy-kit";
import tweetnacl from "tweetnacl";
import { db } from "@/storage/db";
import { auth } from "@/app/auth/auth";
import { createLightSqliteHarness, type LightSqliteHarness } from "@/testkit/lightSqliteHarness";
import {
    getOrCreateServerIdentityId,
    initializeServerIdentityCache,
} from "@/app/serverIdentity/serverIdentity";
import {
    signAccountContentKeyBindingV1,
    createKeyChallengeV2SigningInput,
} from "@happier-dev/protocol";
import { registerKeyChallengeAuthRoute } from "./registerKeyChallengeAuthRoute";
import {
    accountDirectorySigningKeyMetadata,
    resolveAccountDirectorySigningKeyPair,
} from "@/app/accountDirectory/accountDirectorySigner";
import { resetHomeConnectionDescriptorRevisionOwnerForTests } from "@/app/features/homeConnectionDescriptorPublication";

const DUAL_ROLE_ENV = {
    HAPPIER_AUTH_SIGN_IN_SERVICE_MODE: "self",
    HAPPIER_API_RATE_LIMITS_ENABLED: "0",
    HAPPIER_CANONICAL_SERVER_URL: "https://cloud.example.test",
    HAPPIER_PUBLIC_SERVER_URL: "https://cloud.example.test",
};

function createTestApp() {
    const app = Fastify({ logger: false });
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    return app.withTypeProvider<ZodTypeProvider>() as any;
}

function contentKeyBinding(params: Readonly<{
    signingKeyPair: tweetnacl.SignKeyPair;
    contentKeyPair: tweetnacl.BoxKeyPair;
}>) {

    const signature = signAccountContentKeyBindingV1({
        accountSigningSecretKey: params.signingKeyPair.secretKey,
        contentPublicKey: params.contentKeyPair.publicKey,
    });
    return {
        contentPublicKey: privacyKit.encodeBase64(new Uint8Array(params.contentKeyPair.publicKey)),
        contentPublicKeySig: privacyKit.encodeBase64(new Uint8Array(signature)),
    };
}

async function authenticateWithKey(params: Readonly<{
    app: any;
    signingKeyPair: tweetnacl.SignKeyPair;
    directoryPurpose: boolean;
    content?: ReturnType<typeof contentKeyBinding>;
}>): Promise<{ statusCode: number; json: any }> {
    const challengeResponse = await params.app.inject({
        method: "POST",
        url: params.directoryPurpose ? "/v1/auth/account-directory/challenge" : "/v1/auth/challenge",
        payload: {},
    });
    expect(challengeResponse.statusCode).toBe(200);
    const challenge = challengeResponse.json();
    const signingInput = createKeyChallengeV2SigningInput({
        challengeId: challenge.challengeId,
        nonce: challenge.nonce,
        issuedAt: challenge.issuedAt,
        expiresAt: challenge.expiresAt,
        audience: challenge.audience,
    });
    const signature = tweetnacl.sign.detached(signingInput, params.signingKeyPair.secretKey);
    const response = await params.app.inject({
        method: "POST",
        url: params.directoryPurpose ? "/v1/auth/account-directory" : "/v1/auth",
        payload: {
            challengeId: challenge.challengeId,
            publicKey: privacyKit.encodeBase64(new Uint8Array(params.signingKeyPair.publicKey)),
            signature: privacyKit.encodeBase64(new Uint8Array(signature)),
            ...(params.content ?? {}),
        },
    });
    return { statusCode: response.statusCode, json: response.json() };
}

describe("key-challenge account_directory same-service bootstrap (integration)", () => {
    let harness: LightSqliteHarness;
    let app: any;

    beforeAll(async () => {
        harness = await createLightSqliteHarness({
            tempDirPrefix: "happier-auth-key-challenge-same-service-",
            initAuth: true,
            env: DUAL_ROLE_ENV,
        });
        await initializeServerIdentityCache(process.env);
    }, 120_000);

    beforeEach(async () => {
        harness.resetEnv(DUAL_ROLE_ENV);
        resetHomeConnectionDescriptorRevisionOwnerForTests();
        app = createTestApp();
        registerKeyChallengeAuthRoute(app);
        await app.ready();
    });

    afterEach(async () => {
        await app?.close();
        await db.keyChallengeV2.deleteMany();
        await db.accountDirectoryLink.deleteMany();
        await db.accountHomeDirectoryEntry.deleteMany();
        await db.account.deleteMany();
    });

    afterAll(async () => {
        await harness.close();
    });

    it("bootstraps the same-service Home for a fresh directory key account and returns only the restricted credential", async () => {
        const serverIdentityId = await getOrCreateServerIdentityId(process.env);
        const signing = accountDirectorySigningKeyMetadata(process.env);
        const signingKeyPair = tweetnacl.sign.keyPair();
        const content = contentKeyBinding({
            signingKeyPair,
            contentKeyPair: tweetnacl.box.keyPair(),
        });

        const { statusCode, json } = await authenticateWithKey({
            app,
            signingKeyPair,
            directoryPurpose: true,
            content,
        });

        expect(statusCode).toBe(200);
        expect(Object.keys(json).sort()).toEqual(["success", "token"]);
        const verified = await auth.verifyToken(json.token);
        expect(verified?.authTokenKind).toBe("account_directory");
        expect(verified?.authority).toBe("present_user");

        const account = await db.account.findUniqueOrThrow({ where: { id: verified!.userId }, select: { id: true } });
        const entries = await db.accountHomeDirectoryEntry.findMany({ where: { accountId: account.id } });
        expect(entries).toHaveLength(1);
        expect(entries[0]!.homeServerIdentityId).toBe(serverIdentityId);

        const links = await db.accountDirectoryLink.findMany({ where: { accountId: account.id } });
        expect(links).toHaveLength(1);
        expect(links[0]!.issuerServerIdentityId).toBe(serverIdentityId);
        expect(links[0]!.issuerSubjectId).toBe(account.id);
        expect(links[0]!.issuerSigningKeyId).toBe(signing.keyId);
        expect(Buffer.from(links[0]!.issuerSigningPublicKey)).toEqual(
            Buffer.from(resolveAccountDirectorySigningKeyPair(process.env).publicKey),
        );

        const persisted = await db.account.findUniqueOrThrow({
            where: { id: account.id },
            select: { preferredHomeServerIdentityId: true },
        });
        expect(persisted.preferredHomeServerIdentityId).toBe(serverIdentityId);
    });

    it("never bootstraps trust for an ordinary Home key account on the same dual-role server", async () => {
        const signingKeyPair = tweetnacl.sign.keyPair();
        const content = contentKeyBinding({
            signingKeyPair,
            contentKeyPair: tweetnacl.box.keyPair(),
        });

        const { statusCode, json } = await authenticateWithKey({
            app,
            signingKeyPair,
            directoryPurpose: false,
            content,
        });

        expect(statusCode).toBe(200);
        expect(json.success).toBe(true);
        const verified = await auth.verifyToken(json.token);
        expect(verified?.authTokenKind).toBe("account");
        const account = await db.account.findUniqueOrThrow({ where: { id: verified!.userId }, select: { id: true } });
        expect(await db.accountHomeDirectoryEntry.count({ where: { accountId: account.id } })).toBe(0);
        expect(await db.accountDirectoryLink.count({ where: { accountId: account.id } })).toBe(0);
        const persisted = await db.account.findUniqueOrThrow({
            where: { id: account.id },
            select: { preferredHomeServerIdentityId: true },
        });
        expect(persisted.preferredHomeServerIdentityId).toBeNull();
    });

    it("links an existing unlinked Account on deliberate self Directory authentication", async () => {
        const serverIdentityId = await getOrCreateServerIdentityId(process.env);
        const signingKeyPair = tweetnacl.sign.keyPair();
        const content = contentKeyBinding({
            signingKeyPair,
            contentKeyPair: tweetnacl.box.keyPair(),
        });
        const publicKeyHex = privacyKit.encodeHex(new Uint8Array(signingKeyPair.publicKey));
        const existing = await db.account.create({
            data: { publicKey: publicKeyHex, encryptionMode: "plain" },
            select: { id: true },
        });

        const { statusCode, json } = await authenticateWithKey({
            app,
            signingKeyPair,
            directoryPurpose: true,
        });

        expect(statusCode).toBe(200);
        expect(json.success).toBe(true);
        const verified = await auth.verifyToken(json.token);
        expect(verified?.userId).toBe(existing.id);
        expect(verified?.authTokenKind).toBe("account_directory");
        expect(await db.accountHomeDirectoryEntry.count({ where: { accountId: existing.id } })).toBe(1);
        expect(await db.accountDirectoryLink.count({ where: { accountId: existing.id } })).toBe(1);
        const persisted = await db.account.findUniqueOrThrow({
            where: { id: existing.id },
            select: { preferredHomeServerIdentityId: true },
        });
        expect(persisted.preferredHomeServerIdentityId).toBe(serverIdentityId);
    });

    it("returns a typed conflict without replacing an existing different self link", async () => {
        const serverIdentityId = await getOrCreateServerIdentityId(process.env);
        const signingKeyPair = tweetnacl.sign.keyPair();
        const signing = accountDirectorySigningKeyMetadata(process.env);
        const account = await db.account.create({
            data: {
                publicKey: privacyKit.encodeHex(new Uint8Array(signingKeyPair.publicKey)),
                encryptionMode: "plain",
            },
            select: { id: true },
        });
        await db.accountDirectoryLink.create({
            data: {
                accountId: account.id,
                issuerServerIdentityId: serverIdentityId,
                issuerSubjectId: "another-subject",
                issuerSigningKeyId: signing.keyId,
                issuerSigningPublicKey: Buffer.from(resolveAccountDirectorySigningKeyPair(process.env).publicKey),
            },
        });
        const result = await authenticateWithKey({ app, signingKeyPair, directoryPurpose: true });
        expect(result.statusCode).toBe(409);
        expect(result.json).toEqual({ error: "invalid_request" });
        expect(await db.accountHomeDirectoryEntry.count({ where: { accountId: account.id } })).toBe(0);
        expect(await db.accountDirectoryLink.findFirst({ where: { accountId: account.id } })).toMatchObject({
            issuerSubjectId: "another-subject",
        });
    });

    it("repeats directory key authentication idempotently with exactly one entry and one pinned link", async () => {
        const serverIdentityId = await getOrCreateServerIdentityId(process.env);
        const signingKeyPair = tweetnacl.sign.keyPair();
        const content = contentKeyBinding({
            signingKeyPair,
            contentKeyPair: tweetnacl.box.keyPair(),
        });

        const first = await authenticateWithKey({ app, signingKeyPair, directoryPurpose: true, content });
        expect(first.statusCode).toBe(200);
        const second = await authenticateWithKey({ app, signingKeyPair, directoryPurpose: true, content });
        expect(second.statusCode).toBe(200);

        const verified = await auth.verifyToken(second.json.token);
        const account = await db.account.findUniqueOrThrow({ where: { id: verified!.userId }, select: { id: true } });
        expect(await db.accountHomeDirectoryEntry.count({ where: { accountId: account.id } })).toBe(1);
        const links = await db.accountDirectoryLink.findMany({ where: { accountId: account.id } });
        expect(links).toHaveLength(1);
        expect(links[0]!.issuerServerIdentityId).toBe(serverIdentityId);
    });
});
