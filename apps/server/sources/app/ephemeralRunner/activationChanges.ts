import { EPHEMERAL_RUNNER_ACTIVATION_ACCOUNT_CHANGE_ENTITY_ID_V1 } from "@happier-dev/protocol/changes";

import { markAccountChanged } from "@/app/changes/markAccountChanged";
import type { Tx } from "@/storage/inTx";

/** Stable coalescing identity for the creator's Runner-activation projection. */
export const EPHEMERAL_RUNNER_ACTIVATION_CHANGE_ENTITY_ID =
    EPHEMERAL_RUNNER_ACTIVATION_ACCOUNT_CHANGE_ENTITY_ID_V1;

/**
 * Wakes the creator Account after an activation transition it did not itself request.
 *
 * The creator learns about its own create/review/cancel/materialize calls from
 * their responses. Everything the *endpoint* does — claim, endpoint facts,
 * consent, readiness, decline — is invisible to a mounted creator unless the
 * Home says something changed. This is the existing content-free
 * AccountChange wake plus the canonical activation projection read: no
 * activation socket room, cursor, replay stream, push payload or poll interval
 * is introduced, and the wake carries no activation content.
 */
export async function publishRunnerActivationChangedInTx(
    tx: Tx,
    params: Readonly<{ creatorAccountId: string }>,
): Promise<void> {
    await markAccountChanged(tx, {
        accountId: params.creatorAccountId,
        kind: "account",
        entityId: EPHEMERAL_RUNNER_ACTIVATION_CHANGE_ENTITY_ID,
    });
}
