import type { AppPaneScopeApi } from '@/components/appShell/panes/hooks/useAppPaneScope';

export function toggleRightSidebarTab(
    pane: Pick<AppPaneScopeApi, 'scopeState' | 'closeRight' | 'closeDetails'>,
    tabId: string,
    activeTabId: string | null,
    onSelectTab: (tabId: string) => void,
    rightPaneHiddenByDetails = false,
): void {
    if (rightPaneHiddenByDetails) {
        pane.closeDetails();
        onSelectTab(tabId);
    } else if (pane.scopeState?.right.isOpen && activeTabId === tabId) {
        pane.closeRight();
    } else {
        onSelectTab(tabId);
    }
}
