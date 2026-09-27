import * as React from 'react';

import { useAuth } from '@/auth/context/AuthContext';
import { TokenStorage, isLegacyAuthCredentials } from '@/auth/storage/tokenStorage';
import { getCachedReadyServerFeatures, getReadyServerFeatures } from '@/sync/api/capabilities/getReadyServerFeatures';
import { fireAndForget } from '@/utils/system/fireAndForget';

type ReminderState = Readonly<{
    /** `null` until the device's stored answer is read. */
    dismissed: boolean | null;
    /** `null` until the server says whether it wants the reminder. */
    enabled: boolean | null;
}>;

function readEnabled(features: ReturnType<typeof getCachedReadyServerFeatures>): boolean | null {
    if (!features) return null;
    return features.features?.auth?.ui?.recoveryKeyReminder?.enabled === true;
}

// One state for every surface (the banner, the hubs' setup step), so handling it anywhere is done
// everywhere at once.
let state: ReminderState | null = null;
let loadStarted = false;
const listeners = new Set<() => void>();

function readState(): ReminderState {
    if (!state) {
        state = {
            dismissed: TokenStorage.getCachedRecoveryKeyReminderDismissed(),
            enabled: readEnabled(getCachedReadyServerFeatures()),
        };
    }
    return state;
}

function publish(next: Partial<ReminderState>) {
    state = { ...readState(), ...next };
    for (const listener of [...listeners]) listener();
}

function subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

function ensureLoaded() {
    if (loadStarted) return;
    loadStarted = true;
    fireAndForget((async () => {
        const [dismissed, features] = await Promise.all([
            TokenStorage.getRecoveryKeyReminderDismissed().catch(() => true),
            getReadyServerFeatures().catch(() => null),
        ]);
        publish({ dismissed, enabled: readEnabled(features) });
    })(), { tag: 'useRecoveryKeyReminder.load' });
}

async function markHandled(): Promise<void> {
    await TokenStorage.setRecoveryKeyReminderDismissed(true);
    publish({ dismissed: true });
}

export type RecoveryKeyReminder = Readonly<{
    /** The key still needs saving: a legacy sign-in whose key was neither saved nor dismissed here. */
    needed: boolean;
    /** The secret to back up while `needed`. */
    secret: string | null;
    /** Saved: the key was backed up. */
    markSaved: () => Promise<void>;
    /** Dismissed: the person chose to handle it themselves ("I've handled it"). */
    dismiss: () => Promise<void>;
}>;

/**
 * Whether this device's sign-in key still needs saving, for the banner and the hubs' setup step.
 * Saved or dismissed both count as done; the device remembers it. It reads the device flag and the
 * server's feature answer once per launch (no machine calls).
 */
export function useRecoveryKeyReminder(): RecoveryKeyReminder {
    const auth = useAuth();
    const current = React.useSyncExternalStore(subscribe, readState, readState);
    React.useEffect(() => {
        ensureLoaded();
    }, []);
    const credentials = auth.credentials;
    const legacy = auth.isAuthenticated && credentials != null && isLegacyAuthCredentials(credentials);
    const needed = legacy && current.dismissed === false && current.enabled === true;
    return React.useMemo(() => ({
        needed,
        secret: needed && credentials && isLegacyAuthCredentials(credentials) ? credentials.secret : null,
        markSaved: markHandled,
        dismiss: markHandled,
    }), [credentials, needed]);
}
