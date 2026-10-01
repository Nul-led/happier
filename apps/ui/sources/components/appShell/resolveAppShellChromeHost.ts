export type AppShellChromeHost =
    | 'none'
    | 'unauth-shell'
    | 'narrow-desktop-fallback';

export type ResolveAppShellChromeHostParams = Readonly<{
    isAuthenticated: boolean;
    isDesktopHost: boolean;
    isTablet: boolean;
    isTerminalConnectRoute: boolean;
}>;

export function resolveAppShellChromeHost(
    params: ResolveAppShellChromeHostParams,
): AppShellChromeHost {
    if (params.isTerminalConnectRoute) {
        return 'none';
    }

    if (!params.isDesktopHost) {
        return 'none';
    }

    if (!params.isAuthenticated) {
        return 'unauth-shell';
    }

    if (!params.isTablet) {
        return 'narrow-desktop-fallback';
    }

    return 'none';
}
