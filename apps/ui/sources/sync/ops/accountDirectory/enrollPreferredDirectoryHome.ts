import { encodeBase64 } from '@/encryption/base64';
import sodium from '@/encryption/libsodium.lib';
import type { AccountDirectorySession } from '@/sync/domains/accountDirectory/accountDirectorySession';
import { continueHomeLoginEnrollment, type HomeLoginContinuationResult } from './homeLoginApproval';

export type PreferredDirectoryHomeEnrollmentResult =
    | HomeLoginContinuationResult
    | Readonly<{ kind: 'unavailable'; reason: 'directory_not_ready' | 'no_preferred_home' | 'unsupported' }>
    | Readonly<{ kind: 'failed'; error?: unknown }>;

export type PendingPreferredHomeEnrollment = Extract<
    HomeLoginContinuationResult,
    { kind: 'approval_required' }
> & Readonly<{ serviceKey: string }>;

type PreferredDirectoryEnrollmentSession = Pick<
    AccountDirectorySession,
    'snapshot' | 'serviceKey' | 'supportsHomeEnrollment' | 'requestLoginAssertion'
>;

let pendingPreferredHomeEnrollment: PendingPreferredHomeEnrollment | null = null;
let pendingPreferredHomeResume: Readonly<{
    pending: PendingPreferredHomeEnrollment;
    promise: Promise<HomeLoginContinuationResult>;
}> | null = null;
const pendingListeners = new Set<() => void>();

function publishPending(result: HomeLoginContinuationResult, serviceKey?: string): void {
    const boundServiceKey = serviceKey ?? pendingPreferredHomeEnrollment?.serviceKey ?? null;
    pendingPreferredHomeEnrollment = result.kind === 'approval_required' && boundServiceKey
        ? { ...result, serviceKey: boundServiceKey }
        : null;
    for (const listener of pendingListeners) listener();
}

export function getPendingPreferredHomeEnrollment(): PendingPreferredHomeEnrollment | null {
    return pendingPreferredHomeEnrollment;
}

export function subscribePendingPreferredHomeEnrollment(listener: () => void): () => void {
    pendingListeners.add(listener);
    return () => pendingListeners.delete(listener);
}

export async function cancelPendingPreferredHomeEnrollment(): Promise<void> {
    const pending = pendingPreferredHomeEnrollment;
    publishPending({ kind: 'cancelled' });
    await pending?.cancel().catch(() => {});
}

export async function resumePendingPreferredHomeEnrollment(): Promise<HomeLoginContinuationResult | null> {
    const pending = pendingPreferredHomeEnrollment;
    if (!pending) return null;
    if (pendingPreferredHomeResume?.pending === pending) {
        return await pendingPreferredHomeResume.promise;
    }
    const resume = pending.resume().then((result) => {
        if (pendingPreferredHomeEnrollment === pending) {
            publishPending(result, pending.serviceKey);
        }
        return result;
    });
    const inFlight = { pending, promise: resume };
    pendingPreferredHomeResume = inFlight;
    try {
        return await resume;
    } finally {
        if (pendingPreferredHomeResume === inFlight) pendingPreferredHomeResume = null;
    }
}

/**
 * Delegated enrollment is Home-token-only and leaves focus/group selection untouched. A Home
 * remains usable after this returns even when its Account Service is later unavailable.
 */
export async function enrollPreferredDirectoryHome(
    session: PreferredDirectoryEnrollmentSession,
    options: Readonly<{ shouldCancel?: () => boolean }> = {},
): Promise<PreferredDirectoryHomeEnrollmentResult> {
    if (options.shouldCancel?.()) return { kind: 'cancelled' };
    const snapshot = session.snapshot;
    if (snapshot.status === 'unsupported') return { kind: 'unavailable', reason: 'unsupported' };
    if (snapshot.status !== 'ready') return { kind: 'unavailable', reason: 'directory_not_ready' };
    if (!session.supportsHomeEnrollment) return { kind: 'unavailable', reason: 'unsupported' };

    const preferredIdentity = snapshot.preferredHomeServerIdentityId
        ?? snapshot.homes.find((entry) => entry.preferred === true)?.homeServerIdentityId
        ?? null;
    if (!preferredIdentity) return { kind: 'unavailable', reason: 'no_preferred_home' };
    const entry = snapshot.homes.find((candidate) => candidate.homeServerIdentityId === preferredIdentity);
    if (!entry) return { kind: 'unavailable', reason: 'no_preferred_home' };

    await cancelPendingPreferredHomeEnrollment();
    if (options.shouldCancel?.()) return { kind: 'cancelled' };
    try {
        const keyPair = sodium.crypto_box_keypair();
        const assertion = await session.requestLoginAssertion(entry.homeServerIdentityId,
            // The Lane 02 assertion DTO deliberately uses canonical padded
            // base64 (not base64url) for the requester box key.
            encodeBase64(keyPair.publicKey, 'base64'),
        );
        if (options.shouldCancel?.()) return { kind: 'cancelled' };
        if (assertion.audienceHomeServerIdentityId !== entry.homeServerIdentityId) {
            throw new Error('Account Service assertion targeted a different Home');
        }
        const result = await continueHomeLoginEnrollment({
            home: entry,
            clientSecretKey: keyPair.privateKey,
            assertion,
            shouldCancel: options.shouldCancel,
        });
        if (options.shouldCancel?.()) return { kind: 'cancelled' };
        publishPending(result, session.serviceKey);
        return result;
    } catch (error) {
        return { kind: 'failed', error };
    }
}
