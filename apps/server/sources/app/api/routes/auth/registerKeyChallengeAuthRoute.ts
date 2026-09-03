import * as privacyKit from "privacy-kit";
import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { db } from "@/storage/db";
import { auth } from "@/app/auth/auth";
import {
    resolveAuthKeyChallengeV2Requirement,
    resolveAuthPolicyFromEnv,
} from "@/app/auth/authPolicy";
import { enforceLoginEligibility } from "@/app/auth/enforceLoginEligibility";
import { type Fastify } from "../../types";
import { readEncryptionFeatureEnv } from "@/app/features/catalog/readFeatureEnv";
import {
    AUTH_KEY_CHALLENGE_V2_ERROR_CODES,
    canonicalizeKeyChallengeV2AudienceOrigin,
    createKeyChallengeV2SigningInput,
    KeyChallengeAuthRequestSchema,
    KeyChallengeV2IssueRequestSchema,
    KeyChallengeV2IssueResponseSchema,
    createExpectedAccountKeyChallengeSigningInputV1,
    isKeyChallengeV2AuthRequest,
    resolveEffectiveDefaultAccountEncryptionMode,
} from "@happier-dev/protocol";
import { shouldDenyPublicSignupProvisioningAction } from "@/app/integrations/publicUrl/publicSignupProvisioningPolicy";
import {
    admitAccountContentKey,
    deriveAccountEncryptionCurrentnessFromRow,
    isAccountContentKeyBindingRecoveryRequired,
    verifyAccountContentKeyBinding,
    type VerifiedAccountContentKeyBinding,
} from "@/app/encryption/accountContentKeyAdmission";
import { resolveApiHotEndpointRateLimit } from "@/app/api/utils/apiRateLimitCatalog";
import { resolveConfiguredCanonicalServerUrl } from "@/app/serverUrls/effectiveServerUrls";
import { getOrCreateServerIdentityId } from "@/app/serverIdentity/serverIdentity";
import {
    ensureSameServiceHomeBootstrapForNewAccountInTx,
    prepareSameServiceHomeBootstrapForNewAccount,
} from "@/app/accountDirectory/accountDirectoryService";
import { inTx } from "@/storage/inTx";

const KEY_CHALLENGE_V2_TTL_MS = 5 * 60_000;
const ACCOUNT_DIRECTORY_CHALLENGE_ID_PREFIX = "account_directory:";
const KeyChallengeV2UnavailableResponseSchema = z.object({
    error: z.literal(AUTH_KEY_CHALLENGE_V2_ERROR_CODES.unavailable),
});
const KeyChallengeV2RequiredResponseSchema = z.object({
    error: z.literal(AUTH_KEY_CHALLENGE_V2_ERROR_CODES.required),
});
const KeyChallengeAuthResponseSchemas: Record<number, z.ZodTypeAny> = {
    426: KeyChallengeV2RequiredResponseSchema,
};

/**
 * The challenge audience is derived exclusively from the configured stable
 * server URL. Request Host, optional public-ingress metadata, and ephemeral
 * runtime/Iroh origins are deliberately not inputs to this function.
 */
export function resolveStableKeyChallengeV2AudienceOrigin(
    env: NodeJS.ProcessEnv,
): string | null {
    return canonicalizeKeyChallengeV2AudienceOrigin(
        resolveConfiguredCanonicalServerUrl(env),
    );
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
    return left.byteLength === right.byteLength
        && timingSafeEqual(
            Buffer.from(
                left.buffer,
                left.byteOffset,
                left.byteLength,
            ),
            Buffer.from(
                right.buffer,
                right.byteOffset,
                right.byteLength,
            ),
        );
}

export function registerKeyChallengeAuthRoute(app: Fastify): void {
    const ordinaryHomeRequiresKeyChallengeV2 =
        resolveAuthKeyChallengeV2Requirement(process.env);
    registerKeyChallengeAuthRoutesForPurpose(app, {
        challengePath: "/v1/auth/challenge",
        redeemPath: "/v1/auth",
        tokenKind: "account",
        requireKeyChallengeV2: ordinaryHomeRequiresKeyChallengeV2,
    });
    registerKeyChallengeAuthRoutesForPurpose(app, {
        challengePath: "/v1/auth/account-directory/challenge",
        redeemPath: "/v1/auth/account-directory",
        tokenKind: "account_directory",
        requireKeyChallengeV2: true,
    });
}

type KeyChallengeRoutePurpose = Readonly<{
    challengePath: string;
    redeemPath: string;
    tokenKind: "account" | "account_directory";
    requireKeyChallengeV2: boolean;
}>;

function isChallengeIdForPurpose(
    challengeId: string,
    tokenKind: KeyChallengeRoutePurpose["tokenKind"],
): boolean {
    const isAccountDirectoryChallenge = challengeId.startsWith(
        ACCOUNT_DIRECTORY_CHALLENGE_ID_PREFIX,
    );
    return tokenKind === "account_directory"
        ? isAccountDirectoryChallenge
        : !isAccountDirectoryChallenge;
}

function registerKeyChallengeAuthRoutesForPurpose(
    app: Fastify,
    purpose: KeyChallengeRoutePurpose,
): void {
    app.post(purpose.challengePath, {
        config: {
            rateLimit: resolveApiHotEndpointRateLimit(process.env, "auth.keyChallenge.issue"),
        },
        schema: {
            body: KeyChallengeV2IssueRequestSchema,
            response: {
                200: KeyChallengeV2IssueResponseSchema,
                503: KeyChallengeV2UnavailableResponseSchema,
            },
        },
    }, async (request, reply) => {
        const audienceOrigin = resolveStableKeyChallengeV2AudienceOrigin(process.env);
        if (!audienceOrigin) {
            return reply.code(503).send({ error: AUTH_KEY_CHALLENGE_V2_ERROR_CODES.unavailable });
        }

        const issuedAt = new Date();
        await db.keyChallengeV2.deleteMany({
            where: { expiresAt: { lte: issuedAt } },
        }).catch(() => {
            // Expiry reclamation is opportunistic; issuance remains available when it loses a cleanup race.
        });
        const expiresAt = new Date(issuedAt.getTime() + KEY_CHALLENGE_V2_TTL_MS);
        const audienceServerIdentityId = await getOrCreateServerIdentityId(process.env);
        const challenge = await db.keyChallengeV2.create({
            data: {
                ...(purpose.tokenKind === "account_directory"
                    ? { id: `${ACCOUNT_DIRECTORY_CHALLENGE_ID_PREFIX}${randomUUID()}` }
                    : {}),
                nonce: privacyKit.encodeBase64(new Uint8Array(randomBytes(32))),
                issuedAt,
                expiresAt,
                audienceOrigin,
                audienceServerIdentityId,
                ...(request.body.expectedAccountId
                    ? { expectedAccountId: request.body.expectedAccountId }
                    : {}),
            },
            select: {
                id: true,
                nonce: true,
                issuedAt: true,
                expiresAt: true,
                audienceOrigin: true,
                audienceServerIdentityId: true,
            },
        });
        if (!challenge.audienceServerIdentityId) {
            return reply.code(503).send({ error: AUTH_KEY_CHALLENGE_V2_ERROR_CODES.unavailable });
        }
        return reply.send({
            challengeId: challenge.id,
            nonce: challenge.nonce,
            issuedAt: challenge.issuedAt.toISOString(),
            expiresAt: challenge.expiresAt.toISOString(),
            audience: {
                origin: challenge.audienceOrigin,
                serverIdentityId: challenge.audienceServerIdentityId,
            },
        });
    });

    app.post(purpose.redeemPath, {
        config: {
            rateLimit: resolveApiHotEndpointRateLimit(process.env, "auth.keyChallenge.redeem"),
        },
        schema: {
            body: KeyChallengeAuthRequestSchema,
            response: KeyChallengeAuthResponseSchemas,
        }
    }, async (request, reply) => {
        const authRequest = request.body;
        const isV2AuthRequest = isKeyChallengeV2AuthRequest(authRequest);
        if (!isV2AuthRequest && purpose.tokenKind === "account_directory") {
            return reply.code(426).send({ error: AUTH_KEY_CHALLENGE_V2_ERROR_CODES.required });
        }
        const tweetnacl = (await import("tweetnacl")).default;
        if (String(authRequest.publicKey).length > 512) {
            return reply.code(401).send({ error: 'Invalid public key' });
        }
        let publicKey: ReturnType<typeof privacyKit.decodeBase64>;
        try {
            publicKey = privacyKit.decodeBase64(authRequest.publicKey);
        } catch {
            return reply.code(401).send({ error: 'Invalid public key' });
        }
        if (String(authRequest.signature).length > 4096) {
            return reply.code(401).send({ error: 'Invalid signature' });
        }
        let signature: Uint8Array;
        try {
            signature = privacyKit.decodeBase64(authRequest.signature);
        } catch {
            return reply.code(401).send({ error: 'Invalid signature' });
        }
        if (publicKey.length !== tweetnacl.sign.publicKeyLength) {
            return reply.code(401).send({ error: 'Invalid public key' });
        }
        if (signature.length !== tweetnacl.sign.signatureLength) {
            return reply.code(401).send({ error: 'Invalid signature' });
        }

        let signingInput: Uint8Array;
        let v2ChallengeId: string | null = null;
        if (isV2AuthRequest) {
            if (!isChallengeIdForPurpose(authRequest.challengeId, purpose.tokenKind)) {
                return reply.code(401).send({ error: 'Invalid signature' });
            }
            const challenge = await db.keyChallengeV2.findUnique({
                where: { id: authRequest.challengeId },
                select: {
                    id: true,
                    nonce: true,
                    issuedAt: true,
                    expiresAt: true,
                    audienceOrigin: true,
                    audienceServerIdentityId: true,
                    expectedAccountId: true,
                    consumedAt: true,
                },
            });
            const now = new Date();
            const configuredAudienceOrigin = resolveStableKeyChallengeV2AudienceOrigin(process.env);
            const currentServerIdentityId = configuredAudienceOrigin
                ? await getOrCreateServerIdentityId(process.env)
                : null;
            if (
                !challenge
                || challenge.consumedAt
                || challenge.expiresAt.getTime() <= now.getTime()
                || !configuredAudienceOrigin
                || challenge.audienceOrigin !== configuredAudienceOrigin
                || !currentServerIdentityId
                || !challenge.audienceServerIdentityId
                || challenge.audienceServerIdentityId !== currentServerIdentityId
                || (challenge.expectedAccountId ?? undefined)
                    !== (authRequest.expectedAccountId ?? undefined)
            ) {
                return reply.code(401).send({ error: 'Invalid signature' });
            }
            signingInput = createKeyChallengeV2SigningInput({
                challengeId: challenge.id,
                nonce: challenge.nonce,
                issuedAt: challenge.issuedAt.toISOString(),
                expiresAt: challenge.expiresAt.toISOString(),
                audience: {
                    origin: challenge.audienceOrigin,
                    serverIdentityId: challenge.audienceServerIdentityId,
                },
                ...(challenge.expectedAccountId
                    ? { expectedAccountId: challenge.expectedAccountId }
                    : {}),
            });
            v2ChallengeId = challenge.id;
        } else {
            // COMPAT(key-challenge-v1): retain the raw assertion while an immutable supported
            // stable/preview client artifact or the current remote-dev predecessor can emit it.
            // Remove only after that release frontier no longer needs v1; clients do not
            // advertise their challenge version. Return the typed update requirement here then.
            if (purpose.requireKeyChallengeV2) {
                return reply.code(426).send({ error: AUTH_KEY_CHALLENGE_V2_ERROR_CODES.required });
            }
            if (String(authRequest.challenge).length > 4096) {
                return reply.code(401).send({ error: 'Invalid signature' });
            }
            let challenge: Uint8Array;
            try {
                challenge = privacyKit.decodeBase64(authRequest.challenge);
            } catch {
                return reply.code(401).send({ error: 'Invalid signature' });
            }
            signingInput = authRequest.expectedAccountId
                ? createExpectedAccountKeyChallengeSigningInputV1({
                    challenge,
                    expectedAccountId: authRequest.expectedAccountId,
                })
                : challenge;
        }
        const isValid = tweetnacl.sign.detached.verify(
            signingInput,
            signature,
            publicKey,
        );
        if (!isValid) {
            return reply.code(401).send({ error: 'Invalid signature' });
        }
        if (v2ChallengeId) {
            const consumed = await db.keyChallengeV2.updateMany({
                where: {
                    id: v2ChallengeId,
                    consumedAt: null,
                    expiresAt: { gt: new Date() },
                },
                data: { consumedAt: new Date() },
            });
            if (consumed.count !== 1) {
                return reply.code(401).send({ error: 'Invalid signature' });
            }
        }

        // Defensive: /v1/auth is often the first route hit on a fresh server, and some
        // dev/test entrypoints may register routes without going through startServer().
        // Ensure auth is initialized before issuing tokens.
        await auth.init();

        const authPolicy = resolveAuthPolicyFromEnv(process.env);

        let contentKeyBinding: VerifiedAccountContentKeyBinding | null = null;
        if (request.body.contentPublicKey && request.body.contentPublicKeySig) {
            let contentPublicKey: Uint8Array;
            let contentPublicKeySignature: Uint8Array;
            try {
                contentPublicKey = privacyKit.decodeBase64(request.body.contentPublicKey);
                contentPublicKeySignature = privacyKit.decodeBase64(
                    request.body.contentPublicKeySig,
                );
            } catch {
                if (request.body.expectedAccountId) {
                    return reply.code(401).send({
                        error: "Invalid token",
                    });
                }
                return reply.code(400).send({ error: 'Invalid content key encoding' });
            }
            contentKeyBinding = verifyAccountContentKeyBinding({
                accountSigningPublicKey: publicKey,
                contentPublicKey,
                contentPublicKeySignature,
            });
            if (!contentKeyBinding) {
                if (request.body.expectedAccountId) {
                    return reply.code(401).send({
                        error: "Invalid token",
                    });
                }
                return reply.code(400).send({ error: 'Invalid contentPublicKeySig' });
            }
        }

        const publicKeyHex = privacyKit.encodeHex(publicKey);
        if (request.body.expectedAccountId) {
            const expectedAccount = await db.account.findUnique({
                where: { publicKey: publicKeyHex },
                select: {
                    id: true,
                    encryptionMode: true,
                    publicKey: true,
                    contentPublicKey: true,
                    contentPublicKeySig: true,
                },
            });
            const expectedCurrentness =
                expectedAccount
                    ? deriveAccountEncryptionCurrentnessFromRow(
                        expectedAccount,
                    )
                    : null;
            if (
                !expectedAccount
                || expectedAccount.id
                    !== request.body.expectedAccountId
                || expectedAccount.publicKey !== publicKeyHex
                || expectedCurrentness?.status !== "ready"
                || expectedCurrentness.currentness
                    .encryptionMode !== "e2ee"
                || !contentKeyBinding
                || !expectedCurrentness.currentness
                    .contentPublicKey
                || !expectedCurrentness.currentness
                    .contentPublicKeySignature
                || !bytesEqual(
                    expectedCurrentness.currentness
                        .contentPublicKey,
                    contentKeyBinding.contentPublicKey,
                )
                || !bytesEqual(
                    expectedCurrentness.currentness
                        .contentPublicKeySignature,
                    contentKeyBinding.contentPublicKeySignature,
                )
            ) {
                return reply.code(401).send({
                    error: "Invalid token",
                });
            }
            const eligibility = await enforceLoginEligibility({
                accountId: expectedAccount.id,
                env: process.env,
            });
            if (!eligibility.ok) {
                return reply.code(401).send({
                    error: "Invalid token",
                });
            }
            return reply.send({
                success: true,
                token: await auth.createToken(
                    expectedAccount.id,
                    undefined,
                    {
                        kind: purpose.tokenKind,
                        authority: "present_user",
                    },
                ),
            });
        }

        const encryptionFeatureEnv = readEncryptionFeatureEnv(process.env);
        const effectiveDefaultEncryptionMode = resolveEffectiveDefaultAccountEncryptionMode(
            encryptionFeatureEnv.storagePolicy,
            encryptionFeatureEnv.defaultAccountMode,
        );

        const existingAccount = await db.account.findUnique({
            where: { publicKey: publicKeyHex },
            select: {
                id: true,
                publicKey: true,
                encryptionMode: true,
                contentPublicKey: true,
                contentPublicKeySig: true,
            },
        });
        if (!existingAccount) {
            const blocked = shouldDenyPublicSignupProvisioningAction({
                env: process.env,
                requestIp: request.ip,
                methodId: "key_challenge",
                mode: "keyed",
            });
            if (blocked || !authPolicy.anonymousSignupEnabled) {
                return reply.code(403).send({ error: "signup-disabled" });
            }
        }

        let canRepairMissingE2eeContentKeyBinding = false;
        if (existingAccount) {
            const existingCurrentness =
                deriveAccountEncryptionCurrentnessFromRow(
                    existingAccount,
                );
            canRepairMissingE2eeContentKeyBinding =
                contentKeyBinding !== null
                && isAccountContentKeyBindingRecoveryRequired(
                    existingAccount,
                    existingCurrentness,
                );
            if (
                existingCurrentness.status !== "ready"
                && !canRepairMissingE2eeContentKeyBinding
            ) {
                return reply.code(401).send({
                    error: "Invalid token",
                });
            }
            const eligibility = await enforceLoginEligibility({ accountId: existingAccount.id, env: process.env });
            if (!eligibility.ok) {
                // Eligibility can fail closed with 401 (invalid-token) when the account cannot be validated.
                // We intentionally surface a generic auth-style error for 401 to avoid leaking internal details.
                if (eligibility.statusCode === 401) return reply.code(401).send({ error: "Invalid token" });
                if (eligibility.statusCode === 403 && eligibility.error === "provider-required") {
                    return reply.code(403).send({ error: "provider-required", provider: eligibility.provider });
                }
                return reply.code(eligibility.statusCode).send({ error: eligibility.error });
            }
        }

        const sameServiceBootstrapPreparation =
            !existingAccount && purpose.tokenKind === "account_directory"
                ? await prepareSameServiceHomeBootstrapForNewAccount({})
                : null;
        if (
            sameServiceBootstrapPreparation?.status === "not_dual_role"
            && sameServiceBootstrapPreparation.reason === "server_identity_mismatch"
        ) {
            throw new Error("Same-service Home descriptor identity mismatch");
        }

        // Existing-account authentication remains read-mostly. Fresh Account
        // creation, same-service composition, and token issuance share one
        // transaction, so the exact write winner exclusively owns the
        // fresh-only bootstrap authorization.
        const freshAccountWrite = existingAccount
            ? null
            : await inTx(async (tx) => {
                const proposedAccountId = randomUUID();
                const user = await tx.account.upsert({
                    where: { publicKey: publicKeyHex },
                    update: {},
                    create: {
                        id: proposedAccountId,
                        publicKey: publicKeyHex,
                        encryptionMode: effectiveDefaultEncryptionMode,
                        ...(contentKeyBinding ? {
                            contentPublicKey: contentKeyBinding.contentPublicKey,
                            contentPublicKeySig: contentKeyBinding.contentPublicKeySignature,
                        } : {}),
                    },
                });
                const createdByThisRequest = user.id === proposedAccountId;
                if (contentKeyBinding) {
                    const admission = await admitAccountContentKey(tx, {
                        accountId: user.id,
                        contentPublicKey: contentKeyBinding.contentPublicKey,
                        contentPublicKeySignature: contentKeyBinding.contentPublicKeySignature,
                    });
                    if (admission.status === "key_mismatch") {
                        return { status: "key_mismatch" as const };
                    }
                    if (
                        admission.status === "account_not_found"
                        || admission.status === "invalid_binding"
                    ) {
                        return { status: "invalid_binding" as const };
                    }
                }
                if (createdByThisRequest && sameServiceBootstrapPreparation) {
                    await ensureSameServiceHomeBootstrapForNewAccountInTx(tx, {
                        accountId: user.id,
                        preparation: sameServiceBootstrapPreparation,
                    });
                }
                const token = await auth.createTokenInTx(
                    tx,
                    user.id,
                    undefined,
                    { kind: purpose.tokenKind, authority: "present_user" },
                );
                return { status: "written" as const, user, token };
            });
        if (freshAccountWrite?.status === "key_mismatch") {
            return reply.code(409).send({ error: "content_public_key_mismatch" });
        }
        if (freshAccountWrite?.status === "invalid_binding") {
            return reply.code(400).send({ error: "Invalid contentPublicKeySig" });
        }
        const user = existingAccount ?? freshAccountWrite!.user;
        if (contentKeyBinding && existingAccount) {
            const admission = await admitAccountContentKey(db, {
                accountId: user.id,
                contentPublicKey:
                    contentKeyBinding.contentPublicKey,
                contentPublicKeySignature:
                    contentKeyBinding.contentPublicKeySignature,
            });
            if (admission.status === "key_mismatch") {
                return reply.code(409).send({
                    error: "content_public_key_mismatch",
                });
            }
            if (
                admission.status === "account_not_found"
                || admission.status === "invalid_binding"
            ) {
                return reply.code(400).send({
                    error: "Invalid contentPublicKeySig",
                });
            }
        }
        if (canRepairMissingE2eeContentKeyBinding) {
            if (!contentKeyBinding) {
                return reply.code(401).send({
                    error: "Invalid token",
                });
            }
            const repairedAccount = await db.account.findUnique({
                where: { id: user.id },
                select: {
                    publicKey: true,
                    encryptionMode: true,
                    contentPublicKey: true,
                    contentPublicKeySig: true,
                },
            });
            const repairedCurrentness = repairedAccount
                ? deriveAccountEncryptionCurrentnessFromRow(repairedAccount)
                : null;
            if (
                !repairedCurrentness
                || repairedCurrentness.status !== "ready"
                || repairedCurrentness.currentness.encryptionMode !== "e2ee"
                || repairedCurrentness.currentness.contentPublicKey === null
                || repairedCurrentness.currentness.contentPublicKeySignature === null
                || !bytesEqual(
                    repairedCurrentness.currentness.contentPublicKey,
                    contentKeyBinding.contentPublicKey,
                )
                || !bytesEqual(
                    repairedCurrentness.currentness.contentPublicKeySignature,
                    contentKeyBinding.contentPublicKeySignature,
                )
            ) {
                return reply.code(401).send({
                    error: "Invalid token",
                });
            }
        }
        return reply.send({
            success: true,
            token: freshAccountWrite?.status === "written"
                ? freshAccountWrite.token
                : await auth.createToken(
                    user.id,
                    undefined,
                    {
                        kind: purpose.tokenKind,
                        authority: "present_user",
                    },
                ),
        });
    });
}
