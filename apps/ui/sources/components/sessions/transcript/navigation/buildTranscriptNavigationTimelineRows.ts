import type { TranscriptNavigationEntry } from './transcriptNavigationTypes';

export type TranscriptNavigationTimelineRow =
    | Readonly<{ kind: 'day'; id: string; dayStartMs: number }>
    | Readonly<{ kind: 'entry'; id: string; entry: TranscriptNavigationEntry; entryIndex: number }>
    | Readonly<{ kind: 'start'; id: 'start' }>;

function resolveDayStartMs(atMs: number): number {
    const date = new Date(atMs);
    date.setHours(0, 0, 0, 0);
    return date.getTime();
}

function normalizeTimestamp(value: number | null | undefined): number | null {
    return typeof value === 'number' && Number.isFinite(value) ? Math.trunc(value) : null;
}

const START_ROW: TranscriptNavigationTimelineRow = Object.freeze({ kind: 'start', id: 'start' });

/**
 * Flattens navigation entries (oldest first, as derived) into the pane's render rows, NEWEST
 * first: the pane opens on the turn that is live now, and older history grows downward.
 *
 * Every local day opens with a header, a single-day session included, so the top of the list
 * always says when it happened. An entry without a timestamp stays in the section above it
 * rather than inventing a bucket of its own. `sessionStart` closes the list with the session's
 * start, only when the caller knows the whole history is present.
 *
 * `entryIndex` is the index in display order (the keyboard walks what is on screen).
 */
export function buildTranscriptNavigationTimelineRows(
    entries: readonly TranscriptNavigationEntry[],
    options: Readonly<{ sessionStart?: boolean }> = {},
): readonly TranscriptNavigationTimelineRow[] {
    if (entries.length === 0) return [];

    const rows: TranscriptNavigationTimelineRow[] = [];
    let lastDayStartMs: number | null = null;
    let entryIndex = 0;
    for (let index = entries.length - 1; index >= 0; index -= 1) {
        const entry = entries[index]!;
        const createdAtMs = normalizeTimestamp(entry.createdAtMs);
        const dayStartMs = createdAtMs === null ? null : resolveDayStartMs(createdAtMs);
        if (dayStartMs !== null && dayStartMs !== lastDayStartMs) {
            rows.push({ kind: 'day', id: `day:${dayStartMs}`, dayStartMs });
            lastDayStartMs = dayStartMs;
        }
        rows.push({ kind: 'entry', id: entry.id, entry, entryIndex });
        entryIndex += 1;
    }
    if (options.sessionStart === true) rows.push(START_ROW);
    return rows;
}
