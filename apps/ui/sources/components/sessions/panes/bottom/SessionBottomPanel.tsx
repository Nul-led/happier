import * as React from 'react';
import { View } from 'react-native';

import { useAppPaneScope } from '@/components/appShell/panes/hooks/useAppPaneScope';
import { SessionEmbeddedTerminalPane } from '@/components/sessions/terminal/SessionEmbeddedTerminalPane';
import { getActiveSessionTerminal, readSessionTerminalWorkspace } from '@/components/sessions/terminal/sessionTerminalWorkspace';
import { registerSessionTerminalSplitMeasurements } from '@/components/sessions/terminal/sessionTerminalWorkspaceRuntime';
import { PANE_SIZING_DEFAULTS } from '@/components/appShell/panes/layout/paneSizing';
import { SPLIT_CANVAS_DIVIDER_SIZE_PX } from '@/components/appShell/splitCanvas/components/SplitCanvasDivider';
import { resolveOptionalSessionScreenTestId, useSessionScreenTestIdsEnabled } from '../../shell/sessionScreenTestIds';

export const SessionBottomPanel = React.memo((props: Readonly<{ sessionId: string; scopeId: string; onRequestClose?: () => void }>) => {
    const pane = useAppPaneScope(props.scopeId);
    const activeTabId = pane.scopeState?.bottom?.activeTabId ?? null;
    const rawWorkspace = pane.scopeState?.bottom.tabState.terminal;
    const workspace = React.useMemo(() => readSessionTerminalWorkspace(rawWorkspace), [rawWorkspace]);
    const terminal = getActiveSessionTerminal(workspace);
    const widthRef = React.useRef<number | null>(null);
    React.useEffect(() => registerSessionTerminalSplitMeasurements(props.scopeId, (tabId) => widthRef.current === null || (tabId && tabId !== workspace.activeTabId) || activeTabId !== 'terminal' ? null : {
        availableWidthPx: widthRef.current - SPLIT_CANVAS_DIVIDER_SIZE_PX.row,
        minimumTerminalWidthPx: PANE_SIZING_DEFAULTS.mainMinPx,
    }), [props.scopeId, workspace.activeTabId, activeTabId]);
    const requestClose = props.onRequestClose ?? pane.closeBottom;
    const sessionScreenTestIdsEnabled = useSessionScreenTestIdsEnabled();

    return (
        <View
            testID={resolveOptionalSessionScreenTestId(sessionScreenTestIdsEnabled, 'session-bottom-panel-root')}
            style={{ flex: 1, minHeight: 0, minWidth: 0 }}
        >
            {activeTabId === 'terminal' && terminal ? (
                <View
                    testID={resolveOptionalSessionScreenTestId(sessionScreenTestIdsEnabled, 'session-bottompanel-surface-terminal')}
                    style={{ flex: 1, minHeight: 0, minWidth: 0 }}
                    onLayout={(event) => { widthRef.current = event.nativeEvent.layout.width; }}
                >
                    <SessionEmbeddedTerminalPane
                        sessionId={props.sessionId}
                        scopeId={props.scopeId}
                        currentDockLocation="bottom"
                        terminal={terminal}
                        onRequestClose={requestClose}
                        testIdPrefix={sessionScreenTestIdsEnabled ? 'session-bottompanel-terminal' : null}
                    />
                </View>
            ) : null}
        </View>
    );
});
