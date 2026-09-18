import { setActiveServerAndSwitch, type ActiveServerSwitchResult } from './activeServerSwitch';

/**
 * Focuses the exact saved Home a capability link just authenticated against.
 *
 * A mail or invitation link lands on one Home while another may be focused, and
 * the credential it commits is persisted per Home rather than published into the
 * focused runtime. Sending the person onward without this step shows them the
 * Home they were already looking at, as if nothing had happened.
 *
 * `requireExactProfile` is what makes a second Account credential on the same
 * stable identity a real transition instead of a no-op, and an already-focused
 * Home still refreshes because the identity did not move but the credential did.
 *
 * Returns `false` when focus could not be established, so the owning screen can
 * keep the person where they are with a way to try again. It never reports
 * success while leaving them on the previous Home.
 */
export async function focusExactHomeAndRefresh(params: Readonly<{
    serverId: string;
    scope?: 'device' | 'tab';
    refreshAuth: () => Promise<void>;
}>): Promise<boolean> {
    let switched: ActiveServerSwitchResult;
    try {
        switched = await setActiveServerAndSwitch({
            serverId: params.serverId,
            scope: params.scope ?? 'device',
            refreshAuth: params.refreshAuth,
            requireExactProfile: true,
        });
    } catch {
        // The switch owner has already restored the previous connection. Report
        // the failure rather than navigating into a Home this device is not on.
        return false;
    }
    if (switched === 'blocked') return false;
    if (switched === 'already_active') {
        try {
            await params.refreshAuth();
        } catch {
            // The exact Home is focused, but the newly committed credential is
            // not usable until refresh succeeds. Preserve the boolean failure
            // contract so the arrival owner can offer its focus-only retry.
            return false;
        }
    }
    return true;
}
