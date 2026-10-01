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
    resolveSessionCompanionPickerSections,
    canAddSessionCompanionItem,
} from './sessionCompanionContentModel';
import { widgetProjectionOf, widgetInstalledPackage } from '@/dev/testkit/fixtures/pluginWidgetProjectionFixtures';
import type { WidgetCandidate } from '@/components/widgets/widgetCatalog';

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
    it('keeps glances, plugin references and pane links distinct from Summary and Board content', () => {
        const refs = [
            { kind: 'builtin', id: 'changes', frameStyle: 'plain' },
            { kind: 'builtin', id: 'local_services' },
            { kind: 'pane', paneId: 'git' },
            { kind: 'plugin', surface: { pluginId: 'acme.review', localId: 'glance' } },
        ] as const;
        expect(resolveSessionCompanionContentItems({ refs, boardItemsById: new Map(), inventory: { kind: 'offline' } }))
            .toEqual(refs.map((ref, index) => ({ kind: ['changes', 'local_services', 'pane', 'plugin'][index], ref })));
    });

    it('admits compact plugin references through the current placement catalog without requiring a writable Board', () => {
        const pluginUiProjection = widgetProjectionOf([
            { pluginId: 'acme.review', localId: 'glance', placements: ['companion'] },
            { pluginId: 'acme.review', localId: 'board-only' },
        ], { 'acme.review': widgetInstalledPackage('acme.review', 'Review') });
        const runtime = { pluginUiProjection, pluginBrowserProjection: null, phase: 'current' as const, interactionEnabled: true, machineId: 'm1', serverId: 'home1', platform: 'web' as const };
        expect(canAddSessionCompanionItem({ kind: 'plugin', surface: { pluginId: 'acme.review', localId: 'glance' } }, runtime)).toBe(true);
        expect(canAddSessionCompanionItem({ kind: 'plugin', surface: { pluginId: 'acme.review', localId: 'board-only' } }, runtime)).toBe(false);
        expect(canAddSessionCompanionItem({ kind: 'plugin', surface: { pluginId: 'acme.review', localId: 'glance' } }, { ...runtime, phase: 'unavailable' })).toBe(false);
        expect(canAddSessionCompanionItem({ kind: 'pane', paneId: 'git' }, null)).toBe(true);
        expect(canAddSessionCompanionItem({ kind: 'pane', paneId: 'not-a-pane' }, runtime)).toBe(false);
    });
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

    it('resolves the agent Plan as its own built-in item beside the Summary', () => {
        expect(resolveSessionCompanionContentItems({
            refs: [
                { kind: 'builtin', id: 'session_summary' },
                { kind: 'builtin', id: 'agent_plan' },
            ],
            boardItemsById: new Map(),
            inventory: { kind: 'loading' },
        })).toEqual([
            { kind: 'summary', ref: { kind: 'builtin', id: 'session_summary' } },
            { kind: 'plan', ref: { kind: 'builtin', id: 'agent_plan' } },
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

    it('reports an unreachable Board rather than an authoritative empty one', () => {
        expect(resolveSessionCompanionBoardInventory({ status: 'ready', snapshot: snapshot({ reachability: 'offline' }) }))
            .toEqual({ kind: 'offline' });
        expect(resolveSessionCompanionBoardInventory({ status: 'ready', snapshot: snapshot({ reachability: 'unknown' }) }))
            .toEqual({ kind: 'offline' });
    });

    it('keeps a stale but reachable Board authoritative, like every other Board consumer', () => {
        // Freshness is not availability. Any exact Session or share change flips the
        // snapshot to `stale`, and telling the person their reachable Home is offline
        // until the refetch settles is a second answer to a question reachability owns.
        expect(resolveSessionCompanionBoardInventory({ status: 'ready', snapshot: snapshot({ freshness: 'stale' }) }))
            .toEqual({ kind: 'authoritative' });
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

        expect(result).toHaveLength(25);
        expect(result.some((candidate) => candidate.widgetId === 'item-24' && !candidate.added)).toBe(true);
        // A kept item stays in place, marked added, so the picker list never jumps.
        expect(result.find((candidate) => candidate.widgetId === 'item-3')?.added).toBe(true);
    });
});

function installedItem(title: string, pluginId: string, localId: string): SessionSurfaceItemV1 {
    return {
        v: 1,
        title,
        frame: 'card',
        height: { mode: 'auto', fallback: 'regular' },
        source: { kind: 'installedSurface', surface: { pluginId, localId } },
    } as SessionSurfaceItemV1;
}

function candidate(pluginId: string, localId: string, title: string): WidgetCandidate {
    return {
        surface: { pluginId, localId },
        key: `${pluginId}/${localId}`,
        title,
        pluginName: pluginId,
        sharedPluginName: false,
        icon: 'puzzle-piece',
        homeDefault: 'available',
    };
}

describe('resolveSessionCompanionPickerSections', () => {
    const board = projectSessionBoard({
        layout: undefined,
        items: new Map([
            ['note-1', { revision: 'r1', outcome: { status: 'ready' as const, value: readyItem('Open question') } }],
            ['chan-1', {
                revision: 'r1',
                outcome: { status: 'ready' as const, value: installedItem('External conversations', 'channels', 'conversations') },
            }],
        ]),
        capabilities: { readTranscript: true, editSessionRecords: true },
        freshness: 'fresh',
        reachability: 'reachable',
        loading: 'idle',
        incomplete: false,
    });

    it('lists built-ins, Board items and plugin widgets as one widget system, marking what is already kept', () => {
        const sections = resolveSessionCompanionPickerSections({
            refs: [{ kind: 'builtin', id: 'session_summary' }, { kind: 'widget', widgetId: 'chan-1' }],
            snapshot: board,
            candidates: [candidate('channels', 'conversations', 'External conversations'), candidate('triage', 'latest', 'Latest')],
        });

        expect(sections.builtIn).toEqual([
            { id: 'session_summary', added: true },
            { id: 'agent_plan', added: false },
            { id: 'changes', added: false },
            { id: 'local_services', added: false },
        ]);
        // A plugin widget already on the Board is offered once, under its plugin, and reuses that record.
        expect(sections.board.map((row) => row.widgetId)).toEqual(['note-1']);
        expect(sections.plugins).toEqual([
            expect.objectContaining({ key: 'channels/conversations', existingWidgetId: 'chan-1', added: true }),
            expect.objectContaining({ key: 'triage/latest', existingWidgetId: null, added: false }),
        ]);
    });

    it('offers no plugin creation when the Board cannot take a new item', () => {
        const sections = resolveSessionCompanionPickerSections({
            refs: [],
            snapshot: null,
            candidates: [],
        });
        expect(sections.board).toEqual([]);
        expect(sections.plugins).toEqual([]);
        expect(sections.builtIn.every((row) => !row.added)).toBe(true);
    });
});
