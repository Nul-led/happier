import { describe, expect, it } from 'vitest';

import type { SessionBoardLayoutV1 } from '@happier-dev/protocol/sessions/board';

import { renderHook } from '@/dev/testkit';
import {
    projectSessionBoard,
    type SessionBoardActionsPort,
    type SessionBoardItemUpsertInput,
    type SessionBoardMutationResult,
    type SessionBoardSnapshot,
} from '@/sync/domains/session/board';

import type { SessionBoardBinding } from './observeSessionBoard';
import { useSessionBoardController } from './useSessionBoardController';

/**
 * Adding an installed plugin widget to a Board.
 *
 * The failures pinned here are the ones the Board cannot show you: an Add entry
 * offered where no plugin actually contributes one, a creation that lands an item
 * record without its placement, and a stored record that captures a plugin
 * version or renderer and therefore goes stale on the next update.
 */

const LAYOUT: SessionBoardLayoutV1 = {
    v: 1,
    tabs: [{ id: 'overview', title: 'Overview', items: [] }],
} as SessionBoardLayoutV1;

const TWO_VIEW_LAYOUT: SessionBoardLayoutV1 = {
    v: 1,
    tabs: [
        { id: 'overview', title: 'Overview', items: [] },
        { id: 'release', title: 'Release', items: [] },
    ],
} as SessionBoardLayoutV1;

function readySnapshot(canEdit = true, layout: SessionBoardLayoutV1 = LAYOUT): SessionBoardSnapshot {
    return projectSessionBoard({
        layout: { revision: 'rev-layout', outcome: { status: 'ready', value: layout } },
        items: new Map(),
        capabilities: { readTranscript: true, editSessionRecords: canEdit },
        freshness: 'fresh',
        reachability: 'reachable',
        loading: 'idle',
        incomplete: false,
    });
}

function binding(snapshot: SessionBoardSnapshot): SessionBoardBinding {
    return { status: 'ready', snapshot };
}

function recordingActions(): Readonly<{ port: SessionBoardActionsPort; upserts: SessionBoardItemUpsertInput[] }> {
    const upserts: SessionBoardItemUpsertInput[] = [];
    const ok = {
        status: 'ok' as const,
        value: {
            v: 1,
            serverId: 'home-1',
            sessionId: 'session-1',
            result: { operation: 'upsert_item', itemId: 'item-1', itemRevision: 'rev-1', layoutRevision: 'rev-layout-2' },
            destination: null,
        } as SessionBoardMutationResult,
    };
    return {
        upserts,
        port: {
            upsertItem: async (input) => { upserts.push(input); return ok; },
            removeItem: async () => ok,
            updateLayout: async () => ok,
        },
    };
}

async function mountController(input: Readonly<{
    installedWidgetsAvailable?: boolean;
    canEdit?: boolean;
    actions?: SessionBoardActionsPort;
    layout?: SessionBoardLayoutV1;
}> = {}) {
    return await renderHook(() => useSessionBoardController({
        sessionId: 'session-1',
        serverId: 'home-1',
        binding: binding(readySnapshot(input.canEdit ?? true, input.layout)),
        actions: input.actions ?? recordingActions().port,
        ...(input.installedWidgetsAvailable === undefined
            ? {}
            : { installedWidgetsAvailable: input.installedWidgetsAvailable }),
    }));
}

describe('Board Add: installed plugin widgets', () => {
    it('omits From plugins… when this Session projects no admitted widget', async () => {
        const hook = await mountController({ installedWidgetsAvailable: false });
        expect(hook.getCurrent().addIntents).not.toContain('fromPlugins');
    });

    it('offers From plugins… only once a real contribution exists AND writes are possible', async () => {
        const offered = await mountController({ installedWidgetsAvailable: true });
        expect(offered.getCurrent().addIntents).toContain('fromPlugins');

        const readOnly = await mountController({ installedWidgetsAvailable: true, canEdit: false });
        expect(readOnly.getCurrent().addIntents).toEqual([]);
    });

    it('creates the item and its first placement in ONE aggregate mutation', async () => {
        const actions = recordingActions();
        const hook = await mountController({ installedWidgetsAvailable: true, actions: actions.port });
        await hook.getCurrent().run({
            kind: 'item.addInstalled',
            surface: { pluginId: 'acme.review', localId: 'review-status-widget' },
            title: 'Review status',
        });

        expect(actions.upserts).toHaveLength(1);
        const created = actions.upserts[0]!;
        expect(created.expectedItemRevision).toBeNull();
        // Creation without an atomic placement leaves an item no Board view shows.
        expect(created.placement).toMatchObject({ tabId: 'overview' });
        expect(created.item.source).toEqual({
            kind: 'installedSurface',
            surface: { pluginId: 'acme.review', localId: 'review-status-widget' },
        });
        expect(created.item.title).toBe('Review status');
        // No version, immutable generation, renderer, machine, Artifact or
        // placement is persisted: those are resolved at every mount.
        expect(Object.keys(created.item.source)).toEqual(['kind', 'surface']);
        expect(Object.keys(created.item.source.kind === 'installedSurface' ? created.item.source.surface : {}))
            .toEqual(['pluginId', 'localId']);
    });

    it('refuses to create while writes are blocked', async () => {
        const actions = recordingActions();
        const hook = await mountController({
            installedWidgetsAvailable: true,
            canEdit: false,
            actions: actions.port,
        });
        await hook.getCurrent().run({
            kind: 'item.addInstalled',
            surface: { pluginId: 'acme.review', localId: 'review-status-widget' },
            title: 'Review status',
        });
        expect(actions.upserts).toHaveLength(0);
    });
});
