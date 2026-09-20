import * as React from 'react';
import { act } from 'react-test-renderer';
import { describe, expect, it } from 'vitest';

import {
    createSessionSurfaceNoteDocumentV1,
    type SessionBoardLayoutV1,
    type SessionSurfaceItemV1,
} from '@happier-dev/protocol/sessions/board';

import { renderScreen } from '@/dev/testkit';
import {
    projectSessionBoard,
    type SessionBoardActionsPort,
    type SessionBoardSnapshot,
} from '@/sync/domains/session/board';

import { SessionBoardSurface } from './SessionBoardSurface';
import { useSessionBoardController } from './useSessionBoardController';

/**
 * Opening a Board must not build every card it holds.
 *
 * The measurement here is the render count itself: how many declarative bodies
 * the surface instantiates for a hundred placements, before and after the
 * viewport is known and after a scroll.
 */

const PLACEMENT_COUNT = 100;
/** `SessionBoardSurface`'s own `DEFAULT_HEIGHT_BOUNDS.min`. */
const MIN_CARD_HEIGHT = 96;
const ACTIONS: SessionBoardActionsPort = {
    upsertItem: async () => ({ status: 'unavailable', reason: 'board_actions_unavailable' }),
    removeItem: async () => ({ status: 'unavailable', reason: 'board_actions_unavailable' }),
    updateLayout: async () => ({ status: 'unavailable', reason: 'board_actions_unavailable' }),
};

function note(title: string): SessionSurfaceItemV1 {
    return {
        v: 1,
        title,
        frame: 'card',
        height: { mode: 'auto', fallback: 'regular' },
        source: { kind: 'declarative', document: createSessionSurfaceNoteDocumentV1(`${title} body`) },
    } as SessionSurfaceItemV1;
}

const ITEM_IDS = Array.from({ length: PLACEMENT_COUNT }, (_value, index) => `note-${index}`);

const LAYOUT: SessionBoardLayoutV1 = {
    v: 1,
    tabs: [{
        id: 'overview',
        title: 'Overview',
        items: ITEM_IDS.map((itemId) => ({ itemId, width: 'full' })),
    }],
} as SessionBoardLayoutV1;

function snapshot(): SessionBoardSnapshot {
    return projectSessionBoard({
        layout: { revision: 'rev-layout', outcome: { status: 'ready', value: LAYOUT } },
        items: new Map(ITEM_IDS.map((itemId) => [itemId, {
            revision: `rev-${itemId}`,
            outcome: { status: 'ready' as const, value: note(itemId) },
        }] as const)),
        capabilities: { readTranscript: true, editSessionRecords: true },
        freshness: 'fresh',
        reachability: 'reachable',
        loading: 'idle',
        incomplete: false,
    });
}

function Harness(): React.ReactElement {
    const controller = useSessionBoardController({
        sessionId: 'session-1',
        serverId: 'home-1',
        binding: { status: 'ready', snapshot: snapshot(), refresh: () => {} },
        actions: ACTIONS,
    });
    return (
        <SessionBoardSurface
            sessionId="session-1"
            controller={controller}
            host="details"
            resolvePrimaryHost={() => 'details'}
            density="full"
            layout="single"
        />
    );
}

type Screen = Awaited<ReturnType<typeof renderScreen>>;

/** Distinct testIDs: a rendered component and its host element both carry one. */
function testIdsBySuffix(screen: Screen, suffix: string): readonly string[] {
    return [...new Set(screen.tree.root.findAll(
        (node) => typeof (node.props as { testID?: unknown }).testID === 'string'
            && (node.props as { testID: string }).testID.endsWith(suffix),
        { deep: true },
    ).map((node) => (node.props as { testID: string }).testID))];
}

function countBySuffix(screen: Screen, suffix: string): number {
    return testIdsBySuffix(screen, suffix).length;
}

function mountedBodyItemIds(screen: Screen): readonly string[] {
    return testIdsBySuffix(screen, '-declarative')
        .map((testID) => testID.replace(/^session-board-item-/u, '').replace(/-declarative$/u, ''));
}

function scrollNode(screen: Screen) {
    return screen.tree.root.findAll(
        (node) => (node.props as { testID?: unknown }).testID === 'session-board-scroll',
        { deep: true },
    ).at(-1);
}

describe('SessionBoardSurface near-viewport body window', () => {
    it('builds only the bodies a viewport away and advances the window on scroll', async () => {
        const screen = await renderScreen(<Harness />);
        const scroll = scrollNode(screen);
        expect(scroll).toBeTruthy();

        await act(async () => {
            (scroll?.props as { onLayout?: (event: unknown) => void }).onLayout?.({
                nativeEvent: { layout: { x: 0, y: 0, width: 800, height: 600 } },
            });
        });

        // Nothing has been laid out yet, so each card is placed by the surface's own
        // minimum card height. A 600px viewport plus one viewport of overscan reaches
        // 1896px, which is at most twenty 96px cards — not a hundred.
        const unmeasuredBodies = countBySuffix(screen, '-declarative');
        expect(unmeasuredBodies).toBeGreaterThan(0);
        expect(unmeasuredBodies).toBeLessThanOrEqual(
            Math.floor((600 + 600 + MIN_CARD_HEIGHT) / MIN_CARD_HEIGHT) + 1,
        );
        expect(unmeasuredBodies + countBySuffix(screen, '-deferred')).toBe(PLACEMENT_COUNT);

        await act(async () => {
            // Real geometry: one full-width card per row, 200px tall.
            ITEM_IDS.forEach((itemId, ordinal) => {
                const placement = screen.tree.root.findAll(
                    (node) => (node.props as { testID?: unknown }).testID === `session-board-placement-${itemId}`,
                    { deep: true },
                ).at(-1);
                (placement?.props as { onLayout?: (event: unknown) => void } | undefined)?.onLayout?.({
                    nativeEvent: { layout: { x: 0, y: ordinal * 200, width: 800, height: 200 } },
                });
            });
        });
        await act(async () => {
            (scroll?.props as { onScroll?: (event: unknown) => void }).onScroll?.({
                nativeEvent: {
                    contentOffset: { y: 200 },
                    contentSize: { width: 800, height: 200 * PLACEMENT_COUNT },
                    layoutMeasurement: { width: 800, height: 600 },
                },
            });
        });
        const before = mountedBodyItemIds(screen);
        // A 600px viewport with one viewport of overscan either side reaches
        // 1800px of a 20000px Board: nine 200px cards, not a hundred.
        expect(before.length).toBeGreaterThan(0);
        expect(before.length).toBeLessThanOrEqual(12);
        expect(before).toContain('note-0');

        await act(async () => {
            (scroll?.props as { onScroll?: (event: unknown) => void }).onScroll?.({
                nativeEvent: {
                    contentOffset: { y: 200 * 40 },
                    contentSize: { width: 800, height: 200 * PLACEMENT_COUNT },
                    layoutMeasurement: { width: 800, height: 600 },
                },
            });
        });

        const after = mountedBodyItemIds(screen);
        // Still bounded, and it is a different set: the window moved with the
        // scroll instead of accumulating every card the person passed.
        expect(after.length).toBeGreaterThan(0);
        expect(after.length).toBeLessThanOrEqual(12);
        expect(after).not.toContain('note-0');
        expect(after).toContain('note-40');
        expect(after.length + countBySuffix(screen, '-deferred')).toBe(PLACEMENT_COUNT);
    });
});
