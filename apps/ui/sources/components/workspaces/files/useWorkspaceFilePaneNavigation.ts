import * as React from 'react';
import { useAppPaneScope } from '@/components/appShell/panes/hooks/useAppPaneScope';

/** File navigation changes the adjacent destination, retaining the file's tab and draft. */
export function useWorkspaceFilePaneNavigation(scopeId: string, onNavigate?: (tabId: 'files' | 'git') => void) {
    const pane = useAppPaneScope(scopeId);
    const navigate = React.useCallback((tabId: 'files' | 'git', patch: Record<string, unknown>) => {
        const current = pane.scopeState?.right.tabState[tabId];
        pane.setRightTabState(tabId, { ...(current && typeof current === 'object' ? current : {}), ...patch });
        pane.openRight({ tabId });
        pane.setRightTab(tabId);
        onNavigate?.(tabId);
    }, [onNavigate, pane]);
    const openChanges = React.useCallback(() => navigate('git', { activeSubTabId: 'commit' }), [navigate]);
    const openFiles = React.useCallback((path?: string) => navigate('files', path ? { revealRequest: { path } } : {}), [navigate]);
    return { revealInFilesTree: openFiles, openChanges, openFiles };
}
