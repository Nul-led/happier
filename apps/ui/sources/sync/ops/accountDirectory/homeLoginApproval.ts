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
    ACCOUNT_DIRECTORY_MAX_HOME_LOGIN_TOKEN_UTF8_BYTES,
    ACCOUNT_DIRECTORY_MAX_SEALED_TOKEN_BYTES,
} from '@happier-dev/protocol';
import {
    isTokenOnlyAuthCredentials,
    parseAuthCredentials,
    type TokenOnlyAuthCredentials,
} from '@/auth/storage/tokenStorage';
import { decodeBase64 } from '@/encryption/base64';
import { decryptBox } from '@/encryption/libsodium';
import {
    resolveHomeEnrollmentTransport,
    type HomeEnrollmentTransportFailureReason,
} from '@/auth/enrollment/homeEnrollmentTransport';
import { adoptHomeProfileWithCredentials } from '@/sync/domains/server/adoptHomeProfile';

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
        reason: HomeEnrollmentTransportFailureReason;
    }>
    | Readonly<{ kind: 'rejected' }>
    | Readonly<{ kind: 'expired' }>
    | Readonly<{ kind: 'cancelled' }>
    | Readonly<{ kind: 'failed' }>;

function decodeSealedHomeCredentials(
    value: unknown,
    clientSecretKey: Uint8Array,
): TokenOnlyAuthCredentials | null {
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
        const credentials = parseAuthCredentials(payload);
        if (!credentials || !isTokenOnlyAuthCredentials(credentials)) return null;
        if (new TextEncoder().encode(credentials.token).byteLength > ACCOUNT_DIRECTORY_MAX_HOME_LOGIN_TOKEN_UTF8_BYTES) return null;
        return credentials;
    } catch {
        return null;
    }
}

function terminalRedemptionError(error: unknown): HomeLoginContinuationResult | null {
    if (error instanceof AccountDirectoryResponseError) return { kind: 'failed' };
    if (error instanceof AccountDirectoryRequestError && !error.transient) {
        if (error.code === ACCOUNT_DIRECTORY_ERROR_CODES_V1.assertionExpired) return { kind: 'expired' };
        return { kind: 'rejected' };
    }
    return null;
}

type HomeLoginApprovalContinuation = Extract<
    HomeLoginContinuationResult,
    { kind: 'approval_required' }
>;

function createApprovalContinuation(
    input: Readonly<{
        home: AccountDirectoryHomeEntryV1;
        clientSecretKey: Uint8Array;
        assertion: HomeLoginAssertionV1;
        shouldCancel?: () => boolean;
    }>,
    approvalId: string,
    expiresAtMs: number,
): HomeLoginApprovalContinuation {
    return {
        kind: 'approval_required',
        homeServerIdentityId: input.home.connectionDescriptor.homeServerIdentityId,
        approvalId,
        expiresAtMs,
        resume: async () => await continueHomeLoginEnrollment({
            ...input,
            approvalId,
            approvalExpiresAtMs: expiresAtMs,
        }),
        cancel: async () => ({ kind: 'cancelled' }),
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
}>): Promise<HomeLoginContinuationResult> {
    const descriptor = input.home.connectionDescriptor;
    const targetIdentity = descriptor.homeServerIdentityId;
    if (input.assertion.audienceHomeServerIdentityId !== targetIdentity) return { kind: 'failed' };
    if (input.clientSecretKey.byteLength !== 32) return { kind: 'failed' };
    if (input.shouldCancel?.()) return { kind: 'cancelled' };
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
            return createApprovalContinuation(input, input.approvalId, input.approvalExpiresAtMs);
        }
        return { kind: 'transport_unavailable', reason: resolved.reason };
    }

    const transport = resolved.transport;
    let redemption: HomeLoginRedemptionResultV1;
    try {
        redemption = await redeemHomeLoginAssertion(transport, input.assertion, {
            ...(input.approvalId ? { approvalId: input.approvalId } : {}),
        });
    } catch (error) {
        const terminalError = terminalRedemptionError(error);
        if (terminalError) return terminalError;
        if (input.approvalId && input.approvalExpiresAtMs !== undefined) {
            return createApprovalContinuation(input, input.approvalId, input.approvalExpiresAtMs);
        }
        return { kind: 'failed' };
    } finally {
        await transport.close().catch(() => {});
    }

    if ('approvalId' in redemption) {
        if (redemption.homeServerIdentityId !== targetIdentity) return { kind: 'failed' };
        const resolvedApprovalId = input.approvalId ?? redemption.approvalId;
        if (resolvedApprovalId !== redemption.approvalId) return { kind: 'failed' };
        const approvalExpiresAtMs = Math.min(
            input.approvalExpiresAtMs ?? redemption.expiresAtMs,
            redemption.expiresAtMs,
        );
        if (approvalExpiresAtMs <= Date.now()) return { kind: 'expired' };
        return createApprovalContinuation(input, resolvedApprovalId, approvalExpiresAtMs);
    }

    if (redemption.homeServerIdentityId !== targetIdentity) return { kind: 'failed' };
    // The locked wire field names the redemption window, not the lifetime of
    // the durable Home credential carried inside the sealed envelope.
    const redemptionExpiresAtMs = redemption.expiresAtMs;
    if (redemptionExpiresAtMs <= redemption.issuedAtMs || redemptionExpiresAtMs <= Date.now()) {
        return { kind: 'failed' };
    }
    const credentials = decodeSealedHomeCredentials(
        redemption.sealedHomeTokenBase64Url,
        input.clientSecretKey,
    );
    if (!credentials) return { kind: 'failed' };

    try {
        await adoptHomeProfileWithCredentials({
            descriptor,
            source: 'account-directory',
            preserveUserLabel: true,
            suggestedName: input.home.label,
            credentials,
        });
    } catch {
        return { kind: 'failed' };
    }
    return { kind: 'enrolled', homeServerIdentityId: targetIdentity };
}
