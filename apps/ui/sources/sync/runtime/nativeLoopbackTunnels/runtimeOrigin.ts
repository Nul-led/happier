import type { ActiveServerSnapshot } from '@/sync/domains/server/serverRuntime';
import { getServerProfileById } from '@/sync/domains/server/serverProfiles';
import { ServerScopedTransportUnavailableError } from '@/sync/runtime/homeCarrier';

/** Descriptor-backed Homes require a policy publication, including HTTPS. */
export function isServerRuntimeTransportPublished(snapshot: Pick<ActiveServerSnapshot, 'serverId' | 'carrier'>): boolean {
    return snapshot.carrier !== undefined
        || !getServerProfileById(snapshot.serverId)?.homeConnectionDescriptor;
}

/** Resolves the ephemeral data-plane origin without changing the stable Home identity. */
export function resolveServerRuntimeOrigin(snapshot: Readonly<{
    serverUrl: string;
    runtimeOrigin?: string;
    carrier?: 'https' | 'iroh';
}>): string {
    if ((snapshot.carrier === 'iroh' || snapshot.carrier === 'https') && typeof snapshot.runtimeOrigin === 'string' && snapshot.runtimeOrigin.trim()) {
        const candidate = snapshot.runtimeOrigin.trim().replace(/\/+$/, '');
        try {
            const parsed = new URL(candidate);
            if ((parsed.protocol === 'http:' || parsed.protocol === 'https:') && !parsed.username && !parsed.password && !parsed.search && !parsed.hash) {
                return candidate;
            }
        } catch {
            // An invalid native origin must never replace the stable Home URL.
        }
    }
    return String(snapshot.serverUrl ?? '').trim().replace(/\/+$/, '');
}

export function resolveActiveServerRuntimeOrigin(snapshot: ActiveServerSnapshot): string {
    if (!isServerRuntimeTransportPublished(snapshot)) throw new ServerScopedTransportUnavailableError();
    return resolveServerRuntimeOrigin(snapshot);
}
