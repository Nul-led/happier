import { db } from "@/storage/db";
import { resolveSessionAccessForAccountsInTx, type EffectiveSessionAccess } from "@/app/session/access/sessionAccess";
import { backgroundDeliveryAuthentication } from "@/app/session/access/sessionAccessAuthentication";
import type { Tx } from "@/storage/inTx";

import { listRelevantAccountIdsForSessionBadgeRefresh } from "./readState";

/**
 * The one admission every background delivery leg takes.
 *
 * OS push, the content-free wake and the badge-refresh push all disclose the
 * same fact — that this exact Session changed — to a device that presented no
 * credential, so they share one decision rather than each reading access their
 * own way. It is the ordinary credential-qualified decision taken with the
 * evidence background delivery actually has (none), so owner, direct and
 * inherited-authentication arms admit exactly as before while a restricted Team
 * admits a recipient only while it qualifies without evidence.
 *
 * One event reaches every recipient of one Session, so the decision is taken
 * set-oriented: the access row is read once for a bounded batch of recipients
 * and the Team qualification once for the credential context they share.
 */
export async function admitSessionBackgroundDeliveryInTx(
    tx: Tx,
    params: Readonly<{ sessionId: string; accountIds: readonly string[] }>,
): Promise<ReadonlyMap<string, EffectiveSessionAccess>> {
    const accesses = await resolveSessionAccessForAccountsInTx(tx, {
        sessionId: params.sessionId,
        accountIds: params.accountIds,
        authentication: backgroundDeliveryAuthentication(),
    });
    const admitted = new Map<string, EffectiveSessionAccess>();
    for (const [accountId, access] of accesses) {
        if (access.capabilities.readTranscript) admitted.set(accountId, access);
    }
    return admitted;
}

/**
 * Recipients of one Session's badge-refresh push: the exact owner-or-active-Follow
 * tracking relation, admitted by the same background-delivery decision.
 *
 * The tracking relation stays the badge's own candidate owner — it also seeds
 * read-state and Discussion attention, which are private state rather than
 * delivery — so the admission is applied here, at the push fanout, and nowhere
 * else.
 */
export async function listSessionBadgeRefreshPushAccountIds(sessionId: string): Promise<readonly string[]> {
    const tracked = await listRelevantAccountIdsForSessionBadgeRefresh(sessionId);
    if (tracked.length === 0) return [];
    const admitted = await admitSessionBackgroundDeliveryInTx(db, { sessionId, accountIds: tracked });
    return tracked.filter((accountId) => admitted.has(accountId));
}
