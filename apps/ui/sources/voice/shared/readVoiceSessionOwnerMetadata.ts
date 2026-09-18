import { findSessionListLookupSession } from '@/sync/domains/session/listing/sessionListLookupState';
import { readSessionOwnerMetadataView } from '@/sync/domains/session/readSessionOwnerMetadataView';
import { getActiveServerSnapshot } from '@/sync/domains/server/serverRuntime';
import { resolveSessionAddressFromLocalState } from '@/sync/domains/session/resolveSessionAddressFromLocalState';
import { normalizeSessionAddress, type SessionAddress } from '@/sync/domains/session/sessionAddress';

/**
 * Voice execution facts need the hydrated owner view in layout v1. Layout v0
 * keeps the existing preference for the fresher session-list projection.
 */
export function readVoiceSessionOwnerMetadataFromState(
  state: any,
  target: SessionAddress | string,
  options?: Readonly<{ activeServerId?: string | null }>,
): ReturnType<typeof readSessionOwnerMetadataView> {
  const normalizedSessionId = typeof target === 'string' ? target.trim() : target.sessionId.trim();
  if (!normalizedSessionId) return null;
  const address = typeof target === 'string'
    ? (
        (state?.sessions?.[normalizedSessionId]
          ? normalizeSessionAddress(options?.activeServerId ?? getActiveServerSnapshot().serverId, normalizedSessionId)
          : null)
        ?? resolveSessionAddressFromLocalState(state, normalizedSessionId)
      )
    : normalizeSessionAddress(target.serverId, target.sessionId);
  if (!address) return null;
  const directCandidate = state?.sessions?.[address.sessionId] ?? null;
  const directCandidateServerId = normalizeSessionAddress(
    directCandidate?.serverId ?? options?.activeServerId ?? getActiveServerSnapshot().serverId,
    address.sessionId,
  )?.serverId ?? null;
  const directSession = directCandidateServerId === address.serverId ? directCandidate : null;
  if (directSession && (
    directSession.metadataLayoutVersion !== undefined
    && directSession.metadataLayoutVersion !== 0
  )) {
    return readSessionOwnerMetadataView(directSession);
  }

  const directMetadata = directSession ? readSessionOwnerMetadataView(directSession) : null;
  const preferredSession = findSessionListLookupSession(state, address, options)?.session ?? null;
  const preferredMetadata = preferredSession ? readSessionOwnerMetadataView(preferredSession) : null;
  if (directMetadata && preferredMetadata) {
    return {
      ...directMetadata,
      ...preferredMetadata,
    };
  }
  return preferredMetadata ?? directMetadata;
}
