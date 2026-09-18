export type PoolMembershipDiff = Readonly<{
    toAdd: ReadonlyArray<string>;
    toRemove: ReadonlyArray<string>;
}>;

/** Computes the exact account mutations required to reach one target Pool membership. */
export function computePoolMembershipDiff(
    selectedAccountIds: ReadonlyArray<string>,
    nextSelectedAccountIds: ReadonlyArray<string>,
): PoolMembershipDiff {
    const selected = new Set(selectedAccountIds);
    const next = new Set(nextSelectedAccountIds);
    return {
        toAdd: Array.from(next).filter((accountId) => !selected.has(accountId)),
        toRemove: Array.from(selected).filter((accountId) => !next.has(accountId)),
    };
}
