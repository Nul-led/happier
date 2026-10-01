import type { Tx } from "@/storage/inTx";

/** Admissions and claims serialize on the scoped trigger's existing row. */
export async function lockScopedAutomationTriggerInTx(tx: Tx, accountId: string, triggerId: string) {
    const locked = await tx.automationTrigger.updateMany({
        where: { id: triggerId, automation: { accountId, scopeSessionId: { not: null } } },
        // Acquire the row's write lock without changing the authored revision.
        data: { revision: { increment: 0 } },
    });
    if (locked.count !== 1) return null;
    return await tx.automationTrigger.findUniqueOrThrow({
        where: { id: triggerId }, select: { revision: true, remainingOccurrences: true },
    });
}
