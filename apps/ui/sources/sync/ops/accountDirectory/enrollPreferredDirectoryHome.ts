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
>;

let pendingPreferredHomeEnrollment: PendingPreferredHomeEnrollment | null = null;
let pendingPreferredHomeResume: Promise<HomeLoginContinuationResult> | null = null;
const pendingListeners = new Set<() => void>();

function publishPending(result: HomeLoginContinuationResult): void {
    pendingPreferredHomeEnrollment = result.kind === 'approval_required'
        ? result
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
    if (pendingPreferredHomeResume) return await pendingPreferredHomeResume;
    const pending = pendingPreferredHomeEnrollment;
    if (!pending) return null;
    const resume = pending.resume().then((result) => {
        publishPending(result);
        return result;
    });
    pendingPreferredHomeResume = resume;
    try {
        return await resume;
    } finally {
        if (pendingPreferredHomeResume === resume) pendingPreferredHomeResume = null;
    }
}

/**
 * Delegated enrollment is Home-token-only and leaves focus/group selection untouched. A Home
 * remains usable after this returns even when its Account Service is later unavailable.
 */
export async function enrollPreferredDirectoryHome(
    session: AccountDirectorySession,
): Promise<PreferredDirectoryHomeEnrollmentResult> {
    const snapshot = session.snapshot;
    if (snapshot.status === 'unsupported') return { kind: 'unavailable', reason: 'unsupported' };
    if (snapshot.status !== 'ready') return { kind: 'unavailable', reason: 'directory_not_ready' };

    const preferredIdentity = snapshot.preferredHomeServerIdentityId
        ?? snapshot.homes.find((entry) => entry.preferred === true)?.homeServerIdentityId
        ?? null;
    if (!preferredIdentity) return { kind: 'unavailable', reason: 'no_preferred_home' };
    const entry = snapshot.homes.find((candidate) => candidate.homeServerIdentityId === preferredIdentity);
    if (!entry) return { kind: 'unavailable', reason: 'no_preferred_home' };

    await cancelPendingPreferredHomeEnrollment();
    try {
        const keyPair = sodium.crypto_box_keypair();
        const assertion = await session.requestLoginAssertion(entry.homeServerIdentityId,
            // The Lane 02 assertion DTO deliberately uses canonical padded
            // base64 (not base64url) for the requester box key.
            encodeBase64(keyPair.publicKey, 'base64'),
        );
        if (assertion.audienceHomeServerIdentityId !== entry.homeServerIdentityId) {
            throw new Error('Account Service assertion targeted a different Home');
        }
        const result = await continueHomeLoginEnrollment({
            home: entry,
            clientSecretKey: keyPair.privateKey,
            assertion,
        });
        if (result.kind === 'transient') {
            // This production boundary retains only Home approval continuations.
            // Release a transient carrier before projecting it to the existing
            // retryable failure outcome used by settings and OAuth callers.
            await result.cancel();
            const failed = { kind: 'failed' } as const;
            publishPending(failed);
            return failed;
        }
        publishPending(result);
        return result;
    } catch (error) {
        return { kind: 'failed', error };
    }
}
