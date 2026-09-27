import * as React from 'react';

/**
 * Whether the settings rail is showing beside the page. `SettingsShell` owns the decision (viewport,
 * the rail preference, the crash fallback); pages only read it. Where the rail shows, it is the
 * settings index, so a page need not repeat it.
 */
export const SettingsRailVisibilityContext = React.createContext<boolean>(false);

export function useSettingsRailVisible(): boolean {
    return React.useContext(SettingsRailVisibilityContext);
}
