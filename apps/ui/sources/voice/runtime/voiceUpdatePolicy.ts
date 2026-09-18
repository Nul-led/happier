import { storage } from '@/sync/domains/state/storage';
import {
  normalizeSessionAddress,
  sessionAddressKey,
  type SessionAddress,
} from '@/sync/domains/session/sessionAddress';
import { resolveVoiceSessionRef } from '@/voice/tools/actionImpl/sessionReference';

export type VoiceUpdateLevel = 'none' | 'activity' | 'summaries' | 'snippets';

export type VoiceSessionUpdatePolicy = Readonly<{
  level: VoiceUpdateLevel;
  isIncludedInVoice: boolean;
  includeUserMessagesInSnippets: boolean;
  snippetsMaxMessages: number;
}>;

function clampInt(value: unknown, { min, max, fallback }: { min: number; max: number; fallback: number }): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  const rounded = Math.floor(value);
  if (rounded < min) return min;
  if (rounded > max) return max;
  return rounded;
}

function normalizeUpdateLevel(value: unknown, fallback: VoiceUpdateLevel): VoiceUpdateLevel {
  if (value === 'none' || value === 'activity' || value === 'summaries' || value === 'snippets') return value;
  return fallback;
}

export function resolveVoiceSessionUpdatePolicy(params: Readonly<{
  sessionId: string;
  sessionAddress?: SessionAddress | null;
  settings: unknown;
  includeInVoice?: boolean;
  isCurrentAttemptTarget?: boolean;
}>): VoiceSessionUpdatePolicy {
  const settings = (params.settings ?? {}) as any;
  const updates = settings?.voice?.ui?.updates ?? {};
  const activeLevel = normalizeUpdateLevel(updates.activeSession, 'summaries');
  const otherLevel = normalizeUpdateLevel(updates.otherSessions, 'activity');
  const otherSnippetsMode = String(updates.otherSessionsSnippetsMode ?? 'on_demand_only');

  const isIncludedInVoice = params.includeInVoice === true;
  const hasActivePolicy = isIncludedInVoice || params.isCurrentAttemptTarget === true;
  const baseLevel = hasActivePolicy ? activeLevel : otherLevel;

  const level = (!hasActivePolicy && baseLevel === 'snippets' && otherSnippetsMode !== 'auto')
    ? 'summaries'
    : baseLevel;

  return {
    level,
    isIncludedInVoice,
    includeUserMessagesInSnippets: updates.includeUserMessagesInSnippets === true,
    snippetsMaxMessages: clampInt(updates.snippetsMaxMessages, { min: 1, max: 10, fallback: 3 }),
  };
}

function readViewerIncludeInVoice(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const viewer = (value as { viewer?: unknown }).viewer;
  if (!viewer || typeof viewer !== 'object') return false;
  const follow = (viewer as { follow?: unknown }).follow;
  return Boolean(follow && typeof follow === 'object' && (follow as { includeInVoice?: unknown }).includeInVoice === true);
}

/** Reads only the synchronized exact-Home Account Follow projection. */
export function readSessionIncludedInVoiceFromState(
  state: unknown,
  address: SessionAddress | null | undefined,
): boolean {
  if (!address || !state || typeof state !== 'object') return false;
  const record = state as {
    sessions?: Record<string, unknown>;
    sessionListRowsByServerId?: Record<string, Record<string, unknown> | undefined>;
  };
  const listRow = record.sessionListRowsByServerId?.[address.serverId]?.[address.sessionId];
  if (listRow) return readViewerIncludeInVoice(listRow);
  const active = record.sessions?.[address.sessionId];
  if (!active || typeof active !== 'object') return false;
  const activeServerId = (active as { serverId?: unknown }).serverId;
  return activeServerId === address.serverId && readViewerIncludeInVoice(active);
}

/**
 * Enumerates the exact-Home Include-in-Voice relationships already held by the synchronized
 * Account Follow projection. The Voice target store is attempt-local presentation state and must
 * never seed replacement writes after restart or an update made on another device.
 */
export function listSessionsIncludedInVoiceFromState(state: unknown): SessionAddress[] {
  if (!state || typeof state !== 'object') return [];
  const record = state as {
    sessions?: Record<string, unknown>;
    sessionListRowsByServerId?: Record<string, Record<string, unknown> | undefined>;
  };
  const byKey = new Map<string, SessionAddress>();
  for (const [serverId, rows] of Object.entries(record.sessionListRowsByServerId ?? {})) {
    for (const [sessionId, row] of Object.entries(rows ?? {})) {
      const address = normalizeSessionAddress(serverId, sessionId);
      if (address && readViewerIncludeInVoice(row)) byKey.set(sessionAddressKey(address), address);
    }
  }
  for (const [sessionId, row] of Object.entries(record.sessions ?? {})) {
    if (!row || typeof row !== 'object') continue;
    const address = normalizeSessionAddress(
      (row as { serverId?: unknown }).serverId,
      (row as { id?: unknown }).id ?? sessionId,
    );
    if (address && readViewerIncludeInVoice(row)) byKey.set(sessionAddressKey(address), address);
  }
  return [...byKey.values()].sort((left, right) =>
    sessionAddressKey(left).localeCompare(sessionAddressKey(right)));
}

export function getVoiceSessionUpdatePolicy(sessionId: string): VoiceSessionUpdatePolicy {
  const state = storage.getState();
  const sessionAddress = resolveVoiceSessionRef(sessionId, state)?.address ?? null;
  return resolveVoiceSessionUpdatePolicy({
    sessionId,
    sessionAddress,
    settings: state.settings,
    includeInVoice: readSessionIncludedInVoiceFromState(state, sessionAddress),
  });
}
