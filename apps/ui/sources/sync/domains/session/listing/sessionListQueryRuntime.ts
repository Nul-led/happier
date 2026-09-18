import { areServerProfileIdentifiersEquivalent } from '@/sync/domains/server/serverProfiles';
import { getActiveServerSnapshot } from '@/sync/domains/server/serverRuntime';
import { storage } from '@/sync/domains/state/storageStore';
import { sync } from '@/sync/sync';
import {
    fetchConcurrentSessionListQueryPage,
    isConcurrentSessionListQueryHomeOnline,
} from '@/sync/runtime/orchestration/concurrentSessionCache';

import type { SessionListQueryPageRequest } from './sessionListQueryController';

export function isSessionListQueryHomeOnline(serverIdRaw: string): boolean {
    const serverId = String(serverIdRaw ?? '').trim();
    if (!serverId) return false;
    if (areServerProfileIdentifiersEquivalent(serverId, getActiveServerSnapshot().serverId)) {
        return storage.getState().socketStatus === 'connected';
    }
    return isConcurrentSessionListQueryHomeOnline(serverId);
}

export async function fetchSessionListQueryPageForHome(
    serverIdRaw: string,
    page: SessionListQueryPageRequest,
) {
    const serverId = String(serverIdRaw ?? '').trim();
    if (areServerProfileIdentifiersEquivalent(serverId, getActiveServerSnapshot().serverId)) {
        return sync.fetchSessionListQueryPage(serverId, page);
    }
    return fetchConcurrentSessionListQueryPage(serverId, page);
}
