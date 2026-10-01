import type { SessionPersonalEventEphemeralV1 } from "@happier-dev/protocol/updates";

import { eventRouter } from "@/app/events/eventRouter";
import { afterTx, type Tx } from "@/storage/inTx";

/**
 * Publish a semantic mutation's live recipient fact only after commit. The
 * mutation owns the target; the existing router rechecks that socket's current
 * Session authority. This carries no history or remote-notification enrollment.
 */
export function scheduleSessionPersonalEvent(
    tx: Tx,
    recipientAccountId: string,
    event: SessionPersonalEventEphemeralV1,
): void {
    afterTx(tx, () => {
        void eventRouter.emitEphemeral({
            userId: recipientAccountId,
            payload: event,
            recipientFilter: { type: "all-interested-in-session", sessionId: event.sessionId },
        });
    });
}
