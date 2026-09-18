import * as privacyKit from "privacy-kit";
import { randomUUID, timingSafeEqual } from "node:crypto";
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
import {
    ensureSameServiceHomeEntryInTx,
    prepareSameServiceHomeEntry,
} from "@/app/accountDirectory/accountDirectoryService";
import { accountDirectoryAuthErrorHandler } from "@/app/accountDirectory/accountDirectoryErrors";
import { inTx } from "@/storage/inTx";
import { provisionFreshAccountInTx } from "@/app/auth/provisionFreshAccountInTx";
import {
    isEffectiveHomeAuthMethodActionEnabled,
    isEffectiveHomeAuthMethodActionEnabledInTx,
} from "@/app/auth/methods/effectiveHomeAuthMethods";
import {
    TeamInvitationAcceptanceAbort,
} from "@/app/teams/invitations/accept";
import {
    requireTeamInvitationFreshAccountAdmissionInTx,
    TeamInvitationFreshAccountAdmissionAbort,
} from "@/app/teams/invitations/freshAccountAdmission";
import { isTeamMembershipAdmissionEnabled } from "@/app/teams/memberships/membershipService";

import {
    issueKeyChallengeV2,
    readKeyChallengeV2ForLogin,
    consumeLoginKeyChallengeV2,
    decodeVerifiedNativePasswordEvidenceV1,
    verifyKeyChallengeSignature,
} from "@/app/auth/keyChallengeV2";
import { acquireAccountSessionOwnerMetadataFenceInTx } from "@/app/encryption/accountSessionOwnerMetadataFence";
export { resolveStableKeyChallengeV2AudienceOrigin } from "@/app/auth/keyChallengeV2";

const KeyChallengeV2UnavailableResponseSchema = z.object({
    error: z.literal(AUTH_KEY_CHALLENGE_V2_ERROR_CODES.unavailable),
});
const KeyChallengeV2RequiredResponseSchema = z.object({
    error: z.literal(AUTH_KEY_CHALLENGE_V2_ERROR_CODES.required),
});
const KeyChallengeAuthResponseSchemas: Record<number, z.ZodTypeAny> = {
    426: KeyChallengeV2RequiredResponseSchema,
};

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
        const challenge = await issueKeyChallengeV2({
            purpose: purpose.tokenKind,
            expectedAccountId: request.body.expectedAccountId,
            env: process.env,
        });
        if (!challenge) {
            return reply.code(503).send({ error: AUTH_KEY_CHALLENGE_V2_ERROR_CODES.unavailable });
        }
        return reply.send(challenge);
    });

    app.post(purpose.redeemPath, {
        config: {
            rateLimit: resolveApiHotEndpointRateLimit(process.env, "auth.keyChallenge.redeem"),
        },
        schema: {
            body: KeyChallengeAuthRequestSchema,
            response: KeyChallengeAuthResponseSchemas,
        },
        errorHandler: accountDirectoryAuthErrorHandler,
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
        // Server-owned evidence written by a native verifier when it issued this
        // exact Account-bound challenge. It is not request input, so a caller
        // holding only the recovery secret cannot mint password provenance.
        let verifiedNativePasswordCredentialRevision: number | null = null;
        let challengeExpectedAccountId: string | null = null;
        if (isV2AuthRequest) {
            const challenge = await readKeyChallengeV2ForLogin({
                challengeId: authRequest.challengeId,
                expectedAccountId: authRequest.expectedAccountId,
                purpose: purpose.tokenKind,
                env: process.env,
            });
            if (!challenge) {
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
                ...(authRequest.requireExistingAccount
                    ? { requireExistingAccount: true }
                    : {}),
            });
            v2ChallengeId = challenge.id;
            verifiedNativePasswordCredentialRevision =
                decodeVerifiedNativePasswordEvidenceV1(challenge.verifiedNativeMethodId);
            challengeExpectedAccountId = challenge.expectedAccountId;
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
        const isValid = await verifyKeyChallengeSignature(
            signingInput,
            signature,
            publicKey,
        );
        if (!isValid) {
            return reply.code(401).send({ error: 'Invalid signature' });
        }
        if (v2ChallengeId) {
            if (!await consumeLoginKeyChallengeV2(db, v2ChallengeId)) {
                return reply.code(401).send({ error: 'Invalid signature' });
            }
        }

        const publicKeyHex = privacyKit.encodeHex(publicKey);
        const requiredExistingAccount =
            isV2AuthRequest
            && authRequest.requireExistingAccount
            && !authRequest.expectedAccountId
                ? await db.account.findUnique({
                    where: { publicKey: publicKeyHex },
                    select: {
                        id: true,
                        publicKey: true,
                        encryptionMode: true,
                        contentPublicKey: true,
                        contentPublicKeySig: true,
                    },
                })
                : null;
        if (
            isV2AuthRequest
            && authRequest.requireExistingAccount
            && !authRequest.expectedAccountId
            && !requiredExistingAccount
        ) {
            return reply.code(401).send({ error: "Invalid token" });
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
                if (eligibility.error === "account-disabled") {
                    return reply.code(403).send({ error: "account-disabled" });
                }
                return reply.code(401).send({
                    error: "Invalid token",
                });
            }
            // The challenge carried password evidence only if a native verifier
            // issued it for this exact Account after proving the factor. Every
            // ordinary check above — signature, currentness, one-time
            // consumption, expected Account, content-key binding — has already
            // passed, so the stamp records what was actually verified.
            const token = purpose.tokenKind === "account"
                ? await inTx(async (tx) => {
                    await acquireAccountSessionOwnerMetadataFenceInTx(tx, expectedAccount.id);
                    const passwordCredential = verifiedNativePasswordCredentialRevision !== null
                        ? await tx.accountPasswordCredential.findUnique({
                            where: { accountId: expectedAccount.id },
                            select: { revision: true },
                        })
                        : null;
                    const verifiedMethodId =
                        verifiedNativePasswordCredentialRevision !== null
                        && passwordCredential?.revision === verifiedNativePasswordCredentialRevision
                        && challengeExpectedAccountId === expectedAccount.id
                            ? "email_password"
                            : "key_challenge";
                    if (!await isEffectiveHomeAuthMethodActionEnabledInTx(tx, {
                        env: process.env,
                        methodId: verifiedMethodId,
                        actionId: "login",
                        mode: "keyed",
                    })) return null;
                    return await auth.createTokenInTx(tx, expectedAccount.id, undefined, {
                        kind: purpose.tokenKind,
                        authority: "present_user",
                        authenticationEvidence: [{ kind: "home_method", methodId: verifiedMethodId }],
                    });
                })
                : await auth.createToken(expectedAccount.id, undefined, {
                    kind: purpose.tokenKind,
                    authority: "present_user",
                    authenticationEvidence: [{ kind: "home_method", methodId: "key_challenge" }],
                });
            if (!token) return reply.code(403).send({ error: "method_not_available" });
            return reply.send({
                success: true,
                token,
            });
        }

        const encryptionFeatureEnv = readEncryptionFeatureEnv(process.env);
        const effectiveDefaultEncryptionMode = resolveEffectiveDefaultAccountEncryptionMode(
            encryptionFeatureEnv.storagePolicy,
            encryptionFeatureEnv.defaultAccountMode,
        );

        const existingAccount = requiredExistingAccount ?? await db.account.findUnique({
            where: { publicKey: publicKeyHex },
            select: {
                id: true,
                publicKey: true,
                encryptionMode: true,
                contentPublicKey: true,
                contentPublicKeySig: true,
            },
        });
        const teamInvitationAdmission = purpose.tokenKind === "account"
            && !existingAccount
            && request.body.admission?.kind === "team_invitation"
                ? request.body.admission
                : null;
        if (teamInvitationAdmission && !isTeamMembershipAdmissionEnabled()) {
            return reply.code(403).send({ error: "signup-disabled" });
        }
        if (purpose.tokenKind === "account" && !await isEffectiveHomeAuthMethodActionEnabled({
            env: process.env,
            methodId: "key_challenge",
            actionId: existingAccount ? "login" : "provision",
            mode: "keyed",
            ...(teamInvitationAdmission ? { admission: { kind: "team_invitation" as const } } : {}),
        })) {
            return reply.code(403).send({
                error: existingAccount ? "method_not_available" : "signup-disabled",
            });
        }
        if (!existingAccount) {
            const blocked = shouldDenyPublicSignupProvisioningAction({
                env: process.env,
                requestIp: request.ip,
                methodId: "key_challenge",
                mode: "keyed",
            });
            if (!teamInvitationAdmission && (blocked || !authPolicy.anonymousSignupEnabled)) {
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
            purpose.tokenKind === "account_directory"
                ? await prepareSameServiceHomeEntry({})
                : null;
        if (
            sameServiceBootstrapPreparation?.status === "not_dual_role"
            && sameServiceBootstrapPreparation.reason === "server_identity_mismatch"
        ) {
            throw new Error("Same-service Home descriptor identity mismatch");
        }

        let freshAccount = null;
        if (!existingAccount) {
            try {
                freshAccount = await inTx(async (tx) => {
                    if (purpose.tokenKind === "account" && !await isEffectiveHomeAuthMethodActionEnabledInTx(tx, {
                        env: process.env,
                        methodId: "key_challenge",
                        actionId: "provision",
                        mode: "keyed",
                        ...(teamInvitationAdmission ? { admission: { kind: "team_invitation" as const } } : {}),
                    })) throw new Error("signup-disabled");
                    if (!teamInvitationAdmission && (shouldDenyPublicSignupProvisioningAction({
                        env: process.env,
                        requestIp: request.ip,
                        methodId: "key_challenge",
                        mode: "keyed",
                    }) || !resolveAuthPolicyFromEnv(process.env).anonymousSignupEnabled)) {
                        throw new Error("signup-disabled");
                    }
                    const account = await provisionFreshAccountInTx(tx, {
                        insertSemantics: {
                            kind: "idempotent_verified_signing_identity",
                            publicKey: publicKeyHex,
                        },
                        encryptionMode: effectiveDefaultEncryptionMode,
                        contentKeyBinding,
                        directoryPreparation: sameServiceBootstrapPreparation,
                    });
                    if (teamInvitationAdmission) {
                        await requireTeamInvitationFreshAccountAdmissionInTx(tx, {
                            token: teamInvitationAdmission.token,
                            accountId: account.id,
                        });
                    }
                    return account;
                });
            } catch (error) {
                if (error instanceof Error && error.message === "signup-disabled") {
                    return reply.code(403).send({ error: "signup-disabled" });
                }
                if (error instanceof Error && error.message === "content_public_key_mismatch") {
                    return reply.code(409).send({ error: "content_public_key_mismatch" });
                }
                if (error instanceof Error && error.message === "invalid_content_public_key_binding") {
                    return reply.code(400).send({ error: "Invalid contentPublicKeySig" });
                }
                if (error instanceof TeamInvitationAcceptanceAbort
                    || error instanceof TeamInvitationFreshAccountAdmissionAbort) {
                    return reply.code(403).send({ error: "signup-disabled" });
                }
                throw error;
            }
        }
        const user = existingAccount ?? freshAccount!;
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
        const token = purpose.tokenKind === "account"
            ? await inTx(async (tx) => {
                if (!await isEffectiveHomeAuthMethodActionEnabledInTx(tx, {
                    env: process.env,
                    methodId: "key_challenge",
                    actionId: freshAccount ? "provision" : "login",
                    mode: "keyed",
                    ...(freshAccount && teamInvitationAdmission
                        ? { admission: { kind: "team_invitation" as const } }
                        : {}),
                })) return null;
                return await auth.createTokenInTx(tx, user.id, undefined, {
                    kind: purpose.tokenKind,
                    authority: "present_user",
                    authenticationEvidence: [{ kind: "home_method", methodId: "key_challenge" }],
                });
            })
            : !freshAccount && sameServiceBootstrapPreparation?.status === "ready"
                    ? await inTx(async (tx) => {
                        await ensureSameServiceHomeEntryInTx(tx, {
                            accountId: user.id,
                            preparation: sameServiceBootstrapPreparation,
                        });
                        return auth.createTokenInTx(tx, user.id, undefined, {
                            kind: purpose.tokenKind,
                            authority: "present_user",
                            authenticationEvidence: [{ kind: "home_method", methodId: "key_challenge" }],
                        });
                    })
                : await auth.createToken(
                    user.id,
                    undefined,
                    {
                        kind: purpose.tokenKind,
                        authority: "present_user",
                        authenticationEvidence: [{ kind: "home_method", methodId: "key_challenge" }],
                    },
                );
        if (!token) {
            return reply.code(403).send({
                error: freshAccount ? "signup-disabled" : "method_not_available",
            });
        }
        return reply.send({
            success: true,
            token,
        });
    });
}
