import * as React from 'react';
import { createSessionPaneScopeId, parseSessionPaneScopeId } from '@/components/sessions/panes/sessionPaneScopeId';

export type SessionTerminalMode = 'workspace_shell' | 'session_attach';

const modeByScopeId = new Map<string, SessionTerminalMode>();
const listenersByScopeId = new Map<string, Set<() => void>>();

export function readSessionTerminalMode(sessionId: string, serverId?: string | null): SessionTerminalMode {
    return modeByScopeId.get(createSessionPaneScopeId(sessionId, serverId)) ?? 'workspace_shell';
}

export function setSessionTerminalMode(sessionId: string, mode: SessionTerminalMode, serverId?: string | null): void {
    if (readSessionTerminalMode(sessionId, serverId) === mode) return;
    const scopeId = createSessionPaneScopeId(sessionId, serverId);
    modeByScopeId.set(scopeId, mode);
    for (const listener of listenersByScopeId.get(scopeId) ?? []) listener();
}

function subscribeSessionTerminalMode(scopeId: string, listener: () => void): () => void {
    const listeners = listenersByScopeId.get(scopeId) ?? new Set<() => void>();
    listeners.add(listener);
    listenersByScopeId.set(scopeId, listeners);
    return () => {
        listeners.delete(listener);
        if (listeners.size === 0) listenersByScopeId.delete(scopeId);
    };
}

export function useSessionTerminalMode(sessionId: string, serverId?: string | null): SessionTerminalMode {
    return React.useSyncExternalStore(
        React.useCallback((listener) => subscribeSessionTerminalMode(createSessionPaneScopeId(sessionId, serverId), listener), [sessionId, serverId]),
        React.useCallback(() => readSessionTerminalMode(sessionId, serverId), [sessionId, serverId]),
        React.useCallback(() => readSessionTerminalMode(sessionId, serverId), [sessionId, serverId]),
    );
}

export type SessionTerminalIdentity = Readonly<{
    serverId: string | null;
    terminalMode: SessionTerminalMode;
    terminalKey: string;
}>;

export function useSessionTerminalIdentity(params: Readonly<{
    sessionId: string;
    scopeId: string;
    terminalMode?: SessionTerminalMode;
    terminalInstanceId?: string;
}>): SessionTerminalIdentity {
    const serverId = parseSessionPaneScopeId(params.scopeId)?.address?.serverId ?? null;
    const storedMode = useSessionTerminalMode(params.sessionId, serverId);
    const terminalMode = params.terminalMode ?? storedMode;
    return React.useMemo(() => {
        const scopeId = createSessionPaneScopeId(params.sessionId, serverId);
        const terminalKey = terminalMode === 'session_attach'
            ? serverId ? `${scopeId}:attach` : `session-attach:${params.sessionId}`
            : params.terminalInstanceId
                ? `${scopeId}:terminal:${params.terminalInstanceId}`
                : `${scopeId}:terminal`;
        return { serverId, terminalMode, terminalKey };
    }, [params.sessionId, params.terminalInstanceId, serverId, terminalMode]);
}
