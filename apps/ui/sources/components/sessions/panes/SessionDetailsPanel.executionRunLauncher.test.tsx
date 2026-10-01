import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';

import { installSessionDetailsPanelCommonModuleMocks } from './sessionDetailsPanelTestHelpers';
import { renderScreen } from '@/dev/testkit/render/renderScreen';

// Loaded at the assertion, not at the top: an eager import would evaluate the spinner's module
// graph before this file's mocks and per-test setup have run.
const loadActivitySpinner = async () => (await import('@/components/ui/feedback/ActivitySpinner')).ActivitySpinner;

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('@/components/ui/text/Text', () => ({
    Text: 'Text',
    TextInput: 'TextInput',
}));

installSessionDetailsPanelCommonModuleMocks({
    icons: async () => ({
        Octicons: 'Octicons',
        Ionicons: 'Ionicons',
    }),
    storage: async (importOriginal) => {
        const { createStorageModuleMock } = await import('@/dev/testkit/mocks/storage');
        return createStorageModuleMock({
            importOriginal,
            overrides: {
                useLocalSetting: ((key: string) => {
                    return null;
                }) as any,
                useLocalSettingMutable: (() => [false, vi.fn()]) as any,
            },
        });
    },
});

vi.mock('@/components/appShell/panes/hooks/useAppPaneScope', () => ({
    useAppPaneScope: () => ({
        closeDetails: vi.fn(),
        closeDetailsTab: vi.fn(),
        pinDetailsTab: vi.fn(),
        unpinDetailsTab: vi.fn(),
        setActiveDetailsTab: vi.fn(),
        openDetailsTab: vi.fn(),
        setDetailsTabState: vi.fn(),
        scopeState: {
            details: {
                isOpen: true,
                activeTabKey: 'execution-run-launcher:review',
                tabState: {},
                tabs: [
                    {
                        key: 'execution-run-launcher:review',
                        kind: 'executionRunLauncher',
                        title: 'Review run',
                        isPinned: false,
                        isPreview: true,
                        resource: { kind: 'executionRunLauncher', intent: 'review' },
                    },
                ],
            },
        },
    }),
}));

vi.mock('@/components/appShell/panes/details/workspace/DetailsSplitWorkspace', () => ({
    DetailsSplitWorkspace: (props: Readonly<{
        pane: { scopeState: { details: { tabs: readonly unknown[] } } };
        renderTabContent: (tab: unknown, presentation: Readonly<{ active: boolean }>) => React.ReactNode;
    }>) => React.createElement(
        React.Fragment,
        null,
        props.renderTabContent(props.pane.scopeState.details.tabs[0], { active: true }),
    ),
}));

vi.mock('@/components/appShell/panes/details/surfaces', () => ({
    createDetailsSurfacePaneCallbacks: (callbacks: unknown) => callbacks,
    DetailsSurfaceHost: (props: Readonly<{
        tab: Record<string, unknown>;
        scope: Record<string, unknown>;
        region: string;
        renderers: ReadonlyArray<{
            canRender: (input: Record<string, unknown>) => boolean;
            render: (input: Record<string, unknown>) => React.ReactNode;
        }>;
        callbacks: Record<string, unknown>;
    }>) => {
        const input = {
            tab: props.tab,
            scope: props.scope,
            region: props.region,
            callbacks: props.callbacks,
            active: true,
        };
        const renderer = props.renderers.find((candidate) => candidate.canRender(input));
        return React.createElement(React.Fragment, null, renderer?.render(input) ?? null);
    },
}));

const launcherViewSpy = vi.fn();

vi.mock('@/components/sessions/runs/launcher/SessionInteractiveExecutionRunDraftView', () => ({
    SessionInteractiveExecutionRunDraftView: (props: any) => {
        launcherViewSpy(props);
        return React.createElement('SessionInteractiveExecutionRunDraftView');
    },
}));

vi.mock('@/components/sessions/runs/details/SessionExecutionRunDetailsView', () => ({
    SessionExecutionRunDetailsView: () => React.createElement('SessionExecutionRunDetailsView'),
}));

vi.mock('./useSessionDetailsPanelPluginRuntime', () => ({
    useSessionDetailsPanelPluginRuntime: () => ({
        machineId: null,
        serverId: 'server-1',
        pluginUiProjection: null,
        pluginBrowserProjection: null,
        phase: 'unavailable',
        interactionEnabled: false,
        peerMediationObservabilityScope: null,
        platform: 'web',
    }),
}));

vi.mock('@/hooks/server/useFeatureEnabled', () => ({ useFeatureEnabled: () => false }));
vi.mock('@/sync/domains/local/services/preview/useLocalServicePreviewState', () => ({ useLocalServicePreviewState: () => null }));
vi.mock('@/sync/domains/local/services/launch', () => ({ useLocalServiceLauncherState: () => null }));
vi.mock('@/sync/domains/machines/peer/mediation/observability/usePeerMediationObservabilityStore', () => ({ usePeerMediationObservabilityStore: () => null }));
vi.mock('@/components/devices/simulator/relay/useSimulatorPreviewLiveSurface', () => ({ useSimulatorPreviewLiveSurface: () => null }));
vi.mock('@/components/devices/simulator/relay/useSimulatorLiveStreamRelaySocket', () => ({ useSimulatorLiveStreamRelaySocket: () => null }));
vi.mock('@/components/browser/surfaces/useBrowserSurfaceHostProps', () => ({
    useBrowserSurfaceHostProps: () => ({
        feed: { rows: [], refreshStatus: 'idle', refreshError: null },
    }),
}));
vi.mock('@/components/sessions/browser/sessionBrowserContextRuntime', () => ({ useSessionBrowserContextRuntimeContext: () => null }));
vi.mock('@/components/sessions/browser/sessionBrowserRecordingRuntime', () => ({ useSessionBrowserRecordingRuntime: () => null }));
vi.mock('@/components/appShell/panes/focusMode/usePaneFocusMode', () => ({
    usePaneFocusMode: () => ({ active: false, canEnter: false, toggle: vi.fn() }),
}));
vi.mock('@/utils/platform/responsive', () => ({ useDeviceType: () => 'desktop' }));
vi.mock('@/components/ui/layout/useChromeSafeAreaInsets', () => ({
    useChromeSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));
vi.mock('@/components/sessions/shell/sessionScreenTestIds', () => ({
    useSessionScreenTestIdsEnabled: () => false,
    resolveOptionalSessionScreenTestId: () => undefined,
}));

vi.mock('@/components/sessions/board/SessionBoardPane', () => ({
    SessionBoardPane: () => React.createElement('SessionBoardPane'),
}));

vi.mock('@/components/sessions/conversations/SessionDiscussionDetailsView', () => ({
    SessionDiscussionDetailsView: () => React.createElement('SessionDiscussionDetailsView'),
}));

vi.mock('@/components/sessions/terminal/SessionEmbeddedTerminalPane', () => ({
    SessionEmbeddedTerminalPane: () => React.createElement('SessionEmbeddedTerminalPane'),
}));

vi.mock('@/components/sessions/files/views/SessionCommitDetailsView', () => ({
    SessionCommitDetailsView: () => React.createElement('SessionCommitDetailsView'),
}));

vi.mock('@/components/sessions/files/views/SessionFileDetailsView', () => ({
    SessionFileDetailsView: () => React.createElement('SessionFileDetailsView'),
}));

describe('SessionDetailsPanel (execution run launcher resource)', () => {
    const getSessionDetailsPanel = async () => (await import('./SessionDetailsPanel')).SessionDetailsPanel;

    it('opens a Review launcher tab as the composer-first start for that intent (no launcher form)', async () => {
        launcherViewSpy.mockClear();

        const SessionDetailsPanel = await getSessionDetailsPanel();
        const screen = await renderScreen(<SessionDetailsPanel sessionId="s1" scopeId="session:s1" />);

        expect(launcherViewSpy.mock.calls.length).toBeGreaterThan(0);
        expect(launcherViewSpy.mock.calls.at(-1)?.[0]).toMatchObject({
            sessionId: 's1',
            serverId: 'server-1',
            intent: 'review',
        });
        expect(screen.findAllByType(await loadActivitySpinner())).toHaveLength(0);
    });

    it('renders execution-run launcher tabs without an intermediate loading fallback', async () => {
        launcherViewSpy.mockClear();

        const SessionDetailsPanel = await getSessionDetailsPanel();
        const screen = await renderScreen(<SessionDetailsPanel sessionId="s1" scopeId="session:s1" />);

        expect(screen.findAllByType(await loadActivitySpinner())).toHaveLength(0);
        expect(launcherViewSpy.mock.calls.length).toBeGreaterThan(0);
    });
});
