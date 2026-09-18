import {
  resolveSessionListLookupSessionServerScopeFromState,
  resolveSessionListPreferredSessionMetadataFromState,
} from '@/sync/domains/session/listing/sessionListLookupState';
import {
  resolveVoiceSessionLocationLabelFromMetadata,
  resolveVoiceSessionSharedTitleFromMetadata,
  resolveVoiceSessionTitleFromMetadata,
} from './sessionMetadata';
import { normalizeNonEmptyString } from './shared';
import {
  collectVoiceSessionCorpus,
  type VoiceSessionCorpusOptions,
  type VoiceSessionRow,
} from './voiceSessionRows';
import { readVoiceSessionOwnerMetadataFromState } from '@/voice/shared/readVoiceSessionOwnerMetadata';
import { resolveSessionAddressFromLocalState } from '@/sync/domains/session/resolveSessionAddressFromLocalState';
import { normalizeSessionAddress, type SessionAddress } from '@/sync/domains/session/sessionAddress';

function normalizeVoiceSessionLookupTitle(value: string | null | undefined): string | null {
  const normalized = normalizeNonEmptyString(value);
  if (!normalized) return null;
  const withoutQuotes = normalized.replace(/^[\s"'`“”‘’]+|[\s"'`“”‘’]+$/g, '').trim();
  const withoutTrailingSentencePunctuation = withoutQuotes.replace(/[.!?,;:]+$/g, '').trim();
  return normalizeNonEmptyString(withoutTrailingSentencePunctuation ?? withoutQuotes);
}

export function resolveVoiceSessionRef(
  target: SessionAddress | string | null | undefined,
  state: unknown,
  options?: Readonly<{ serverId?: string | null; serverName?: string | null; activeServerId?: string | null }>,
): VoiceSessionCandidate | null {
  const normalizedSessionId = normalizeNonEmptyString(typeof target === 'string' ? target : target?.sessionId);
  if (!normalizedSessionId) return null;

  const lookupState = state as Parameters<typeof resolveSessionListPreferredSessionMetadataFromState>[0];
  const address = typeof target === 'object' && target
    ? normalizeSessionAddress(target.serverId, target.sessionId)
    : (
        normalizeSessionAddress(options?.serverId, normalizedSessionId)
        ?? resolveSessionAddressFromLocalState(lookupState, normalizedSessionId)
      );
  if (!address) return null;
  const metadata = resolveSessionListPreferredSessionMetadataFromState(lookupState, address, {
    activeServerId: options?.activeServerId,
  });
  const ownerMetadata = readVoiceSessionOwnerMetadataFromState(lookupState, address, {
    activeServerId: options?.activeServerId,
  });
  const title = resolveVoiceSessionSharedTitleFromMetadata(metadata)
    ?? resolveVoiceSessionTitleFromMetadata(ownerMetadata);
  const locationLabel = resolveVoiceSessionLocationLabelFromMetadata(
    ownerMetadata,
  );
  const serverName = normalizeNonEmptyString(options?.serverName)
    ?? resolveSessionListLookupSessionServerScopeFromState(lookupState, address)?.serverName
    ?? null;

  return {
    address,
    id: normalizedSessionId,
    ...(title ? { title } : {}),
    ...(locationLabel ? { locationLabel } : {}),
    serverId: address.serverId,
    ...(serverName ? { serverName } : {}),
  };
}

export type VoiceSessionCandidate = Readonly<{
  address: SessionAddress;
  id: string;
  title?: string;
  locationLabel?: string;
  serverId: string;
  serverName?: string;
}>;

export type VoiceSessionReferenceResolution =
  | Readonly<{ kind: 'unique'; address: SessionAddress; candidate: VoiceSessionCandidate }>
  | Readonly<{ kind: 'ambiguous'; candidates: readonly VoiceSessionCandidate[] }>
  | Readonly<{ kind: 'none' }>
  | Readonly<{ kind: 'incomplete' }>;

function rowToCandidate(row: VoiceSessionRow): VoiceSessionCandidate {
  return {
    address: row.address,
    id: row.id,
    ...(row.title ? { title: row.title } : {}),
    ...(row.locationLabel ? { locationLabel: row.locationLabel } : {}),
    serverId: row.serverId,
    ...(row.serverName ? { serverName: row.serverName } : {}),
  };
}

export function resolveVoiceSessionReference(
  input: Readonly<{ serverId?: string | null; sessionId?: string | null; sessionTitle?: string | null }>,
  state: unknown,
  options?: VoiceSessionCorpusOptions,
): VoiceSessionReferenceResolution {
  const sessionId = normalizeNonEmptyString(input.sessionId);
  const serverId = normalizeNonEmptyString(input.serverId);
  if (sessionId && serverId) {
    const address = normalizeSessionAddress(serverId, sessionId)!;
    const candidate = resolveVoiceSessionRef(address, state) ?? {
      address,
      id: address.sessionId,
      serverId: address.serverId,
    };
    return { kind: 'unique', address, candidate };
  }

  const normalizedTitle = normalizeVoiceSessionLookupTitle(input.sessionTitle);
  if (!sessionId && !normalizedTitle) return { kind: 'none' };
  const corpus = collectVoiceSessionCorpus(state, options);
  const matches = corpus.rows.filter((row) => {
    if (serverId && row.serverId !== serverId) return false;
    return sessionId
      ? row.id === sessionId
      : normalizeVoiceSessionLookupTitle(row.title) === normalizedTitle;
  });
  const candidates = matches.map(rowToCandidate);
  if (candidates.length > 1) return { kind: 'ambiguous', candidates };
  if (!corpus.coverage.complete) return { kind: 'incomplete' };
  if (candidates.length === 0) return { kind: 'none' };
  return { kind: 'unique', address: candidates[0].address, candidate: candidates[0] };
}

export function resolveVoiceSessionReferenceFromTitle(
  sessionTitle: string | null | undefined,
  state: unknown,
  options: VoiceSessionCorpusOptions,
): VoiceSessionReferenceResolution {
  return resolveVoiceSessionReference({ sessionTitle }, state, options);
}

/** Released bare result adapter. It only emits a target after qualified uniqueness is proven. */
export function resolveVoiceSessionIdFromTitle(
  sessionTitle: string | null | undefined,
  state: unknown,
  options: VoiceSessionCorpusOptions = { coverage: 'incomplete' },
): Readonly<{ sessionId: string; address: SessionAddress; session: VoiceSessionCandidate }> | null {
  const resolution = resolveVoiceSessionReferenceFromTitle(sessionTitle, state, options);
  return resolution.kind === 'unique'
    ? { sessionId: resolution.address.sessionId, address: resolution.address, session: resolution.candidate }
    : null;
}
