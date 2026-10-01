import type { Tx } from '@/storage/inTx';
import type { SessionAccessAuthentication } from '@/app/session/access/sessionAccessAuthentication';
import {
    resolveEffectiveSessionAccessWhere,
    type SessionCollectiveAccessSnapshot,
} from '@/app/session/access/sessionAccessWhere';
import {
    isSessionTranscriptShareable,
    SESSION_TRANSCRIPT_PUBLICATION_SELECT,
} from '@/app/session/sessionTranscriptPublicationPolicy';

/** Structural reachability is not an access grant. Only readable IDs leave this owner. */
export async function readSessionLedSubtreeSessionIdsInTx(tx: Tx, input: Readonly<{
    accountId: string;
    rootSessionId: string;
    authentication: SessionAccessAuthentication;
    collectiveAccessSnapshot?: SessionCollectiveAccessSnapshot;
}>): Promise<string[]> {
    const access = await resolveEffectiveSessionAccessWhere({
        tx,
        accountId: input.accountId,
        capability: 'readTranscript',
        mode: 'effective_access_v1',
        authentication: input.authentication,
        collectiveAccessSnapshot: input.collectiveAccessSnapshot,
    });
    const root = await tx.session.findFirst({
        where: { AND: [access.where, { id: input.rootSessionId }] },
        select: { id: true, ...SESSION_TRANSCRIPT_PUBLICATION_SELECT },
    });
    if (!root || (root.accountId !== input.accountId && !isSessionTranscriptShareable(root))) return [];

    const reachable = new Set([root.id]);
    let frontier = [root.id];
    while (frontier.length > 0) {
        const edges = await tx.sessionReportsTo.findMany({
            where: { leadSessionId: { in: frontier } },
            select: { sessionId: true },
        });
        frontier = [];
        for (const edge of edges) {
            if (reachable.has(edge.sessionId)) continue;
            reachable.add(edge.sessionId);
            frontier.push(edge.sessionId);
        }
    }
    // Traverse unreadable intermediates without returning their identity. The
    // canonical access owner also restricts Runner credentials to current_session.
    const rows = await tx.session.findMany({
        where: { AND: [access.where, { id: { in: [...reachable] } }] },
        select: { id: true, ...SESSION_TRANSCRIPT_PUBLICATION_SELECT },
    });
    return rows.filter((row) => row.accountId === input.accountId || isSessionTranscriptShareable(row))
        .map((row) => row.id);
}
