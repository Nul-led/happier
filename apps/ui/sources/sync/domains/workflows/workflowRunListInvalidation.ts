import type { ActiveServerAccountScopeLifetime } from '@/sync/domains/scope/activeServerAccountScope';
import { areServerProfileIdentifiersEquivalent } from '@/sync/domains/server/serverProfiles';
import {
    subscribeHomeAccountChange,
    type HomeAccountChangeEvent,
} from '@/sync/runtime/orchestration/homeAccountChange';

function accountChangeAffectsWorkflowRunList(event: HomeAccountChangeEvent): boolean {
    return event.entityIds === undefined
        || event.entityIds.some((entityId) => entityId.startsWith('workflow-run:'));
}

/**
 * Observe the incumbent Home Account-change wake for one visible Runs window.
 *
 * This does not interpret Run state or own synchronization: the existing list
 * query remains authoritative for filter membership, including attention.
 */
export function subscribeVisibleWorkflowRunListInvalidation(params: Readonly<{
    lifetime: ActiveServerAccountScopeLifetime;
    isVisibleWindowLoaded: () => boolean;
    invalidate: () => void;
}>): () => void {
    const unsubscribe = subscribeHomeAccountChange((event) => {
        if (!params.lifetime.isCurrent()) return;
        if (!areServerProfileIdentifiersEquivalent(event.serverId, params.lifetime.scope.serverId)) return;
        if (!accountChangeAffectsWorkflowRunList(event)) return;
        if (!params.isVisibleWindowLoaded()) return;
        params.invalidate();
    });
    const retirement = params.lifetime.onRetire(unsubscribe);
    return () => {
        retirement.dispose();
        unsubscribe();
    };
}
