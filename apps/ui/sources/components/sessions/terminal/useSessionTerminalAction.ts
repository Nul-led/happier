import * as React from 'react';

import { usePaneActionRailRightPaneHiddenByDetails } from '@/components/appShell/panes/PaneActionRailContext';

import { useAppPaneScope } from '@/components/appShell/panes/hooks/useAppPaneScope';
import { parseSessionPaneScopeId } from '@/components/sessions/panes/sessionPaneScopeId';
import { isTerminalDetailsTab } from '@/components/terminal/terminalDetailsTabModel';
import { closeEmbeddedTerminalOutsideDockLocation, openEmbeddedTerminalInDockLocation } from './embeddedTerminalDocking';
import { useSessionTerminalAvailability } from './useSessionTerminalAvailability';
import { setSessionTerminalMode } from './sessionTerminalMode';
import { readSessionTerminalWorkspace } from './sessionTerminalWorkspace';

/** Shared workspace-shell action using the session's server-qualified terminal owners. */
export function useSessionTerminalAction(params: Readonly<{
    sessionId: string;
    scopeId: string;
    serverId?: string | null;
}>): Readonly<{ available: boolean; active: boolean; onPress: () => void }> {
    const pane = useAppPaneScope(params.scopeId);
    const rightPaneHiddenByDetails = usePaneActionRailRightPaneHiddenByDetails();
    const serverId = parseSessionPaneScopeId(params.scopeId)?.address?.serverId ?? params.serverId ?? null;
    const { dockLocation, terminalEnabled } = useSessionTerminalAvailability(serverId);

    const scopeState = pane.scopeState;
    const rightTerminalActive = Boolean(scopeState?.right.isOpen) && scopeState?.right.activeTabId === 'terminal';
    const bottomTerminalActive = Boolean(scopeState?.bottom?.isOpen) && scopeState?.bottom?.activeTabId === 'terminal';
    const activeDetailsTab = scopeState?.details.activeTabKey
        ? scopeState.details.tabs.find((tab) => tab.key === scopeState.details.activeTabKey) ?? null
        : null;
    const detailsTerminalActive = Boolean(scopeState?.details.isOpen)
        && activeDetailsTab != null
        && isTerminalDetailsTab({
            resource: activeDetailsTab.resource,
            tabKey: activeDetailsTab.key,
        });

    const onPress = React.useCallback(() => {
        if (!terminalEnabled) return;
        if (readSessionTerminalWorkspace(scopeState?.bottom.tabState.terminal).tabs.length === 0) {
            setSessionTerminalMode(params.sessionId, 'workspace_shell', serverId, pane.scopeId);
        }

        if (dockLocation === 'bottom') {
            if (bottomTerminalActive) {
                pane.closeBottom();
                return;
            }
            closeEmbeddedTerminalOutsideDockLocation({ pane, dockLocation: 'bottom' });
            openEmbeddedTerminalInDockLocation({ pane, dockLocation: 'bottom' });
            return;
        }

        if (dockLocation === 'details') {
            if (detailsTerminalActive) {
                pane.closeDetailsTab(activeDetailsTab.key);
                return;
            }
            closeEmbeddedTerminalOutsideDockLocation({ pane, dockLocation: 'details' });
            openEmbeddedTerminalInDockLocation({ pane, dockLocation: 'details' });
            return;
        }

        // sidebar
        if (rightTerminalActive && !rightPaneHiddenByDetails) {
            pane.closeRight();
            return;
        }
        if (rightPaneHiddenByDetails) pane.closeDetails();
        closeEmbeddedTerminalOutsideDockLocation({ pane, dockLocation: 'sidebar' });
        openEmbeddedTerminalInDockLocation({ pane, dockLocation: 'sidebar' });
    }, [
        bottomTerminalActive,
        detailsTerminalActive,
        dockLocation,
        pane,
        rightTerminalActive,
        rightPaneHiddenByDetails,
        terminalEnabled,
        activeDetailsTab,
        params.sessionId,
        serverId,
        scopeState,
    ]);

    const active = dockLocation === 'bottom'
        ? bottomTerminalActive
        : dockLocation === 'details'
            ? detailsTerminalActive
            : rightTerminalActive && !rightPaneHiddenByDetails;

    return { available: terminalEnabled, active: terminalEnabled && active, onPress };
}
