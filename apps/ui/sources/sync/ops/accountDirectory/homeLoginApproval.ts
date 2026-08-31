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
import { resolveDirectoryHomeTransport } from './resolveDirectoryHomeTransport';
import type { HomeEnrollmentTransport } from '@/auth/enrollment/homeEnrollmentTransport';
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
        kind: 'transient';
        resume: () => Promise<HomeLoginContinuationResult>;
        cancel: () => Promise<HomeLoginContinuationResult>;
    }>
    | Readonly<{
        kind: 'transport_unavailable';
        reason: 'iroh_target_transport_unavailable' | 'no_approved_endpoint';
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

/**
 * Attempt assertion enrollment once. Approval and transient results retain the exact
 * assertion/client key/approval id in a smallest explicit resume operation. Scheduling and
 * polling remain Lane 05 UI concerns rather than an Account Directory background loop.
 */
export async function continueHomeLoginEnrollment(input: Readonly<{
    home: AccountDirectoryHomeEntryV1;
    clientSecretKey: Uint8Array;
    assertion: HomeLoginAssertionV1;
    approvalId?: string;
    approvalExpiresAtMs?: number;
    shouldCancel?: () => boolean;
    /** A previously obtained redemption can be consumed without issuing it twice. */
    initialRedemption?: HomeLoginRedemptionResultV1;
    /** Retained only by approval/transient continuations; callers never resolve a second carrier. */
    transport?: HomeEnrollmentTransport;
}>): Promise<HomeLoginContinuationResult> {
    const descriptor = input.home.connectionDescriptor;
    const targetIdentity = descriptor.homeServerIdentityId;
    const closeInputTransport = async <T extends HomeLoginContinuationResult>(result: T): Promise<T> => {
        await input.transport?.close().catch(() => {});
        return result;
    };
    if (input.assertion.audienceHomeServerIdentityId !== targetIdentity) return await closeInputTransport({ kind: 'failed' });
    if (input.clientSecretKey.byteLength !== 32) return await closeInputTransport({ kind: 'failed' });
    if (input.shouldCancel?.()) return await closeInputTransport({ kind: 'cancelled' });
    if (input.approvalExpiresAtMs !== undefined && Date.now() >= input.approvalExpiresAtMs) {
        return await closeInputTransport({ kind: 'expired' });
    }
    let transport: HomeEnrollmentTransport;
    if (input.transport) {
        transport = input.transport;
    } else {
        const resolved = await resolveDirectoryHomeTransport(descriptor);
        if (!resolved.ok) return { kind: 'transport_unavailable', reason: resolved.reason };
        transport = resolved;
    }
    const terminal = async <T extends HomeLoginContinuationResult>(result: T): Promise<T> => {
        await transport.close().catch(() => {});
        return result;
    };
    const cancelled = async (): Promise<HomeLoginContinuationResult> => await terminal({ kind: 'cancelled' });

    let redemption = input.initialRedemption;
    if (!redemption) {
        try {
            redemption = await redeemHomeLoginAssertion(transport, input.assertion, {
                ...(input.approvalId ? { approvalId: input.approvalId } : {}),
            });
        } catch (error) {
            const terminalError = terminalRedemptionError(error);
            if (terminalError) return await terminal(terminalError);
            return {
                kind: 'transient',
                resume: async () => await continueHomeLoginEnrollment({
                    ...input,
                    transport,
                    initialRedemption: undefined,
                }),
                cancel: cancelled,
            };
        }
    }

    if ('approvalId' in redemption) {
        if (redemption.homeServerIdentityId !== targetIdentity) return await terminal({ kind: 'failed' });
        const resolvedApprovalId = input.approvalId ?? redemption.approvalId;
        if (resolvedApprovalId !== redemption.approvalId) return await terminal({ kind: 'failed' });
        if (redemption.expiresAtMs <= Date.now()) return await terminal({ kind: 'expired' });
        return {
            kind: 'approval_required',
            homeServerIdentityId: targetIdentity,
            approvalId: resolvedApprovalId,
            expiresAtMs: redemption.expiresAtMs,
            resume: async () => await continueHomeLoginEnrollment({
                ...input,
                transport,
                approvalId: resolvedApprovalId,
                approvalExpiresAtMs: redemption.expiresAtMs,
                initialRedemption: undefined,
            }),
            cancel: cancelled,
        };
    }

    if (redemption.homeServerIdentityId !== targetIdentity) return await terminal({ kind: 'failed' });
    // The locked wire field names the redemption window, not the lifetime of
    // the durable Home credential carried inside the sealed envelope.
    const redemptionExpiresAtMs = redemption.expiresAtMs;
    if (redemptionExpiresAtMs <= redemption.issuedAtMs || redemptionExpiresAtMs <= Date.now()) {
        return await terminal({ kind: 'failed' });
    }
    const credentials = decodeSealedHomeCredentials(
        redemption.sealedHomeTokenBase64Url,
        input.clientSecretKey,
    );
    if (!credentials) return await terminal({ kind: 'failed' });

    try {
        await adoptHomeProfileWithCredentials({
            descriptor,
            source: 'account-directory',
            preserveUserLabel: true,
            suggestedName: input.home.label,
            credentials,
        });
    } catch {
        return await terminal({ kind: 'failed' });
    }
    return await terminal({ kind: 'enrolled', homeServerIdentityId: targetIdentity });
}
