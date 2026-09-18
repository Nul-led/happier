/** Client routing identity. A Home-local HTTP operation still sends only sessionId. */
export type SessionAddress = Readonly<{
    serverId: string;
    sessionId: string;
}>;

export function normalizeSessionAddress(serverId: unknown, sessionId: unknown): SessionAddress | null {
    if (typeof serverId !== 'string' || typeof sessionId !== 'string') return null;
    const normalizedServerId = serverId.trim();
    const normalizedSessionId = sessionId.trim();
    return normalizedServerId && normalizedSessionId
        ? { serverId: normalizedServerId, sessionId: normalizedSessionId }
        : null;
}

/** Opaque in-memory key: never parse it, or use it as a route/persistence format. */
export function sessionAddressKey(address: SessionAddress): string {
    return JSON.stringify([address.serverId, address.sessionId]);
}

export function areSessionAddressesEqual(left: SessionAddress | null | undefined, right: SessionAddress | null | undefined): boolean {
    return Boolean(left && right && left.serverId === right.serverId && left.sessionId === right.sessionId);
}

/**
 * A Session named by an Activity instance. `serverId: null` is a Session with no Home binding at
 * all — deliberately a distinct value from any real profile id, including the literal id `local`.
 */
export type ActivityInstanceAddress = Readonly<{
    serverId: string | null;
    sessionId: string;
}>;

/**
 * The one opaque Activity instance identity. Activity overview candidates, Live Activity
 * snapshots, remote-target registration, background-wake state and update/end calls all address
 * the same tuple through this encoder, so delimiter-bearing Home, Session or Activity names cannot
 * collide and an unbound Session cannot alias a Home literally named `local`.
 *
 * Like {@link sessionAddressKey} it is an in-memory key: never parse it, route on it, or persist
 * it as a wire format.
 */
export function activityInstanceKey(address: ActivityInstanceAddress, activityName: string): string {
    return JSON.stringify([address.serverId, address.sessionId, activityName]);
}
