import * as React from 'react';

import { createServerAccountScope, type ServerAccountScope } from '@/sync/domains/scope/serverAccountScope';
import { observeHomeGovernance } from '@/sync/engine/home/governance/homeGovernanceEngine';
import {
    getHomeGovernanceSnapshot,
    subscribeHomeGovernanceSnapshots,
    type HomeGovernanceSnapshot,
} from '@/sync/store/home/governance/homeGovernanceSnapshots';

/**
 * Subscribes to the governance projection of one exact Home *and Account*, and
 * keeps it observed for as long as the surface is mounted.
 *
 * Loading and invalidation belong to the engine: it owns the initial load, the
 * Account-change wake and retry, so this hook adds no second refresh policy. The
 * wake carries no governance content and triggers no Session or Machine reload.
 */
export function useHomeGovernanceSnapshot(
    scope: ServerAccountScope | null | undefined,
): HomeGovernanceSnapshot | null {
    const serverId = scope?.serverId ?? '';
    const accountId = scope?.accountId ?? '';

    const getSnapshot = React.useCallback(
        () => getHomeGovernanceSnapshot(createServerAccountScope(serverId, accountId)),
        [serverId, accountId],
    );

    const snapshot = React.useSyncExternalStore(
        subscribeHomeGovernanceSnapshots,
        getSnapshot,
        getSnapshot,
    );

    React.useEffect(() => {
        const observedScope = createServerAccountScope(serverId, accountId);
        if (!observedScope) return;
        return observeHomeGovernance(observedScope);
    }, [serverId, accountId]);

    return snapshot;
}
