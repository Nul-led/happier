import { findSessionListLookupSession } from '@/sync/domains/session/listing/sessionListLookupState';
import type { Session } from '@/sync/domains/state/storageTypes';
import { getActiveServerSnapshot } from '@/sync/domains/server/serverRuntime';
import { normalizeSessionAddress, type SessionAddress } from '@/sync/domains/session/sessionAddress';
import { resolveSessionAddressFromLocalState } from '@/sync/domains/session/resolveSessionAddressFromLocalState';

function normalizeSessionId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function resolveVoiceContextSessionFromState(target: SessionAddress | string, state: unknown): Session | null {
  const normalizedSessionId = normalizeSessionId(typeof target === 'string' ? target : target.sessionId);
  if (!normalizedSessionId || !state || typeof state !== 'object') return null;

  const stateRecord = state as {
    sessions?: Readonly<Record<string, Session | null>> | null | undefined;
  };
  const uniqueLocalAddress = typeof target === 'string'
    ? resolveSessionAddressFromLocalState(
        state as Parameters<typeof resolveSessionAddressFromLocalState>[0],
        normalizedSessionId,
      )
    : null;
  const activeDirectAddress = typeof target === 'string' && stateRecord.sessions?.[normalizedSessionId]
    ? normalizeSessionAddress(getActiveServerSnapshot().serverId, normalizedSessionId)
    : null;
  const address = typeof target === 'string'
    ? uniqueLocalAddress ?? activeDirectAddress
    : normalizeSessionAddress(target.serverId, target.sessionId);
  if (!address) return null;
  const directSession = address.serverId === getActiveServerSnapshot().serverId
    ? stateRecord.sessions?.[normalizedSessionId] ?? null
    : null;
  if (directSession && (
    directSession.metadataLayoutVersion !== undefined
    && directSession.metadataLayoutVersion !== 0
  )) {
    return directSession;
  }

  const lookupSession = findSessionListLookupSession(
    state as Parameters<typeof findSessionListLookupSession>[0],
    address,
  )?.session as Session | null;
  if (lookupSession) return lookupSession;

  return directSession;
}
