import * as React from 'react';
import * as ReactNavigation from '@react-navigation/native';

const navigationModule = ReactNavigation as Partial<Readonly<{
    NavigationContext: React.Context<unknown>;
    useIsFocused: () => boolean;
}>>;

/**
 * Whether the screen this renders in is focused. Outside a screen (a host that is not a route, a test
 * or preview without a navigator) there is no screen to leave, so it counts as focused. Whether an
 * instance is inside a screen never changes while it is mounted, so the hook order stays stable.
 */
export function useOptionalScreenIsFocused(): boolean {
    const screenNavigation = navigationModule.NavigationContext
        // eslint-disable-next-line react-hooks/rules-of-hooks -- the branch is a module constant.
        ? React.useContext(navigationModule.NavigationContext)
        : undefined;
    const useIsFocused = navigationModule.useIsFocused;
    // eslint-disable-next-line react-hooks/rules-of-hooks -- stable for a mounted instance (see above).
    return screenNavigation !== undefined && screenNavigation !== null && useIsFocused ? useIsFocused() : true;
}
