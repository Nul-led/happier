import type { HomeAccountChangeEvent } from '@/sync/runtime/orchestration/homeAccountChange';
import { subscribeHomeAccountChange } from '@/sync/runtime/orchestration/homeAccountChange';

type SessionListQueryInvalidationTarget = Readonly<{
    invalidate(): Promise<void>;
}>;

type SessionListQueryInvalidationReader = () => ReadonlyMap<string, SessionListQueryInvalidationTarget>;
const mountedSessionListQueryReaders = new Set<SessionListQueryInvalidationReader>();

/**
 * Invalidates the mounted filtered-list controller for one exact Home.
 *
 * This is the imperative leaf of the existing query-invalidation owner. It is
 * used when a local wall-clock boundary changes list membership without a Home
 * Account-change event (for example a persisted reminder becoming due).
 */
export function invalidateSessionListQueryHome(serverId: string): Promise<void> {
    const pending: Array<Promise<void>> = [];
    for (const readControllers of mountedSessionListQueryReaders) {
        const target = readControllers().get(serverId);
        if (target) pending.push(target.invalidate());
    }
    return Promise.all(pending).then(() => undefined);
}

/**
 * Exact focused-Home catch-up identifies `self` for Account settings, profile,
 * security and encryption changes. The incumbent planner supplies whether the
 * concrete change can alter qualified list membership; this consumer must not
 * guess from the shared `self` identifier.
 *
 * A socket-only concurrent-Home wake has no entity identities, so it stays
 * conservative. Do not infer a domain cause from content or ciphertext here.
 */
export function shouldInvalidateSessionListQueryForAccountChange(
    event: HomeAccountChangeEvent,
): boolean {
    if (event.sessionListQueryAffects !== undefined) {
        return event.sessionListQueryAffects;
    }
    return event.entityIds === undefined
        || event.entityIds.some((entityId) => entityId !== 'self');
}

/**
 * Connect mounted filtered-list controllers to the incumbent Account-change
 * owner. This adapter requests one exact-Home refresh; it does not interpret
 * membership or create another event stream.
 */
export function subscribeSessionListQueryHomeInvalidation(
    readControllers: SessionListQueryInvalidationReader,
): () => void {
    mountedSessionListQueryReaders.add(readControllers);
    const unsubscribeAccountChanges = subscribeHomeAccountChange((event) => {
        if (!shouldInvalidateSessionListQueryForAccountChange(event)) return;
        void readControllers().get(event.serverId)?.invalidate();
    });
    return () => {
        unsubscribeAccountChanges();
        mountedSessionListQueryReaders.delete(readControllers);
    };
}
