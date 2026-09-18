import { didSessionActivityBadgeSignalChange } from "@/app/activity/accountActivityBadge";
import {
    type SessionArchiveTransitionPublication,
} from "@/app/session/archive/publishSessionArchiveTransition";
import { transitionSessionArchiveStateInTx } from "@/app/session/archive/transitionSessionArchiveStateInTx";
import { markSessionProjectionRecipientsChanged } from "@/app/session/changeTracking/markSessionProjectionRecipientsChanged";
import type { Tx } from "@/storage/inTx";

import type { CreatedSessionRow } from "./layout1SessionRowWrite";

export type RestoredSessionTagRejoin = Readonly<{
    session: CreatedSessionRow;
    publication: SessionArchiveTransitionPublication | null;
}>;

/**
 * Applies the released ordinary tag-rejoin lifecycle without changing Session
 * content, pending state, placement or runtime activity.
 */
export async function restoreSessionTagRejoinInTx(
    tx: Tx,
    existing: CreatedSessionRow,
): Promise<RestoredSessionTagRejoin> {
    if (existing.active && existing.archivedAt === null) {
        return { session: existing, publication: null };
    }

    const meaningfulActivityAtDate = new Date();
    const meaningfulActivityAt = meaningfulActivityAtDate.getTime();
    const wasArchived = existing.archivedAt !== null;
    const session = await transitionSessionArchiveStateInTx({
        tx,
        sessionId: existing.id,
        wasArchived,
        archivedAt: null,
        meaningfulActivityAt: meaningfulActivityAtDate,
    });
    const projection = {
        sessionStart: true as const,
        meaningfulActivityAt,
        ...(wasArchived ? { archivedAt: null } : {}),
    };
    const recipientCursors = await markSessionProjectionRecipientsChanged({
        tx,
        sessionId: existing.id,
        hint: projection,
    });
    return {
        session,
        publication: {
            sessionId: existing.id,
            projection,
            recipientCursors,
            badgeAttentionChanged: didSessionActivityBadgeSignalChange(existing, session),
        },
    };
}
