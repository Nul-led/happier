import type { MemorySettingsV1 } from '@happier-dev/protocol';

import type { RawSessionListRow } from '@/session/transport/http/sessionsHttp';

import { selectSessionsForBackfill } from './selectSessionsForBackfill';

/**
 * The two Session inventories the daemon memory worker may page. `active` is
 * the ordinary `/v2/sessions` listing, which the server already excludes
 * archived rows from; `archived` is the separate archived listing.
 */
export type MemoryInventoryScope = 'active' | 'archived';

export type MemoryInventoryScopeCursorV1 = Readonly<{
  cursor: string | null;
  hasNext: boolean;
}>;

export type MemoryInventoryState = Readonly<Record<MemoryInventoryScope, MemoryInventoryScopeCursorV1>>;

export const INITIAL_MEMORY_INVENTORY_STATE: MemoryInventoryState = Object.freeze({
  active: Object.freeze({ cursor: null, hasNext: true }),
  archived: Object.freeze({ cursor: null, hasNext: true }),
});

export type MemoryInventoryPage = Readonly<{
  sessions: ReadonlyArray<RawSessionListRow>;
  nextCursor: string | null;
  hasNext: boolean;
}>;

export type MemoryInventoryPageFetcher = (args: Readonly<{
  scope: MemoryInventoryScope;
  cursor?: string;
  limit: number;
}>) => Promise<MemoryInventoryPage>;

export type MemoryInventoryRefresh = Readonly<{
  /**
   * `snapshot` replaces the candidate set from the head page of every eligible
   * inventory (`new_only`); `append` extends it while paging (`last_30_days`,
   * `all_history`).
   */
  mode: 'snapshot' | 'append';
  sessionIds: readonly string[];
  allowInitialBackfillSessionIds: readonly string[];
  observedSeqBySessionId: ReadonlyMap<string, number>;
  state: MemoryInventoryState;
}>;

/**
 * The archived inventory is requested for indexing only under an explicit
 * opt-in. This is the single place that decides it, so no policy branch can
 * silently inventory archived Sessions.
 */
export function resolveMemoryInventoryScopes(
  includeArchivedSessions: boolean,
): readonly MemoryInventoryScope[] {
  return includeArchivedSessions ? ['active', 'archived'] : ['active'];
}

function readSessionId(row: RawSessionListRow): string {
  const raw = (row as { id?: unknown }).id;
  return typeof raw === 'string' ? raw.trim() : '';
}

function readObservedSeq(row: RawSessionListRow): number {
  const raw = (row as { seq?: unknown }).seq;
  return typeof raw === 'number' && Number.isFinite(raw) ? Math.max(0, Math.trunc(raw)) : 0;
}

function readCreatedAtMs(row: RawSessionListRow): number {
  const raw = (row as { createdAt?: unknown }).createdAt;
  const value = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.trunc(value);
}

export type MemoryInventorySessionEligibility = Readonly<{
  sessionId: string;
  observedSeq: number;
  allowInitialBackfill: boolean;
}>;

/**
 * The one per-Session eligibility decision used by paged inventory and by an
 * explicit `ensureUpToDate(sessionId)` request. The explicit path must not turn
 * `new_only` into all-history or bypass archived opt-in.
 */
export function resolveMemoryInventorySessionEligibility(params: Readonly<{
  session: RawSessionListRow;
  backfillPolicy: MemorySettingsV1['backfillPolicy'];
  includeArchivedSessions: boolean;
  enabledAtMs: number;
  nowMs: number;
}>): MemoryInventorySessionEligibility | null {
  const sessionId = readSessionId(params.session);
  if (!sessionId) return null;
  const archivedAt = (params.session as { archivedAt?: unknown }).archivedAt;
  if (archivedAt !== null && archivedAt !== undefined && !params.includeArchivedSessions) {
    return null;
  }
  const selected = selectSessionsForBackfill({
    sessions: [params.session],
    backfillPolicy: params.backfillPolicy,
    nowMs: params.nowMs,
  });
  if (!selected.sessionIds.includes(sessionId)) return null;
  const enabledAtMs = Math.max(0, Math.trunc(params.enabledAtMs));
  return {
    sessionId,
    observedSeq: readObservedSeq(params.session),
    allowInitialBackfill: params.backfillPolicy === 'new_only'
      && enabledAtMs > 0
      && readCreatedAtMs(params.session) >= enabledAtMs,
  };
}

/**
 * One eligibility and inventory pass shared by every backfill policy and by
 * `ensureUpToDate`. Callers own persistence of the returned cursor state and
 * the candidate set; they never decide which inventories to read.
 */
export async function refreshMemoryInventoryOnce(params: Readonly<{
  backfillPolicy: MemorySettingsV1['backfillPolicy'];
  includeArchivedSessions: boolean;
  enabledAtMs: number;
  pageLimit: number;
  nowMs: number;
  state: MemoryInventoryState;
  seenSessionIds: ReadonlySet<string>;
  fetchSessionsPage: MemoryInventoryPageFetcher;
}>): Promise<MemoryInventoryRefresh> {
  const scopes = resolveMemoryInventoryScopes(params.includeArchivedSessions);
  const limit = Math.max(1, Math.trunc(params.pageLimit));
  const isSnapshot = params.backfillPolicy === 'new_only';
  const enabledAtMs = Math.max(0, Math.trunc(params.enabledAtMs));

  const sessionIds: string[] = [];
  const allowInitialBackfillSessionIds: string[] = [];
  const observedSeqBySessionId = new Map<string, number>();
  const emitted = new Set<string>();
  const nextState: Record<MemoryInventoryScope, MemoryInventoryScopeCursorV1> = {
    active: params.state.active,
    archived: params.state.archived,
  };

  for (const scope of scopes) {
    const scopeState = params.state[scope];
    const cursor = scopeState.hasNext ? scopeState.cursor ?? undefined : undefined;
    const page = await params.fetchSessionsPage({
      scope,
      ...(isSnapshot || cursor === undefined ? {} : { cursor }),
      limit,
    });

    if (isSnapshot) {
      for (const row of page.sessions) {
        const eligibility = resolveMemoryInventorySessionEligibility({
          session: row,
          backfillPolicy: params.backfillPolicy,
          includeArchivedSessions: params.includeArchivedSessions,
          enabledAtMs,
          nowMs: params.nowMs,
        });
        if (!eligibility || emitted.has(eligibility.sessionId)) continue;
        emitted.add(eligibility.sessionId);
        observedSeqBySessionId.set(eligibility.sessionId, eligibility.observedSeq);
        if (eligibility.allowInitialBackfill) {
          allowInitialBackfillSessionIds.push(eligibility.sessionId);
        }
        sessionIds.push(eligibility.sessionId);
      }
      nextState[scope] = INITIAL_MEMORY_INVENTORY_STATE[scope];
      continue;
    }

    const selected = selectSessionsForBackfill({
      sessions: page.sessions,
      backfillPolicy: params.backfillPolicy,
      nowMs: params.nowMs,
    });
    for (const id of selected.sessionIds) {
      if (!id || emitted.has(id) || params.seenSessionIds.has(id)) continue;
      const row = page.sessions.find((candidate) => readSessionId(candidate) === id);
      if (!row) continue;
      const eligibility = resolveMemoryInventorySessionEligibility({
        session: row,
        backfillPolicy: params.backfillPolicy,
        includeArchivedSessions: params.includeArchivedSessions,
        enabledAtMs,
        nowMs: params.nowMs,
      });
      if (!eligibility) continue;
      emitted.add(id);
      observedSeqBySessionId.set(id, eligibility.observedSeq);
      sessionIds.push(id);
    }

    if (!scopeState.hasNext) {
      nextState[scope] = { cursor: null, hasNext: false };
    } else if (selected.shouldStopPaging) {
      nextState[scope] = { cursor: null, hasNext: false };
    } else {
      nextState[scope] = { cursor: page.nextCursor, hasNext: Boolean(page.hasNext) };
    }
  }

  return {
    mode: isSnapshot ? 'snapshot' : 'append',
    sessionIds,
    allowInitialBackfillSessionIds,
    observedSeqBySessionId,
    state: nextState,
  };
}
