import { getActiveServerSnapshot, getServerProfileById } from './serverProfiles';
import { createServerUrlComparableKey } from './url/serverUrlCanonical';

/**
 * The one rule for which Home a local system task addresses when its caller names none: the app's
 * active server, by URL and — when known — its server identity. The identity lets the CLI tell
 * apart saved profiles that share one endpoint (RV-11), so every daemon, setup and repair task for
 * the active server carries it (R10 D3, RV2-30).
 */
export function readActiveServerTaskScope(): Readonly<{ relayUrl: string; serverIdentityId: string | null }> {
    const snapshot = getActiveServerSnapshot();
    return {
        relayUrl: snapshot.serverUrl,
        serverIdentityId: snapshot.serverId ? getServerProfileById(snapshot.serverId)?.serverIdentityId?.trim() || null : null,
    };
}

/** The active server's identity when `relayUrl` is the active server; `null` for any other Home. */
export function readActiveServerIdentityForRelayUrl(relayUrl: string): string | null {
    const active = readActiveServerTaskScope();
    const target = createServerUrlComparableKey(relayUrl);
    return target && target === createServerUrlComparableKey(active.relayUrl) ? active.serverIdentityId : null;
}
