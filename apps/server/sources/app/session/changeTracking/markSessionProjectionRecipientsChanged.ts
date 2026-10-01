import { resolveCurrentSessionRecipientAccountIdsInTx } from "@/app/session/access/sessionRecipients";
import {
    loadSessionTranscriptPublication,
    projectSessionTranscriptPublicationChangeHint,
} from "@/app/session/sessionTranscriptPublicationPolicy";
import type { Tx } from "@/storage/inTx";
import {
    markAccountChangesForSessionAccounts,
    type SessionAccountChangeCursor,
} from "./markAccountChangesForSessionAccounts";
import { invalidateSessionFollowDestinationsForSourceChangeInTx } from "@/app/session/follow/sessionFollowEdgeService";
import { invalidateSessionReportsToForSourceChangeInTx } from "@/app/session/relations/sessionReportsToService";

export type SessionRecipientCursor = SessionAccountChangeCursor;

/**
 * Transcript-publication-aware fanout. It keeps its own publication filter and
 * delegates the actual AccountChange writes to the generic Session fanout, so a
 * Session-owned domain that is not transcript publication can reuse the fanout
 * without inheriting this publication ceiling.
 *
 * The recipient set comes from the canonical Session access recipient resolver, so
 * a Team- or Group-granted collaborator receives the same projection invalidation
 * as a direct recipient. Callers that already resolved the affected Accounts inside
 * their own transaction pass them explicitly instead.
 */
export async function markSessionProjectionRecipientsChanged(params: {
    tx: Tx;
    sessionId: string;
    hint?: unknown;
    recipientAccountIds?: readonly string[];
    hintForRecipient?: (accountId: string) => unknown;
}): Promise<SessionRecipientCursor[]> {
    const publication = await loadSessionTranscriptPublication(params.tx, params.sessionId);
    const recipientAccountIds = params.recipientAccountIds
        ?? await resolveCurrentSessionRecipientAccountIdsInTx(params.tx, {
            sessionId: params.sessionId,
        });

    const cursors = await markAccountChangesForSessionAccounts({
        tx: params.tx,
        sessionId: params.sessionId,
        accountIds: recipientAccountIds,
        hintForAccount: (accountId) => {
            const hint = projectSessionTranscriptPublicationChangeHint(
                params.hintForRecipient
                    ? params.hintForRecipient(accountId)
                    : params.hint,
                publication,
                accountId,
            );
            return hint.kind === "suppress"
                ? { kind: "suppress" }
                : { kind: "publish", value: hint.value };
        },
    });
    await invalidateSessionFollowDestinationsForSourceChangeInTx(params.tx, {
        sourceSessionId: params.sessionId,
    });
    await invalidateSessionReportsToForSourceChangeInTx(params.tx, { sessionId: params.sessionId });
    return cursors;
}
