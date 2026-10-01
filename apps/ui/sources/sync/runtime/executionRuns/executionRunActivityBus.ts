import {
    normalizeSessionAddress,
    sessionAddressKey,
    type SessionAddress,
} from '@/sync/domains/session/sessionAddress';

/**
 * What the producer knows about the notification.
 *
 * `runId` is present when the producer observed one exact Run — the wire
 * `execution-run-updated` ephemeral carries the Run, and every Run mutation
 * names its target. A Session-level consumer ignores it; a surface mounted on
 * one exact Run uses it so a sibling Run's activity does not refetch it. `null`
 * means "unknown", and every listener then refreshes.
 */
export type ExecutionRunActivityNotification = Readonly<{
    runId: string | null;
}>;

type Listener = (notification: ExecutionRunActivityNotification) => void;

const UNKNOWN_RUN_NOTIFICATION: ExecutionRunActivityNotification = Object.freeze({ runId: null });

const listenersBySessionAddress = new Map<string, Set<Listener>>();

export function notifyExecutionRunActivity(
    address: SessionAddress,
    notification: ExecutionRunActivityNotification = UNKNOWN_RUN_NOTIFICATION,
): void {
    const normalizedAddress = normalizeSessionAddress(address.serverId, address.sessionId);
    if (!normalizedAddress) return;

    const listeners = listenersBySessionAddress.get(sessionAddressKey(normalizedAddress));
    if (!listeners || listeners.size === 0) return;

    // Defensive copy: listeners may add/remove subscriptions while handling the notification.
    for (const listener of Array.from(listeners)) {
        try {
            listener(notification);
        } catch {
            // ignore listener errors
        }
    }
}

export function subscribeExecutionRunActivity(address: SessionAddress, listener: Listener): () => void {
    const normalizedAddress = normalizeSessionAddress(address.serverId, address.sessionId);
    if (!normalizedAddress) return () => {};

    const key = sessionAddressKey(normalizedAddress);
    const listeners = listenersBySessionAddress.get(key) ?? new Set<Listener>();
    listeners.add(listener);
    listenersBySessionAddress.set(key, listeners);

    return () => {
        const current = listenersBySessionAddress.get(key);
        if (!current) return;
        current.delete(listener);
        if (current.size === 0) {
            listenersBySessionAddress.delete(key);
        }
    };
}
