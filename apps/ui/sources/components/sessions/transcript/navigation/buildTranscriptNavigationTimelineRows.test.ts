import { describe, expect, it } from 'vitest';

import { buildTranscriptNavigationTimelineRows } from './buildTranscriptNavigationTimelineRows';
import type { TranscriptNavigationEntry } from './transcriptNavigationTypes';

function entry(id: string, createdAtMs: number | null): TranscriptNavigationEntry {
    return {
        id,
        sessionId: 's1',
        seq: 1,
        routeMessageId: null,
        transcriptBlockIndex: null,
        kind: 'user-turn',
        role: 'user',
        label: id,
        promptPreview: id,
        responsePreview: null,
        createdAtMs,
        pinned: false,
        pinnedAtMs: null,
        loaded: true,
    };
}

function atLocal(year: number, month: number, day: number, hour: number): number {
    return new Date(year, month - 1, day, hour, 0, 0, 0).getTime();
}

function shape(rows: ReturnType<typeof buildTranscriptNavigationTimelineRows>): string[] {
    return rows.map((row) => (row.kind === 'entry' ? row.entry.id : row.kind === 'day' ? `day:${new Date(row.dayStartMs).getDate()}` : row.kind));
}

describe('buildTranscriptNavigationTimelineRows', () => {
    it('lists the newest turn first, grouped under a header per local day', () => {
        const rows = buildTranscriptNavigationTimelineRows([
            entry('a', atLocal(2026, 7, 26, 23)),
            entry('b', atLocal(2026, 7, 27, 1)),
            entry('c', atLocal(2026, 7, 27, 20)),
        ]);

        expect(shape(rows)).toEqual(['day:27', 'c', 'b', 'day:26', 'a']);
    });

    it('dates a single-day session too, so the top of the list says when it happened', () => {
        const rows = buildTranscriptNavigationTimelineRows([
            entry('a', atLocal(2026, 7, 27, 9)),
            entry('b', atLocal(2026, 7, 27, 18)),
        ]);

        expect(shape(rows)).toEqual(['day:27', 'b', 'a']);
    });

    it('keeps timestamp-less entries in the section above them instead of inventing one', () => {
        const rows = buildTranscriptNavigationTimelineRows([
            entry('a', atLocal(2026, 7, 26, 10)),
            entry('b', null),
            entry('c', atLocal(2026, 7, 27, 10)),
        ]);

        expect(shape(rows)).toEqual(['day:27', 'c', 'b', 'day:26', 'a']);
    });

    it('ends with the session start only when the whole history is known', () => {
        const entries = [entry('a', atLocal(2026, 7, 26, 10)), entry('b', atLocal(2026, 7, 26, 11))];

        expect(shape(buildTranscriptNavigationTimelineRows(entries, { sessionStart: true })).at(-1)).toBe('start');
        expect(shape(buildTranscriptNavigationTimelineRows(entries)).at(-1)).toBe('a');
    });

    it('numbers entry rows in display order so keyboard focus follows what is on screen', () => {
        const rows = buildTranscriptNavigationTimelineRows([
            entry('a', atLocal(2026, 7, 26, 10)),
            entry('b', atLocal(2026, 7, 27, 10)),
        ]);

        expect(rows.flatMap((row) => (row.kind === 'entry' ? [[row.entry.id, row.entryIndex]] : [])))
            .toEqual([['b', 0], ['a', 1]]);
    });

    it('returns no rows for an empty entry list', () => {
        expect(buildTranscriptNavigationTimelineRows([], { sessionStart: true })).toEqual([]);
    });
});
