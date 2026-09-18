import { readStoredSessionMessagesForAddress } from '@/sync/domains/messages/readStoredSessionMessagesForAddress';
import { listSessionAddressesForSessionIdFromLocalState } from '@/sync/domains/session/resolveSessionAddressFromLocalState';
import { normalizeSessionAddress } from '@/sync/domains/session/sessionAddress';
import { storage } from '@/sync/domains/state/storage';
import { readSessionIncludedInVoiceFromState } from '@/voice/runtime/voiceUpdatePolicy';
import type { SessionTranscriptGetResult } from '@happier-dev/protocol/actions';

import {
  clampInt,
  compareSessionKeyDesc,
  formatCursorKey,
  normalizeNonEmptyString,
  parseCursorKey,
  resolveVoiceUpdatesPrefs,
  shouldIncludeAfterCursor,
  toRoleAndText,
} from './shared';

type VoiceRecentMessagesParams = Readonly<{
  sessionId: string;
  /**
   * Home bound by the invoking Action host, which is never the currently focused UI
   * Home. It is absent whenever the host could not bind one, so the projection falls
   * back to unambiguous local knowledge rather than to focus.
   */
  serverId?: string | null;
  limit?: number;
  cursor?: string | null;
  includeUser?: boolean;
  includeAssistant?: boolean;
  maxCharsPerMessage?: number | null;
}>;

type VoiceRecentMessage = Readonly<{
  id: unknown;
  role: 'assistant' | 'user' | 'tool';
  text: string;
  createdAt: unknown;
}>;

type VoiceRecentMessagesProjection =
  | Readonly<{
      ok: true;
      sessionId: string;
      messages: readonly VoiceRecentMessage[];
      nextCursor: string | null;
      rawRowsScanned: number;
    }>
  | Readonly<{ ok: false; errorCode: string; errorMessage: string }>;

async function readSessionRecentMessagesForVoiceProjection(
  params: VoiceRecentMessagesParams,
): Promise<VoiceRecentMessagesProjection> {
  const state = storage.getState();
  const prefs = resolveVoiceUpdatesPrefs(state.settings);
  const refuse = (errorCode: string) => ({ ok: false as const, errorCode, errorMessage: errorCode });
  if (!prefs.shareRecentMessages) return refuse('recent_messages_disabled');

  const requestedSessionId = String(params.sessionId ?? '').trim();
  if (!requestedSessionId) return refuse('invalid_parameters');

  // The host binds the Home; an unqualified caller may only be resolved from
  // unambiguous local knowledge, never from whichever Home the UI happens to show.
  const boundServerId = normalizeNonEmptyString(params.serverId);
  const knownAddresses = listSessionAddressesForSessionIdFromLocalState(state, requestedSessionId);
  if (!boundServerId && knownAddresses.length > 1) return refuse('session_ambiguous');
  const resolvedServerId = boundServerId ?? knownAddresses[0]?.serverId ?? null;
  if (!resolvedServerId) return refuse('session_not_found');
  const requestedAddress = normalizeSessionAddress(resolvedServerId, requestedSessionId);
  if (!requestedAddress) return refuse('invalid_parameters');

  // Durable Account Follow is the disclosure authority. Attempt-local Voice context and
  // action-target state exist only for presentation/readback and cannot grant transcript access.
  const isActive = readSessionIncludedInVoiceFromState(state, requestedAddress);

  if (!isActive && prefs.otherSessionsSnippetsMode === 'never') {
    return refuse('other_sessions_snippets_disabled');
  }

  const defaultOnDemandLimit = clampInt(params.limit, { min: 1, max: 50, fallback: 20 });
  const limit = defaultOnDemandLimit;
  const cursor = params.cursor ?? null;
  const maxCharsPerMessage = params.maxCharsPerMessage ?? null;

  const includeAssistant = params.includeAssistant ?? true;
  const includeUser = params.includeUser ?? true;

  const messages = readStoredSessionMessagesForAddress(state, requestedAddress);
  const beforeCursor = parseCursorKey(cursor);

  const filtered = messages
    .filter((m) => m && typeof m === 'object')
    .map((message) => ({
      message,
      key: {
        updatedAt: Number((message as any).createdAt ?? 0),
        id: String((message as any).id ?? ''),
      },
    }))
    .filter(({ key }) => Number.isFinite(key.updatedAt) && key.id.length > 0)
    .filter(({ message }) => {
      if (message.kind === 'agent-text') return includeAssistant;
      if (message.kind === 'user-text') return includeUser;
      if (message.kind === 'tool-call') return includeAssistant;
      return false;
    })
    .filter(({ key }) => (beforeCursor == null ? true : shouldIncludeAfterCursor(key, beforeCursor)))
    .slice(0)
    .sort((left, right) => compareSessionKeyDesc(left.key, right.key));

  const page = filtered.slice(0, limit).slice(0).reverse();
  const outMessages = page.flatMap(({ message }) => {
    const row = toRoleAndText(message, { shareToolNames: prefs.shareToolNames, shareToolArgs: prefs.shareToolArgs, shareFilePaths: prefs.shareFilePaths });
    if (!row.text || !row.role) return [];
    const text = maxCharsPerMessage === null ? row.text : row.text.slice(0, Math.max(0, maxCharsPerMessage));
    return [{
      id: (message as any).id,
      role: row.role,
      text,
      createdAt: (message as any).createdAt,
    }];
  });

  const nextCursor = outMessages.length > 0
    ? formatCursorKey({
        updatedAt: Number(outMessages[0]?.createdAt ?? 0),
        id: String(outMessages[0]?.id ?? ''),
      })
    : null;
  return {
    ok: true,
    sessionId: requestedAddress.sessionId,
    messages: outMessages,
    nextCursor,
    rawRowsScanned: messages.length,
  };
}

export async function getSessionRecentMessagesForVoiceTool(
  params: VoiceRecentMessagesParams,
): Promise<
  | Readonly<{ ok: true; sessionId: string; messages: readonly any[]; nextCursor: string | null }>
  | Readonly<{ ok: false; errorCode: string; errorMessage: string }>
> {
  const result = await readSessionRecentMessagesForVoiceProjection(params);
  if (!result.ok) return result;
  return {
    ok: true,
    sessionId: result.sessionId,
    messages: result.messages,
    nextCursor: result.nextCursor,
  };
}

function isCanonicalTranscriptTimestamp(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

export async function getSessionTranscriptForVoiceTool(params: VoiceRecentMessagesParams & Readonly<{
  projection?: 'externalShareableV1';
  roles?: readonly ('user' | 'assistant')[];
}>): Promise<SessionTranscriptGetResult> {
  if (params.projection === 'externalShareableV1') {
    return {
      ok: false,
      errorCode: 'external_shareable_projection_unavailable',
      errorMessage: 'external_shareable_projection_unavailable',
    };
  }

  const roleSet = Array.isArray(params.roles) ? new Set(params.roles) : null;
  const result = await readSessionRecentMessagesForVoiceProjection({
    sessionId: params.sessionId,
    ...(params.serverId !== undefined ? { serverId: params.serverId } : {}),
    ...(params.limit !== undefined ? { limit: params.limit } : {}),
    ...(params.cursor !== undefined ? { cursor: params.cursor } : {}),
    includeUser: roleSet ? roleSet.has('user') : true,
    includeAssistant: roleSet ? roleSet.has('assistant') : true,
    ...(params.maxCharsPerMessage !== undefined ? { maxCharsPerMessage: params.maxCharsPerMessage } : {}),
  });
  if (!result.ok) return result;

  return {
    ok: true,
    sessionId: result.sessionId,
    items: result.messages.flatMap((message) => {
      if (typeof message.id !== 'string' || !isCanonicalTranscriptTimestamp(message.createdAt)) return [];
      return [{
        id: message.id,
        createdAt: message.createdAt,
        semanticRole: message.role,
        role: message.role,
        kind: message.role === 'tool' ? 'tool_call' : 'message',
        text: message.text,
      }];
    }),
    nextCursor: result.nextCursor,
    hasMore: result.nextCursor !== null,
    diagnostics: {
      rawRowsScanned: result.rawRowsScanned,
      // This projection reads the already-normalized local store, so no raw transport page exists.
      pagesFetched: 0,
      scanLimitReached: false,
      // It publishes text only and never materializes raw payloads.
      payloadTruncations: 0,
    },
  };
}
