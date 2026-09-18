import { describe, expect, it } from 'vitest';

import { createSessionSurfaceNoteDocumentV1 } from '@happier-dev/protocol/sessions/board';

import type { SessionBoardItemProjection } from '@/sync/domains/session/board';

import {
    captureSessionBoardPresentationPosition,
    filterSessionBoardItemIds,
    resolveSessionBoardPresentationOffset,
} from './sessionBoardPresentationContinuity';

const rects = new Map([
    ['first', { x: 0, y: 0, width: 320, height: 100 }],
    ['anchor', { x: 0, y: 116, width: 320, height: 120 }],
    ['last', { x: 0, y: 252, width: 320, height: 100 }],
]);

function note(itemId: string, title: string, body: string): SessionBoardItemProjection {
    return {
        itemId,
        revision: `rev-${itemId}`,
        state: {
            kind: 'ready',
            item: {
                v: 1,
                title,
                frame: 'card',
                height: { mode: 'auto', fallback: 'regular' },
                source: { kind: 'declarative', document: createSessionSurfaceNoteDocumentV1(body) },
            },
        },
    };
}

describe('Board presentation continuity', () => {
    it('captures the first visible item and restores its within-item offset after a prepend or reorder', () => {
        const captured = captureSessionBoardPresentationPosition({
            orderedItemIds: ['first', 'anchor', 'last'],
            itemRects: rects,
            contentStartY: 24,
            scrollOffset: 170,
        });

        expect(captured).toEqual({
            anchorItemId: 'anchor',
            offsetWithinItem: 30,
            absoluteOffset: 170,
        });

        const reorderedRects = new Map([
            ['new', { x: 0, y: 0, width: 320, height: 80 }],
            ['last', { x: 0, y: 96, width: 320, height: 100 }],
            ['anchor', { x: 0, y: 212, width: 320, height: 120 }],
        ]);
        expect(resolveSessionBoardPresentationOffset({
            position: captured,
            itemRects: reorderedRects,
            contentStartY: 24,
        })).toBe(266);
    });

    it('falls back to the prior absolute offset when the visible anchor was removed remotely', () => {
        expect(resolveSessionBoardPresentationOffset({
            position: { anchorItemId: 'gone', offsetWithinItem: 12, absoluteOffset: 170 },
            itemRects: new Map(),
            contentStartY: 24,
        })).toBe(170);
    });
});

describe('mobile Board loaded-snapshot filtering', () => {
    const items = new Map([
        ['plan', note('plan', 'Release plan', 'Ship on Tuesday')],
        ['notes', note('notes', 'Meeting notes', 'Discuss the database migration')],
        ['recovered', note('recovered', 'Recovered checklist', 'Release follow-up')],
    ]);

    it('matches loaded title or note content while preserving canonical order', () => {
        expect(filterSessionBoardItemIds({
            orderedItemIds: ['notes', 'plan'],
            itemsById: items,
            query: 'release',
        })).toEqual(['plan']);
        expect(filterSessionBoardItemIds({
            orderedItemIds: ['notes', 'plan'],
            itemsById: items,
            query: 'DATABASE',
        })).toEqual(['notes']);
    });

    it('filters Recovered independently without dropping or reordering its loaded inventory', () => {
        expect(filterSessionBoardItemIds({
            orderedItemIds: ['recovered', 'notes'],
            itemsById: items,
            query: 'release',
        })).toEqual(['recovered']);
        expect(filterSessionBoardItemIds({
            orderedItemIds: ['recovered', 'notes'],
            itemsById: items,
            query: '   ',
        })).toEqual(['recovered', 'notes']);
    });
});
