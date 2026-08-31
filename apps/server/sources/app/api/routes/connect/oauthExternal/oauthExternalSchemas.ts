import { z } from "zod";
import {
    AccountEncryptionMigrateExternalAuthBindingDigestV1Schema,
} from "@happier-dev/protocol";

export const oauthStateAttemptSchema = z.object({
    provider: z.string(),
    pkceCodeVerifier: z.string(),
    nonce: z.string(),
    webAppOAuthReturnUrl: z.string().optional(),
    purpose: z.literal("account_directory").optional(),
    endpointUrl: z.string().url().optional(),
    endpointServerIdentityId: z.string().trim().min(1).optional(),
});

export const connectPendingSchema = z.object({
    flow: z.literal("connect"),
    provider: z.string(),
    userId: z.string(),
    profileEnc: z.string(),
    accessTokenEnc: z.string(),
    refreshTokenEnc: z.string().optional(),
});

const authPendingSharedSchema = z.object({
    flow: z.literal("auth"),
    provider: z.string(),
    profileEnc: z.string(),
    accessTokenEnc: z.string(),
    refreshTokenEnc: z.string().optional(),
    suggestedUsername: z.string().nullable().optional(),
    usernameRequired: z.boolean().optional(),
    usernameReason: z.string().nullable().optional(),
});

const authPendingLegacyKeylessSchema = authPendingSharedSchema.extend({
    authMode: z.literal("keyless"),
    proofHash: z.string(),
}).strict();

const authPendingLegacyKeyedSchema = authPendingSharedSchema.extend({
    publicKeyHex: z.string(),
}).strict();

const authPendingV2Schema = authPendingSharedSchema.extend({
    v: z.literal(2),
    authMode: z.enum(["keyed", "keyless"]).optional(),
    proofHash: z.string().optional(),
    publicKeyHex: z.string().optional(),
    purpose: z.literal("account_directory").optional(),
    endpointUrl: z.string().url().optional(),
    endpointServerIdentityId: z.string().trim().min(1).optional(),
}).strict().superRefine((value, ctx) => {
    const isAccountDirectory = value.purpose === "account_directory";
    const hasEndpointUrl = value.endpointUrl !== undefined;
    const hasEndpointServerIdentityId =
        value.endpointServerIdentityId !== undefined;
    if (
        isAccountDirectory !== hasEndpointUrl
        || isAccountDirectory !== hasEndpointServerIdentityId
    ) {
        ctx.addIssue({
            code: "custom",
            message:
                "Account Directory pending state requires an exact endpoint binding",
        });
    }
    if (!isAccountDirectory) {
        if (
            value.authMode !== undefined
            || value.publicKeyHex !== undefined
            || !value.proofHash
        ) {
            ctx.addIssue({
                code: "custom",
                message: "Ordinary v2 pending state requires its proof binding",
            });
        }
        return;
    }
    if (
        value.authMode === "keyless"
        && value.proofHash
        && value.publicKeyHex === undefined
    ) {
        return;
    }
    if (
        value.authMode === "keyed"
        && value.publicKeyHex !== undefined
        && /^[0-9a-f]{64}$/i.test(value.publicKeyHex)
        && value.proofHash === undefined
    ) {
        return;
    }
    ctx.addIssue({
        code: "custom",
        message:
            "Account Directory pending state requires exactly one keyed or keyless binding",
    });
});

export const authPendingSchema = z.union([
    authPendingV2Schema,
    authPendingLegacyKeylessSchema,
    authPendingLegacyKeyedSchema,
]);

export const accountEncryptionFirstKeyStepUpPendingSchema = z
    .object({
        v: z.literal(3),
        flow: z.literal("auth"),
        purpose:
            z.literal("account_encryption_first_key"),
        provider: z.string().min(1),
        userId: z.string().min(1),
        providerUserId: z.string().min(1),
        proofHash: z.string().regex(/^[0-9a-f]{64}$/),
        requestDigest:
            AccountEncryptionMigrateExternalAuthBindingDigestV1Schema,
    })
    .strict();

export const oauthAuthPendingSchema = z.union([
    authPendingSchema,
    accountEncryptionFirstKeyStepUpPendingSchema,
]);
