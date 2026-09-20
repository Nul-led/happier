import { areServerProfileIdentifiersEquivalent } from '@/sync/domains/server/serverProfiles';
import { getActiveServerSnapshot } from '@/sync/domains/server/serverRuntime';
import { storage } from '@/sync/domains/state/storageStore';
import { sync } from '@/sync/sync';
import {
    fetchConcurrentSessionListQueryPage,
    getConcurrentSessionListQueryHomeAvailability,
    retryConcurrentSessionListQueryHome,
} from '@/sync/runtime/orchestration/concurrentSessionCache';
import {
    getAppliedActiveServerSnapshot,
    isAppliedActiveServerRuntimeAvailable,
    retryActiveServerConnection,
} from '@/sync/runtime/orchestration/connectionManager';

import { buildOrdinarySessionListHomeState } from './ordinarySessionListHomeState';
import type {
    SessionListQueryHomeState,
    SessionListQueryPageRequest,
} from './sessionListQueryController';

export type SessionListQueryHomeAvailability = 'online' | 'pending' | 'offline';

export function getSessionListQueryHomeAvailability(
    serverIdRaw: string,
): SessionListQueryHomeAvailability {
    const serverId = String(serverIdRaw ?? '').trim();
    if (!serverId) return 'offline';
    const staged = getActiveServerSnapshot();
    const applied = getAppliedActiveServerSnapshot();
    const runtimeAvailable = isAppliedActiveServerRuntimeAvailable();
    const isApplied = areServerProfileIdentifiersEquivalent(serverId, applied.serverId);
    const hasUnappliedStagedHome = !areServerProfileIdentifiersEquivalent(staged.serverId, applied.serverId);

    // The staged target is withdrawn from the secondary cache before it can own the singleton.
    // That ownership gap is loading, not evidence that the Home is unreachable.
    if (
        hasUnappliedStagedHome
        && areServerProfileIdentifiersEquivalent(serverId, staged.serverId)
    ) {
        return 'pending';
    }
    if (runtimeAvailable && isApplied) {
        return storage.getState().socketStatus === 'connected' ? 'online' : 'offline';
    }
    const concurrentAvailability = getConcurrentSessionListQueryHomeAvailability(serverId);
    if (concurrentAvailability !== 'offline') return concurrentAvailability;
    return 'offline';
}

export function isSessionListQueryHomeOnline(serverIdRaw: string): boolean {
    return getSessionListQueryHomeAvailability(serverIdRaw) === 'online';
}

/**
 * Whether Sync's singleton lifecycle owns this Home's ordinary `/v2/sessions`
 * corpus. It is the same fact that routes a page request to Sync rather than to
 * the concurrent cache, so the filter's ordinary corpus cannot disagree with the
 * transport about which Home Sync is serving.
 */
export function isSyncOwnedOrdinarySessionListHome(serverIdRaw: string): boolean {
    const serverId = String(serverIdRaw ?? '').trim();
    if (!serverId) return false;
    return isAppliedActiveServerRuntimeAvailable()
        && areServerProfileIdentifiersEquivalent(serverId, getAppliedActiveServerSnapshot().serverId);
}

/**
 * Sync's ordinary frontier for this Home, projected onto the per-Home query state.
 *
 * The filter reads this instead of opening a second paginator over the same corpus,
 * so one cursor advances and one membership is canonical.
 */
export function readSyncOrdinarySessionListHomeState(input: Readonly<{
    serverId: string;
    requestedQueryKey: string;
    online: boolean | null;
}>): SessionListQueryHomeState {
    const state = storage.getState();
    return buildOrdinarySessionListHomeState({
        serverId: input.serverId,
        requestedQueryKey: input.requestedQueryKey,
        sessionIds: state.ordinarySessionListMembershipByServerId?.[input.serverId] ?? [],
        observation: state.concurrentSessionListCacheByServerId?.[input.serverId]?.listObservation ?? null,
        lifecycle: sync.readOrdinarySessionListLifecycle(),
        online: input.online,
    });
}

/** Advance Sync's ordinary frontier. There is no second cursor to advance. */
export async function loadNextSyncOrdinarySessionListPage(): Promise<void> {
    await sync.fetchMoreSessions();
}

/** Replace Sync's ordinary corpus from page one. */
export async function refreshSyncOrdinarySessionList(): Promise<void> {
    await sync.refreshSessions();
}

export async function fetchSessionListQueryPageForHome(
    serverIdRaw: string,
    page: SessionListQueryPageRequest,
) {
    const serverId = String(serverIdRaw ?? '').trim();
    if (isSyncOwnedOrdinarySessionListHome(serverId)) {
        return sync.fetchSessionListQueryPage(serverId, page);
    }
    return fetchConcurrentSessionListQueryPage(serverId, page);
}

/**
 * The query source owns controller refresh; this boundary only restores the
 * exact Home transport that made its query unavailable.
 */
export async function retrySessionListQueryHome(serverIdRaw: string): Promise<void> {
    const serverId = String(serverIdRaw ?? '').trim();
    if (!serverId) return;
    if (isSyncOwnedOrdinarySessionListHome(serverId)) {
        await retryActiveServerConnection();
        return;
    }
    await retryConcurrentSessionListQueryHome(serverId);
}
