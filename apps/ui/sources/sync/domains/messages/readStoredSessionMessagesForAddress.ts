import { getActiveServerSnapshot } from '../server/serverRuntime';
import { areSessionAddressesEqual, normalizeSessionAddress, type SessionAddress } from '../session/sessionAddress';
import type { Message } from './messageTypes';
import {
    readStoredSessionMessagesFromStateLike,
    type StoredMessageFromStateLike,
} from './readStoredSessionMessages';

/**
 * The retained transcript store is keyed by bare session id and holds the rows of
 * the Home that hydrated them, so a Home-qualified caller must prove the stored
 * Session belongs to the requested address before reading it. Without that proof a
 * same-named Session on another Home discloses the focused Home's transcript.
 *
 * The stored `sessions` row is that proof: it is reset together with
 * `sessionMessages` whenever the server scope changes, and it declares the Home
 * that hydrated it (falling back to the loaded Home only for a row that declares
 * none). A retained transcript with no stored row carries no Home provenance.
 */
export type SessionHomeQualifiedMessagesStateLike = Readonly<{
    sessions?: Readonly<Record<string, { serverId?: unknown } | null | undefined>> | null;
}>;

function resolveStoredSessionHomeAddress(
    state: SessionHomeQualifiedMessagesStateLike | null | undefined,
    sessionId: string,
    activeServerId: string | null | undefined,
): SessionAddress | null {
    const storedSession = state?.sessions?.[sessionId];
    // The loaded Home is provenance for a stored row that declares none; it is not
    // evidence on its own. Without a stored row nothing proves which Home hydrated
    // the retained rows, so the read fails closed instead of guessing the focused Home.
    if (!storedSession) return null;
    return normalizeSessionAddress(storedSession.serverId, sessionId)
        ?? normalizeSessionAddress(activeServerId, sessionId);
}

export function readStoredSessionMessagesForAddress<TState, TFallback = Message>(
    state: (Readonly<{ sessionMessages?: Record<string, TState> }> & SessionHomeQualifiedMessagesStateLike) | null | undefined,
    address: SessionAddress | null | undefined,
    options?: Readonly<{ activeServerId?: string | null }>,
): StoredMessageFromStateLike<TState, TFallback>[];
export function readStoredSessionMessagesForAddress(
    state: (Readonly<{ sessionMessages?: Record<string, unknown> }> & SessionHomeQualifiedMessagesStateLike) | null | undefined,
    address: SessionAddress | null | undefined,
    options?: Readonly<{ activeServerId?: string | null }>,
): unknown[] {
    const requested = address ? normalizeSessionAddress(address.serverId, address.sessionId) : null;
    if (!requested) return [];
    const stored = resolveStoredSessionHomeAddress(
        state,
        requested.sessionId,
        options?.activeServerId ?? getActiveServerSnapshot().serverId,
    );
    if (!areSessionAddressesEqual(stored, requested)) return [];
    return readStoredSessionMessagesFromStateLike(state?.sessionMessages?.[requested.sessionId]);
}
