import * as React from 'react';
import { useAppPaneContext } from '@/components/appShell/panes/AppPaneProvider';
import type { SessionTerminalActionId } from '@happier-dev/protocol';
import { parseSessionPaneScopeId } from '@/components/sessions/panes/sessionPaneScopeId';
import { createFrontDoorActionExecute } from '@/sync/ops/actions/frontDoorRuntimeActionExecutor';
import { getActiveSessionTerminal, readSessionTerminalWorkspace, type SessionTerminalWorkspaceCommand } from './sessionTerminalWorkspace';

export function useSessionTerminalWorkspace(scopeId: string) {
    const { state, dispatch } = useAppPaneContext();
    const raw = state.scopes[scopeId]?.bottom.tabState.terminal;
    const workspace = React.useMemo(() => readSessionTerminalWorkspace(raw), [raw]);
    const actionExecute = React.useMemo(() => createFrontDoorActionExecute(), []);
    const execute = React.useCallback((actionId: SessionTerminalActionId, input: Readonly<Record<string, unknown>> = {}) => {
        const session = parseSessionPaneScopeId(scopeId);
        return actionExecute(actionId, { ...input, scopeId }, {
            surface: 'ui', defaultSessionId: session?.sessionId, serverId: session?.address?.serverId,
        });
    }, [actionExecute, scopeId]);
    // Only the real SplitCanvasHost writes measured geometry. Process-affecting UI verbs use Actions above.
    const dispatchResize = React.useCallback((command: Extract<SessionTerminalWorkspaceCommand, { type: 'resize' }>) => dispatch({ type: 'terminalWorkspace', scopeId, command }), [dispatch, scopeId]);
    return React.useMemo(() => ({ workspace, activeTerminal: getActiveSessionTerminal(workspace), execute, dispatchResize }), [workspace, execute, dispatchResize]);
}
