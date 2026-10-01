import type { DesktopServiceAutostartMode } from '@/components/settings/machines/localControl/useLocalDaemonControl';

/**
 * What the desktop app does with this computer's background services as it quits (R16 a).
 *
 * `keepInMenuBar` — the services start at login, so quitting releases the window and the web UI
 * and keeps the tray, with the services running. `stop` — stop every service the app manages, then
 * quit. `ask` — agent sessions are running here; `askUnknown` — the app cannot see this computer's
 * sessions (another account, another Home, signed out), so it asks without claiming any run.
 * `leaveRunning` — quit outright and touch nothing (the login-start mode is unknown).
 *
 * Paths that cannot ask — force quit, OS shutdown, logout — never reach this function and leave
 * the services running.
 */
export type DesktopQuitDecision = 'stop' | 'ask' | 'askUnknown' | 'leaveRunning' | 'keepInMenuBar';

/** "Quit Happier" follows the login-start setting; "Stop background services and quit" stops them regardless. */
export type DesktopQuitIntent = 'quit' | 'stopServices';

export function resolveDesktopQuitDecision(input: Readonly<{
    intent: DesktopQuitIntent;
    /** The login-start mode as the CLI reports it; `null` is unknown, never `on-demand`. */
    serviceAutostart: DesktopServiceAutostartMode | null;
    /** Agent sessions running on THIS computer — the only ones stopping its services would end. */
    activeLocalSessionCount: number;
    /**
     * Whether the count above covers every service the stop would end (A13-01): the app's Home's
     * daemon is visible to it, and no other managed service is running. Otherwise zero may mean unseen.
     */
    canSeeDaemonSessions: boolean;
}>): DesktopQuitDecision {
    const stopRequested = input.intent === 'stopServices' || input.serviceAutostart === 'on-demand';
    if (!stopRequested) {
        // Meant to outlive the app, or nothing proved otherwise: quitting is no reason to take this
        // computer off the air on a guess. When it outlives the app, the tray does too.
        return input.serviceAutostart === 'at-login' ? 'keepInMenuBar' : 'leaveRunning';
    }
    if (!input.canSeeDaemonSessions) return 'askUnknown';
    return input.activeLocalSessionCount > 0 ? 'ask' : 'stop';
}
