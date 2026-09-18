import * as React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderScreen } from '@/dev/testkit/render/renderScreen';
import { createTextModuleMock } from '@/dev/testkit/mocks/text';
import {
    readPresentationNotice,
    retirePresentationNotice,
} from '@/components/sessions/presentation/presentationNotices';
import { createSessionBoardSourceAvailabilityResolver } from '@/components/sessions/board/sessionBoardItemPresentation';
import { createSessionFixture } from '@/dev/testkit';
import { createSessionSurfaceNoteDocumentV1 } from '@happier-dev/protocol/sessions/board';

vi.mock('@/text', () => createTextModuleMock());

const summaryModel = {
    title: 'Teams lane 08',
    agentLabel: 'Claude',
    operational: 'working' as const,
    stale: false,
    availability: 'complete' as const,
    identityDestination: 'sessionInfo' as const,
    rows: [] as const,
};
vi.mock('./summary/useSessionSummaryModel', () => ({
    useSessionSummaryModel: () => summaryModel,
}));

const widgetHostProps = vi.fn();
vi.mock('@/components/sessions/board/SessionWidgetHost', () => ({
    SessionWidgetHost: (props: Record<string, unknown>) => {
        widgetHostProps(props);
        return null;
    },
}));

import {
    projectSessionBoard,
    type SessionBoardItemProjection,
    type SessionBoardSnapshot,
} from '@/sync/domains/session/board';

import { SessionCompanionContent } from './SessionCompanionContent';
import {
    HIDDEN_SESSION_COMPANION_PREFERENCE_V1,
    SESSION_SUMMARY_COMPANION_ITEM,
    type SessionCompanionItemRefV1,
    type SessionCompanionPreferenceV1,
} from './state/sessionCompanionPreference';
import type { SessionCompanionController } from './state/useSessionCompanionController';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const session = createSessionFixture({ id: 'session-1' });

const readyItem = (itemId: string): SessionBoardItemProjection => ({
    itemId,
    revision: 'r1',
    state: {
        kind: 'ready',
        item: {
            v: 1,
            title: 'Deploy status',
            frame: 'card',
            height: { mode: 'auto', fallback: 'regular' },
            source: { kind: 'declarative', document: createSessionSurfaceNoteDocumentV1('') },
        },
    },
});

function snapshot(overrides: Partial<SessionBoardSnapshot> = {}): SessionBoardSnapshot {
    return {
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
    };
}

const binding = (overrides: Partial<SessionBoardSnapshot> = {}) => ({
    status: 'ready' as const,
    snapshot: snapshot(overrides),
    refresh: vi.fn(),
});

const removeItem = vi.fn();
const moveItem = vi.fn();
const show = vi.fn();
const applyLocalInverse = vi.fn();

function controller(items: readonly SessionCompanionItemRefV1[]): SessionCompanionController {
    const preference: SessionCompanionPreferenceV1 = {
        ...HIDDEN_SESSION_COMPANION_PREFERENCE_V1,
        visible: true,
        items,
    };
    return {
        preference,
        availability: 'ready',
        preferenceExists: true,
        show,
        hide: () => null,
        setCollapsed: () => null,
        setEdge: () => null,
        setDensity: () => null,
        addItem: () => null,
        removeItem,
        moveItem,
        openFullSurface: () => {},
        applyLocalInverse,
    };
}

describe('SessionCompanionContent (mounted)', () => {
    beforeEach(() => {
        widgetHostProps.mockClear();
        removeItem.mockClear();
        moveItem.mockClear();
        show.mockClear();
        applyLocalInverse.mockClear();
        retirePresentationNotice();
    });

    it('mounts a widget through the shared host with the exact Session and shell-derived primary mount', async () => {
        const pluginRuntime = { serverId: 'server-a' } as never;
        const callerHostedHtmlRuntime = { serverIdentityId: 'server-identity-a' } as never;
        await renderScreen(
            <SessionCompanionContent
                session={session}
                serverId="server-a"
                controller={controller([{ kind: 'widget', widgetId: 'w1' }])}
                boardBinding={binding({
                    itemsById: new Map([['w1', readyItem('w1')]]),
                    capabilities: { readTranscript: true, editSessionRecords: true },
                    canEdit: true,
                })}
                resolvePrimaryHost={() => 'details'}
                pluginRuntime={pluginRuntime}
                callerHostedHtmlRuntime={callerHostedHtmlRuntime}
                resolveSourceAvailability={createSessionBoardSourceAvailabilityResolver(pluginRuntime, {
                    hostedHtmlRendererAvailable: true,
                })}
            />,
        );

        expect(widgetHostProps).toHaveBeenCalledTimes(1);
        expect(widgetHostProps.mock.calls[0]?.[0]).toMatchObject({
            sessionId: 'session-1',
            host: 'companion',
            // Not 'companion': the Companion consumes the shell's answer instead
            // of appointing itself, so Details keeps the single executable mount.
            primaryHost: 'details',
            pluginRuntime,
            callerHostedHtmlRuntime,
        });
        const resolveSourceAvailability = widgetHostProps.mock.calls[0]?.[0]
            ?.resolveSourceAvailability as ((source: unknown) => unknown) | undefined;
        expect(resolveSourceAvailability?.({
            kind: 'hostedHtml',
            source: { kind: 'html', html: '<main>Companion</main>' },
            requestedCapabilities: {},
        })).toEqual({ kind: 'available' });
    });

    it('uses the incumbent inert preview path and withholds every executable control during cold measurement', async () => {
        const pluginRuntime = { serverId: 'server-a' } as never;
        const callerHostedHtmlRuntime = { serverIdentityId: 'server-identity-a' } as never;
        const openBoard = vi.fn();
        const managePlugin = vi.fn();
        const removeFromBoard = vi.fn();

        const renderer = await renderScreen(
            <SessionCompanionContent
                session={session}
                serverId="server-a"
                controller={controller([{ kind: 'widget', widgetId: 'w1' }])}
                boardBinding={binding({
                    itemsById: new Map([['w1', readyItem('w1')]]),
                    capabilities: { readTranscript: true, editSessionRecords: true },
                    canEdit: true,
                })}
                resolvePrimaryHost={() => 'companion'}
                pluginRuntime={pluginRuntime}
                callerHostedHtmlRuntime={callerHostedHtmlRuntime}
                onRevealBoardItem={openBoard}
                onManageBoardItemPlugin={managePlugin}
                onRemoveBoardItem={removeFromBoard}
                measurementOnly
                testID="measurement-content"
            />,
        );

        expect(widgetHostProps).toHaveBeenCalledTimes(1);
        expect(widgetHostProps.mock.calls[0]?.[0]).toMatchObject({
            sessionId: 'session-1',
            host: 'companion',
            primaryHost: null,
            canEdit: false,
            pluginRuntime,
        });
        expect(widgetHostProps.mock.calls[0]?.[0]).not.toHaveProperty('callerHostedHtmlRuntime');
        expect(widgetHostProps.mock.calls[0]?.[0]).not.toHaveProperty('onOpenHere');
        expect(widgetHostProps.mock.calls[0]?.[0]).not.toHaveProperty('onManagePlugin');
        expect(widgetHostProps.mock.calls[0]?.[0]).not.toHaveProperty('onRemove');
        expect(renderer.findByTestId('measurement-content-item-widget:w1-actions')).toBeNull();
        expect(openBoard).not.toHaveBeenCalled();
        expect(managePlugin).not.toHaveBeenCalled();
        expect(removeFromBoard).not.toHaveBeenCalled();
    });

    it('names the Board destination on an inert preview instead of promising the item runs here', async () => {
        await renderScreen(
            <SessionCompanionContent
                session={session}
                serverId="server-a"
                controller={controller([{ kind: 'widget', widgetId: 'w1' }])}
                boardBinding={binding({
                    itemsById: new Map([['w1', readyItem('w1')]]),
                    capabilities: { readTranscript: true, editSessionRecords: true },
                    canEdit: true,
                })}
                // Details owns the executable mount, so this placement is a preview.
                resolvePrimaryHost={() => 'details'}
                onRevealBoardItem={() => {}}
            />,
        );

        // The handler navigates to the Board, so the shared host's default
        // "Open here" label would promise an activation this control never does.
        expect(widgetHostProps.mock.calls.at(-1)?.[0]).toMatchObject({
            openActionLabel: 'sessionBoard.companion.actions.openOnBoard',
        });
    });

    it('threads plugin recovery and shared Board removal independently from local Companion removal', async () => {
        const managePlugin = vi.fn();
        const removeFromBoard = vi.fn();
        await renderScreen(
            <SessionCompanionContent
                session={session}
                serverId="server-a"
                controller={controller([{ kind: 'widget', widgetId: 'w1' }])}
                boardBinding={binding({
                    itemsById: new Map([['w1', readyItem('w1')]]),
                    capabilities: { readTranscript: true, editSessionRecords: true },
                    canEdit: true,
                })}
                resolvePrimaryHost={() => 'companion'}
                onManageBoardItemPlugin={managePlugin}
                onRemoveBoardItem={removeFromBoard}
            />,
        );

        const mounted = widgetHostProps.mock.calls.at(-1)?.[0] as Record<string, unknown>;
        (mounted.onManagePlugin as (() => void) | undefined)?.();
        (mounted.onRemove as (() => void) | undefined)?.();

        expect(managePlugin).toHaveBeenCalledWith('w1');
        expect(removeFromBoard).toHaveBeenCalledWith('w1');
        expect(removeItem).not.toHaveBeenCalled();
    });

    it('uses compact widget composition in the rail and fill composition in the full surface', async () => {
        const board = snapshot({ itemsById: new Map([['w1', readyItem('w1')]]) });
        const shared = {
            session,
            serverId: 'server-a',
            controller: controller([{ kind: 'widget' as const, widgetId: 'w1' }]),
            boardBinding: binding({ itemsById: board.itemsById }),
            resolvePrimaryHost: () => 'companion' as const,
        };

        await renderScreen(<SessionCompanionContent {...shared} presentation="rail" />);
        expect(widgetHostProps.mock.calls.at(-1)?.[0]).toMatchObject({ density: 'compact', expanded: false });

        await renderScreen(<SessionCompanionContent {...shared} presentation="full" />);
        expect(widgetHostProps.mock.calls.at(-1)?.[0]).toMatchObject({ density: 'full', expanded: true });
    });

    it('renders a recoverable pending state, never a deletion, while the inventory is incomplete', async () => {
        const renderer = await renderScreen(
            <SessionCompanionContent
                session={session}
                serverId="server-a"
                controller={controller([{ kind: 'widget', widgetId: 'w1' }])}
                boardBinding={binding({ incomplete: true })}
                resolvePrimaryHost={() => null}
            />,
        );

        expect(renderer.findByTestId('session-companion-content-pending-w1')).not.toBeNull();
        expect(renderer.findByTestId('session-companion-content-removed-w1')).toBeNull();
    });

    it('calls an absent widget removed only once the Board inventory is authoritative', async () => {
        const renderer = await renderScreen(
            <SessionCompanionContent
                session={session}
                serverId="server-a"
                controller={controller([{ kind: 'widget', widgetId: 'w1' }])}
                boardBinding={binding()}
                resolvePrimaryHost={() => null}
            />,
        );

        expect(renderer.findByTestId('session-companion-content-removed-w1')).not.toBeNull();
    });

    it('keeps an unreachable Board recoverable rather than tombstoning every reference', async () => {
        const renderer = await renderScreen(
            <SessionCompanionContent
                session={session}
                serverId="server-a"
                controller={controller([{ kind: 'widget', widgetId: 'w1' }])}
                boardBinding={binding({ reachability: 'offline' })}
                resolvePrimaryHost={() => null}
            />,
        );

        expect(renderer.findByTestId('session-companion-content-pending-w1')).not.toBeNull();
    });

    it('keeps revoked Board references visible without hiding the independent Session Summary', async () => {
        const renderer = await renderScreen(
            <SessionCompanionContent
                session={session}
                serverId="server-a"
                controller={controller([
                    SESSION_SUMMARY_COMPANION_ITEM,
                    { kind: 'widget', widgetId: 'w1' },
                ])}
                boardBinding={{ status: 'unavailable', reason: 'forbidden', refresh: vi.fn() }}
                resolvePrimaryHost={() => null}
            />,
        );

        expect(renderer.findByTestId('session-companion-content-summary')).not.toBeNull();
        expect(renderer.findByTestId(
            'session-companion-content-pending-w1-diagnostic-session_companion_widget_access_revoked',
        )).not.toBeNull();
        expect(renderer.getTextContent()).toContain('session.follow.accessLost');
    });

    it('offers retry for an offline Board reference through the incumbent binding refresh', async () => {
        const refresh = vi.fn();
        const renderer = await renderScreen(
            <SessionCompanionContent
                session={session}
                serverId="server-a"
                controller={controller([{ kind: 'widget', widgetId: 'w1' }])}
                boardBinding={{ status: 'unavailable', reason: 'offline', refresh }}
                resolvePrimaryHost={() => null}
            />,
        );
        await renderer.pressByTestIdAsync('session-companion-content-pending-w1-action');

        expect(renderer.findByTestId(
            'session-companion-content-pending-w1-diagnostic-session_companion_widget_offline',
        )).not.toBeNull();
        expect(refresh).toHaveBeenCalledTimes(1);
    });

    it('keeps Open on Board available for stale but reachable content', async () => {
        const openBoard = vi.fn();
        const renderer = await renderScreen(
            <SessionCompanionContent
                session={session}
                serverId="server-a"
                controller={controller([{ kind: 'widget', widgetId: 'w1' }])}
                boardBinding={binding({
                    freshness: 'stale',
                    itemsById: new Map([['w1', readyItem('w1')]]),
                })}
                resolvePrimaryHost={() => null}
                onRevealBoardItem={openBoard}
            />,
        );
        const [actionOwner] = renderer.findAll((node) => Array.isArray(node.props?.actions)
            && node.props?.overflowTriggerTestID === 'session-companion-content-item-widget:w1-actions');
        const actions = actionOwner?.props.actions as ReadonlyArray<{ id: string; onPress?: () => void }>;

        actions.find((action) => action.id === 'open-board')?.onPress?.();

        expect(openBoard).toHaveBeenCalledWith('w1');
        const openFromPreview = widgetHostProps.mock.calls.at(-1)?.[0]?.onOpenHere as (() => void) | undefined;
        openFromPreview?.();
        expect(openBoard).toHaveBeenNthCalledWith(2, 'w1');
    });

    it('offers one atomic add that seeds the summary and reveals the Companion together', async () => {
        const before = {
            ...HIDDEN_SESSION_COMPANION_PREFERENCE_V1,
            visible: true,
            items: [] as readonly SessionCompanionItemRefV1[],
        };
        const after = { ...before, items: [SESSION_SUMMARY_COMPANION_ITEM] };
        const outcome = { previous: before, applied: after };
        show.mockReturnValueOnce(outcome);
        const companion = controller([]);
        const renderer = await renderScreen(
            <SessionCompanionContent
                session={session}
                serverId="server-a"
                controller={companion}
                boardBinding={binding()}
                resolvePrimaryHost={() => null}
            />,
        );

        const empty = renderer.findByTestId('session-companion-content-empty');
        expect(empty).not.toBeNull();
        expect(show).not.toHaveBeenCalled();
        const [stateCard] = renderer.findAll((node) => (
            node.props?.testID === 'session-companion-content-empty'
            && typeof node.props?.action?.onPress === 'function'
        ));
        stateCard?.props.action.onPress();
        expect(show).toHaveBeenCalledWith(SESSION_SUMMARY_COMPANION_ITEM);
        expect(readPresentationNotice()).toMatchObject({
            message: 'sessionBoard.companion.notices.added',
            severity: 'info',
            undo: { label: 'sessionBoard.companion.actions.undo' },
        });
        readPresentationNotice()?.undo?.run();
        expect(applyLocalInverse).toHaveBeenCalledWith(outcome);
    });

    it('publishes one safe inverse after an exact item reorder and none for a no-op', async () => {
        const summary = SESSION_SUMMARY_COMPANION_ITEM;
        const widget = { kind: 'widget' as const, widgetId: 'w1' };
        const before = {
            ...HIDDEN_SESSION_COMPANION_PREFERENCE_V1,
            visible: true,
            items: [summary, widget],
        };
        const after = { ...before, items: [widget, summary] };
        const outcome = { previous: before, applied: after };
        moveItem.mockReturnValueOnce(outcome).mockReturnValueOnce(null);
        const companion = controller([summary, widget]);
        const renderer = await renderScreen(
            <SessionCompanionContent
                session={session}
                serverId="server-a"
                controller={companion}
                boardBinding={binding({ itemsById: new Map([['w1', readyItem('w1')]]) })}
                resolvePrimaryHost={() => null}
            />,
        );
        const [actionOwner] = renderer.findAll((node) => Array.isArray(node.props?.actions)
            && node.props?.overflowTriggerTestID === 'session-companion-content-item-builtin:session_summary-actions');
        const actions = actionOwner?.props.actions as ReadonlyArray<{ id: string; onPress?: () => void }>;

        actions.find((action) => action.id === 'move-down')?.onPress?.();
        expect(readPresentationNotice()).toMatchObject({
            message: 'sessionBoard.companion.notices.reordered',
            undo: { label: 'sessionBoard.companion.actions.undo' },
        });
        readPresentationNotice()?.undo?.run();
        expect(applyLocalInverse).toHaveBeenCalledWith(outcome);

        retirePresentationNotice();
        actions.find((action) => action.id === 'move-down')?.onPress?.();
        expect(readPresentationNotice()).toBeNull();
    });

    it('gives every mounted item a reachable local action menu', async () => {
        const renderer = await renderScreen(
            <SessionCompanionContent
                session={session}
                serverId="server-a"
                controller={controller([
                    SESSION_SUMMARY_COMPANION_ITEM,
                    { kind: 'widget', widgetId: 'w1' },
                ])}
                boardBinding={binding({
                    itemsById: new Map([['w1', readyItem('w1')]]),
                    capabilities: { readTranscript: true, editSessionRecords: true },
                    canEdit: true,
                })}
                resolvePrimaryHost={() => 'companion'}
            />,
        );

        expect(renderer.findByTestId('session-companion-content-item-builtin:session_summary-actions')).not.toBeNull();
        expect(renderer.findByTestId('session-companion-content-item-widget:w1-actions')).not.toBeNull();
    });

    it('offers safe Undo through the one presentation notice when an item is removed locally', async () => {
        const before = {
            ...HIDDEN_SESSION_COMPANION_PREFERENCE_V1,
            visible: true,
            items: [SESSION_SUMMARY_COMPANION_ITEM],
        };
        const after = { ...before, visible: false, items: [] };
        const outcome = { previous: before, applied: after };
        removeItem.mockReturnValueOnce(outcome);
        const companion = controller([SESSION_SUMMARY_COMPANION_ITEM]);
        const renderer = await renderScreen(
            <SessionCompanionContent
                session={session}
                serverId="server-a"
                controller={companion}
                boardBinding={binding()}
                resolvePrimaryHost={() => null}
            />,
        );
        const [actionOwner] = renderer.findAll((node) => Array.isArray(node.props?.actions)
            && node.props?.overflowTriggerTestID === 'session-companion-content-item-builtin:session_summary-actions');
        const actions = actionOwner?.props.actions as ReadonlyArray<{ id: string; onPress?: () => void }>;

        actions.find((action) => action.id === 'remove')?.onPress?.();

        expect(readPresentationNotice()).toMatchObject({
            message: 'sessionBoard.companion.notices.removed',
            severity: 'info',
            undo: { label: 'sessionBoard.companion.actions.undo' },
        });
        readPresentationNotice()?.undo?.run();
        expect(applyLocalInverse).toHaveBeenCalledWith(outcome);
    });

    it('uses the translation owner for every visible string', async () => {
        const renderer = await renderScreen(
            <SessionCompanionContent
                session={session}
                serverId="server-a"
                controller={controller([])}
                boardBinding={binding()}
                resolvePrimaryHost={() => null}
            />,
        );

        // The text mock echoes keys, so hardcoded English would surface here as
        // prose instead of the translation key its owner resolves.
        const [empty] = renderer.findAll((node) => (
            node.props?.testID === 'session-companion-content-empty'
            && typeof node.props?.title === 'string'
        ));
        expect(empty?.props.title).toBe('sessionBoard.companion.empty.title');
        expect(empty?.props.reason).toBe('sessionBoard.companion.empty.reason');
        expect(empty?.props.action?.label).toBe('sessionBoard.companion.actions.addSummary');
    });
});
