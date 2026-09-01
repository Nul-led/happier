import {
    AccountDirectoryRequestError,
    AccountDirectoryResponseError,
    redeemHomeLoginAssertion,
    type AccountDirectoryHomeEntryV1,
    type HomeLoginAssertionV1,
    type HomeLoginRedemptionResultV1,
} from '@/sync/api/accountDirectory/accountDirectoryClient';
import {
    ACCOUNT_DIRECTORY_ERROR_CODES_V1,
    ACCOUNT_DIRECTORY_MAX_HOME_LOGIN_CREDENTIAL_PLAINTEXT_BYTES,
    ACCOUNT_DIRECTORY_MAX_SEALED_TOKEN_BYTES,
    HomeLoginCredentialPayloadV1Schema,
} from '@happier-dev/protocol';
import { decodeBase64 } from '@/encryption/base64';
import { decryptBox } from '@/encryption/libsodium';
import {
    resolveHomeEnrollmentTransport,
    type HomeEnrollmentTransportFailureReason,
} from '@/auth/enrollment/homeEnrollmentTransport';
import {
    adoptHomeProfileWithCredentials,
    HomeProfileAdoptionPartialCommitError,
    type HomeProfileCredentialRollbackOutcome,
} from '@/sync/domains/server/adoptHomeProfile';

/**
 * Home-authoritative existing-device approval continuation. All requests target the exact
 * Home endpoint; approver routes authenticate with that Home's own full stored credential
 * and never with Account Service, directory, PAT, or assertion-only credentials.
 */

/** Terminal outcomes of an approval continuation; no credential material is exposed. */
export type HomeLoginContinuationResult =
    | Readonly<{ kind: 'enrolled'; homeServerIdentityId: string }>
    | Readonly<{
        kind: 'approval_required';
        homeServerIdentityId: string;
        approvalId: string;
        expiresAtMs: number;
        resume: () => Promise<HomeLoginContinuationResult>;
        cancel: () => Promise<HomeLoginContinuationResult>;
    }>
    | Readonly<{
        kind: 'transport_unavailable';
        reason: HomeEnrollmentTransportFailureReason | 'request_failed';
        resume?: () => Promise<HomeLoginContinuationResult>;
        cancel?: () => Promise<HomeLoginContinuationResult>;
    }>
    | Readonly<{ kind: 'rejected' }>
    | Readonly<{ kind: 'expired' }>
    | Readonly<{ kind: 'cancelled' }>
    | Readonly<{
        kind: 'partial_commit';
        homeServerIdentityId: string;
        canonicalServerUrl: string;
        rollbackOutcome: Exclude<HomeProfileCredentialRollbackOutcome, { kind: 'succeeded' }>;
    }>
    | Readonly<{ kind: 'failed' }>;

/**
 * Decrypts and strictly parses the exact protocol-owned redemption-coupled
 * credential/descriptor plaintext. Legacy token-only wrappers and every extra
 * field fail closed.
 */
function decodeHomeCredentialPayload(
    value: unknown,
    clientSecretKey: Uint8Array,
) {
    if (typeof value !== 'string' || value.length === 0) return null;
    let sealedBytes: Uint8Array;
    try {
        sealedBytes = decodeBase64(value, 'base64url');
    } catch {
        return null;
    }
    if (sealedBytes.byteLength > ACCOUNT_DIRECTORY_MAX_SEALED_TOKEN_BYTES) return null;
    const opened = decryptBox(sealedBytes, clientSecretKey);
    if (
        !opened
        || opened.length === 0
        || opened.length > ACCOUNT_DIRECTORY_MAX_HOME_LOGIN_CREDENTIAL_PLAINTEXT_BYTES
    ) return null;
    try {
        const payload: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(opened));
        const parsed = HomeLoginCredentialPayloadV1Schema.safeParse(payload);
        return parsed.success ? parsed.data : null;
    } catch {
        return null;
    }
}

function terminalRedemptionError(error: unknown): HomeLoginContinuationResult | null {
    if (error instanceof AccountDirectoryResponseError) return { kind: 'failed' };
    if (error instanceof AccountDirectoryRequestError && !error.transient) {
        if (
            error.code === ACCOUNT_DIRECTORY_ERROR_CODES_V1.assertionExpired
            || error.code === ACCOUNT_DIRECTORY_ERROR_CODES_V1.approvalExpired
        ) return { kind: 'expired' };
        if (error.code === ACCOUNT_DIRECTORY_ERROR_CODES_V1.approvalRejected) return { kind: 'rejected' };
        return { kind: 'failed' };
    }
    return null;
}

type HomeLoginApprovalContinuation = Extract<
    HomeLoginContinuationResult,
    { kind: 'approval_required' }
>;

type HomeLoginCancellationState = {
    cancelled: boolean;
    readonly externalShouldCancel?: () => boolean;
    readonly retained?: true;
};

function isCancelled(state: HomeLoginCancellationState): boolean {
    return state.cancelled || state.externalShouldCancel?.() === true;
}

function createApprovalContinuation(
    input: Readonly<{
        home: AccountDirectoryHomeEntryV1;
        clientSecretKey: Uint8Array;
        assertion: HomeLoginAssertionV1;
        cancellationState: HomeLoginCancellationState;
    }>,
    approvalId: string,
    expiresAtMs: number,
): HomeLoginApprovalContinuation {
    // The initiating screen's cancellation signal owns only its in-flight
    // redemption attempt. Once the Home has durably returned approval_required,
    // the service-scoped continuation must survive normal navigation/unmount;
    // explicit service change/disconnect still invokes this continuation's
    // cancel method and flips the detached state below.
    const cancellationState: HomeLoginCancellationState = input.cancellationState.retained
        ? input.cancellationState
        : { cancelled: input.cancellationState.cancelled, retained: true };
    const continuationInput = { ...input, cancellationState };
    return {
        kind: 'approval_required',
        homeServerIdentityId: input.home.connectionDescriptor.homeServerIdentityId,
        approvalId,
        expiresAtMs,
        resume: async () => await continueHomeLoginEnrollment({
            ...continuationInput,
            approvalId,
            approvalExpiresAtMs: expiresAtMs,
        }),
        cancel: async () => {
            cancellationState.cancelled = true;
            return { kind: 'cancelled' };
        },
    };
}

function createExplicitResumeContinuation(
    input: Parameters<typeof createApprovalContinuation>[0],
    approvalId: string,
    expiresAtMs: number,
    reason: HomeEnrollmentTransportFailureReason | 'request_failed',
): Extract<HomeLoginContinuationResult, { kind: 'transport_unavailable' }> {
    const cancellationState = input.cancellationState;
    return {
        kind: 'transport_unavailable',
        reason,
        resume: async () => await continueHomeLoginEnrollment({
            ...input,
            approvalId,
            approvalExpiresAtMs: expiresAtMs,
        }),
        cancel: async () => {
            cancellationState.cancelled = true;
            return { kind: 'cancelled' };
        },
    };
}

/**
 * Attempt assertion enrollment once. Approval retains only assertion-bound state and reacquires
 * transport for each explicit resume. Scheduling and polling remain Lane 05 UI concerns rather
 * than an Account Directory background loop.
 */
export async function continueHomeLoginEnrollment(input: Readonly<{
    home: AccountDirectoryHomeEntryV1;
    clientSecretKey: Uint8Array;
    assertion: HomeLoginAssertionV1;
    approvalId?: string;
    approvalExpiresAtMs?: number;
    shouldCancel?: () => boolean;
    cancellationState?: HomeLoginCancellationState;
}>): Promise<HomeLoginContinuationResult> {
    const cancellationState = input.cancellationState ?? {
        cancelled: false,
        ...(input.shouldCancel ? { externalShouldCancel: input.shouldCancel } : {}),
    };
    const continuationInput = { ...input, cancellationState };
    const descriptor = input.home.connectionDescriptor;
    const targetIdentity = descriptor.homeServerIdentityId;
    if (input.assertion.audienceHomeServerIdentityId !== targetIdentity) return { kind: 'failed' };
    if (input.clientSecretKey.byteLength !== 32) return { kind: 'failed' };
    if (isCancelled(cancellationState)) return { kind: 'cancelled' };
    if (input.approvalExpiresAtMs !== undefined && Date.now() >= input.approvalExpiresAtMs) {
        return { kind: 'expired' };
    }

    const resolved = await resolveHomeEnrollmentTransport(descriptor);
    if (!resolved.ok) {
        if (
            resolved.reason === 'iroh_transport_unavailable'
            && input.approvalId
            && input.approvalExpiresAtMs !== undefined
        ) {
            return createExplicitResumeContinuation(
                continuationInput,
                input.approvalId,
                input.approvalExpiresAtMs,
                resolved.reason,
            );
        }
        return { kind: 'transport_unavailable', reason: resolved.reason };
    }

    const transport = resolved.transport;
    let redemption: HomeLoginRedemptionResultV1;
    try {
        if (isCancelled(cancellationState)) return { kind: 'cancelled' };
        redemption = await redeemHomeLoginAssertion(transport, input.assertion, {
            ...(input.approvalId ? { approvalId: input.approvalId } : {}),
        });
    } catch (error) {
        const terminalError = terminalRedemptionError(error);
        if (terminalError) return terminalError;
        if (input.approvalId && input.approvalExpiresAtMs !== undefined) {
            return createExplicitResumeContinuation(
                continuationInput,
                input.approvalId,
                input.approvalExpiresAtMs,
                'request_failed',
            );
        }
        return { kind: 'failed' };
    } finally {
        await transport.close().catch(() => {});
    }
    if (isCancelled(cancellationState)) return { kind: 'cancelled' };

    if ('approvalId' in redemption) {
        if (redemption.homeServerIdentityId !== targetIdentity) return { kind: 'failed' };
        const resolvedApprovalId = input.approvalId ?? redemption.approvalId;
        if (resolvedApprovalId !== redemption.approvalId) return { kind: 'failed' };
        const approvalExpiresAtMs = Math.min(
            input.approvalExpiresAtMs ?? redemption.expiresAtMs,
            redemption.expiresAtMs,
        );
        if (approvalExpiresAtMs <= Date.now()) return { kind: 'expired' };
        return createApprovalContinuation(continuationInput, resolvedApprovalId, approvalExpiresAtMs);
    }

    if (redemption.homeServerIdentityId !== targetIdentity) return { kind: 'failed' };
    // The locked wire field names the redemption window, not the lifetime of
    // the durable Home credential carried inside the sealed envelope.
    const redemptionExpiresAtMs = redemption.expiresAtMs;
    if (redemptionExpiresAtMs <= redemption.issuedAtMs || redemptionExpiresAtMs <= Date.now()) {
        return { kind: 'failed' };
    }
    const payload = decodeHomeCredentialPayload(
        redemption.sealedHomeTokenBase64Url,
        input.clientSecretKey,
    );
    if (!payload) return { kind: 'failed' };
    if (payload.connectionDescriptor.homeServerIdentityId !== targetIdentity) {
        return { kind: 'failed' };
    }
    if (isCancelled(cancellationState)) return { kind: 'cancelled' };

    try {
        await adoptHomeProfileWithCredentials({
            descriptor: payload.connectionDescriptor,
            source: 'account-directory',
            preserveUserLabel: true,
            suggestedName: input.home.label,
            descriptorAuthority: 'redemption_coupled',
            credentials: payload.credentials,
            shouldCancel: () => isCancelled(cancellationState),
        });
    } catch (error) {
        if (error instanceof HomeProfileAdoptionPartialCommitError) {
            return {
                kind: 'partial_commit',
                homeServerIdentityId: error.serverIdentityId,
                canonicalServerUrl: error.canonicalServerUrl,
                rollbackOutcome: error.rollbackOutcome,
            };
        }
        return { kind: 'failed' };
    }
    return { kind: 'enrolled', homeServerIdentityId: targetIdentity };
}
