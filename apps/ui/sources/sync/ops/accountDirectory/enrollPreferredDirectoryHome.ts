import { encodeBase64 } from '@/encryption/base64';
import sodium from '@/encryption/libsodium.lib';
import {
    classifyAccountServiceDirectory,
    verifyAccountServiceHomeAssertionRequest,
} from '@happier-dev/cli-common/accountService';
import type { AccountDirectorySession } from '@/sync/domains/accountDirectory/accountDirectorySession';
import type { AccountServiceEntryIntent } from '@/auth/storage/tokenStorage';
import { continueHomeLoginEnrollment, type HomeLoginContinuationResult } from './homeLoginApproval';
import { Platform } from 'react-native';
import {
    resolveServerProfileForPortableIdentity,
    resolveServerProfileScopeId,
} from '@/sync/domains/server/serverProfiles';
import { isSelectedAccountServiceKey } from '@/sync/domains/accountDirectory/accountServiceSelection';
import { resolveRoutineServerSelectionScope } from '@/sync/domains/server/selection/serverSelectionScope';
import { isDesktopHost } from '@/utils/platform/desktopHost';

export type PreferredDirectoryHomeEnrollmentResult =
    | HomeLoginContinuationResult
    | Readonly<{ kind: 'unavailable'; reason: 'directory_not_ready' | 'no_preferred_home' | 'unsupported' }>
    | Readonly<{ kind: 'failed'; error?: unknown }>;

type ResumableHomeLoginContinuation =
    | Extract<HomeLoginContinuationResult, { kind: 'approval_required' }>
    | (Extract<HomeLoginContinuationResult, { kind: 'transport_unavailable' }> & Readonly<{
        resume: () => Promise<HomeLoginContinuationResult>;
        cancel: () => Promise<HomeLoginContinuationResult>;
    }>);

function isResumableHomeLoginContinuation(
    result: HomeLoginContinuationResult,
): result is ResumableHomeLoginContinuation {
    return result.kind === 'approval_required'
        || (result.kind === 'transport_unavailable' && Boolean(result.resume && result.cancel));
}

export type PendingPreferredHomeEnrollment = ResumableHomeLoginContinuation & Readonly<{
    serviceKey: string;
    entryIntent: AccountServiceEntryIntent;
    homeServerIdentityId: string;
}>;

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

export type PreferredHomeEntryIntentOutcome = 'completed' | 'blocked' | 'superseded';

/**
 * Applies the semantic entry intent after a successful non-focusing adoption. Only
 * `enter_preferred_home` opens a Home, and only while its own Account Service is still selected —
 * an immediate result and an approval resume both recheck that here rather than at each caller.
 */
export async function finalizePreferredHomeEnrollmentEntryIntent(
    homeServerIdentityId: string,
    entryIntent: AccountServiceEntryIntent,
    serviceKey: string,
    shouldCancel?: () => boolean,
): Promise<PreferredHomeEntryIntentOutcome> {
    if (entryIntent === 'connect_service') return 'completed';
    if (shouldCancel?.() || !isSelectedAccountServiceKey(serviceKey)) return 'superseded';
    const resolvedProfile = resolveServerProfileForPortableIdentity(homeServerIdentityId);
    if (resolvedProfile.kind !== 'resolved') return 'blocked';
    try {
        // Settings uses `connect_service` and must not pull the active-runtime
        // switch graph into its non-focusing enrollment path. Load the single
        // canonical switch owner only for the explicit Welcome/open intent.
        const { setActiveServerAndSwitch } = await import('@/sync/domains/server/activeServerSwitch');
        if (shouldCancel?.()) return 'superseded';
        const switched = await setActiveServerAndSwitch({
            serverId: resolveServerProfileScopeId(resolvedProfile.profile),
            scope: resolveRoutineServerSelectionScope(Platform.OS, isDesktopHost()),
        });
        return switched === 'blocked' ? 'blocked' : 'completed';
    } catch {
        return 'blocked';
    }
}

function publishPending(
    result: HomeLoginContinuationResult,
    serviceKey?: string,
    entryIntent?: AccountServiceEntryIntent,
    homeServerIdentityId?: string,
): void {
    const boundServiceKey = serviceKey ?? pendingPreferredHomeEnrollment?.serviceKey ?? null;
    const boundEntryIntent = entryIntent ?? pendingPreferredHomeEnrollment?.entryIntent ?? null;
    const boundHomeServerIdentityId = result.kind === 'approval_required'
        ? result.homeServerIdentityId
        : homeServerIdentityId ?? pendingPreferredHomeEnrollment?.homeServerIdentityId ?? null;
    pendingPreferredHomeEnrollment = isResumableHomeLoginContinuation(result)
        && boundServiceKey
        && boundEntryIntent
        && boundHomeServerIdentityId
        ? {
            ...result,
            serviceKey: boundServiceKey,
            entryIntent: boundEntryIntent,
            homeServerIdentityId: boundHomeServerIdentityId,
        }
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

export async function cancelPendingPreferredHomeEnrollment(
    fallback?: Pick<PendingPreferredHomeEnrollment, 'cancel'>,
): Promise<void> {
    const pending = pendingPreferredHomeEnrollment;
    if (pending && fallback && pending.cancel !== fallback.cancel) {
        await fallback.cancel().catch(() => {});
        return;
    }
    const cancellation = (pending ?? fallback)?.cancel().catch(() => {});
    publishPending({ kind: 'cancelled' });
    await cancellation;
}

export async function resumePendingPreferredHomeEnrollment(): Promise<HomeLoginContinuationResult | null> {
    const pending = pendingPreferredHomeEnrollment;
    if (!pending) return null;
    if (pendingPreferredHomeResume?.pending === pending) {
        return await pendingPreferredHomeResume.promise;
    }
    const resume = pending.resume().then(async (result) => {
        if (result.kind === 'enrolled') {
            const entryOutcome = await finalizePreferredHomeEnrollmentEntryIntent(
                result.homeServerIdentityId,
                pending.entryIntent,
                pending.serviceKey,
            );
            if (entryOutcome === 'blocked') {
                throw new Error('Unable to enter the enrolled preferred Home');
            }
            if (entryOutcome === 'superseded') {
                result = { kind: 'cancelled' };
            }
        }
        if (pendingPreferredHomeEnrollment === pending) {
            publishPending(
                result,
                pending.serviceKey,
                pending.entryIntent,
                pending.homeServerIdentityId,
            );
            return pendingPreferredHomeEnrollment ?? result;
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
    options: Readonly<{
        entryIntent: AccountServiceEntryIntent;
        shouldCancel?: () => boolean;
        shouldInvalidateContinuation?: () => boolean;
    }>,
): Promise<PreferredDirectoryHomeEnrollmentResult> {
    if (options.shouldCancel?.()) return { kind: 'cancelled' };
    const snapshot = session.snapshot;
    if (snapshot.status === 'unsupported') return { kind: 'unavailable', reason: 'unsupported' };
    if (snapshot.status !== 'ready') return { kind: 'unavailable', reason: 'directory_not_ready' };
    if (!session.supportsHomeEnrollment) return { kind: 'unavailable', reason: 'unsupported' };

    const directory = classifyAccountServiceDirectory({
        homes: snapshot.homes,
        preferredHomeServerIdentityId: snapshot.preferredHomeServerIdentityId,
    });
    if (directory.kind === 'invalid') return { kind: 'failed' };
    const entry = directory.preferredHome;
    if (!entry) return { kind: 'unavailable', reason: 'no_preferred_home' };

    const retained = pendingPreferredHomeEnrollment;
    if (
        retained?.serviceKey === session.serviceKey
        && retained.homeServerIdentityId === entry.homeServerIdentityId
        && retained.entryIntent === options.entryIntent
    ) return retained;

    await cancelPendingPreferredHomeEnrollment();
    if (options.shouldCancel?.()) return { kind: 'cancelled' };
    try {
        const keyPair = sodium.crypto_box_keypair();
        const clientBoxPublicKeyBase64 = encodeBase64(keyPair.publicKey, 'base64');
        const assertion = await session.requestLoginAssertion(entry.homeServerIdentityId,
            // The Lane 02 assertion DTO deliberately uses canonical padded
            // base64 (not base64url) for the requester box key.
            clientBoxPublicKeyBase64,
        );
        const issuerServerIdentityId = session.serviceKey.slice(session.serviceKey.lastIndexOf('\u0000') + 1);
        const verification = verifyAccountServiceHomeAssertionRequest({
            home: entry,
            issuerServerIdentityId,
            requesterPublicKeyBase64: clientBoxPublicKeyBase64,
            assertion,
        });
        if (verification.kind !== 'verified') {
            throw new Error(`Account Service assertion verification failed: ${verification.reason}`);
        }
        if (options.shouldCancel?.()) return { kind: 'cancelled' };
        const result = await continueHomeLoginEnrollment({
            home: entry,
            clientSecretKey: keyPair.privateKey,
            assertion,
            shouldCancel: options.shouldCancel,
        });
        // Retryable first-contact failures and durable approval requests both
        // retain the exact assertion/key/descriptor tuple. Publish that
        // detached continuation before initiating-screen teardown can discard
        // it; only explicit service replacement/disconnect invalidates it.
        if (isResumableHomeLoginContinuation(result)) {
            // Disconnect and Account Service replacement are stronger than
            // ordinary initiating-screen cancellation. They can race the
            // Home's 202 before the continuation exists, so consume the newly
            // detached continuation here instead of publishing it afterward.
            if (options.shouldInvalidateContinuation?.()) {
                await result.cancel().catch(() => {});
                return { kind: 'cancelled' };
            }
            publishPending(
                result,
                session.serviceKey,
                options.entryIntent,
                entry.homeServerIdentityId,
            );
            return pendingPreferredHomeEnrollment ?? result;
        }
        publishPending(result, session.serviceKey, options.entryIntent);
        return result;
    } catch (error) {
        return { kind: 'failed', error };
    }
}
