import { areServerProfileIdentifiersEquivalent } from '@/sync/domains/server/serverProfiles';
import { storage } from '@/sync/domains/state/storageStore';
import { getSyncSingleton } from '@/sync/runtime/getSyncSingleton';

export type MemorySearchSessionTargetV1 = Readonly<{
    sessionKey: string;
    serverId: string;
    sessionId: string;
}>;

export type MemorySearchSessionRead = Readonly<{ ok: boolean; errorCode?: string }>;

/**
 * Authorizes transcript hits whose Session is not in the local projection for the
 * hit's own server scope.
 *
 * A transcript index — daemon-local or Home-derived — is derived state that can
 * outlive the Account's access to a Session. Each hit the local server-scoped
 * projection does not already carry is therefore read through the canonical
 * explicit-server Session reader before it can be displayed or activated. A missing
 * authorization, a missing Session, or an unreadable target suppresses the row
 * rather than showing a stale entity — and the same read supplies the canonical
 * metadata a normal Session row needs.
 */
export async function hydrateMemorySearchSessionTargets(params: Readonly<{
    targets: readonly MemorySearchSessionTargetV1[];
    hasLocalSession: (target: MemorySearchSessionTargetV1) => boolean;
    readSessionForServerScope: (
        args: Readonly<{ serverId: string; sessionId: string }>,
    ) => Promise<MemorySearchSessionRead>;
    signal?: AbortSignal;
}>): Promise<readonly MemorySearchSessionTargetV1[]> {
    const authorized: MemorySearchSessionTargetV1[] = [];

    for (const target of params.targets) {
        if (params.signal?.aborted) break;
        if (params.hasLocalSession(target)) {
            authorized.push(target);
            continue;
        }
        try {
            const read = await params.readSessionForServerScope({
                serverId: target.serverId,
                sessionId: target.sessionId,
            });
            if (read.ok) authorized.push(target);
        } catch {
            // Unreadable target: keep the surface coherent by suppressing the
            // row instead of presenting an entity we cannot authorize.
        }
    }

    return authorized;
}

/**
 * Server-scoped local presence. A same-id Session held for another server is not
 * this hit's Session, so it can neither authorize the row nor supply its metadata.
 */
export function hasLocalMemorySearchSessionForServerScope(
    target: MemorySearchSessionTargetV1,
): boolean {
    const session = storage.getState().sessions[target.sessionId];
    if (!session) return false;
    const sessionServerId = String(session.serverId ?? '').trim();
    // A legacy record with no server owner cannot authorize an explicitly
    // scoped hit. Force the canonical reader to bind it to the requested Home
    // before derived transcript bytes become visible.
    if (!sessionServerId) return false;
    return areServerProfileIdentifiersEquivalent(sessionServerId, target.serverId);
}

/**
 * Default binding of the explicit-server Session reader for the search surfaces.
 * It never falls back to the focused server: the hit's own captured server scope is
 * the request target.
 */
export async function readMemorySearchSessionForServerScope(
    args: Readonly<{ serverId: string; sessionId: string }>,
): Promise<MemorySearchSessionRead> {
    const result = await getSyncSingleton().ensureSessionVisibleForMessageRoute(args.sessionId, {
        serverId: args.serverId,
        forceRefresh: true,
        includeTurnsProjection: false,
    });
    return result.kind === 'available'
        ? { ok: true }
        : { ok: false, errorCode: result.kind === 'missing' ? result.cause : result.kind };
}
