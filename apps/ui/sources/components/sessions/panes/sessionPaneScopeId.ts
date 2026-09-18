import { normalizeSessionAddress, type SessionAddress } from '@/sync/domains/session/sessionAddress';
import { normalizeSessionId } from '@/sync/domains/session/normalizeSessionId';

const QUALIFIED_SESSION_SCOPE_PREFIX = 'session:address:';
const LEGACY_SESSION_SCOPE_PREFIX = 'session:';

export function createSessionPaneScopeId(
    sessionIdRaw: string,
    serverIdRaw?: string | null,
): string {
    const sessionId = normalizeSessionId(sessionIdRaw);
    const address = normalizeSessionAddress(serverIdRaw, sessionId);
    if (!address) return `${LEGACY_SESSION_SCOPE_PREFIX}${sessionId}`;
    return `${QUALIFIED_SESSION_SCOPE_PREFIX}${encodeURIComponent(address.serverId)}:${encodeURIComponent(address.sessionId)}`;
}

export function parseSessionPaneScopeId(scopeId: string): Readonly<{
    sessionId: string;
    address: SessionAddress | null;
}> | null {
    if (scopeId.startsWith(QUALIFIED_SESSION_SCOPE_PREFIX)) {
        const payload = scopeId.slice(QUALIFIED_SESSION_SCOPE_PREFIX.length);
        const separatorIndex = payload.indexOf(':');
        if (separatorIndex <= 0) return null;
        try {
            const address = normalizeSessionAddress(
                decodeURIComponent(payload.slice(0, separatorIndex)),
                decodeURIComponent(payload.slice(separatorIndex + 1)),
            );
            return address ? { sessionId: address.sessionId, address } : null;
        } catch {
            return null;
        }
    }
    if (!scopeId.startsWith(LEGACY_SESSION_SCOPE_PREFIX)) return null;
    const sessionId = normalizeSessionId(scopeId.slice(LEGACY_SESSION_SCOPE_PREFIX.length));
    return sessionId ? { sessionId, address: null } : null;
}
