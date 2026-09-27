import * as React from 'react';
import type { StyleProp, ViewStyle } from 'react-native';

/**
 * A back control the surrounding navigation chrome gives the page header, so "back" sits on the title
 * line, just before the title, instead of floating over the page (the settings modal on wide screens,
 * which has no native header). The control decides itself whether it applies and renders nothing
 * otherwise; `style` places it on the title line.
 */
export type NavigationBackControl = React.ComponentType<Readonly<{ style: StyleProp<ViewStyle> }>>;

const NavigationBackChromeContext = React.createContext<NavigationBackControl | null>(null);

export function NavigationBackChromeProvider(props: Readonly<{ control: NavigationBackControl | null; children: React.ReactNode }>) {
    return (
        <NavigationBackChromeContext.Provider value={props.control}>
            {props.children}
        </NavigationBackChromeContext.Provider>
    );
}

export function useNavigationBackControl(): NavigationBackControl | null {
    return React.useContext(NavigationBackChromeContext);
}
