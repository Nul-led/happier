import { z } from 'zod';
import { KeyChallengeV2IssueResponseSchema } from './keyChallenge.js';
import { NativeAuthOneTimeBearerV1Schema } from './nativeAuthOneTimeOperation.js';
import { VERIFIED_EMAIL_MAX_SCALARS } from './verifiedEmail.js';
import { PASSWORD_MAX_UTF8_BYTES_V1, PasswordEnvelopeKdfV1Schema, PasswordWrappedRecoverySecretV1Schema, decodePasswordCredentialFieldV1 } from './accountPasswordCredential.js';
import { TeamInvitationAccountAdmissionV1Schema } from './accountAdmission.js';

/**
 * The public bearer routes are deliberately small. They never turn a bearer
 * into free-standing verified-email state: the exact consuming operation
 * carries the bearer into its own transaction.
 */
export const NATIVE_AUTH_EMAIL_VERIFY_REQUEST_PATH_V1 = '/v1/auth/email/verify/request' as const;
export const NATIVE_AUTH_EMAIL_VERIFY_PREVIEW_PATH_V1 = '/v1/auth/email/verify/preview' as const;
export const NATIVE_AUTH_PASSWORD_RESET_REQUEST_PATH_V1 = '/v1/auth/password/reset/request' as const;
export const NATIVE_AUTH_PASSWORD_RESET_PREVIEW_PATH_V1 = '/v1/auth/password/reset/preview' as const;

/** Application landing pages that only render their corresponding preview. */
export const NATIVE_AUTH_EMAIL_VERIFY_APP_PATH_V1 = '/auth/email/verify' as const;
export const NATIVE_AUTH_PASSWORD_RESET_APP_PATH_V1 = '/auth/password/reset' as const;
/** Bearer-free exact-Home entry for replacing an E2EE password with the recovery key. */
export const NATIVE_AUTH_PASSWORD_RECOVERY_APP_PATH_V1 = '/auth/password/recover' as const;

const RequestedEmailSchema = z.string().min(1).max(VERIFIED_EMAIL_MAX_SCALARS * 2);

// V1 authentication envelopes are recursively closed. These are new native
// operations; neither the released login wire nor its credential shapes change.
export const NATIVE_AUTH_EMAIL_PRELOGIN_PATH_V1 = '/v1/auth/email/prelogin' as const;
export const NATIVE_AUTH_EMAIL_LOGIN_PATH_V1 = '/v1/auth/email/login' as const;
export const NATIVE_AUTH_EMAIL_UNLOCK_PATH_V1 = '/v1/auth/email/unlock' as const;
export const NATIVE_AUTH_EMAIL_PROVISION_PATH_V1 = '/v1/auth/email/provision' as const;

export const NativeEmailPasswordPreloginRequestV1Schema = z.object({
    v: z.literal(1), email: RequestedEmailSchema,
}).strict();
export type NativeEmailPasswordPreloginRequestV1 = z.infer<typeof NativeEmailPasswordPreloginRequestV1Schema>;
export const NativeEmailPasswordPreloginResponseV1Schema = z.discriminatedUnion('kind', [
    z.object({ v: z.literal(1), kind: z.literal('plain_password') }).strict(),
    z.object({ v: z.literal(1), kind: z.literal('e2ee_password_unlock'), kdf: PasswordEnvelopeKdfV1Schema }).strict(),
]);
export type NativeEmailPasswordPreloginResponseV1 = z.infer<typeof NativeEmailPasswordPreloginResponseV1Schema>;

export const NativeEmailPasswordLoginRequestV1Schema = z.object({
    v: z.literal(1), email: RequestedEmailSchema,
    // The shared acceptance owner validates exact scalar/UTF-8 semantics.
    password: z.string().max(PASSWORD_MAX_UTF8_BYTES_V1),
    /**
     * Ask for the restricted Account Directory credential an account service
     * issues, instead of an ordinary Home credential. Refused on a server that
     * is not an account service. E2EE Accounts reach the same credential by
     * redeeming their unlocked key at the Account Directory Key Challenge.
     */
    credentialTarget: z.literal('account_directory').optional(),
}).strict();
export type NativeEmailPasswordLoginRequestV1 = z.infer<typeof NativeEmailPasswordLoginRequestV1Schema>;
export const NativeEmailPasswordLoginResponseV1Schema = z.object({ token: z.string().min(1) }).strict();
export type NativeEmailPasswordLoginResponseV1 = z.infer<typeof NativeEmailPasswordLoginResponseV1Schema>;

export const NativeEmailPasswordUnlockRequestV1Schema = z.object({
    v: z.literal(1), email: RequestedEmailSchema,
    authKey: z.string().length(43).refine((value) => {
        try { return decodePasswordCredentialFieldV1(value).byteLength === 32; } catch { return false; }
    }),
}).strict();
export type NativeEmailPasswordUnlockRequestV1 = z.infer<typeof NativeEmailPasswordUnlockRequestV1Schema>;
/**
 * The unlock boundary is the only place that observes a verified native
 * password, so it also issues the Key Challenge the client will redeem. Binding
 * the two here is what lets the Home stamp truthful `email_password` provenance
 * on the resulting credential: a challenge the client issued for itself carries
 * no password evidence, and a client cannot ask for one that does.
 */
export const NativeEmailPasswordUnlockResponseV1Schema = z.object({
    envelope: PasswordWrappedRecoverySecretV1Schema, expectedAccountId: z.string().min(1),
    challenge: KeyChallengeV2IssueResponseSchema,
}).strict();
export type NativeEmailPasswordUnlockResponseV1 = z.infer<typeof NativeEmailPasswordUnlockResponseV1Schema>;

const NativeEmailPasswordProvisionProofV1Schema = z.object({
    challengeId: z.string().min(1).max(256),
    publicKey: z.string().min(1).max(256),
    signature: z.string().min(1).max(256),
    contentPublicKey: z.string().min(1).max(256),
    contentPublicKeySig: z.string().min(1).max(256),
}).strict();

const NativeEmailPasswordProvisionAdmissionV1Schema = z.discriminatedUnion('kind', [
    z.object({
        kind: z.literal('native_email_verification'),
        token: NativeAuthOneTimeBearerV1Schema,
    }).strict(),
    TeamInvitationAccountAdmissionV1Schema.extend({
        emailVerificationToken: NativeAuthOneTimeBearerV1Schema.optional(),
    }).strict(),
]);
export type NativeAccountAdmissionV1 = z.infer<typeof NativeEmailPasswordProvisionAdmissionV1Schema>;

const NativeEmailPasswordProvisionAccountV1Schema = z.discriminatedUnion('mode', [
    z.object({
        mode: z.literal('plain'),
        password: z.string().max(PASSWORD_MAX_UTF8_BYTES_V1),
    }).strict(),
    z.object({
        mode: z.literal('e2ee'),
        authKey: z.string().length(43).refine((value) => {
            try { return decodePasswordCredentialFieldV1(value).byteLength === 32; } catch { return false; }
        }),
        envelope: PasswordWrappedRecoverySecretV1Schema,
        proof: NativeEmailPasswordProvisionProofV1Schema,
    }).strict(),
]);

/**
 * Fresh native admission is one recursively closed request. Password/KDF,
 * envelope and signing/content-key proof validation therefore finishes before
 * the transaction owner receives any prepared effect.
 */
export const NativeEmailPasswordProvisionRequestV1Schema = z.object({
    v: z.literal(1),
    email: RequestedEmailSchema,
    admission: NativeEmailPasswordProvisionAdmissionV1Schema,
    account: NativeEmailPasswordProvisionAccountV1Schema,
    /** As on login: the new Account signs in to the account service rather than to the Home. */
    credentialTarget: z.literal('account_directory').optional(),
}).strict();
export type NativeEmailPasswordProvisionRequestV1 = z.infer<typeof NativeEmailPasswordProvisionRequestV1Schema>;

export const NativeEmailPasswordProvisionResponseV1Schema = z.object({
    token: z.string().min(1),
    accountId: z.string().min(1),
    teamId: z.string().min(1).nullable(),
}).strict();
export type NativeEmailPasswordProvisionResponseV1 = z.infer<typeof NativeEmailPasswordProvisionResponseV1Schema>;

export const NativeEmailPasswordProvisionErrorResponseV1Schema = z.object({
    error: z.enum(['authentication_failed', 'method_not_available', 'password_hash_overloaded']),
}).strict();
export type NativeEmailPasswordProvisionErrorResponseV1 = z.infer<typeof NativeEmailPasswordProvisionErrorResponseV1Schema>;

export const NativeEmailPasswordErrorResponseV1Schema = z.union([
    z.object({ error: z.enum([
        'authentication_failed', 'method_not_available', 'account-disabled',
        'invalid-token', 'not-eligible', 'upstream_error', 'password_hash_overloaded',
        'challenge_unavailable',
    ]) }).strict(),
    z.object({ error: z.literal('provider-required'), provider: z.string() }).strict(),
]);
export type NativeEmailPasswordErrorResponseV1 = z.infer<typeof NativeEmailPasswordErrorResponseV1Schema>;

export const NativeEmailVerifyRequestV1Schema = z.object({
    v: z.literal(1),
    email: RequestedEmailSchema,
    continuationId: z.string().min(1).max(256).optional(),
    admission: TeamInvitationAccountAdmissionV1Schema.optional(),
    /**
     * The mailbox is being proven to create an account-service sign-in. The
     * mailed link carries `purpose=account_service` so the landing finishes
     * that journey on whichever device opens it. Non-authoritative: creation
     * still re-checks every admission and capability on the server.
     */
    purpose: z.literal('account_service').optional(),
}).strict();
export type NativeEmailVerifyRequestV1 = z.infer<typeof NativeEmailVerifyRequestV1Schema>;

export const NativePasswordResetRequestV1Schema = z.object({
    v: z.literal(1),
    email: RequestedEmailSchema,
}).strict();
export type NativePasswordResetRequestV1 = z.infer<typeof NativePasswordResetRequestV1Schema>;

/**
 * Claimed, unknown, disabled, ineligible, and unsupported addresses all receive
 * this exact projection so the endpoints never disclose Account existence.
 */
export const NativeAuthEmailAcceptedResponseV1Schema = z.object({
    accepted: z.literal(true),
}).strict();
export type NativeAuthEmailAcceptedResponseV1 = z.infer<typeof NativeAuthEmailAcceptedResponseV1Schema>;

export const NativeAuthBearerPreviewRequestV1Schema = z.object({
    v: z.literal(1),
    token: NativeAuthOneTimeBearerV1Schema,
}).strict();
export type NativeAuthBearerPreviewRequestV1 = z.infer<typeof NativeAuthBearerPreviewRequestV1Schema>;

/**
 * Expired, missing, malformed, and consumed bearers are externally equivalent:
 * they all return `{ v: 1, valid: false }`.
 */
export const NativeEmailVerifyPreviewResponseV1Schema = z.object({
    v: z.literal(1),
    valid: z.boolean(),
    maskedDestination: z.string().max(VERIFIED_EMAIL_MAX_SCALARS).nullable(),
    continuation: z.enum(['account_admission', 'password_enrollment', 'sign_in_email_change', 'none']).nullable(),
}).strict();
export type NativeEmailVerifyPreviewResponseV1 = z.infer<typeof NativeEmailVerifyPreviewResponseV1Schema>;

export const NativePasswordResetPreviewResponseV1Schema = z.object({
    v: z.literal(1),
    valid: z.boolean(),
}).strict();
export type NativePasswordResetPreviewResponseV1 = z.infer<typeof NativePasswordResetPreviewResponseV1Schema>;
