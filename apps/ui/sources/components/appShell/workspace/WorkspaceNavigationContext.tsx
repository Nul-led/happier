import * as React from 'react';
import type { WorkspaceOpenOptions } from './workspaceNavigationAdapter';
import type { WorkspaceAction, WorkspaceState } from './workspaceState';
import type { DestinationNavigation } from './DestinationInstanceHost';
import type { SplitCanvasHostControls } from '../splitCanvas/components/SplitCanvasHost';
import type { SharedWorkspaceTabs } from './workspaceSyncedTabs';
import type { WorkspaceTabSyncStatus } from './useWorkspaceTabSync';
import type { WorkspaceTabsHandoffSource } from './workspaceTabsHandoff';

export type WorkspaceNavigationContextValue = Readonly<{
    active: boolean;
    state: WorkspaceState;
    sharedTabs?: SharedWorkspaceTabs | null;
    tabSyncStatus?: WorkspaceTabSyncStatus;
    handoffSource?: WorkspaceTabsHandoffSource | null;
    canvasControlsRef?: React.MutableRefObject<SplitCanvasHostControls | null>;
    canGoBack: boolean;
    canGoForward: boolean;
    openHref: (href: string, options?: WorkspaceOpenOptions) => boolean;
    activateTab: (groupId: string, tabId: string) => void;
    closeTab: (groupId: string, tabId: string) => void;
    dispatch: (action: WorkspaceAction) => void;
    navigationForTab: (tabId: string) => DestinationNavigation;
    registerBackStep: (tabId: string, consume: () => boolean) => () => void;
    back: () => void;
    forward: () => void;
}>;

export const WorkspaceNavigationContext = React.createContext<WorkspaceNavigationContextValue | null>(null);

export function useOptionalWorkspaceNavigation(): WorkspaceNavigationContextValue | null {
    return React.useContext(WorkspaceNavigationContext);
}
