import * as React from 'react';

/**
 * Whether the surrounding navigation chrome already shows the page title (a native stack header on
 * phones). When it does, a page header shows only its purpose line so the title is never duplicated.
 */
const NavigationTitleChromeContext = React.createContext<boolean>(false);

export function NavigationTitleChromeProvider(props: Readonly<{ showsTitle: boolean; children: React.ReactNode }>) {
    return (
        <NavigationTitleChromeContext.Provider value={props.showsTitle}>
            {props.children}
        </NavigationTitleChromeContext.Provider>
    );
}

/** Whether the surrounding navigation chrome already shows the page title (see `NavigationTitleChromeProvider`). */
export function useNavigationTitleChromeShowsTitle(): boolean {
    return React.useContext(NavigationTitleChromeContext);
}
