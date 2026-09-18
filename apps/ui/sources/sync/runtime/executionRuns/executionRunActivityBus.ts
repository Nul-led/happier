import {
    normalizeSessionAddress,
    sessionAddressKey,
    type SessionAddress,
} from '@/sync/domains/session/sessionAddress';

type Listener = () => void;

const listenersBySessionAddress = new Map<string, Set<Listener>>();

export function notifyExecutionRunActivity(address: SessionAddress): void {
    const normalizedAddress = normalizeSessionAddress(address.serverId, address.sessionId);
    if (!normalizedAddress) return;

    const listeners = listenersBySessionAddress.get(sessionAddressKey(normalizedAddress));
    if (!listeners || listeners.size === 0) return;

    // Defensive copy: listeners may add/remove subscriptions while handling the notification.
    for (const listener of Array.from(listeners)) {
        try {
            listener();
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
