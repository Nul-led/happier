import { getCachedServerFeaturesSnapshot } from '@/sync/api/capabilities/serverFeaturesClient';
import { resolveRuntimeFeatureDecisionFromSnapshot } from '@/sync/domains/features/featureDecisionRuntime';
import { storage } from '@/sync/domains/state/storageStore';

/**
 * Released detail stays owner/direct unless the exact Home's already-loaded
 * Session-sharing decision opts this request into the current access projection.
 */
export function readSessionDetailAccessProjectionVersion(
    serverId?: string | null,
): 1 | undefined {
    const snapshot = getCachedServerFeaturesSnapshot({
        serverId: serverId ?? undefined,
    });
    const decision = snapshot
        ? resolveRuntimeFeatureDecisionFromSnapshot({
            featureId: 'sharing.session',
            settings: storage.getState().settings,
            snapshot,
        })
        : null;
    return decision?.state === 'enabled'
        ? 1
        : undefined;
}

export function buildSessionDetailAccessProjectionQuery(
    serverId?: string | null,
): string {
    return readSessionDetailAccessProjectionVersion(serverId) === 1
        ? '?accessProjectionVersion=1'
        : '';
}
