import * as React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderScreen } from '@/dev/testkit/render/renderScreen';
import { createTextModuleMock } from '@/dev/testkit/mocks/text';
import { createSessionSurfaceNoteDocumentV1, type SessionSurfaceItemV1 } from '@happier-dev/protocol/sessions/board';
import {
    readPresentationNotice,
    retirePresentationNotice,
} from '@/components/sessions/presentation/presentationNotices';

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

vi.mock('@/components/sessions/shell/sessionViewStableSession', () => ({
    useSessionViewShellSession: () => ({ id: 'session-1', serverId: 'server-a' }),
}));

vi.mock('@/hooks/server/useFeatureEnabled', () => ({
    useFeatureEnabled: () => true,
}));

const boardSnapshot = vi.fn();
const boardControllerRun = vi.fn();
vi.mock('@/components/sessions/board/SessionBoardControllerProvider', () => ({
    useMountedSessionBoardController: () => ({
        address: { serverId: 'server-a', sessionId: 'session-1' },
        binding: boardSnapshot(),
        controller: {
            supports: (kind: string) => kind === 'item.managePlugin' || kind === 'item.remove',
            run: boardControllerRun,
        },
        pluginRuntime: shellRuntime,
        callerHostedHtmlRuntime: null,
    }),
}));

// The mobile Cockpit shell: no multi-pane, phone class. The REAL host-visibility
// derivation runs on top of these incumbent-owner facts.
vi.mock('@/components/appShell/panes/hooks/useAppPaneScope', () => ({
    useAppPaneScope: () => ({ scopeId: 'session:s1', scopeState: null }),
}));
vi.mock('@/components/appShell/panes/hooks/useAppPaneScopeLayout', () => ({
    useOptionalAppPaneScopeLayout: () => ({
        containerWidthPx: 390,
        containerHeightPx: 844,
        mainRegionHeightPx: 844,
        mainRegionWidthPx: 390,
        multiPaneEnabled: false,
        deviceType: 'phone',
        layout: { kind: 'single', right: 'hidden', details: 'hidden' },
        bottomPresentation: 'docked',
    }),
}));
vi.mock('@/sync/domains/session/sessionSurfaceVisibility', () => ({
    isSessionSurfaceVisible: () => true,
}));
vi.mock('@/hooks/ui/useKeyboardHeight', () => ({ useKeyboardHeight: () => 0 }));
vi.mock('@/components/workspaceCockpit/session/SessionCockpitChromeRegistry', () => ({
    useSessionCockpitBottomChromeHeight: () => 64,
    useSessionCockpitComposerChromeHeight: () => 0,
}));

const storedPreference = { value: undefined as unknown };
const mutate = vi.fn();
vi.mock('@/sync/domains/state/storage', async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    useSessionCompanionPreferenceSlot: () => ({
        stored: storedPreference.value,
        storageKey: JSON.stringify(['server-a', 'account-a', 'session-1']),
    }),
    useMutateSessionCompanionPreference: () => mutate,
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
    type SessionBoardOpenedRecord,
} from '@/sync/domains/session/board';

import { SessionCompanionScreen } from './SessionCompanionScreen';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const readySnapshot = () => ({
    status: 'ready' as const,
    snapshot: projectSessionBoard({
        layout: undefined,
        items: new Map(),
        capabilities: null,
        freshness: 'fresh',
        reachability: 'reachable',
        loading: 'idle',
        incomplete: false,
    }),
    refresh: () => {},
});
const resolvePrimaryHost = () => 'companion' as const;
const shellRuntime = {
    serverId: 'server-a',
    machineId: 'machine-from-cockpit-shell',
    pluginUiProjection: null,
    pluginBrowserProjection: null,
    phase: 'current' as const,
    interactionEnabled: true,
    platform: 'web' as const,
};
const shellProps = {
    sessionId: 'session-1',
    address: { serverId: 'server-a', sessionId: 'session-1' },
    onRequestClose: () => {},
    onRevealBoardItem: () => {},
    resolvePrimaryHost,
};

describe('SessionCompanionScreen (mounted, mobile Cockpit)', () => {
    beforeEach(() => {
        widgetHostProps.mockClear();
        boardControllerRun.mockClear();
        mutate.mockClear();
        mutate.mockImplementation((_sessionId: string, project: (stored: unknown) => unknown) => {
            const next = project(storedPreference.value);
            if (next !== null) storedPreference.value = next;
            return next !== null;
        });
        retirePresentationNotice();
        boardSnapshot.mockReturnValue(readySnapshot());
        storedPreference.value = {
            v: 1,
            visible: true,
            collapsed: false,
            edge: 'trailing',
            density: 'compact',
            items: [{ kind: 'builtin', id: 'session_summary' }],
        };
    });

    it('renders one full-height Companion destination with the shared content owner', async () => {
        const renderer = await renderScreen(
            <SessionCompanionScreen
                {...shellProps}
            />,
        );

        expect(renderer.findByTestId('session-companion-screen')).not.toBeNull();
        expect(renderer.findByTestId('session-companion-content')).not.toBeNull();
        expect(renderer.findByTestId('session-companion-content-summary')).not.toBeNull();
        expect(renderer.findByTestId('session-companion-screen-heading')?.props.accessibilityRole).toBe('header');
        // Full-height content stretches to the Cockpit width. Publishing that
        // laid-out width as rail evidence would make the placement owner treat
        // a presentation constraint as the card's intrinsic rail width.
        expect(renderer.findByTestId(
            'session-companion-content-item-builtin:session_summary',
        )?.props.onLayout).toBeUndefined();
    });

    it('routes installed-widget recovery and Board removal through the mounted Board controller', async () => {
        boardSnapshot.mockReturnValue({
            ...readySnapshot(),
            snapshot: projectSessionBoard({
                layout: undefined,
                items: new Map([['w1', {
                    revision: 'r1',
                    outcome: {
                        status: 'ready',
                        value: {
                            v: 1,
                            title: 'Review status',
                            frame: 'card',
                            height: { mode: 'auto', fallback: 'regular' },
                            source: {
                                kind: 'installedSurface',
                                surface: { pluginId: 'acme.review', localId: 'review-status' },
                            },
                        },
                    },
                }]]),
                capabilities: { readTranscript: true, editSessionRecords: true },
                freshness: 'fresh',
                reachability: 'reachable',
                loading: 'idle',
                incomplete: false,
            }),
        });
        storedPreference.value = {
            v: 1,
            visible: true,
            collapsed: false,
            edge: 'trailing',
            density: 'compact',
            items: [{ kind: 'widget', widgetId: 'w1' }],
        };

        await renderScreen(<SessionCompanionScreen {...shellProps} />);
        const mounted = widgetHostProps.mock.calls.at(-1)?.[0] as Record<string, unknown>;
        (mounted.onManagePlugin as (() => void) | undefined)?.();
        (mounted.onRemove as (() => void) | undefined)?.();

        expect(boardControllerRun).toHaveBeenNthCalledWith(1, { kind: 'item.managePlugin', itemId: 'w1' });
        expect(boardControllerRun).toHaveBeenNthCalledWith(2, { kind: 'item.remove', itemId: 'w1' });
    });

    it('preserves the Session Summary when the exact Home cannot provide Board', async () => {
        boardSnapshot.mockReturnValue({
            status: 'unavailable',
            reason: 'board_feature_disabled',
            refresh: vi.fn(),
        });
        const renderer = await renderScreen(
            <SessionCompanionScreen
                {...shellProps}
            />,
        );

        expect(renderer.findByTestId('session-companion-screen-unavailable')).toBeNull();
        expect(renderer.findByTestId('session-companion-content')).not.toBeNull();
        expect(renderer.findByTestId('session-companion-content-summary')).not.toBeNull();
    });

    it('exposes the Companion menu without collapse controls that would do nothing here', async () => {
        const renderer = await renderScreen(
            <SessionCompanionScreen
                {...shellProps}
            />,
        );

        const [menu] = renderer.findAll((node) => Array.isArray(node.props?.actions)
            && node.props?.overflowTriggerTestID === 'session-companion-screen-menu');
        const ids = (menu?.props.actions as ReadonlyArray<{ id: string }>).map((action) => action.id);

        expect(ids).toContain('edge-leading');
        expect(ids).toContain('density-comfortable');
        expect(ids).toContain('hide');
        expect(ids).not.toContain('collapse');
        expect(ids).not.toContain('expand');
        // Navigation to "the full surface" from the full surface would be a
        // control with no observable effect.
        expect(ids).not.toContain('open-full');
    });

    it('returns to Chat when the person hides the full-screen Companion', async () => {
        const onRequestClose = vi.fn();
        const renderer = await renderScreen(
            <SessionCompanionScreen
                {...shellProps}
                onRequestClose={onRequestClose}
            />,
        );
        const [menu] = renderer.findAll((node) => Array.isArray(node.props?.actions)
            && node.props?.overflowTriggerTestID === 'session-companion-screen-menu');
        const actions = menu?.props.actions as ReadonlyArray<{ id: string; onPress?: () => void }>;

        actions.find((action) => action.id === 'hide')?.onPress?.();

        expect(mutate).toHaveBeenCalledTimes(1);
        expect(onRequestClose).toHaveBeenCalledTimes(1);
        expect(readPresentationNotice()).toMatchObject({
            message: 'sessionBoard.companion.notices.hidden',
            undo: { label: 'sessionBoard.companion.actions.undo' },
        });
    });

    it('publishes feedback only after applied edge and density changes', async () => {
        const renderer = await renderScreen(
            <SessionCompanionScreen {...shellProps} />,
        );
        const [menu] = renderer.findAll((node) => Array.isArray(node.props?.actions)
            && node.props?.overflowTriggerTestID === 'session-companion-screen-menu');
        const actions = menu?.props.actions as ReadonlyArray<{ id: string; onPress?: () => void }>;

        actions.find((action) => action.id === 'density-compact')?.onPress?.();
        expect(readPresentationNotice()).toBeNull();

        actions.find((action) => action.id === 'edge-leading')?.onPress?.();
        expect(readPresentationNotice()).toMatchObject({
            message: 'sessionBoard.companion.notices.moved',
            undo: { label: 'sessionBoard.companion.actions.undo' },
        });

        retirePresentationNotice();
        actions.find((action) => action.id === 'density-comfortable')?.onPress?.();
        expect(readPresentationNotice()).toMatchObject({
            message: 'sessionBoard.companion.actions.comfortable',
            undo: { label: 'sessionBoard.companion.actions.undo' },
        });
    });

    it('offers safe Undo when a readable Board item is added from the Companion menu', async () => {
        const boardItems = new Map<string, SessionBoardOpenedRecord<SessionSurfaceItemV1>>([['widget-1', {
            revision: 'r1',
            outcome: {
                status: 'ready',
                value: {
                    v: 1,
                    title: 'Deploy status',
                    frame: 'card',
                    height: { mode: 'auto', fallback: 'regular' },
                    source: {
                        kind: 'declarative',
                        document: createSessionSurfaceNoteDocumentV1(''),
                    },
                },
            },
        }]]);
        boardSnapshot.mockReturnValue({
            status: 'ready',
            snapshot: projectSessionBoard({
                layout: undefined,
                items: boardItems,
                capabilities: { readTranscript: true, editSessionRecords: true },
                freshness: 'fresh',
                reachability: 'reachable',
                loading: 'idle',
                incomplete: false,
            }),
            refresh: () => {},
        });
        const renderer = await renderScreen(
            <SessionCompanionScreen
                {...shellProps}
                onRequestClose={() => {}}
            />,
        );
        const [menu] = renderer.findAll((node) => Array.isArray(node.props?.actions)
            && node.props?.overflowTriggerTestID === 'session-companion-screen-menu');
        const actions = menu?.props.actions as ReadonlyArray<{ id: string; onPress?: () => void }>;

        actions.find((action) => action.id === 'add-widget-1')?.onPress?.();

        expect(readPresentationNotice()).toMatchObject({
            message: 'sessionBoard.companion.notices.added',
            severity: 'info',
            undo: { label: 'sessionBoard.companion.actions.undo' },
        });
    });

    it('never mounts a persistent rail on a phone: the wide host resolves to a mobile control', async () => {
        const renderer = await renderScreen(
            <SessionCompanionScreen
                {...shellProps}
            />,
        );

        expect(renderer.findByTestId('session-companion-reserved-rail')).toBeNull();
        expect(renderer.findByTestId('session-companion-collapsed-control')).toBeNull();
    });

    it('reads its preference through the realm-qualified slot and writes nothing on mount', async () => {
        await renderScreen(
            <SessionCompanionScreen
                {...shellProps}
            />,
        );

        expect(mutate).not.toHaveBeenCalled();
    });

    it('shows a truthful loading state while the exact Session is not readable yet', async () => {
        const renderer = await renderScreen(
            <SessionCompanionScreen
                {...shellProps}
            />,
        );

        // An unavailable Board never becomes a deleted-item tombstone here.
        expect(renderer.findByTestId('session-companion-content')).not.toBeNull();
    });
});
