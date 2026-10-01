import { setActiveServerAndSwitch, upsertActivateAndSwitchServer } from '@/sync/domains/server/activeServerSwitch';
import { resolveSavedServerProfileByUrl } from '@/sync/domains/server/serverProfiles';

/**
 * A tray row's Open (D11-3): the person picked that Home, so the app switches to it through the
 * active-server switch owner. Its saved profile comes from the canonical ambiguity-aware URL
 * resolver (A13-05); a Home the app has not saved yet is registered by the same switch owner, the
 * way any typed address is (A12-02 parity). Two saved Homes on one address cannot be told apart
 * from a relay URL, so nothing is picked and the caller shows where to choose. That Home already
 * has its own background service here, so nothing about this computer's services changes.
 */
export async function openHomeFromTrayRow(relayUrl: string, refreshAuth: () => Promise<void>): Promise<'opened' | 'ambiguous'> {
    const resolution = resolveSavedServerProfileByUrl(relayUrl);
    if (resolution.kind === 'ambiguous') return 'ambiguous';
    if (resolution.kind === 'resolved') {
        await setActiveServerAndSwitch({ serverId: resolution.profile.id, scope: 'device', refreshAuth });
    } else {
        await upsertActivateAndSwitchServer({ serverUrl: relayUrl, scope: 'device', refreshAuth });
    }
    return 'opened';
}
