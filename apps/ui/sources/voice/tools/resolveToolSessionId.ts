import { getActiveServerSnapshot } from '@/sync/domains/server/serverRuntime';
import { normalizeSessionAddress, type SessionAddress } from '@/sync/domains/session/sessionAddress';
import { storage } from '@/sync/domains/state/storage';
import { resolveVoiceActionTargetAddress, useVoiceTargetStore } from '@/voice/runtime/voiceTargetStore';
import { normalizeNonEmptyString } from './actionImpl/shared';
import { readAdmittedSessionReferenceCorpusOptions } from './actionImpl/admittedSessionReferenceCorpus';
import { resolveVoiceSessionReference } from './actionImpl/sessionReference';

export function resolveToolSessionAddress(opts: Readonly<{
  explicitSessionId?: unknown;
  explicitServerId?: unknown;
  currentSessionId?: string | null;
  currentServerId?: string | null;
}>): SessionAddress | null {
  const state = storage.getState();
  const explicitSessionId = normalizeNonEmptyString(opts.explicitSessionId);
  const explicitServerId = normalizeNonEmptyString(opts.explicitServerId);
  if (explicitSessionId) {
    // An exact tuple is already qualified and never consults a corpus. A bare id is resolved
    // against the one admitted corpus, so a single authoritative match opens while ambiguity,
    // absence and unproven coverage all stay closed here (Lane 07.1 §3).
    const corpusOptions = explicitServerId ? null : readAdmittedSessionReferenceCorpusOptions(state);
    const resolution = resolveVoiceSessionReference(
      { sessionId: explicitSessionId, serverId: explicitServerId },
      state,
      corpusOptions ?? undefined,
    );
    return resolution.kind === 'unique' ? resolution.address : null;
  }

  const currentSessionAddress = normalizeSessionAddress(
    opts.currentServerId ?? getActiveServerSnapshot().serverId,
    opts.currentSessionId,
  );
  const { scope, primaryActionSessionAddress, lastFocusedSessionAddress } = useVoiceTargetStore.getState();
  return resolveVoiceActionTargetAddress({
    scope,
    currentSessionAddress,
    primaryActionSessionAddress,
    lastFocusedSessionAddress,
  });
}

export function resolveToolSessionId(opts: Readonly<{
  explicitSessionId?: unknown;
  explicitServerId?: unknown;
  currentSessionId?: string | null;
  currentServerId?: string | null;
}>): string | null {
  return resolveToolSessionAddress(opts)?.sessionId ?? null;
}
