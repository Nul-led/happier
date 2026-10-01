import { afterTx, type Tx } from '@/storage/inTx';
import { markCurrentSessionReadersChanged } from '@/app/session/changeTracking/markCurrentSessionReadersChanged';
import { eventRouter } from '@/app/events/eventRouter';
import { randomKeyNaked } from '@/utils/keys/randomKeyNaked';

/** Content-free relation changes use the same AccountChange and committed socket hint. */
export function scheduleSessionRelationBroadcastAfterTx(tx: Tx, sessionId: string, accountIds: readonly string[]): void {
    const recipients = [...new Set(accountIds)].sort();
    if (recipients.length === 0) return;
    const payload = { id: randomKeyNaked(12), createdAt: Date.now(), body: { t: 'session-changed' as const, sessionId } };
    afterTx(tx, () => {
        for (const userId of recipients) void eventRouter.emitSessionBroadcast({ userId, sessionId, payload });
    });
}

export async function invalidateSessionRelationProjectionsInTx(tx: Tx, sessionIds: Iterable<string>): Promise<void> {
    for (const sessionId of [...new Set(sessionIds)].sort()) {
        const recipients = await markCurrentSessionReadersChanged({ tx, sessionId });
        scheduleSessionRelationBroadcastAfterTx(tx, sessionId, recipients.map(({ accountId }) => accountId));
    }
}
