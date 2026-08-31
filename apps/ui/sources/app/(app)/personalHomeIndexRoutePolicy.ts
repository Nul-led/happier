export function shouldKeepDesktopPersonalHomeShell(input: Readonly<{
    isAuthenticated: boolean;
    isDesktopHost: boolean;
}>): boolean {
    return !input.isAuthenticated
        && input.isDesktopHost;
}
