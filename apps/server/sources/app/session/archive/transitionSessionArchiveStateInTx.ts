import { applySessionArchiveTransitionToFollowsInTx } from "@/app/session/follow/lifecycle";
import type { Tx } from "@/storage/inTx";

/** The canonical transactional Session archive-state write and its Follow lifecycle. */
export async function transitionSessionArchiveStateInTx(params: Readonly<{
    tx: Tx;
    sessionId: string;
    wasArchived: boolean;
    archivedAt: Date | null;
    meaningfulActivityAt?: Date;
}>) {
    const session = await params.tx.session.update({
        where: { id: params.sessionId },
        data: {
            archivedAt: params.archivedAt,
            ...(params.meaningfulActivityAt
                ? { meaningfulActivityAt: params.meaningfulActivityAt }
                : {}),
        },
    });
    await applySessionArchiveTransitionToFollowsInTx({
        tx: params.tx,
        sessionId: params.sessionId,
        wasArchived: params.wasArchived,
        isArchived: params.archivedAt !== null,
    });
    return session;
}
