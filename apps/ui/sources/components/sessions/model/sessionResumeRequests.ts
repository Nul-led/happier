import * as React from 'react';

export type SessionResumeRequestListener = () => Promise<boolean>;

/**
 * Resume listeners keyed by Session id, then by the exact Home that registered them.
 *
 * Two Homes can host the same Session id, so a qualified request must reach that Home's Session
 * and no other. The unqualified legacy entry point stays admissible only while exactly one Home
 * has a listener for the id: with several, resuming the focused or first one would resume the
 * wrong Session.
 */
const listenersBySessionId = new Map<string, Map<string, Set<SessionResumeRequestListener>>>();

function normalizeServerScope(serverId: string | null | undefined): string {
    return typeof serverId === 'string' ? serverId.trim() : '';
}

function readResumeListeners(
    sessionId: string,
    serverScope: string,
): Set<SessionResumeRequestListener> | undefined {
    const listenersByServerScope = listenersBySessionId.get(sessionId);
    if (!listenersByServerScope) return undefined;
    if (serverScope) return listenersByServerScope.get(serverScope);
    return listenersByServerScope.size === 1
        ? listenersByServerScope.values().next().value
        : undefined;
}

export async function emitSessionResumeRequest(
    sessionId: string,
    serverId?: string | null,
): Promise<boolean> {
    const serverScope = normalizeServerScope(serverId);
    const listeners = readResumeListeners(sessionId, serverScope);
    if (!listeners || listeners.size === 0) {
        throw new Error(
            `No resume listener is registered for session ${sessionId}${serverScope ? ` on Home ${serverScope}` : ''}`,
        );
    }

    const results = await Promise.all(Array.from(listeners, (listener) => listener()));
    return results.every(Boolean);
}

export function useSessionResumeRequestListener(
    sessionId: string,
    listener: SessionResumeRequestListener,
    serverId?: string | null,
): void {
    const serverScope = normalizeServerScope(serverId);
    React.useEffect(() => {
        const listenersByServerScope = listenersBySessionId.get(sessionId)
            ?? new Map<string, Set<SessionResumeRequestListener>>();
        const listeners = listenersByServerScope.get(serverScope)
            ?? new Set<SessionResumeRequestListener>();
        listeners.add(listener);
        listenersByServerScope.set(serverScope, listeners);
        listenersBySessionId.set(sessionId, listenersByServerScope);
        return () => {
            listeners.delete(listener);
            if (listeners.size === 0) {
                listenersByServerScope.delete(serverScope);
            }
            if (listenersByServerScope.size === 0) {
                listenersBySessionId.delete(sessionId);
            }
        };
    }, [listener, sessionId, serverScope]);
}
