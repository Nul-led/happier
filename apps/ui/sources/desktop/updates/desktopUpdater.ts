import { shouldShowDesktopUpdateBanner } from './state';
import { invokeDesktopHost, isDesktopHost } from '@/utils/platform/desktopHost';
import type { DesktopUpdateStatus } from '@/updates/updateStatusTypes';

type UpdateMetadata = {
    version: string;
    currentVersion: string;
    notes: string | null;
    pubDate: string | null;
} | null;

const DISMISS_KEY = 'desktop_update_dismissed_version';
const UPDATE_CHECKS_ENABLED_ENV = 'EXPO_PUBLIC_HAPPIER_DESKTOP_UPDATES_ENABLED';

function parseOptionalBoolean(raw: string | undefined): boolean | null {
    const normalized = String(raw ?? '').trim().toLowerCase();
    if (!normalized) return null;
    if (['1', 'true', 'yes', 'on', 'enabled'].includes(normalized)) return true;
    if (['0', 'false', 'no', 'off', 'disabled'].includes(normalized)) return false;
    return null;
}

function readDesktopUpdateChecksEnabledOverride(): boolean | null {
    return parseOptionalBoolean(process.env[UPDATE_CHECKS_ENABLED_ENV]);
}

function isDevelopmentBundle(): boolean {
    return (globalThis as { __DEV__?: unknown }).__DEV__ === true;
}

function shouldRunDesktopUpdateChecks(params: {
    isDesktop: boolean;
    isDevelopmentBundle: boolean;
    enabledOverride: boolean | null;
}): boolean {
    if (!params.isDesktop) return false;
    if (params.enabledOverride !== null) return params.enabledOverride;
    return !params.isDevelopmentBundle;
}

function formatDesktopUpdaterErrorMessage(error: unknown): string {
    if (error instanceof Error && error.message.trim().length > 0) {
        return error.message;
    }
    if (typeof error === 'string' && error.trim().length > 0) {
        return error.trim();
    }
    return 'Update failed';
}

function getDismissedVersion(): string | null {
    try {
        return typeof localStorage !== 'undefined' ? localStorage.getItem(DISMISS_KEY) : null;
    } catch {
        return null;
    }
}

function setDismissedVersion(version: string) {
    try {
        if (typeof localStorage !== 'undefined') {
            localStorage.setItem(DISMISS_KEY, version);
        }
    } catch {
        // ignore
    }
}

export type DesktopUpdaterSnapshot = Readonly<{
    status: DesktopUpdateStatus;
    availableVersion: string | null;
    error: string | null;
    lastCheckedAt: number | null;
    isChecking: boolean;
}>;

/** One update lifecycle for the banner and settings, including native pending-update ownership. */
export function createDesktopUpdaterStore() {
    let snapshot: DesktopUpdaterSnapshot = { status: 'idle', availableVersion: null, error: null, lastCheckedAt: null, isChecking: false };
    const listeners = new Set<() => void>();
    let started = false;
    let checksEnabled: boolean | null = null;
    let checkInFlight: Promise<void> | null = null;
    let reportCheckErrors = false;
    let installInFlight: Promise<void> | null = null;
    const enabled = () => checksEnabled ??= shouldRunDesktopUpdateChecks({
        isDesktop: isDesktopHost(),
        isDevelopmentBundle: isDevelopmentBundle(),
        enabledOverride: readDesktopUpdateChecksEnabledOverride(),
    });
    const patch = (update: Partial<DesktopUpdaterSnapshot>) => {
        snapshot = { ...snapshot, ...update };
        for (const listener of listeners) listener();
    };
    const check = (reportErrors: boolean): Promise<void> => {
        if (!enabled()) return Promise.resolve();
        if (installInFlight) return installInFlight;
        if (checkInFlight) {
            reportCheckErrors ||= reportErrors;
            return checkInFlight;
        }
        reportCheckErrors = reportErrors;
        patch({ error: null, isChecking: true, status: snapshot.status === 'idle' ? 'checking' : snapshot.status });
        checkInFlight = (async () => {
            try {
                const update = await invokeDesktopHost<UpdateMetadata>('desktop_fetch_update');
                patch({
                    availableVersion: update?.version ?? null,
                    status: update
                        ? shouldShowDesktopUpdateBanner({ availableVersion: update.version, dismissedVersion: getDismissedVersion() })
                            ? 'available' : 'dismissed'
                        : 'upToDate',
                    lastCheckedAt: Date.now(),
                });
            } catch (error) {
                console.warn('Failed to check for desktop updates:', error);
                patch(reportCheckErrors
                    ? { status: 'error', error: formatDesktopUpdaterErrorMessage(error), lastCheckedAt: Date.now() }
                    : { status: 'idle', error: null });
            } finally {
                patch({ isChecking: false });
                checkInFlight = null;
            }
        })();
        return checkInFlight;
    };
    const startInstall = (): Promise<void> => {
        if (installInFlight) return installInFlight;
        // A check owns Rust's pending update until it settles; don't install stale metadata.
        if (!enabled() || checkInFlight || !snapshot.availableVersion) return Promise.resolve();
        patch({ error: null, status: 'installing' });
        installInFlight = (async () => {
            try {
                const installed = await invokeDesktopHost<boolean>('desktop_install_update');
                if (!installed) patch({ availableVersion: null, status: 'upToDate' });
            } catch (error) {
                console.warn('Failed to install desktop update:', error);
                patch({ status: 'error', error: formatDesktopUpdaterErrorMessage(error) });
            } finally {
                installInFlight = null;
            }
        })();
        return installInFlight;
    };
    return {
        getSnapshot: () => snapshot,
        subscribe: (listener: () => void) => {
            listeners.add(listener);
            return () => { listeners.delete(listener); };
        },
        ensureChecked: () => {
            if (started) return;
            started = true;
            // Preserve the existing quiet automatic check; foreground checks report errors.
            void check(false);
        },
        isEnabled: enabled,
        refresh: () => check(true),
        startInstall,
        dismiss: () => {
            if (snapshot.availableVersion) setDismissedVersion(snapshot.availableVersion);
            patch({ status: 'dismissed' });
        },
    };
}

export const desktopUpdater = createDesktopUpdaterStore();
