import { createHappierCollectionVisitMemory, resolveHappierCollectionInitialKey } from '@happier-dev/plugin-ui/presentation';

export const REMOTE_HOSTS_ROOT = '/settings/remote-hosts';
export const REMOTE_HOSTS_NEW_ROUTE = `${REMOTE_HOSTS_ROOT}/new`;
export const REMOTE_HOSTS_ACCESS_ROUTE = `${REMOTE_HOSTS_ROOT}/access`;

export function remoteHostHref(hostId: string): string {
    return `${REMOTE_HOSTS_ROOT}/${encodeURIComponent(hostId)}`;
}

/** The collection row a route selects: `new` (the draft), `access`, a host id, or nothing. */
export function resolveSelectedRemoteHostsEntry(pathname: string): Readonly<{ kind: 'new' | 'access' } | { kind: 'host'; hostId: string }> | null {
    const normalized = pathname.replace(/\/+$/, '');
    if (!normalized.startsWith(`${REMOTE_HOSTS_ROOT}/`)) return null;
    const segment = normalized.slice(REMOTE_HOSTS_ROOT.length + 1);
    if (!segment || segment.includes('/')) return null;
    if (segment === 'new') return { kind: 'new' };
    if (segment === 'access') return { kind: 'access' };
    try {
        return { kind: 'host', hostId: decodeURIComponent(segment) };
    } catch {
        return { kind: 'host', hostId: segment };
    }
}

/**
 * Where a wide collection lands when its route names nothing: the host last opened, the most
 * recently used host, else the new-host draft (an empty collection starts by adding one).
 */
export function resolveRemoteHostsLandingHref(
    hostIds: readonly string[],
    lastVisitedHostId: string | null,
    options?: Readonly<{ addHostRequested?: boolean }>,
): string {
    // Search for "Add host": beside the rail, adding a host is the new-host draft page.
    if (options?.addHostRequested) return REMOTE_HOSTS_NEW_ROUTE;
    const landing = resolveHappierCollectionInitialKey({ keys: hostIds, lastVisited: lastVisitedHostId });
    return landing ? remoteHostHref(landing) : REMOTE_HOSTS_NEW_ROUTE;
}

/** The host last opened in the collection during this app session; a wide collection lands on it. */
const remoteHostVisits = createHappierCollectionVisitMemory<string>();

export const recordRemoteHostVisit = remoteHostVisits.record;
export const readLastVisitedRemoteHostId = remoteHostVisits.read;

/** The host a route opens, for the visit memory (the draft and the access page open none). */
export function resolveVisitedRemoteHostId(pathname: string): string | null {
    const selected = resolveSelectedRemoteHostsEntry(pathname);
    return selected?.kind === 'host' ? selected.hostId : null;
}
