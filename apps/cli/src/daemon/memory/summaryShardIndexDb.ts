import {
  openSqliteDatabaseSync,
  resolveSqliteSupportedValueBatchSize,
  type SqliteDatabaseSync,
} from '../persistence/sqliteSync';
import {
  createMemoryIndexQueueDb,
  ensureMemoryIndexQueueSchema,
} from './queue/memoryIndexQueueDb';
import type { MemoryIndexQueueDbHandle } from './queue/memoryIndexQueueTypes';
import { tokenizeMemoryText } from './tokenizeMemoryText';

export type MemorySearchScope =
  | Readonly<{ type: 'global' }>
  | Readonly<{ type: 'session'; sessionId: string }>;

export type SummaryShardSearchHit = Readonly<{
  sessionId: string;
  seqFrom: number;
  seqTo: number;
  createdAtFromMs: number;
  createdAtToMs: number;
  summary: string;
  rank: number;
  score: number;
}>;

export type SummaryIndexStats = Readonly<{
  lightShardCount: number;
  lightTermCount: number;
  searchableSessionCount: number;
  lastIndexedAtMs: number | null;
  latestIndexedMessageAtMs: number | null;
}>;

export type SummaryShardIndexDbHandle = Readonly<{
  init: () => void;
  insertSummaryShard: (args: Readonly<{
    sessionId: string;
    seqFrom: number;
    seqTo: number;
    createdAtFromMs: number;
    createdAtToMs: number;
    summary: string;
    keywords: ReadonlyArray<string>;
    entities: ReadonlyArray<string>;
    decisions: ReadonlyArray<string>;
  }>) => void;
  search: (args: Readonly<{
    query: string;
    scope: MemorySearchScope;
    eligibleSessionIds?: readonly string[];
    maxResults: number;
  }>) => SummaryShardSearchHit[];
  getSummaryIndexStats: () => SummaryIndexStats;
  getLatestShardSeqTo: (args: Readonly<{ sessionId: string }>) => number;
  /** Every Session id this index currently retains derived rows or progress for. */
  listIndexedSessionIds: () => readonly string[];
  getSessionCursors: (args: Readonly<{ sessionId: string; nowMs: number }>) => Readonly<{
    lastObservedSeq: number;
    lastHintedSeq: number;
    lastDeepIndexedSeq: number;
    consecutiveDeepFailures: number;
    nextDeepEligibleAtMs: number;
  }>;
  trySeedSessionCursorsIfMissing: (args: Readonly<{
    sessionId: string;
    nowMs: number;
    lastHintedSeq: number;
    lastDeepIndexedSeq: number;
  }>) => boolean;
  tryAcquireHintRunPermit: (args: Readonly<{ sessionId: string; nowMs: number; maxRunsPerHour: number }>) => boolean;
  markHintRunSuccess: (args: Readonly<{ sessionId: string; seqTo: number; nowMs: number }>) => void;
  markHintRunFailure: (args: Readonly<{ sessionId: string; nowMs: number; backoffBaseMs: number; backoffMaxMs: number }>) => void;
  enforceMaxShardsPerSession: (args: Readonly<{ sessionId: string; maxShardsPerSession: number }>) => void;
  markDeepIndexSuccess: (args: Readonly<{ sessionId: string; seqTo: number; nowMs: number }>) => void;
  markDeepIndexFailure: (args: Readonly<{ sessionId: string; nowMs: number; backoffBaseMs: number; backoffMaxMs: number }>) => void;
  deleteOldestSummaryShards: (args: Readonly<{ limit: number }>) => number;
  /**
   * Removes every tier-1 derived row for one Session: summary shards (and
   * their cascaded terms), progress cursors, and queue/index state. Used when
   * a Session is deleted, its access is revoked, or it leaves the configured
   * eligibility; later re-admission must follow the then-current backfill
   * policy, so the cursor is deliberately not retained.
   */
  deleteSessionIndexData: (args: Readonly<{ sessionId: string }>) => void;
  checkpointAndVacuum: () => void;
  close: () => void;
}> & MemoryIndexQueueDbHandle;

function normalizeQuery(raw: string): string {
  return String(raw ?? '')
    .trim()
    .replace(/\s+/g, ' ');
}

const HINT_RUN_WINDOW_MS = 60 * 60 * 1000;
const MULTI_TERM_QUERY_MIN_MATCH_RATIO = 0.5;
function nullableInt(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.trunc(n)) : null;
}

function intOrZero(value: unknown): number {
  return nullableInt(value) ?? 0;
}

/**
 * Bumped to 4 when summary terms moved to the canonical Unicode-aware
 * tokenizer: v3 term rows were produced by an ASCII-only tokenizer and cannot
 * be matched by current queries.
 */
const SUMMARY_INDEX_SCHEMA_VERSION = 4;

function applyConnectionPragmas(db: SqliteDatabaseSync): void {
  db.exec(`PRAGMA journal_mode=WAL;`);
  db.exec(`PRAGMA synchronous=NORMAL;`);
  // The daemon worker and per-query search openers share this file; wait for a
  // writer (schema upgrade, eviction) instead of failing the caller outright.
  db.exec(`PRAGMA busy_timeout=5000;`);
  db.exec(`PRAGMA foreign_keys=ON;`);
  db.exec(`PRAGMA auto_vacuum=INCREMENTAL;`);
}

function ensureSchemaTables(db: SqliteDatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS session_cursors (
      sessionId TEXT PRIMARY KEY,
      lastObservedSeq INTEGER NOT NULL DEFAULT 0,
      lastHintedSeq INTEGER NOT NULL DEFAULT 0,
      lastDeepIndexedSeq INTEGER NOT NULL DEFAULT 0,
      lastHintRunAtMs INTEGER NOT NULL DEFAULT 0,
      hintRunWindowStartMs INTEGER NOT NULL DEFAULT 0,
      hintRunWindowCount INTEGER NOT NULL DEFAULT 0,
      lastHintErrorAtMs INTEGER,
      lastDeepErrorAtMs INTEGER,
      consecutiveHintFailures INTEGER NOT NULL DEFAULT 0,
      consecutiveDeepFailures INTEGER NOT NULL DEFAULT 0,
      nextHintEligibleAtMs INTEGER NOT NULL DEFAULT 0,
      nextDeepEligibleAtMs INTEGER NOT NULL DEFAULT 0,
      updatedAtMs INTEGER NOT NULL DEFAULT 0
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS summary_shards (
      shardId INTEGER PRIMARY KEY AUTOINCREMENT,
      sessionId TEXT NOT NULL,
      seqFrom INTEGER NOT NULL,
      seqTo INTEGER NOT NULL,
      createdAtFromMs INTEGER NOT NULL,
      createdAtToMs INTEGER NOT NULL,
      summary TEXT NOT NULL,
      keywordsText TEXT NOT NULL,
      entitiesText TEXT NOT NULL,
      decisionsText TEXT NOT NULL,
      UNIQUE (sessionId, seqFrom, seqTo)
    );
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS summary_shards_by_session_seqTo ON summary_shards(sessionId, seqTo);
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS summary_terms (
      term TEXT NOT NULL,
      shardId INTEGER NOT NULL,
      PRIMARY KEY (term, shardId),
      FOREIGN KEY (shardId) REFERENCES summary_shards(shardId) ON DELETE CASCADE
    );
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS summary_terms_term_idx ON summary_terms(term);
  `);
}

function migrateV1ToV2(db: SqliteDatabaseSync): void {
  db.exec(`ALTER TABLE session_cursors ADD COLUMN lastHintRunAtMs INTEGER NOT NULL DEFAULT 0;`);
  db.exec(`ALTER TABLE session_cursors ADD COLUMN hintRunWindowStartMs INTEGER NOT NULL DEFAULT 0;`);
  db.exec(`ALTER TABLE session_cursors ADD COLUMN hintRunWindowCount INTEGER NOT NULL DEFAULT 0;`);
}

/**
 * Re-derives every term row from the shard text the index already retains, so
 * an index written by the retired ASCII-only tokenizer becomes searchable
 * without discarding shards or replaying session cursors from the server.
 */
function rebuildSummaryTerms(db: SqliteDatabaseSync): void {
  const shards = db
    .prepare(`SELECT shardId, summary, keywordsText, entitiesText, decisionsText FROM summary_shards;`)
    .all() as any[];
  const insertTermStmt = db.prepare(`INSERT OR IGNORE INTO summary_terms (term, shardId) VALUES (?, ?);`);
  db.exec('BEGIN IMMEDIATE');
  try {
    db.exec('DELETE FROM summary_terms;');
    for (const shard of shards) {
      const shardId = Number(shard?.shardId);
      if (!Number.isFinite(shardId)) continue;
      const source = [shard?.summary, shard?.keywordsText, shard?.entitiesText, shard?.decisionsText]
        .map((part) => String(part ?? ''))
        .join(' ');
      for (const term of tokenizeMemoryText(source)) {
        insertTermStmt.run(term, shardId);
      }
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

function ensureSchema(db: SqliteDatabaseSync): void {
  applyConnectionPragmas(db);
  const versionRow = db.prepare('PRAGMA user_version').get() as any;
  const userVersion = typeof versionRow?.user_version === 'number' ? versionRow.user_version : 0;
  if (userVersion > SUMMARY_INDEX_SCHEMA_VERSION) {
    throw new Error(`Unsupported memory DB schema version: ${userVersion}`);
  }

  if (userVersion === 1) migrateV1ToV2(db);
  ensureSchemaTables(db);
  ensureMemoryIndexQueueSchema(db);

  if (userVersion === SUMMARY_INDEX_SCHEMA_VERSION) return;
  if (userVersion > 0) rebuildSummaryTerms(db);
  db.exec(`PRAGMA user_version=${SUMMARY_INDEX_SCHEMA_VERSION}`);
}

export function openSummaryShardIndexDb(args: Readonly<{ dbPath: string }>): SummaryShardIndexDbHandle {
  const db = openSqliteDatabaseSync(args.dbPath);
  ensureSchema(db);

  const insertStmt = db.prepare(`
    INSERT OR IGNORE INTO summary_shards (
      shardId,
      sessionId,
      seqFrom,
      seqTo,
      createdAtFromMs,
      createdAtToMs,
      summary,
      keywordsText,
      entitiesText,
      decisionsText
    ) VALUES (
      NULL,
      ?,
      ?,
      ?,
      ?,
      ?,
      ?,
      ?,
      ?,
      ?
    );
  `);
  const insertTermStmt = db.prepare(`INSERT OR IGNORE INTO summary_terms (term, shardId) VALUES (?, ?);`);
  const latestSeqToStmt = db.prepare(`SELECT MAX(seqTo) AS maxSeqTo FROM summary_shards WHERE sessionId = ?;`);
  const summaryIndexStatsStmt = db.prepare(`
    SELECT
      COUNT(*) AS lightShardCount,
      COUNT(DISTINCT sessionId) AS searchableSessionCount,
      MAX(createdAtToMs) AS latestIndexedMessageAtMs
    FROM summary_shards;
  `);
  const summaryTermCountStmt = db.prepare(`SELECT COUNT(*) AS lightTermCount FROM summary_terms;`);
  const summaryLastIndexedAtStmt = db.prepare(`SELECT MAX(updatedAtMs) AS lastIndexedAtMs FROM session_cursors;`);

  const ensureCursorStmt = db.prepare(`INSERT OR IGNORE INTO session_cursors (sessionId, updatedAtMs) VALUES (?, ?);`);
  const getCursorStmt = db.prepare(`
    SELECT
      lastObservedSeq AS lastObservedSeq,
      lastHintedSeq AS lastHintedSeq,
      lastDeepIndexedSeq AS lastDeepIndexedSeq,
      lastHintRunAtMs AS lastHintRunAtMs,
      hintRunWindowStartMs AS hintRunWindowStartMs,
      hintRunWindowCount AS hintRunWindowCount,
      lastHintErrorAtMs AS lastHintErrorAtMs,
      lastDeepErrorAtMs AS lastDeepErrorAtMs,
      consecutiveHintFailures AS consecutiveHintFailures,
      consecutiveDeepFailures AS consecutiveDeepFailures,
      nextHintEligibleAtMs AS nextHintEligibleAtMs,
      nextDeepEligibleAtMs AS nextDeepEligibleAtMs,
      updatedAtMs AS updatedAtMs
    FROM session_cursors
    WHERE sessionId = ?;
  `);
  const seedCursorStmt = db.prepare(`
    UPDATE session_cursors
    SET
      lastObservedSeq = MAX(lastObservedSeq, ?),
      lastHintedSeq = MAX(lastHintedSeq, ?),
      lastDeepIndexedSeq = MAX(lastDeepIndexedSeq, ?),
      updatedAtMs = ?
    WHERE sessionId = ?;
  `);
  const getHintCursorStmt = db.prepare(`
    SELECT
      nextHintEligibleAtMs AS nextHintEligibleAtMs,
      lastHintRunAtMs AS lastHintRunAtMs,
      hintRunWindowStartMs AS hintRunWindowStartMs,
      hintRunWindowCount AS hintRunWindowCount,
      consecutiveHintFailures AS consecutiveHintFailures
    FROM session_cursors
    WHERE sessionId = ?;
  `);
  const updateHintPermitStmt = db.prepare(`
    UPDATE session_cursors
    SET
      lastHintRunAtMs = ?,
      hintRunWindowStartMs = ?,
      hintRunWindowCount = ?,
      updatedAtMs = ?
    WHERE sessionId = ?;
  `);
  const updateHintThrottleStmt = db.prepare(`
    UPDATE session_cursors
    SET
      nextHintEligibleAtMs = ?,
      updatedAtMs = ?
    WHERE sessionId = ?;
  `);
  const hintSuccessStmt = db.prepare(`
    UPDATE session_cursors
    SET
      lastHintedSeq = MAX(lastHintedSeq, ?),
      lastHintErrorAtMs = NULL,
      consecutiveHintFailures = 0,
      nextHintEligibleAtMs = 0,
      updatedAtMs = ?
    WHERE sessionId = ?;
  `);
  const hintFailureStmt = db.prepare(`
    UPDATE session_cursors
    SET
      lastHintErrorAtMs = ?,
      consecutiveHintFailures = consecutiveHintFailures + 1,
      nextHintEligibleAtMs = ?,
      updatedAtMs = ?
    WHERE sessionId = ?;
  `);

  const getDeepCursorStmt = db.prepare(`
    SELECT
      consecutiveDeepFailures AS consecutiveDeepFailures,
      nextDeepEligibleAtMs AS nextDeepEligibleAtMs
    FROM session_cursors
    WHERE sessionId = ?;
  `);
  const deepSuccessStmt = db.prepare(`
    UPDATE session_cursors
    SET
      lastDeepIndexedSeq = MAX(lastDeepIndexedSeq, ?),
      lastDeepErrorAtMs = NULL,
      consecutiveDeepFailures = 0,
      nextDeepEligibleAtMs = 0,
      updatedAtMs = ?
    WHERE sessionId = ?;
  `);
  const deepFailureStmt = db.prepare(`
    UPDATE session_cursors
    SET
      lastDeepErrorAtMs = ?,
      consecutiveDeepFailures = consecutiveDeepFailures + 1,
      nextDeepEligibleAtMs = ?,
      updatedAtMs = ?
    WHERE sessionId = ?;
  `);

  const evictStmt = db.prepare(`
    DELETE FROM summary_shards
    WHERE shardId IN (
      SELECT shardId
      FROM summary_shards
      WHERE sessionId = ?
      ORDER BY seqTo DESC
      LIMIT -1 OFFSET ?
    );
  `);
  const deleteOldestGlobalStmt = db.prepare(`
    DELETE FROM summary_shards
    WHERE shardId IN (
      SELECT shardId
      FROM summary_shards
      ORDER BY createdAtToMs ASC
      LIMIT ?
    );
  `);
  const listIndexedSessionIdsStmt = db.prepare(`
    SELECT sessionId FROM summary_shards
    UNION
    SELECT sessionId FROM session_cursors;
  `);
  const deleteSessionShardsStmt = db.prepare(`DELETE FROM summary_shards WHERE sessionId = ?;`);
  const deleteSessionCursorStmt = db.prepare(`DELETE FROM session_cursors WHERE sessionId = ?;`);
  const deleteSessionIndexStateStmt = db.prepare(`DELETE FROM memory_session_index_state WHERE sessionId = ?;`);
  const queueDb = createMemoryIndexQueueDb(db);

  return {
    init: () => {
      // Schema is ensured at open time; keep init() for call-site symmetry.
    },
    insertSummaryShard: (shard) => {
      const keywordsText = shard.keywords.map((k) => String(k ?? '').trim()).filter(Boolean).join(' ');
      const entitiesText = shard.entities.map((k) => String(k ?? '').trim()).filter(Boolean).join(' ');
      const decisionsText = shard.decisions.map((k) => String(k ?? '').trim()).filter(Boolean).join(' ');
      const res = insertStmt.run(
        shard.sessionId,
        shard.seqFrom,
        shard.seqTo,
        shard.createdAtFromMs,
        shard.createdAtToMs,
        shard.summary,
        keywordsText,
        entitiesText,
        decisionsText,
      );
      if (!res || typeof (res as any).changes !== 'number' || (res as any).changes <= 0) {
        return;
      }
      const shardId = Number((res as any).lastInsertRowid);
      const terms = tokenizeMemoryText([shard.summary, keywordsText, entitiesText, decisionsText].join(' '));
      for (const term of terms) {
        insertTermStmt.run(term, shardId);
      }
    },
    search: ({ query, scope, eligibleSessionIds, maxResults }) => {
      const normalized = normalizeQuery(query);
      if (!normalized) return [];

      const limit = Math.max(1, Math.min(100, Math.floor(maxResults)));
      const terms = tokenizeMemoryText(normalized);
      if (terms.length === 0) return [];

      const eligibleIds = eligibleSessionIds === undefined
        ? undefined
        : [...new Set(eligibleSessionIds.map((id) => String(id).trim()).filter(Boolean))];
      if (eligibleIds?.length === 0) return [];

      const placeholders = terms.map(() => '?').join(',');
      const sessionIdBatchSize = resolveSqliteSupportedValueBatchSize({
        // Every term, the optional exact-session scope, and LIMIT are bound in
        // addition to the variable eligible-Session collection.
        fixedParameterCount: terms.length + (scope.type === 'session' ? 1 : 0) + 1,
        parametersPerValue: 1,
      });
      const queryBatch = (sessionIds?: readonly string[]): any[] => {
        const eligibilityPlaceholders = sessionIds?.map(() => '?').join(',');
        const sql = `
          SELECT
            s.sessionId AS sessionId,
            s.seqFrom AS seqFrom,
            s.seqTo AS seqTo,
            s.createdAtFromMs AS createdAtFromMs,
            s.createdAtToMs AS createdAtToMs,
            s.summary AS summary,
            COUNT(*) AS hitCount
          FROM summary_terms t
            JOIN summary_shards s ON s.shardId = t.shardId
          WHERE t.term IN (${placeholders})
            ${scope.type === 'session' ? 'AND s.sessionId = ?' : ''}
            ${eligibilityPlaceholders ? `AND s.sessionId IN (${eligibilityPlaceholders})` : ''}
          GROUP BY s.shardId
          ORDER BY hitCount DESC, s.createdAtToMs DESC
          LIMIT ?;
        `;
        const params: any[] = [...terms];
        if (scope.type === 'session') params.push(scope.sessionId);
        if (sessionIds) params.push(...sessionIds);
        params.push(limit);
        return db.prepare(sql).all(...params) as any[];
      };
      let rows: any[];
      if (eligibleIds) {
        rows = [];
        for (let offset = 0; offset < eligibleIds.length; offset += sessionIdBatchSize) {
          rows.push(...queryBatch(eligibleIds.slice(offset, offset + sessionIdBatchSize)));
        }
        rows.sort((left, right) => Number(right.hitCount) - Number(left.hitCount)
          || Number(right.createdAtToMs) - Number(left.createdAtToMs));
        rows = rows.slice(0, limit);
      } else {
        rows = queryBatch();
      }

      return rows.flatMap((row) => {
        const hitCount = Number(row.hitCount ?? 0);
        const score = terms.length > 0 ? hitCount / terms.length : 0;
        if (terms.length > 1 && score <= MULTI_TERM_QUERY_MIN_MATCH_RATIO) {
          return [];
        }
        const rank = hitCount > 0 ? -hitCount : 0;
        return [{
          sessionId: String(row.sessionId),
          seqFrom: Number(row.seqFrom),
          seqTo: Number(row.seqTo),
          createdAtFromMs: Number(row.createdAtFromMs),
          createdAtToMs: Number(row.createdAtToMs),
          summary: String(row.summary ?? ''),
          rank,
          score,
        } satisfies SummaryShardSearchHit];
      });
    },
    getSummaryIndexStats: () => {
      const stats = summaryIndexStatsStmt.get() as any;
      const termStats = summaryTermCountStmt.get() as any;
      const cursorStats = summaryLastIndexedAtStmt.get() as any;
      return {
        lightShardCount: intOrZero(stats?.lightShardCount),
        lightTermCount: intOrZero(termStats?.lightTermCount),
        searchableSessionCount: intOrZero(stats?.searchableSessionCount),
        lastIndexedAtMs: nullableInt(cursorStats?.lastIndexedAtMs),
        latestIndexedMessageAtMs: nullableInt(stats?.latestIndexedMessageAtMs),
      };
    },
    getLatestShardSeqTo: ({ sessionId }) => {
      const row = latestSeqToStmt.get(String(sessionId ?? '').trim()) as any;
      const value = typeof row?.maxSeqTo === 'number' && Number.isFinite(row.maxSeqTo) ? Math.trunc(row.maxSeqTo) : 0;
      return Math.max(0, value);
    },
    getSessionCursors: ({ sessionId, nowMs }) => {
      const id = String(sessionId ?? '').trim();
      const now = Number.isFinite(nowMs) ? Math.max(0, Math.trunc(nowMs)) : 0;
      if (!id) {
        return {
          lastObservedSeq: 0,
          lastHintedSeq: 0,
          lastDeepIndexedSeq: 0,
          consecutiveDeepFailures: 0,
          nextDeepEligibleAtMs: 0,
        };
      }
      ensureCursorStmt.run(id, now);
      const row = getCursorStmt.get(id) as any;
      return {
        lastObservedSeq: typeof row?.lastObservedSeq === 'number' ? Math.max(0, Math.trunc(row.lastObservedSeq)) : 0,
        lastHintedSeq: typeof row?.lastHintedSeq === 'number' ? Math.max(0, Math.trunc(row.lastHintedSeq)) : 0,
        lastDeepIndexedSeq: typeof row?.lastDeepIndexedSeq === 'number' ? Math.max(0, Math.trunc(row.lastDeepIndexedSeq)) : 0,
        consecutiveDeepFailures:
          typeof row?.consecutiveDeepFailures === 'number' ? Math.max(0, Math.trunc(row.consecutiveDeepFailures)) : 0,
        nextDeepEligibleAtMs:
          typeof row?.nextDeepEligibleAtMs === 'number' ? Math.max(0, Math.trunc(row.nextDeepEligibleAtMs)) : 0,
      };
    },
    trySeedSessionCursorsIfMissing: ({ sessionId, nowMs, lastHintedSeq, lastDeepIndexedSeq }) => {
      const id = String(sessionId ?? '').trim();
      if (!id) return false;
      const now = Number.isFinite(nowMs) ? Math.max(0, Math.trunc(nowMs)) : 0;
      const hinted = Number.isFinite(lastHintedSeq) ? Math.max(0, Math.trunc(lastHintedSeq)) : 0;
      const deepSeq = Number.isFinite(lastDeepIndexedSeq) ? Math.max(0, Math.trunc(lastDeepIndexedSeq)) : 0;

      ensureCursorStmt.run(id, now);
      const row = getCursorStmt.get(id) as any;
      const isFresh =
        (typeof row?.lastObservedSeq !== 'number' || Math.trunc(row.lastObservedSeq) === 0) &&
        (typeof row?.lastHintedSeq !== 'number' || Math.trunc(row.lastHintedSeq) === 0) &&
        (typeof row?.lastDeepIndexedSeq !== 'number' || Math.trunc(row.lastDeepIndexedSeq) === 0) &&
        (typeof row?.lastHintRunAtMs !== 'number' || Math.trunc(row.lastHintRunAtMs) === 0) &&
        (typeof row?.hintRunWindowCount !== 'number' || Math.trunc(row.hintRunWindowCount) === 0) &&
        (typeof row?.consecutiveHintFailures !== 'number' || Math.trunc(row.consecutiveHintFailures) === 0) &&
        (typeof row?.consecutiveDeepFailures !== 'number' || Math.trunc(row.consecutiveDeepFailures) === 0) &&
        (typeof row?.nextHintEligibleAtMs !== 'number' || Math.trunc(row.nextHintEligibleAtMs) === 0) &&
        (typeof row?.nextDeepEligibleAtMs !== 'number' || Math.trunc(row.nextDeepEligibleAtMs) === 0);
      if (!isFresh) return false;

      const observed = Math.max(hinted, deepSeq);
      seedCursorStmt.run(observed, hinted, deepSeq, now, id);
      return true;
    },
    tryAcquireHintRunPermit: ({ sessionId, nowMs, maxRunsPerHour }) => {
      const id = String(sessionId ?? '').trim();
      if (!id) return false;
      const now = Number.isFinite(nowMs) ? Math.max(0, Math.trunc(nowMs)) : 0;
      const maxRuns = Number.isFinite(maxRunsPerHour) ? Math.max(1, Math.trunc(maxRunsPerHour)) : 1;

      ensureCursorStmt.run(id, now);
      const row = getHintCursorStmt.get(id) as any;
      const nextEligibleAtMs =
        typeof row?.nextHintEligibleAtMs === 'number' && Number.isFinite(row.nextHintEligibleAtMs)
          ? Math.trunc(row.nextHintEligibleAtMs)
          : 0;
      if (nextEligibleAtMs > now) return false;

      let windowStart =
        typeof row?.hintRunWindowStartMs === 'number' && Number.isFinite(row.hintRunWindowStartMs)
          ? Math.trunc(row.hintRunWindowStartMs)
          : 0;
      let windowCount =
        typeof row?.hintRunWindowCount === 'number' && Number.isFinite(row.hintRunWindowCount)
          ? Math.trunc(row.hintRunWindowCount)
          : 0;

      if (windowStart <= 0 || now - windowStart >= HINT_RUN_WINDOW_MS) {
        windowStart = now;
        windowCount = 0;
      }

      if (windowCount >= maxRuns) {
        updateHintThrottleStmt.run(windowStart + HINT_RUN_WINDOW_MS, now, id);
        return false;
      }

      updateHintPermitStmt.run(now, windowStart, windowCount + 1, now, id);
      return true;
    },
    markHintRunSuccess: ({ sessionId, seqTo, nowMs }) => {
      const id = String(sessionId ?? '').trim();
      if (!id) return;
      const now = Number.isFinite(nowMs) ? Math.max(0, Math.trunc(nowMs)) : 0;
      const seq = Number.isFinite(seqTo) ? Math.max(0, Math.trunc(seqTo)) : 0;
      ensureCursorStmt.run(id, now);
      hintSuccessStmt.run(seq, now, id);
    },
    markHintRunFailure: ({ sessionId, nowMs, backoffBaseMs, backoffMaxMs }) => {
      const id = String(sessionId ?? '').trim();
      if (!id) return;
      const now = Number.isFinite(nowMs) ? Math.max(0, Math.trunc(nowMs)) : 0;
      const base = Number.isFinite(backoffBaseMs) ? Math.max(0, Math.trunc(backoffBaseMs)) : 0;
      const max = Number.isFinite(backoffMaxMs) ? Math.max(0, Math.trunc(backoffMaxMs)) : 0;

      ensureCursorStmt.run(id, now);
      const row = getHintCursorStmt.get(id) as any;
      const failures =
        typeof row?.consecutiveHintFailures === 'number' && Number.isFinite(row.consecutiveHintFailures)
          ? Math.max(0, Math.trunc(row.consecutiveHintFailures))
          : 0;
      const nextFailures = failures + 1;

      let backoff = 0;
      if (base > 0) {
        const scaled = base * Math.pow(2, Math.max(0, nextFailures - 1));
        backoff = max > 0 ? Math.min(max, scaled) : scaled;
      }
      const nextEligibleAt = now + Math.max(0, Math.trunc(backoff));
      hintFailureStmt.run(now, nextEligibleAt, now, id);
    },
    enforceMaxShardsPerSession: ({ sessionId, maxShardsPerSession }) => {
      const id = String(sessionId ?? '').trim();
      if (!id) return;
      const maxShards = Number.isFinite(maxShardsPerSession) ? Math.max(1, Math.trunc(maxShardsPerSession)) : 1;
      evictStmt.run(id, maxShards);
    },
    markDeepIndexSuccess: ({ sessionId, seqTo, nowMs }) => {
      const id = String(sessionId ?? '').trim();
      if (!id) return;
      const now = Number.isFinite(nowMs) ? Math.max(0, Math.trunc(nowMs)) : 0;
      const seq = Number.isFinite(seqTo) ? Math.max(0, Math.trunc(seqTo)) : 0;
      ensureCursorStmt.run(id, now);
      deepSuccessStmt.run(seq, now, id);
    },
    markDeepIndexFailure: ({ sessionId, nowMs, backoffBaseMs, backoffMaxMs }) => {
      const id = String(sessionId ?? '').trim();
      if (!id) return;
      const now = Number.isFinite(nowMs) ? Math.max(0, Math.trunc(nowMs)) : 0;
      const base = Number.isFinite(backoffBaseMs) ? Math.max(0, Math.trunc(backoffBaseMs)) : 0;
      const max = Number.isFinite(backoffMaxMs) ? Math.max(0, Math.trunc(backoffMaxMs)) : 0;

      ensureCursorStmt.run(id, now);
      const row = getDeepCursorStmt.get(id) as any;
      const failures =
        typeof row?.consecutiveDeepFailures === 'number' && Number.isFinite(row.consecutiveDeepFailures)
          ? Math.max(0, Math.trunc(row.consecutiveDeepFailures))
          : 0;
      const nextFailures = failures + 1;

      let backoff = 0;
      if (base > 0) {
        const scaled = base * Math.pow(2, Math.max(0, nextFailures - 1));
        backoff = max > 0 ? Math.min(max, scaled) : scaled;
      }
      const nextEligibleAt = now + Math.max(0, Math.trunc(backoff));
      deepFailureStmt.run(now, nextEligibleAt, now, id);
    },
    recordMemorySessionIndexState: queueDb.recordMemorySessionIndexState,
    recordMemoryWorkerRun: queueDb.recordMemoryWorkerRun,
    getMemoryIndexQueueTelemetry: queueDb.getMemoryIndexQueueTelemetry,
    deleteOldestSummaryShards: ({ limit }) => {
      const n = Number.isFinite(limit) ? Math.max(0, Math.trunc(limit)) : 0;
      if (n <= 0) return 0;
      const res = deleteOldestGlobalStmt.run(n) as any;
      return typeof res?.changes === 'number' && Number.isFinite(res.changes) ? Math.max(0, Math.trunc(res.changes)) : 0;
    },
    listIndexedSessionIds: () => {
      const rows = listIndexedSessionIdsStmt.all() as Array<{ sessionId?: unknown }>;
      const out: string[] = [];
      for (const row of rows) {
        const id = typeof row?.sessionId === 'string' ? row.sessionId.trim() : '';
        if (id) out.push(id);
      }
      return out;
    },
    deleteSessionIndexData: ({ sessionId }) => {
      const id = String(sessionId ?? '').trim();
      if (!id) return;
      deleteSessionShardsStmt.run(id);
      deleteSessionCursorStmt.run(id);
      deleteSessionIndexStateStmt.run(id);
    },
    checkpointAndVacuum: () => {
      db.exec(`PRAGMA wal_checkpoint(TRUNCATE);`);
      db.exec(`PRAGMA incremental_vacuum;`);
    },
    close: () => {
      db.close();
    },
  };
}
