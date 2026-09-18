import {
    SESSION_METADATA_LAYOUT_VERSION_V1,
    SessionActionConfirmationsV1Schema,
    SessionSharedMetadataV1Schema,
} from '@happier-dev/protocol';

import type { Session } from '@/sync/domains/state/storageTypes';
import { isSessionAccessRecipient } from '@/sync/engine/sessions/normalizeSessionAccessProjection';

type PresentationSession = Pick<
    Session,
    'accessLevel' | 'access' | 'agentState' | 'metadata' | 'metadataLayoutVersion'
>;

export function readSharedMetadataPresentationCompletedRequests(
    metadata: unknown,
    metadataLayoutVersion: unknown,
): Record<string, unknown> | null {
    if (metadataLayoutVersion !== SESSION_METADATA_LAYOUT_VERSION_V1) {
        return null;
    }
    const sharedMetadata = SessionSharedMetadataV1Schema.safeParse(metadata);
    if (!sharedMetadata.success) return null;
    const completedRequests = {
        ...(sharedMetadata.data.publicAgentState?.completedRequests ?? {}),
        ...(sharedMetadata.data.actionConfirmationsV1?.completedRequests ?? {}),
    };
    return Object.keys(completedRequests).length > 0 ? completedRequests : null;
}

export function readSharedMetadataActionConfirmationState(
    metadata: unknown,
    metadataLayoutVersion: unknown,
) {
    if (metadataLayoutVersion !== SESSION_METADATA_LAYOUT_VERSION_V1) return null;
    const sharedMetadata = SessionSharedMetadataV1Schema.safeParse(metadata);
    if (sharedMetadata.success) return sharedMetadata.data.actionConfirmationsV1 ?? null;
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return null;
    const actionState = SessionActionConfirmationsV1Schema.safeParse(
        (metadata as Record<string, unknown>).actionConfirmationsV1,
    );
    return actionState.success ? actionState.data : null;
}

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
