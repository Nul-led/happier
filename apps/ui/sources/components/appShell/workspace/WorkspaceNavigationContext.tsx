import * as React from 'react';
import type { WorkspaceOpenOptions } from './workspaceNavigationAdapter';
import type { WorkspaceAction, WorkspaceState } from './workspaceState';
import type { DestinationNavigation } from './DestinationInstanceHost';
import type { SplitCanvasHostControls } from '../splitCanvas/components/SplitCanvasHost';
import type { SharedWorkspaceTabs } from './workspaceSyncedTabs';
import type { WorkspaceTabSyncStatus } from './useWorkspaceTabSync';
import type { WorkspaceTabsHandoffSource } from './workspaceTabsHandoff';
import type { CompactAppDestination } from '../destinations/compactAppDestinationCatalog';

/**
 * The phone's controls over the same owner. The phone keeps its own stack navigation: these move the
 * stack and record intent in the workspace, but the workspace never projects a URL on a phone.
 */
export type WorkspacePhoneControls = Readonly<{
    /** The destination catalog the tabs resolve against (titles, icons, hrefs). */
    catalog: readonly CompactAppDestination[];
    /** The screen shows one of the tabs (not one of the phone's own main tabs). */
    onTab: boolean;
    /** `preview` replaces the phone's preview; `newTab` keeps it as a synced tab. Both open it on screen. */
    openHref: (href: string, mode: 'preview' | 'newTab') => boolean;
    activateTab: (tabId: string) => void;
    closeTab: (tabId: string) => void;
}>;

export type WorkspaceNavigationContextValue = Readonly<{
    active: boolean;
    /** Present only on a phone, where the workspace owns the tab set but not navigation. */
    phone?: WorkspacePhoneControls | null;
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
