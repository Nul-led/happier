import { markAccountChanged } from "@/app/changes/markAccountChanged";
import type { Tx } from "@/storage/inTx";

export type SessionAccountChangeCursor = { accountId: string; cursor: number };

/**
 * The generic Session AccountChange fanout.
 *
 * It knows only how to wake an explicit set of Accounts for one Session. Every
 * decision about *which* Accounts and *whether* a hint is safe for a given
 * recipient belongs to the caller above it, so transcript publication ceilings
 * cannot silently become the ceiling of an unrelated Session-owned domain.
 */
export async function markAccountChangesForSessionAccounts(params: {
    tx: Tx;
    sessionId: string;
    accountIds: readonly string[];
    hint?: unknown;
    hintForAccount?: (accountId: string) => { kind: "suppress" } | { kind: "publish"; value: unknown };
}): Promise<SessionAccountChangeCursor[]> {
    const cursors: SessionAccountChangeCursor[] = [];
    for (const accountId of params.accountIds) {
        const projected = params.hintForAccount
            ? params.hintForAccount(accountId)
            : { kind: "publish" as const, value: params.hint };
        if (projected.kind === "suppress") continue;
        const cursor = await markAccountChanged(params.tx, {
            accountId,
            kind: "session",
            entityId: params.sessionId,
            hint: projected.value,
        });
        cursors.push({ accountId, cursor });
    }
    return cursors;
}
