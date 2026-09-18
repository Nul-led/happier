import { sessionAddressKey, type SessionAddress } from '@/sync/domains/session/sessionAddress';

export type SessionCollaborationFocusTarget = 'top' | 'access' | 'responsible' | 'publicLink';

export type SessionCollaborationIntent = Readonly<{
    intentId: number;
    focusTarget: SessionCollaborationFocusTarget;
}>;

let nextIntentId = 0;
const pendingByAddress = new Map<string, SessionCollaborationIntent>();
const listenersByAddress = new Map<string, Set<() => void>>();

function addressKey(target: SessionAddress): string {
    return sessionAddressKey(target);
}

/**
 * Ephemeral handoff between an already-mounted Session control and whichever
 * incumbent responsive host owns Collaboration. This is an intent mailbox,
 * not persisted mode state or a data cache: the destination consumes it once.
 */
export function publishSessionCollaborationIntent(
    target: SessionAddress,
    focusTarget: SessionCollaborationFocusTarget,
): SessionCollaborationIntent {
    const intent = Object.freeze({ intentId: ++nextIntentId, focusTarget });
    const key = addressKey(target);
    pendingByAddress.set(key, intent);
    listenersByAddress.get(key)?.forEach((listener) => listener());
    return intent;
}

export function consumeSessionCollaborationIntent(target: SessionAddress): SessionCollaborationIntent | null {
    const key = addressKey(target);
    const intent = pendingByAddress.get(key) ?? null;
    if (intent) {
        pendingByAddress.delete(key);
        listenersByAddress.get(key)?.forEach((listener) => listener());
    }
    return intent;
}

export function readSessionCollaborationIntent(target: SessionAddress): SessionCollaborationIntent | null {
    return pendingByAddress.get(addressKey(target)) ?? null;
}

export function subscribeSessionCollaborationIntent(target: SessionAddress, listener: () => void): () => void {
    const key = addressKey(target);
    const listeners = listenersByAddress.get(key) ?? new Set<() => void>();
    listeners.add(listener);
    listenersByAddress.set(key, listeners);
    return () => {
        listeners.delete(listener);
        if (listeners.size === 0) listenersByAddress.delete(key);
    };
}

export function normalizeSessionCollaborationFocusTarget(value: unknown): SessionCollaborationFocusTarget | null {
    const raw = Array.isArray(value) ? value[0] : value;
    return raw === 'top' || raw === 'access' || raw === 'responsible' || raw === 'publicLink'
        ? raw
        : null;
}

export function resetSessionCollaborationIntentsForTests(): void {
    pendingByAddress.clear();
    listenersByAddress.clear();
    nextIntentId = 0;
}
