/**
 * The one Account-owned decision about what a Followed Session may disclose to a
 * Voice provider.
 *
 * Both Voice hosts ask this: the foreground app, which composes context
 * formatter preferences for an attempt, and the daemon, which prepares Account
 * Voice Follow context for a provider prompt. Neither may re-derive it, because
 * a user who turned transcript sharing off must get the same answer regardless
 * of which host reached the provider.
 *
 * This reads raw Account settings rather than a parsed settings type on purpose:
 * a present but unparsable privacy value must never inherit a schema default and
 * authorize disclosure. Only an explicit `true` shares.
 */

export type VoiceUpdateLevelV1 = 'none' | 'activity' | 'summaries' | 'snippets';

export type VoiceSessionUpdatePolicyV1 = Readonly<{
  level: VoiceUpdateLevelV1;
  isIncludedInVoice: boolean;
  includeUserMessagesInSnippets: boolean;
  snippetsMaxMessages: number;
}>;

/** The permitted content classes for one Voice source, after the update level. */
export type VoiceSourceDisclosureV1 = Readonly<{
  level: VoiceUpdateLevelV1;
  /** The source Session's current-work summary may be described. */
  shareSessionSummary: boolean;
  /** The source Session's message text may be quoted. */
  shareRecentMessages: boolean;
}>;

function readRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function normalizeUpdateLevel(value: unknown, fallback: VoiceUpdateLevelV1): VoiceUpdateLevelV1 {
  if (value === 'none' || value === 'activity' || value === 'summaries' || value === 'snippets') return value;
  return fallback;
}

function clampInt(value: unknown, input: Readonly<{ min: number; max: number; fallback: number }>): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return input.fallback;
  const rounded = Math.floor(value);
  if (rounded < input.min) return input.min;
  if (rounded > input.max) return input.max;
  return rounded;
}

/**
 * The Voice update level for one source Session, from the Account's Voice UI
 * update settings plus that Session's explicit opt-in.
 */
export function resolveVoiceSessionUpdatePolicyV1(params: Readonly<{
  accountSettings: unknown;
  includeInVoice?: boolean;
  isCurrentAttemptTarget?: boolean;
}>): VoiceSessionUpdatePolicyV1 {
  const voice = readRecord(readRecord(params.accountSettings)?.voice);
  const updates = readRecord(readRecord(voice?.ui)?.updates) ?? {};
  const activeLevel = normalizeUpdateLevel(updates.activeSession, 'summaries');
  const otherLevel = normalizeUpdateLevel(updates.otherSessions, 'activity');
  const otherSnippetsMode = String(updates.otherSessionsSnippetsMode ?? 'on_demand_only');

  const isIncludedInVoice = params.includeInVoice === true;
  const hasActivePolicy = isIncludedInVoice || params.isCurrentAttemptTarget === true;
  const baseLevel = hasActivePolicy ? activeLevel : otherLevel;

  return {
    level: (!hasActivePolicy && baseLevel === 'snippets' && otherSnippetsMode !== 'auto')
      ? 'summaries'
      : baseLevel,
    isIncludedInVoice,
    includeUserMessagesInSnippets: updates.includeUserMessagesInSnippets === true,
    snippetsMaxMessages: clampInt(updates.snippetsMaxMessages, { min: 1, max: 10, fallback: 3 }),
  };
}

/**
 * The Account-wide content disclosure switches, before any per-source level.
 * A missing, malformed or non-boolean value withholds.
 */
export function readVoiceContentDisclosureV1(accountSettings: unknown): Readonly<{
  shareSessionSummary: boolean;
  shareRecentMessages: boolean;
}> {
  const privacy = readRecord(readRecord(readRecord(accountSettings)?.voice)?.privacy);
  return {
    shareSessionSummary: privacy?.shareSessionSummary === true,
    shareRecentMessages: privacy?.shareRecentMessages === true,
  };
}

/**
 * What one Voice source may disclose: the Account switches bounded by that
 * source's update level. Summaries need at least `summaries`; message text needs
 * `snippets`.
 */
export function resolveVoiceSourceDisclosureV1(params: Readonly<{
  accountSettings: unknown;
  includeInVoice?: boolean;
  isCurrentAttemptTarget?: boolean;
}>): VoiceSourceDisclosureV1 {
  const level = resolveVoiceSessionUpdatePolicyV1(params).level;
  const disclosure = readVoiceContentDisclosureV1(params.accountSettings);
  return {
    level,
    shareSessionSummary: disclosure.shareSessionSummary
      && (level === 'summaries' || level === 'snippets'),
    shareRecentMessages: disclosure.shareRecentMessages && level === 'snippets',
  };
}
