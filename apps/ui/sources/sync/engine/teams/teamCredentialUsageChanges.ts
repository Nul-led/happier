/**
 * Mounted readers of one Team credential resource's usage, woken by the Home's
 * content-free `team-credential-usage-changed` ephemeral after an immutable
 * usage write.
 *
 * This is an observation seam over the existing socket ephemeral, not a second
 * synchronization system: it opens no socket, keeps no cursor, stores nothing
 * and promises no delivery beyond the ephemeral itself. The usage query stays the
 * only source of numbers; a reader that was not mounted reads current usage when
 * it opens.
 */
type Listener = () => void;

const listenersByResource = new Map<string, Set<Listener>>();

function resourceKey(serverId: string, resourceId: string): string {
    return JSON.stringify([serverId, resourceId]);
}

export function notifyTeamCredentialUsageChanged(params: Readonly<{ serverId: string; resourceId: string }>): void {
    const listeners = listenersByResource.get(resourceKey(params.serverId, params.resourceId));
    if (!listeners) return;
    for (const listener of Array.from(listeners)) {
        try {
            listener();
        } catch {
            // One mounted reader cannot suppress the wake for its siblings.
        }
    }
}

export function subscribeTeamCredentialUsageChanged(
    params: Readonly<{ serverId: string; resourceId: string }>,
    listener: Listener,
): () => void {
    const key = resourceKey(params.serverId, params.resourceId);
    const listeners = listenersByResource.get(key) ?? new Set<Listener>();
    listeners.add(listener);
    listenersByResource.set(key, listeners);
    return () => {
        listeners.delete(listener);
        if (listeners.size === 0 && listenersByResource.get(key) === listeners) listenersByResource.delete(key);
    };
}
