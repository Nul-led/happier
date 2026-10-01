import * as React from 'react';

/**
 * Whether the desktop app shell (rail + column) stands around the routes, and whether its column is
 * showing. Provided by `SidebarNavigator`, the one owner of that decision. A settings or console page
 * reads it to know whether its navigation is already on screen in the column.
 */
export type AppShellColumnState = Readonly<{
    /** The rail and title strip are present (tablet and desktop, signed in). */
    present: boolean;
    /** The column beside the page is showing (not collapsed, and the destination has one). */
    columnVisible: boolean;
}>;

const ABSENT: AppShellColumnState = Object.freeze({ present: false, columnVisible: false });

export const AppShellColumnContext = React.createContext<AppShellColumnState>(ABSENT);

export function useAppShellColumn(): AppShellColumnState {
    return React.useContext(AppShellColumnContext);
}
