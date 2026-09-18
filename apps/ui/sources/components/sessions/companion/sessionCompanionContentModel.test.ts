import { describe, expect, it } from 'vitest';

import { createSessionSurfaceNoteDocumentV1, type SessionSurfaceItemV1 } from '@happier-dev/protocol/sessions/board';

import {
    projectSessionBoard,
    type SessionBoardItemProjection,
    type SessionBoardSnapshot,
} from '@/sync/domains/session/board';

import {
    resolveSessionCompanionBoardInventory,
    resolveSessionCompanionAddableItems,
    resolveSessionCompanionContentItems,
} from './sessionCompanionContentModel';

const item = (itemId: string): SessionBoardItemProjection => ({
    itemId,
    revision: 'r1',
    state: { kind: 'removed' },
});

function readyItem(title: string): SessionSurfaceItemV1 {
    return {
        v: 1,
        title,
        frame: 'card',
        height: { mode: 'auto', fallback: 'regular' },
        source: { kind: 'declarative', document: createSessionSurfaceNoteDocumentV1(`${title} body`) },
    } as SessionSurfaceItemV1;
}

describe('resolveSessionCompanionContentItems', () => {
    it('preserves preference order and resolves widgets from the shared Board snapshot', () => {
        const boardItem = item('widget-a');
        expect(resolveSessionCompanionContentItems({
            refs: [
                { kind: 'widget', widgetId: 'widget-a' },
                { kind: 'builtin', id: 'session_summary' },
            ],
            boardItemsById: new Map([['widget-a', boardItem]]),
            inventory: { kind: 'authoritative' },
        })).toEqual([
            { kind: 'widget', ref: { kind: 'widget', widgetId: 'widget-a' }, item: boardItem },
            { kind: 'summary', ref: { kind: 'builtin', id: 'session_summary' } },
        ]);
    });

    it('keeps a deleted widget reference recoverable instead of dropping or replacing it', () => {
        expect(resolveSessionCompanionContentItems({
            refs: [{ kind: 'widget', widgetId: 'removed-widget' }],
            boardItemsById: new Map(),
            inventory: { kind: 'authoritative' },
        })).toEqual([{
            kind: 'missing_widget',
            ref: { kind: 'widget', widgetId: 'removed-widget' },
        }]);
    });

    it('never calls an absent widget removed while the Board inventory is still incomplete', () => {
        expect(resolveSessionCompanionContentItems({
            refs: [{ kind: 'widget', widgetId: 'not-loaded-yet' }],
            boardItemsById: new Map(),
            inventory: { kind: 'loading' },
        })).toEqual([{
            kind: 'pending_widget',
            ref: { kind: 'widget', widgetId: 'not-loaded-yet' },
            inventory: { kind: 'loading' },
        }]);
    });

    it('never calls an absent widget removed while the Board is unreachable or unavailable', () => {
        for (const inventory of [{ kind: 'offline' }, { kind: 'unavailable', reason: 'board_feature_disabled' }] as const) {
            expect(resolveSessionCompanionContentItems({
                refs: [{ kind: 'widget', widgetId: 'offline-widget' }],
                boardItemsById: new Map(),
                inventory,
            })).toEqual([{
                kind: 'pending_widget',
                ref: { kind: 'widget', widgetId: 'offline-widget' },
                inventory,
            }]);
        }
    });

    it('still resolves a loaded widget while the rest of the inventory is incomplete', () => {
        const boardItem = item('widget-a');
        expect(resolveSessionCompanionContentItems({
            refs: [{ kind: 'widget', widgetId: 'widget-a' }],
            boardItemsById: new Map([['widget-a', boardItem]]),
            inventory: { kind: 'loading' },
        })).toEqual([{ kind: 'widget', ref: { kind: 'widget', widgetId: 'widget-a' }, item: boardItem }]);
    });
});

describe('resolveSessionCompanionBoardInventory', () => {
    const snapshot = (overrides: Partial<SessionBoardSnapshot>): SessionBoardSnapshot => ({
        ...projectSessionBoard({
            layout: undefined,
            items: new Map(),
            capabilities: null,
            freshness: 'fresh',
            reachability: 'reachable',
            loading: 'idle',
            incomplete: false,
        }),
        ...overrides,
    });

    it('is authoritative only for a complete, fresh, reachable Board', () => {
        expect(resolveSessionCompanionBoardInventory({ status: 'ready', snapshot: snapshot({}) }))
            .toEqual({ kind: 'authoritative' });
    });

    it('reports a paging inventory as incomplete', () => {
        expect(resolveSessionCompanionBoardInventory({ status: 'ready', snapshot: snapshot({ incomplete: true }) }))
            .toEqual({ kind: 'loading' });
        expect(resolveSessionCompanionBoardInventory({ status: 'ready', snapshot: snapshot({ loading: 'initial' }) }))
            .toEqual({ kind: 'loading' });
    });

    it('reports an unreachable or stale Board rather than an authoritative empty one', () => {
        expect(resolveSessionCompanionBoardInventory({ status: 'ready', snapshot: snapshot({ reachability: 'offline' }) }))
            .toEqual({ kind: 'offline' });
        expect(resolveSessionCompanionBoardInventory({ status: 'ready', snapshot: snapshot({ reachability: 'unknown' }) }))
            .toEqual({ kind: 'offline' });
        expect(resolveSessionCompanionBoardInventory({ status: 'ready', snapshot: snapshot({ freshness: 'stale' }) }))
            .toEqual({ kind: 'offline' });
    });

    it('reports an absent binding as unavailable', () => {
        expect(resolveSessionCompanionBoardInventory(null)).toEqual({ kind: 'loading' });
    });

    it('projects access loss, locking, and unsupported content without calling them deletions', () => {
        expect(resolveSessionCompanionBoardInventory({ status: 'unavailable', reason: 'forbidden' }))
            .toEqual({ kind: 'revoked' });
        expect(resolveSessionCompanionBoardInventory({
            status: 'ready',
            snapshot: snapshot({ layoutState: { kind: 'locked' } }),
        })).toEqual({ kind: 'locked' });
        expect(resolveSessionCompanionBoardInventory({
            status: 'ready',
            snapshot: snapshot({ layoutState: { kind: 'unsupported', version: 2 } }),
        })).toEqual({ kind: 'unavailable', reason: 'unsupported' });
    });
});

describe('resolveSessionCompanionAddableItems', () => {
    it('projects every readable loaded item without an arbitrary picker cap', () => {
        const items = new Map(Array.from({ length: 25 }, (_, index) => {
            const itemId = `item-${index}`;
            return [itemId, {
                revision: `revision-${index}`,
                outcome: { status: 'ready' as const, value: readyItem(`Item ${index}`) },
            }] as const;
        }));
        const snapshot = projectSessionBoard({
            layout: undefined,
            items,
            capabilities: { readTranscript: true, editSessionRecords: true },
            freshness: 'fresh',
            reachability: 'reachable',
            loading: 'idle',
            incomplete: false,
        });

        const result = resolveSessionCompanionAddableItems({
            snapshot,
            refs: [{ kind: 'widget', widgetId: 'item-3' }],
        });

        expect(result).toHaveLength(24);
        expect(result.some((candidate) => candidate.widgetId === 'item-24')).toBe(true);
        expect(result.some((candidate) => candidate.widgetId === 'item-3')).toBe(false);
    });
});
