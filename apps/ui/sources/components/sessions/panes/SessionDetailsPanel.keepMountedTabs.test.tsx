import * as React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { findTestInstanceByTypeWithProps, flushHookEffects, renderScreen } from '@/dev/testkit';
import { installSessionDetailsPanelCommonModuleMocks } from './sessionDetailsPanelTestHelpers';
import { EMPTY_PLUGIN_UI_PROJECTION } from '@/sync/domains/plugins/ui/projection';


(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const addEventListenerSpy = vi.fn((type: string, handler: any) => {
    if (type === 'wheel') wheelHandlers.push(handler);
    if (type === 'touchmove') touchMoveHandlers.push(handler);
});
const removeEventListenerSpy = vi.fn();
const wheelHandlers: Array<(e: any) => void> = [];
const touchMoveHandlers: Array<(e: any) => void> = [];

let lastScrollLockBypassEl: { addEventListener: any; removeEventListener: any } | null = null;

const fakeDomNode = {
    addEventListener: addEventListenerSpy,
    removeEventListener: removeEventListenerSpy,
    querySelectorAll: () => [],
    querySelector: () => null,
    getAttribute: () => null,
    hasAttribute: () => false,
    scrollHeight: 0,
    clientHeight: 0,
    scrollWidth: 0,
    clientWidth: 0,
    scrollTop: 0,
    scrollLeft: 0,
};

type ScopeStateFixture = Readonly<{
    right: Readonly<{
        isOpen: boolean;
        activeTabId: string | null;
    }>;
    details: Readonly<{
        isOpen: boolean;
        activeTabKey: string;
        groups?: ReadonlyArray<Readonly<{ id: string; activeTabKey: string | null }>>;
        maximizedGroupId?: string | null;
        tabs: ReadonlyArray<Readonly<{
            key: string;
            kind: string;
            title: string;
            isPinned: boolean;
            isPreview: boolean;
            resource: Readonly<{ kind: string; path?: string }>;
        }>>;
    }>;
}>;

function createScopeState(): ScopeStateFixture {
    return {
        right: {
            isOpen: false,
            activeTabId: null,
        },
        details: {
            isOpen: true,
            activeTabKey: 'file:a',
            tabs: [
                { key: 'file:a', kind: 'file', title: 'a.txt', isPinned: true, isPreview: false, resource: { kind: 'file', path: 'a.txt' } },
                { key: 'scmReview', kind: 'scmReview', title: 'Review', isPinned: true, isPreview: false, resource: { kind: 'scmReview' } },
            ],
        },
    };
}

let scopeState = createScopeState();
let boardFeatureEnabled = false;
let mountedBoardItemCount = 0;
let mountedBoardAddressMatches = true;
let sessionHydrated = true;
const mountedBoardAddressCalls: unknown[] = [];
const mountedCallerHostedHtmlRuntime = Object.freeze({ serverIdentityId: 'home-a-runtime' });

function getStyleValue(style: unknown, key: string): unknown {
    if (Array.isArray(style)) {
        for (let index = style.length - 1; index >= 0; index -= 1) {
            const value = getStyleValue(style[index], key);
            if (typeof value !== 'undefined') return value;
        }
        return undefined;
    }
    return style && typeof style === 'object'
        ? (style as Record<string, unknown>)[key]
        : undefined;
}

installSessionDetailsPanelCommonModuleMocks({
    reactNative: async () => {
        const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
        return createReactNativeWebMock({
            Platform: {
                OS: 'web',
            },
            View: React.forwardRef((props: any, ref: any) => {
                lastScrollLockBypassEl = fakeDomNode;
                if (ref && typeof ref === 'object') {
                    ref.current = fakeDomNode;
                }
                if (typeof ref === 'function') {
                    ref(fakeDomNode);
                }
                return React.createElement('View', props, props.children);
            }),
            Pressable: (props: any) => React.createElement('Pressable', props, props.children),
            ScrollView: (props: any) => React.createElement('ScrollView', props, props.children),
        });
    },
    storage: async () => {
        const { createStorageModuleStub } = await import('@/dev/testkit/mocks/storage');
        return createStorageModuleStub({
            useLocalSetting: (key: string) => {
                return null;
            },
            useLocalSettingMutable: () => [false, vi.fn()],
        });
    },
});

vi.mock('@/components/sessions/files/views/SessionCommitDetailsView', () => ({
    SessionCommitDetailsView: () => React.createElement('SessionCommitDetailsView'),
}));

vi.mock('@/components/sessions/files/views/SessionFileDetailsView', () => ({
    SessionFileDetailsView: (props: any) => React.createElement('SessionFileDetailsView', props),
}));

vi.mock('@/components/sessions/files/views/SessionScmReviewDetailsView', () => ({
    SessionScmReviewDetailsView: () => React.createElement('SessionScmReviewDetailsView'),
}));

vi.mock('@/components/ui/media/FileIcon', () => ({
    FileIcon: 'FileIcon',
}));

vi.mock('@/components/ui/code/editor/CodeEditor', () => ({
    CodeEditor: (props: Record<string, unknown>) => React.createElement('CodeEditor', props),
}));

const unpinDetailsTab = vi.fn();
const openRight = vi.fn();
const closeRight = vi.fn();

vi.mock('@/components/appShell/panes/hooks/useAppPaneScope', () => ({
    useAppPaneScope: () => ({
        closeDetails: vi.fn(),
        closeDetailsTab: vi.fn(),
        openRight,
        closeRight,
        pinDetailsTab: vi.fn(),
        unpinDetailsTab,
        setActiveDetailsTab: vi.fn(),
        openDetailsTab: vi.fn(),
        scopeState,
    }),
}));

vi.mock('@/hooks/server/useFeatureEnabled', () => ({
    useFeatureEnabled: (featureId: string, scope: Readonly<{ serverId?: string | null }>) => {
        if (featureId !== 'sessions.board' || scope.serverId !== 'home-a') return false;
        return boardFeatureEnabled;
    },
}));

vi.mock('@/components/sessions/board/SessionBoardControllerProvider', () => ({
    useMountedSessionBoardController: (address: unknown) => {
        mountedBoardAddressCalls.push(address);
        if (!mountedBoardAddressMatches) return null;
        return {
            callerHostedHtmlRuntime: mountedCallerHostedHtmlRuntime,
            binding: {
                status: 'ready',
                snapshot: {
                    itemsById: new Map(
                        Array.from({ length: mountedBoardItemCount }, (_, index) => [`item-${index}`, {}]),
                    ),
                },
            },
        };
    },
}));

vi.mock('@/components/sessions/shell/sessionViewStableSession', () => ({
    useSessionViewShellSession: (sessionId: string, serverId: string | null) => sessionHydrated ? ({
        id: sessionId,
        serverId,
        metadata: null,
    }) : null,
}));

vi.mock('@/components/ui/surfaces/hostedHtml/useSessionCallerHostedHtmlRuntime', () => ({
    useSessionCallerHostedHtmlRuntime: () => {
        throw new Error('panels must consume the Session shell mounted Board runtime');
    },
}));

async function renderSessionDetailsPanel() {
    const { SessionDetailsPanel } = await import('./SessionDetailsPanel');
    const screen = await renderScreen(<SessionDetailsPanel
        sessionId="s1"
        scopeId="session:s1"
        paneSurfaceScope={{
            targetKind: 'session',
            sessionId: 's1',
            machineId: 'machine-a',
            serverId: 'home-a',
            pluginUiProjection: EMPTY_PLUGIN_UI_PROJECTION,
            projectionPhase: 'current',
            interactionEnabled: true,
            platform: 'web',
        }}
    />);
    await flushHookEffects({ cycles: 1, frames: 1 });
    return screen;
}

describe('SessionDetailsPanel (keep mounted tabs)', () => {
    beforeEach(() => {
        scopeState = createScopeState();
        lastScrollLockBypassEl = null;
        addEventListenerSpy.mockClear();
        removeEventListenerSpy.mockClear();
        openRight.mockClear();
        closeRight.mockClear();
        unpinDetailsTab.mockClear();
        boardFeatureEnabled = false;
        mountedBoardItemCount = 0;
        mountedBoardAddressMatches = true;
        sessionHydrated = true;
        mountedBoardAddressCalls.length = 0;
        wheelHandlers.length = 0;
        touchMoveHandlers.length = 0;
    });

    it('shows a pending details state until a deep-linked Session hydrates', async () => {
        sessionHydrated = false;
        const screen = await renderSessionDetailsPanel();
        expect(screen.findByTestId('details-surface-fallback-pending')).not.toBeNull();
        expect(screen.findByTestId('details-surface-fallback-unsupported')).toBeNull();
    });

    it('keeps inactive tab contents mounted so state can be preserved', async () => {
        const screen = await renderSessionDetailsPanel();

        expect(screen.findAllByType('SessionFileDetailsView')).toHaveLength(1);
        expect(screen.findAllByType('SessionScmReviewDetailsView')).toHaveLength(1);
    });

    it('promotes Board to a dedicated exact-Home header action only for content or a visible Board', async () => {
        const { SessionDetailsPanel } = await import('./SessionDetailsPanel');
        boardFeatureEnabled = true;

        let screen = await renderSessionDetailsPanel();
        expect(screen.findByTestId('session-details-open-board')).toBeUndefined();
        expect(mountedBoardAddressCalls.at(-1)).toEqual({ serverId: 'home-a', sessionId: 's1' });

        mountedBoardItemCount = 1;
        screen.tree.update(<SessionDetailsPanel
            sessionId="s1"
            scopeId="session:s1"
            paneSurfaceScope={{
                targetKind: 'session',
                sessionId: 's1',
                machineId: 'machine-a',
                serverId: 'home-a',
                pluginUiProjection: EMPTY_PLUGIN_UI_PROJECTION,
                projectionPhase: 'current',
                interactionEnabled: true,
                platform: 'web',
            }}
        />);
        expect(screen.findByTestId('session-details-open-board')).toBeTruthy();

        mountedBoardItemCount = 0;
        scopeState = {
            ...scopeState,
            details: {
                ...scopeState.details,
                groups: [{ id: 'secondary', activeTabKey: 'board' }],
            },
        };
        screen.tree.update(<SessionDetailsPanel
            sessionId="s1"
            scopeId="session:s1"
            paneSurfaceScope={{
                targetKind: 'session',
                sessionId: 's1',
                machineId: 'machine-a',
                serverId: 'home-a',
                pluginUiProjection: EMPTY_PLUGIN_UI_PROJECTION,
                projectionPhase: 'current',
                interactionEnabled: true,
                platform: 'web',
            }}
        />);
        expect(screen.findByTestId('session-details-open-board')).toBeTruthy();

        mountedBoardAddressMatches = false;
        scopeState = createScopeState();
        screen.tree.update(<SessionDetailsPanel
            sessionId="s1"
            scopeId="session:s1"
            paneSurfaceScope={{
                targetKind: 'session',
                sessionId: 's1',
                machineId: 'machine-a',
                serverId: 'home-a',
                pluginUiProjection: EMPTY_PLUGIN_UI_PROJECTION,
                projectionPhase: 'current',
                interactionEnabled: true,
                platform: 'web',
            }}
        />);
        expect(screen.findByTestId('session-details-open-board')).toBeUndefined();
    });

    it('keeps the dedicated Board header action hidden when the exact Home disables Board', async () => {
        const { SessionDetailsPanel } = await import('./SessionDetailsPanel');
        mountedBoardItemCount = 1;
        scopeState = {
            ...scopeState,
            details: {
                ...scopeState.details,
                activeTabKey: 'board',
            },
        };

        const screen = await renderScreen(<SessionDetailsPanel
            sessionId="s1"
            scopeId="session:s1"
            paneSurfaceScope={{
                targetKind: 'session',
                sessionId: 's1',
                machineId: 'machine-a',
                serverId: 'home-a',
                pluginUiProjection: EMPTY_PLUGIN_UI_PROJECTION,
                projectionPhase: 'current',
                interactionEnabled: true,
                platform: 'web',
            }}
        />);

        expect(screen.findByTestId('session-details-open-board')).toBeUndefined();
    });

    it('does not hide inactive tab surfaces via accessibility props on web (preserve scroll state)', async () => {
        const screen = await renderSessionDetailsPanel();

        const surfaces = screen.findAll((node) => {
            const props = node.props as any;
            return props.pointerEvents === 'none' || props.pointerEvents === 'auto';
        });

        // Find an inactive surface (pointerEvents="none") and ensure we aren't using props that can map to `hidden`
        // on react-native-web, which would drop scroll/editing state when switching tabs.
        const inactiveSurface = surfaces.find((s) => (s.props as any).pointerEvents === 'none');
        expect(inactiveSurface).toBeTruthy();
        expect(getStyleValue(inactiveSurface!.props.style, 'display')).toBe('flex');
        expect(getStyleValue(inactiveSurface!.props.style, 'visibility')).toBe('hidden');
        expect((inactiveSurface!.props as any).accessibilityElementsHidden).toBeUndefined();
        expect((inactiveSurface!.props as any).importantForAccessibility).toBeUndefined();
    });

    it('stops wheel/touch scroll propagation on web so docked/overlay panes can scroll inside modals', async () => {
        lastScrollLockBypassEl = null;
        const originalDocument = (globalThis as any).document;
        // Simulate a scroll-locked document (common with web overlays/modals).
        (globalThis as any).document = {
            documentElement: {
                hasAttribute: () => false,
                getAttribute: () => null,
            },
            body: {
                hasAttribute: () => false,
                getAttribute: () => null,
                style: { overflow: 'hidden', overflowY: 'hidden' },
            },
            defaultView: {
                getComputedStyle: () => ({ overflow: 'hidden', overflowY: 'hidden' }),
            },
        };

        try {
            await renderSessionDetailsPanel();

            expect(lastScrollLockBypassEl).toBeTruthy();
            expect(vi.mocked(lastScrollLockBypassEl!.addEventListener)).toHaveBeenCalledWith(
                'wheel',
                expect.any(Function),
                expect.objectContaining({ passive: true }),
            );
            expect(vi.mocked(lastScrollLockBypassEl!.addEventListener)).toHaveBeenCalledWith(
                'touchmove',
                expect.any(Function),
                expect.objectContaining({ passive: true }),
            );
        } finally {
            (globalThis as any).document = originalDocument;
        }
    });

    it('renders pinned tab affordance as an unpin icon (pin-slash)', async () => {
        const screen = await renderSessionDetailsPanel();

        const pinnedA = screen.findByTestId('session-details-tab-unpin-file_a');
        const pinnedReview = screen.findByTestId('session-details-tab-unpin-scmReview');
        if (!pinnedA || !pinnedReview) {
            throw new Error('Unable to find pinned tab affordances');
        }

        const aIcon = findTestInstanceByTypeWithProps(pinnedA, 'Icon', { name: 'push-pin-slash' });
        const reviewIcon = findTestInstanceByTypeWithProps(pinnedReview, 'Icon', { name: 'push-pin-slash' });

        expect(aIcon).toBeTruthy();
        expect(reviewIcon).toBeTruthy();
    });

    it('uses the concrete file icon in file detail tabs', async () => {
        const screen = await renderSessionDetailsPanel();

        const tab = screen.findByTestId('session-details-tab-file_a');
        if (!tab) {
            throw new Error('Unable to find file details tab');
        }

        expect(screen.findByTestId('session-details-tab-file-icon-file_a')).toBeTruthy();
        expect(findTestInstanceByTypeWithProps(tab, 'Icon', { name: 'file' })).toBeUndefined();
    });

    it('opens the right pane from the details panel header when it is closed', async () => {
        const screen = await renderSessionDetailsPanel();

        await screen.pressByTestId('session-details-right-pane-toggle');

        expect(openRight).toHaveBeenCalledTimes(1);
        expect(closeRight).not.toHaveBeenCalled();
    });

    it('closes the right pane from the details panel header when it is open', async () => {
        scopeState = {
            ...scopeState,
            right: {
                isOpen: true,
                activeTabId: 'files',
            },
        };
        const screen = await renderSessionDetailsPanel();

        await screen.pressByTestId('session-details-right-pane-toggle');

        expect(closeRight).toHaveBeenCalledTimes(1);
        expect(openRight).not.toHaveBeenCalled();
    });

    it('renders preview tab pin action as a pin icon (not pin-slash)', async () => {
        const originalTabs = scopeState.details.tabs;
        scopeState = {
            ...scopeState,
            details: {
                ...scopeState.details,
                tabs: [
                    ...originalTabs,
                    {
                        key: 'file:preview',
                        kind: 'file',
                        title: 'preview.txt',
                        isPinned: false,
                        isPreview: true,
                        resource: { kind: 'file', path: 'preview.txt' },
                    },
                ],
            },
        };

        try {
            const screen = await renderSessionDetailsPanel();
            const pinButton = screen.findByTestId('session-details-tab-pin-file_preview');
            if (!pinButton) {
                throw new Error('Unable to find preview pin affordance');
            }
            const pinIcon = findTestInstanceByTypeWithProps(pinButton, 'Icon', { name: 'push-pin' });
            expect(pinIcon).toBeTruthy();
        } finally {
            scopeState = {
                ...scopeState,
                details: {
                    ...scopeState.details,
                    tabs: originalTabs,
                },
            };
        }
    });

    it('unpins a pinned tab when pressing the unpin action', async () => {
        const screen = await renderSessionDetailsPanel();

        await screen.pressByTestId('session-details-tab-unpin-file_a');

        expect(unpinDetailsTab).toHaveBeenCalledWith('file:a');
    });
});
