import {
    NATIVE_AUTH_EMAIL_VERIFY_PREVIEW_PATH_V1,
    NATIVE_AUTH_EMAIL_VERIFY_REQUEST_PATH_V1,
    NATIVE_AUTH_PASSWORD_RESET_PREVIEW_PATH_V1,
    NATIVE_AUTH_PASSWORD_RESET_REQUEST_PATH_V1,
    NATIVE_AUTH_PASSWORD_RESET_SUBMIT_PATH_V1,
    NativeAuthBearerPreviewRequestV1Schema,
    NativeAuthEmailAcceptedResponseV1Schema,
    NativeEmailPasswordErrorResponseV1Schema,
    NativeEmailVerifyPreviewResponseV1Schema,
    NativeEmailVerifyRequestV1Schema,
    NativePasswordResetPreviewResponseV1Schema,
    NativePasswordResetRequestV1Schema,
    PlainPasswordResetSubmitRequestV1Schema,
    PlainPasswordResetSubmitResponseV1Schema,
    type NativeEmailVerifyPreviewResponseV1,
    type NativePasswordResetPreviewResponseV1,
    type TeamInvitationAccountAdmissionV1,
    maskEmailForNativeAuthPreview,
} from '@happier-dev/protocol';
import { z } from 'zod';

import type { ServerFetch } from '@/sync/http/client';
import { HappyError } from '@/utils/errors/errors';

export type NativeInvitationEmailVerificationContinuation = Readonly<{
    homeServerIdentityId: string;
    normalizedEmail: string;
    admission: TeamInvitationAccountAdmissionV1;
}>;

// A mail link can navigate away from the Join screen within the same running
// client. Retain only that process-local continuation here, beside the request
// and landing owners; a restarted/lost client safely falls back to the server-
// bound verification operation and never guesses or persists an invitation bearer.
let invitationVerificationContinuation: NativeInvitationEmailVerificationContinuation | null = null;

export function rememberNativeInvitationEmailVerificationContinuation(
    continuation: NativeInvitationEmailVerificationContinuation,
): void {
    invitationVerificationContinuation = continuation;
}

export function readNativeInvitationEmailVerificationContinuation(input: Readonly<{
    homeServerIdentityId: string;
    maskedDestination: string | null;
}>): NativeInvitationEmailVerificationContinuation | null {
    if (!invitationVerificationContinuation
        || invitationVerificationContinuation.homeServerIdentityId !== input.homeServerIdentityId
        || input.maskedDestination === null) return null;
    return maskEmailForNativeAuthPreview(invitationVerificationContinuation.normalizedEmail) === input.maskedDestination
        ? invitationVerificationContinuation
        : null;
}

export function clearNativeInvitationEmailVerificationContinuation(admission: TeamInvitationAccountAdmissionV1): void {
    if (invitationVerificationContinuation?.admission.token === admission.token) {
        invitationVerificationContinuation = null;
    }
}

async function post(request: ServerFetch, path: string, body: unknown): Promise<unknown> {
    const response = await request(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    }, { includeAuth: false, retry: 'none' });
    const payload: unknown = await response.json().catch(() => null);
    if (!response.ok) {
        const parsed = NativeEmailPasswordErrorResponseV1Schema.safeParse(payload);
        const fallback = z.object({ error: z.string() }).safeParse(payload);
        const operationRequiresUpdate = response.status === 404 || response.status === 405 || response.status === 501;
        throw new HappyError('Native email operation failed', !operationRequiresUpdate && (response.status >= 500 || response.status === 429), {
            kind: !operationRequiresUpdate && response.status >= 500 ? 'server' : 'auth',
            status: response.status,
            ...(operationRequiresUpdate
                ? { code: 'client_update_required' }
                : parsed.success
                ? { code: parsed.data.error }
                : fallback.success ? { code: fallback.data.error } : {}),
        });
    }
    return payload;
}

/**
 * Ask the Home to send a verification link. The response is deliberately the
 * same neutral acceptance for claimed, unknown, disabled and ineligible
 * addresses, so no caller may branch on Account existence.
 */
export async function requestNativeEmailVerification(
    request: ServerFetch,
    input: Readonly<{
        email: string;
        continuationId?: string;
        admission?: TeamInvitationAccountAdmissionV1;
    }>,
): Promise<void> {
    NativeAuthEmailAcceptedResponseV1Schema.parse(await post(
        request,
        NATIVE_AUTH_EMAIL_VERIFY_REQUEST_PATH_V1,
        NativeEmailVerifyRequestV1Schema.parse({
            v: 1,
            email: input.email,
            ...(input.continuationId ? { continuationId: input.continuationId } : {}),
            ...(input.admission ? { admission: input.admission } : {}),
        }),
    ));
}

/** Existence-neutral Plain password reset request. */
export async function requestNativePasswordReset(request: ServerFetch, email: string): Promise<void> {
    NativeAuthEmailAcceptedResponseV1Schema.parse(await post(
        request,
        NATIVE_AUTH_PASSWORD_RESET_REQUEST_PATH_V1,
        NativePasswordResetRequestV1Schema.parse({ v: 1, email }),
    ));
}

/** Read-only landing preview. Opening a link never consumes the bearer. */
export async function previewNativeEmailVerification(
    request: ServerFetch,
    token: string,
): Promise<NativeEmailVerifyPreviewResponseV1> {
    return NativeEmailVerifyPreviewResponseV1Schema.parse(await post(
        request,
        NATIVE_AUTH_EMAIL_VERIFY_PREVIEW_PATH_V1,
        NativeAuthBearerPreviewRequestV1Schema.parse({ v: 1, token }),
    ));
}

export async function previewNativePasswordReset(
    request: ServerFetch,
    token: string,
): Promise<NativePasswordResetPreviewResponseV1> {
    return NativePasswordResetPreviewResponseV1Schema.parse(await post(
        request,
        NATIVE_AUTH_PASSWORD_RESET_PREVIEW_PATH_V1,
        NativeAuthBearerPreviewRequestV1Schema.parse({ v: 1, token }),
    ));
}

/** Consume the reset bearer and replace the Plain password credential. */
export async function submitNativePasswordReset(
    request: ServerFetch,
    input: Readonly<{ token: string; password: string }>,
): Promise<void> {
    PlainPasswordResetSubmitResponseV1Schema.parse(await post(
        request,
        NATIVE_AUTH_PASSWORD_RESET_SUBMIT_PATH_V1,
        PlainPasswordResetSubmitRequestV1Schema.parse({ v: 1, ...input }),
    ));
}
