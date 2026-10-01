import type { TranscriptNavigationEntry } from './transcriptNavigationTypes';

/**
 * The Navigate pane's one filter row. All and Pinned are about the list; Approvals and Errors
 * are about what a turn did, which is only known for loaded turns (see `facts`).
 */
export type TranscriptNavigationFilter = 'all' | 'pinned' | 'approvals' | 'errors';

export type TranscriptNavigationSummary = Readonly<{
    counts: Readonly<Record<TranscriptNavigationFilter, number>>;
    /** Turns with an approval still waiting for the person. */
    waitingCount: number;
}>;

export function isTranscriptNavigationTurn(entry: TranscriptNavigationEntry): boolean {
    return entry.kind === 'user-turn' || entry.kind === 'pinned-user';
}

function askedForApproval(entry: TranscriptNavigationEntry): boolean {
    return (entry.facts?.approvals.length ?? 0) > 0;
}

function hadFailure(entry: TranscriptNavigationEntry): boolean {
    return (entry.facts?.failedCount ?? 0) > 0;
}

export function isTranscriptNavigationEntryWaiting(entry: TranscriptNavigationEntry): boolean {
    return entry.facts?.approvals.some((approval) => approval.outcome === 'pending') === true;
}

const MATCHERS: Readonly<Record<TranscriptNavigationFilter, (entry: TranscriptNavigationEntry) => boolean>> = {
    all: () => true,
    pinned: (entry) => entry.pinned,
    approvals: askedForApproval,
    errors: hadFailure,
};

export function summarizeTranscriptNavigationEntries(
    entries: readonly TranscriptNavigationEntry[],
): TranscriptNavigationSummary {
    let all = 0;
    let pinned = 0;
    let approvals = 0;
    let errors = 0;
    let waitingCount = 0;
    for (const entry of entries) {
        if (isTranscriptNavigationTurn(entry)) all += 1;
        if (entry.pinned) pinned += 1;
        if (askedForApproval(entry)) approvals += 1;
        if (hadFailure(entry)) errors += 1;
        if (isTranscriptNavigationEntryWaiting(entry)) waitingCount += 1;
    }
    return { counts: { all, pinned, approvals, errors }, waitingCount };
}

export function filterTranscriptNavigationEntries(
    entries: readonly TranscriptNavigationEntry[],
    filter: TranscriptNavigationFilter,
): readonly TranscriptNavigationEntry[] {
    if (filter === 'all') return entries;
    return entries.filter(MATCHERS[filter]);
}

const FACT_FILTERS: readonly TranscriptNavigationFilter[] = ['approvals', 'errors'];

/**
 * Approvals and Errors earn a chip only when they have something to show. The active filter keeps
 * its chip, so the row never loses the control the reader is using.
 */
export function resolveTranscriptNavigationFilterChips(
    summary: TranscriptNavigationSummary,
    active: TranscriptNavigationFilter,
): readonly TranscriptNavigationFilter[] {
    const chips: TranscriptNavigationFilter[] = ['all', 'pinned'];
    for (const filter of FACT_FILTERS) {
        if (summary.counts[filter] > 0 || filter === active) chips.push(filter);
    }
    return chips;
}

/**
 * A fact filter over history that is not all here is honestly partial: remote turns carry no
 * facts, and earlier turns may not be loaded at all.
 */
export function isTranscriptNavigationFilterPartial(params: Readonly<{
    entries: readonly TranscriptNavigationEntry[];
    filter: TranscriptNavigationFilter;
    historyComplete: boolean;
}>): boolean {
    if (!FACT_FILTERS.includes(params.filter)) return false;
    if (!params.historyComplete) return true;
    return params.entries.some((entry) => isTranscriptNavigationTurn(entry) && entry.facts == null);
}
