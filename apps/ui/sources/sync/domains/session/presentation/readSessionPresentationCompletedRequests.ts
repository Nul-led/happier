import { readSharedMetadataPresentationCompletedRequests } from '@happier-dev/session-core/pending';

import type { Session } from '@/sync/domains/state/storageTypes';
import { isSessionAccessRecipient } from '@/sync/engine/sessions/normalizeSessionAccessProjection';

type PresentationSession = Pick<
    Session,
    'accessLevel' | 'access' | 'agentState' | 'metadata' | 'metadataLayoutVersion'
>;

/**
 * Completion facts used only to render transcript request state.
 *
 * Owners retain the canonical full AgentState. Shared recipients never gain
 * that authority: they may consume only the bounded, strict public projection
 * carried by layout-v1 shared metadata.
 */
export function readSessionPresentationCompletedRequests(
    session: PresentationSession,
): Record<string, unknown> | null {
    const isSharedRecipient = isSessionAccessRecipient(session.access, session.accessLevel);
    if (!isSharedRecipient) {
        return (session.agentState?.completedRequests as Record<string, unknown> | null | undefined) ?? null;
    }
    return readSharedMetadataPresentationCompletedRequests(
        session.metadata,
        session.metadataLayoutVersion,
    );
}
