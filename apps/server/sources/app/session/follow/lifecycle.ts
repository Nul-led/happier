import type { Tx } from "@/storage/inTx";
import { reseedRestoredSessionFollowEdgesInTx } from "./sessionFollowEdgeService";

/** Resumes retained interest at current context without changing a human read cursor. */
export async function applySessionArchiveTransitionToFollowsInTx(input: Readonly<{
    tx: Tx;
    sessionId: string;
    wasArchived: boolean;
    isArchived: boolean;
}>): Promise<void> {
    if (input.wasArchived === input.isArchived || input.isArchived) return;
    await input.tx.accountSessionFollow.updateMany({
        where: { sessionId: input.sessionId, following: true, includeInVoice: true },
        data: { voiceDeliveredFrontier: null },
    });
    await reseedRestoredSessionFollowEdgesInTx(input.tx, {
        sessionId: input.sessionId,
        archived: false,
    });
}
