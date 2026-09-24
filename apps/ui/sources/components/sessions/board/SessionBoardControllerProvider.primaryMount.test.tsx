import * as React from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import { renderScreen, standardCleanup } from '@/dev/testkit';
import {
    createSessionBoardActionsPort,
    projectSessionBoard,
    type SessionBoardSnapshot,
} from '@/sync/domains/session/board';
import type { SessionAddress } from '@/sync/domains/session/sessionAddress';

import { SessionBoardContinuityProvider, useSessionBoardContinuity } from './SessionBoardContinuity';
import {
    SessionBoardControllerOwner,
    useMountedSessionBoardController,
    type MountedSessionBoardController,
} from './SessionBoardControllerProvider';
import {
    resolveSessionBoardHostVisibility,
    resolveSessionBoardItemPrimaryMountHost,
    type SessionBoardPlacementPrimaryMountResolver,
} from './sessionBoardHostVisibility';

const ADDRESS: SessionAddress = { serverId: 'home-1', sessionId: 'session-1' };
const actions = createSessionBoardActionsPort(ADDRESS);
const pluginRuntime = {
    pluginUiProjection: null,
    pluginBrowserProjection: null,
    phase: 'unavailable' as const,
    interactionEnabled: false,
    machineId: null,
    serverId: ADDRESS.serverId,
    platform: 'web' as const,
};

/** View A holds item A, view B holds item B. */
function twoViewSnapshot(): SessionBoardSnapshot {
    return projectSessionBoard({
        layout: {
            revision: 'ssr1:layout',
            outcome: {
                status: 'ready',
                value: {
                    v: 1,
                    tabs: [
                        { id: 'view-a', title: 'A', items: [{ itemId: 'item-a', width: 'medium' }] },
                        { id: 'view-b', title: 'B', items: [{ itemId: 'item-b', width: 'medium' }] },
                    ],
                },
            },
        },
        items: new Map(),
        capabilities: { readTranscript: true, editSessionRecords: true },
        freshness: 'fresh',
        reachability: 'reachable',
        loading: 'idle',
        incomplete: false,
    } as Parameters<typeof projectSessionBoard>[0]);
}

// The Session shell's real derivation for this window: a generic Board tab is the
// active Details tab and the Companion rail is reserved, with both items in it.
const visibility = resolveSessionBoardHostVisibility({
    foreground: true,
    panes: {
        detailsOpen: true,
        detailsShowsBoard: true,
        detailsShowsGenericBoard: true,
        detailsExpandedItemIds: [],
        detailsFocusModeActive: false,
        rightOpen: false,
        rightActiveTabId: null,
    },
    companionPlacement: { kind: 'reserved_rail', edge: 'trailing', widthPx: 280 },
    mobileSurface: null,
});
const shellResolver: SessionBoardPlacementPrimaryMountResolver = (itemId, destination, boardView) => (
    resolveSessionBoardItemPrimaryMountHost({
        visibility,
        itemVisibleInCompanion: true,
        itemId,
        ...(destination ? { detailsDestination: destination } : {}),
        ...(boardView ? { boardView } : {}),
    })
);

type Probe = {
    mounted: MountedSessionBoardController | null;
    continuity: ReturnType<typeof useSessionBoardContinuity>;
};

function ProbeReader(props: Readonly<{ probe: Probe }>): null {
    props.probe.mounted = useMountedSessionBoardController(ADDRESS);
    props.probe.continuity = useSessionBoardContinuity(ADDRESS);
    return null;
}

function Harness(props: Readonly<{ probe: Probe }>): React.ReactElement {
    const binding = { status: 'ready' as const, snapshot: twoViewSnapshot() };
    return (
        <SessionBoardContinuityProvider sessionId={ADDRESS.sessionId} serverId={ADDRESS.serverId}>
            <SessionBoardControllerOwner
                address={ADDRESS}
                input={{ sessionId: ADDRESS.sessionId, serverId: ADDRESS.serverId, binding, actions }}
                binding={binding}
                actions={actions}
                pluginRuntime={pluginRuntime}
                callerHostedHtmlRuntime={null}
                resolvePrimaryHost={shellResolver}
            >
                <ProbeReader probe={props.probe} />
            </SessionBoardControllerOwner>
        </SessionBoardContinuityProvider>
    );
}

afterEach(() => { standardCleanup(); });

describe('mounted Session Board primary placement', () => {
    it('never elects a Board tab for an item its selected view does not draw', async () => {
        const probe: Probe = { mounted: null, continuity: null };
        const screen = await renderScreen(<Harness probe={probe} />);
        const rerender = async () => await screen.update(<Harness probe={probe} />);
        probe.continuity!.viewSelection.request('view-a');
        await rerender();
        expect(probe.mounted!.controller.activeView?.id).toBe('view-a');

        // The Details grid shows view A, which does not draw item B: the Companion runs it.
        expect(probe.mounted!.resolvePrimaryHost('item-b')).toBe('companion');
        // Item A is drawn by the Details grid, which outranks the Companion.
        expect(probe.mounted!.resolvePrimaryHost('item-a')).toBe('details');

        // Switching the Board to view B hands item B's one live mount to Details.
        probe.continuity!.viewSelection.request('view-b');
        await rerender();
        expect(probe.mounted!.controller.activeView?.id).toBe('view-b');
        expect(probe.mounted!.resolvePrimaryHost('item-b')).toBe('details');
        expect(probe.mounted!.resolvePrimaryHost('item-a')).toBe('companion');

        // And back: the mount returns to the Companion.
        probe.continuity!.viewSelection.request('view-a');
        await rerender();
        expect(probe.mounted!.resolvePrimaryHost('item-b')).toBe('companion');
    });
});
