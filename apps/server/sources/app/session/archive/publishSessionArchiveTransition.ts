import { refreshTrackedSessionAccountBadgePushes } from "@/app/activity/refreshAccountActivityBadgePushes";
import { buildUpdateSessionUpdate, eventRouter } from "@/app/events/eventRouter";
import type { SessionRecipientCursor } from "@/app/session/changeTracking/markSessionProjectionRecipientsChanged";
import {
    loadSessionTranscriptPublicationRecipientProjection,
    projectSessionTranscriptPublicationRealtimeProjection,
    type SessionTranscriptPublicationRealtimeProjection,
} from "@/app/session/sessionTranscriptPublicationPolicy";
import { randomKeyNaked } from "@/utils/keys/randomKeyNaked";

export type SessionArchiveTransitionPublication = Readonly<{
    sessionId: string;
    projection: SessionTranscriptPublicationRealtimeProjection;
    recipientCursors: readonly SessionRecipientCursor[];
    badgeAttentionChanged: boolean;
}>;

/** The canonical post-commit badge and realtime effects for an archive-state transition. */
export async function publishSessionArchiveTransition(
    publication: SessionArchiveTransitionPublication,
): Promise<void> {
    await refreshTrackedSessionAccountBadgePushes({
        badgeAttentionChanged: publication.badgeAttentionChanged,
        sessionId: publication.sessionId,
    });
    const session = await loadSessionTranscriptPublicationRecipientProjection(publication.sessionId);
    if (!session) return;
    await Promise.all(publication.recipientCursors.map(async ({ accountId, cursor }) => {
        const projection = projectSessionTranscriptPublicationRealtimeProjection(
            publication.projection,
            session,
            accountId,
        );
        if (projection.kind === "suppress") return;
        const payload = buildUpdateSessionUpdate(
            publication.sessionId,
            cursor,
            randomKeyNaked(12),
            undefined,
            undefined,
            projection.value,
        );
        eventRouter.emitUpdate({
            userId: accountId,
            payload,
            recipientFilter: {
                type: "all-interested-in-session",
                sessionId: publication.sessionId,
            },
        });
        // Account automation has no present-user credential evidence. Only the
        // Session owner has an independent path suitable for machine delivery;
        // collaborator sockets are qualified individually above.
        if (accountId === session.accountId) {
            eventRouter.emitUpdate({
                userId: accountId,
                payload,
                recipientFilter: { type: "user-machine-scoped-only" },
            });
        }
    }));
}
