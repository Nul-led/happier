import { normalizeTrimmedString } from './normalizeTrimmedString';

import { normalizeSessionAddress, sessionAddressKey } from '../sessionAddress';

export const EMPTY_SESSION_LIST_SERVER_KEY = '__unknown_server__';

export type NormalizedSessionListKeyParts = Readonly<{
    serverId: string;
    sessionId: string;
    serverKey: string;
    sessionKey: string | null;
}>;

const EMPTY_NORMALIZED_SESSION_LIST_KEY_PARTS: NormalizedSessionListKeyParts = {
    serverId: '',
    sessionId: '',
    serverKey: EMPTY_SESSION_LIST_SERVER_KEY,
    sessionKey: null,
};

/** Normalizes the structured parts used by current Session-list owners. */
export function normalizeSessionListKeyParts(
    serverIdRaw: unknown,
    sessionIdRaw?: unknown,
): NormalizedSessionListKeyParts {
    const serverId = normalizeTrimmedString(serverIdRaw);
    const sessionId = normalizeTrimmedString(sessionIdRaw);
    if (!serverId && !sessionId) {
        return EMPTY_NORMALIZED_SESSION_LIST_KEY_PARTS;
    }

    return {
        serverId,
        sessionId,
        serverKey: serverId || EMPTY_SESSION_LIST_SERVER_KEY,
        sessionKey: serverId && sessionId ? sessionAddressKey({ serverId, sessionId }) : null,
    };
}

export function buildSessionListServerScopedRowKey(
    serverIdRaw: unknown,
    sessionIdRaw?: unknown,
): string | null {
    const address = normalizeSessionAddress(serverIdRaw, sessionIdRaw);
    return address ? sessionAddressKey(address) : null;
}

export function buildSessionListRowScopeKey(
    serverIdRaw: unknown,
    sessionIdRaw?: unknown,
): string | null {
    const sessionId = typeof sessionIdRaw === 'string' ? sessionIdRaw.trim() : '';
    if (!sessionId) return null;
    // A missing Home is used only by the incumbent active-Home row subscription.
    if (serverIdRaw === null || serverIdRaw === undefined || serverIdRaw === '') return sessionId;
    return buildSessionListServerScopedRowKey(serverIdRaw, sessionId);
}
