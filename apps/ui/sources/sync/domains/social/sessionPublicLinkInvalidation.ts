import { areServerProfileIdentifiersEquivalent } from '@/sync/domains/server/serverProfiles';
import {
    publishHomeAccountChange,
    subscribeHomeAccountChange,
} from '@/sync/runtime/orchestration/homeAccountChange';

type SessionPublicLinkInvalidationTarget = Readonly<{
    serverId: string;
    sessionId: string;
}>;

const ENTITY_ID_PREFIX = 'session-public-link:';

function publicLinkEntityId(sessionId: string): string {
    return `${ENTITY_ID_PREFIX}${sessionId}`;
}

/**
 * Publish a content-free wake through the existing exact-Home Account-change
 * observation seam. The mounted controller remains the state authority and
 * refetches the publication through its canonical owner endpoint.
 */
export function notifySessionPublicLinkInvalidated(target: SessionPublicLinkInvalidationTarget): void {
    publishHomeAccountChange(
        target.serverId,
        [publicLinkEntityId(target.sessionId)],
        { sessionListQueryAffects: false },
    );
}

export function subscribeSessionPublicLinkInvalidation(
    target: SessionPublicLinkInvalidationTarget,
    listener: () => void,
): () => void {
    const entityId = publicLinkEntityId(target.sessionId);
    return subscribeHomeAccountChange((event) => {
        if (!areServerProfileIdentifiersEquivalent(event.serverId, target.serverId)) return;
        // Live public-share events publish the domain-specific marker above.
        // Reconnect catch-up reuses the canonical AccountChange row, whose
        // entityId is the raw Session id for both `share` and `session` changes.
        // Either is a content-free hint; the owner endpoint remains authoritative.
        if (!event.entityIds?.some((candidate) => (
            candidate === entityId || candidate === target.sessionId
        ))) return;
        listener();
    });
}
