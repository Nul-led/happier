/**
 * A global transcript query may legitimately match an active Session that the
 * archived/hidden screen does not display. Only an unknown or eligible target
 * is still pending; a known active, non-hidden target is terminally out of
 * scope and must not leave the empty state spinning forever.
 */
export function hasPendingArchivedTranscriptMatch(input: Readonly<{
    targetKeys: readonly string[];
    knownSessionKeys: ReadonlySet<string>;
    eligibleSessionKeys: ReadonlySet<string>;
    renderedSessionKeys: ReadonlySet<string>;
}>): boolean {
    return input.targetKeys.some((key) => {
        if (input.renderedSessionKeys.has(key)) return false;
        if (!input.knownSessionKeys.has(key)) return true;
        return input.eligibleSessionKeys.has(key);
    });
}
