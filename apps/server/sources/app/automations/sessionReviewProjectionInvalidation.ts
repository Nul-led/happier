import type { Tx } from '@/storage/inTx';
import { markSessionProjectionRecipientsChanged } from '@/app/session/changeTracking/markSessionProjectionRecipientsChanged';
import { scheduleSessionRelationBroadcastAfterTx } from '@/app/session/relations/sessionRelationChanges';

/** Run lifecycle changes release the review barrier through incumbent Session hints. */
export async function invalidateSessionReviewProjectionsForAutomationInTx(tx: Tx, automationId: string): Promise<void> {
    const origins = await tx.automationRun.findMany({
        where: { automationId, causeSourceSessionId: { not: null }, causeTriggerKind: 'sessionLifecycle',
            causeSessionLifecycleEvent: { in: ['parentTurnCompleted', 'parentTurnFailed', 'parentTurnCancelled'] } },
        distinct: ['causeSourceSessionId'], select: { causeSourceSessionId: true },
    });
    for (const { causeSourceSessionId } of origins) {
        if (!causeSourceSessionId) continue;
        const recipients = await markSessionProjectionRecipientsChanged({ tx, sessionId: causeSourceSessionId });
        scheduleSessionRelationBroadcastAfterTx(tx, causeSourceSessionId, recipients.map(({ accountId }) => accountId));
    }
}
