import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { openSqliteDatabaseSync } from '../persistence/sqliteSync';
import { openSummaryShardIndexDb } from './summaryShardIndexDb';

function countRows(dbPath: string, table: string): number {
  const db = openSqliteDatabaseSync(dbPath);
  try {
    const row = db.prepare(`SELECT COUNT(*) AS n FROM ${table};`).get() as any;
    return Number(row?.n ?? 0);
  } finally {
    db.close();
  }
}

describe('summaryShardIndexDb', () => {
  it('indexes summary shards and returns session/seq windows via FTS search', async () => {
    const dir = await mkdtemp(join(os.tmpdir(), 'happier-memory-db-'));
    try {
      const dbPath = join(dir, 'memory.sqlite');
      const db = openSummaryShardIndexDb({ dbPath });
      db.init();

      db.insertSummaryShard({
        sessionId: 'sess_1',
        seqFrom: 1,
        seqTo: 10,
        createdAtFromMs: 1000,
        createdAtToMs: 2000,
        summary: 'We discussed OpenClaw deep memory search and indexing.',
        keywords: ['openclaw', 'memory', 'search'],
        entities: ['OpenClaw'],
        decisions: ['Implement tier-1 summaries'],
      });

      db.insertSummaryShard({
        sessionId: 'sess_2',
        seqFrom: 5,
        seqTo: 8,
        createdAtFromMs: 3000,
        createdAtToMs: 3500,
        summary: 'Unrelated conversation about groceries.',
        keywords: ['groceries'],
        entities: [],
        decisions: [],
      });

      const hits = db.search({
        query: 'OpenClaw',
        scope: { type: 'global' },
        maxResults: 10,
      });
      expect(hits.length).toBeGreaterThan(0);
      expect(hits[0]?.sessionId).toBe('sess_1');
      expect(hits[0]?.seqFrom).toBe(1);
      expect(hits[0]?.seqTo).toBe(10);

      const scoped = db.search({
        query: 'groceries',
        scope: { type: 'session', sessionId: 'sess_1' },
        maxResults: 10,
      });
      expect(scoped).toEqual([]);

      const scoped2 = db.search({
        query: 'groceries',
        scope: { type: 'session', sessionId: 'sess_2' },
        maxResults: 10,
      });
      expect(scoped2.length).toBe(1);
      expect(scoped2[0]?.sessionId).toBe('sess_2');

      expect(db.getLatestShardSeqTo({ sessionId: 'sess_1' })).toBe(10);

      db.close();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('returns [] for empty/whitespace queries', async () => {
    const dir = await mkdtemp(join(os.tmpdir(), 'happier-memory-db-empty-'));
    try {
      const dbPath = join(dir, 'memory.sqlite');
      const db = openSummaryShardIndexDb({ dbPath });
      db.init();
      expect(db.search({ query: '   ', scope: { type: 'global' }, maxResults: 10 })).toEqual([]);
      db.close();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('applies Session eligibility before the result limit', async () => {
    const dir = await mkdtemp(join(os.tmpdir(), 'happier-memory-db-eligibility-'));
    try {
      const db = openSummaryShardIndexDb({ dbPath: join(dir, 'memory.sqlite') });
      db.init();
      for (let index = 0; index < 3; index += 1) {
        db.insertSummaryShard({
          sessionId: `active-${index}`,
          seqFrom: 1,
          seqTo: 1,
          createdAtFromMs: 100 + index,
          createdAtToMs: 100 + index,
          summary: 'shared eligibility term',
          keywords: [],
          entities: [],
          decisions: [],
        });
      }
      db.insertSummaryShard({
        sessionId: 'archived-target',
        seqFrom: 1,
        seqTo: 1,
        createdAtFromMs: 1,
        createdAtToMs: 1,
        summary: 'shared eligibility term',
        keywords: [],
        entities: [],
        decisions: [],
      });

      expect(db.search({
        query: 'eligibility',
        scope: { type: 'global' },
        eligibleSessionIds: ['archived-target'],
        maxResults: 2,
      })).toEqual([expect.objectContaining({ sessionId: 'archived-target' })]);
      db.close();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('seeds and reads per-session cursor state', async () => {
    const dir = await mkdtemp(join(os.tmpdir(), 'happier-memory-db-cursors-'));
    try {
      const dbPath = join(dir, 'memory.sqlite');
      const db = openSummaryShardIndexDb({ dbPath });
      db.init();

      const seeded = db.trySeedSessionCursorsIfMissing({
        sessionId: 'sess_1',
        nowMs: 1000,
        lastHintedSeq: 123,
        lastDeepIndexedSeq: 77,
      });
      expect(seeded).toBe(true);

      const cursors = db.getSessionCursors({ sessionId: 'sess_1', nowMs: 2000 });
      expect(cursors.lastHintedSeq).toBe(123);
      expect(cursors.lastDeepIndexedSeq).toBe(77);
      expect(cursors.consecutiveDeepFailures).toBe(0);

      const seededAgain = db.trySeedSessionCursorsIfMissing({
        sessionId: 'sess_1',
        nowMs: 3000,
        lastHintedSeq: 999,
        lastDeepIndexedSeq: 999,
      });
      expect(seededAgain).toBe(false);

      const cursorsAfter = db.getSessionCursors({ sessionId: 'sess_1', nowMs: 4000 });
      expect(cursorsAfter.lastHintedSeq).toBe(123);
      expect(cursorsAfter.lastDeepIndexedSeq).toBe(77);

      db.close();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('tracks deep index backoff and success', async () => {
    const dir = await mkdtemp(join(os.tmpdir(), 'happier-memory-db-deep-backoff-'));
    try {
      const dbPath = join(dir, 'memory.sqlite');
      const db = openSummaryShardIndexDb({ dbPath });
      db.init();

      db.markDeepIndexFailure({
        sessionId: 'sess_1',
        nowMs: 10_000,
        backoffBaseMs: 1000,
        backoffMaxMs: 5_000,
      });

      const afterFailure = db.getSessionCursors({ sessionId: 'sess_1', nowMs: 10_000 });
      expect(afterFailure.consecutiveDeepFailures).toBe(1);
      expect(afterFailure.nextDeepEligibleAtMs).toBe(11_000);

      db.markDeepIndexSuccess({ sessionId: 'sess_1', seqTo: 50, nowMs: 12_000 });
      const afterSuccess = db.getSessionCursors({ sessionId: 'sess_1', nowMs: 12_000 });
      expect(afterSuccess.lastDeepIndexedSeq).toBe(50);
      expect(afterSuccess.consecutiveDeepFailures).toBe(0);
      expect(afterSuccess.nextDeepEligibleAtMs).toBe(0);

      db.close();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('evicts oldest shards globally and cascades term rows', async () => {
    const dir = await mkdtemp(join(os.tmpdir(), 'happier-memory-db-evict-global-'));
    try {
      const dbPath = join(dir, 'memory.sqlite');
      const db = openSummaryShardIndexDb({ dbPath });
      db.init();

      db.insertSummaryShard({
        sessionId: 'sess_1',
        seqFrom: 1,
        seqTo: 2,
        createdAtFromMs: 1000,
        createdAtToMs: 1000,
        summary: 'oldestuniq unique',
        keywords: [],
        entities: [],
        decisions: [],
      });
      db.insertSummaryShard({
        sessionId: 'sess_1',
        seqFrom: 3,
        seqTo: 4,
        createdAtFromMs: 2000,
        createdAtToMs: 2000,
        summary: 'newestuniq unique',
        keywords: [],
        entities: [],
        decisions: [],
      });

      expect(db.search({ query: 'oldestuniq', scope: { type: 'global' }, maxResults: 10 }).length).toBe(1);
      expect(db.search({ query: 'newestuniq', scope: { type: 'global' }, maxResults: 10 }).length).toBe(1);

      const deleted = db.deleteOldestSummaryShards({ limit: 1 });
      expect(deleted).toBe(1);

      expect(db.search({ query: 'oldestuniq', scope: { type: 'global' }, maxResults: 10 })).toEqual([]);
      expect(db.search({ query: 'newestuniq', scope: { type: 'global' }, maxResults: 10 }).length).toBe(1);

      db.checkpointAndVacuum();

      db.close();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('matches non-ASCII summaries instead of returning an empty result', async () => {
    const dir = await mkdtemp(join(os.tmpdir(), 'happier-memory-db-unicode-'));
    try {
      const dbPath = join(dir, 'memory.sqlite');
      const db = openSummaryShardIndexDb({ dbPath });
      db.init();

      db.insertSummaryShard({
        sessionId: 'sess_unicode',
        seqFrom: 1,
        seqTo: 2,
        createdAtFromMs: 1000,
        createdAtToMs: 1000,
        summary: 'Обсудили メモリ検索機能 и Καλημέρα déjà vu',
        keywords: ['поиск'],
        entities: [],
        decisions: [],
      });

      for (const query of ['Обсудили', 'поиск', '検索', 'Καλημέρα', 'déjà']) {
        const hits = db.search({ query, scope: { type: 'global' }, maxResults: 10 });
        expect(hits.map((hit) => hit.sessionId), query).toEqual(['sess_unicode']);
      }

      expect(db.search({ query: 'groceries', scope: { type: 'global' }, maxResults: 10 })).toEqual([]);

      db.close();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('rebuilds terms from the released schema-v2 source text while preserving shards and cursors', async () => {
    const dir = await mkdtemp(join(os.tmpdir(), 'happier-memory-db-migrate-'));
    try {
      const dbPath = join(dir, 'memory.sqlite');

      // Provenance-pinned to cli-v0.2.1 and
      // cli-v0.2.2-preview.1775586717.26498: both released this schema-v2
      // shape with ASCII-only term rows.
      const legacy = openSqliteDatabaseSync(dbPath);
      legacy.exec(`PRAGMA foreign_keys=ON;`);
      legacy.exec(`
        CREATE TABLE session_cursors (
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
      legacy.exec(`
        CREATE TABLE summary_shards (
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
      legacy.exec(`
        CREATE TABLE summary_terms (
          term TEXT NOT NULL,
          shardId INTEGER NOT NULL,
          PRIMARY KEY (term, shardId),
          FOREIGN KEY (shardId) REFERENCES summary_shards(shardId) ON DELETE CASCADE
        );
      `);
      legacy
        .prepare(`
          INSERT INTO summary_shards (
            shardId, sessionId, seqFrom, seqTo, createdAtFromMs, createdAtToMs,
            summary, keywordsText, entitiesText, decisionsText
          ) VALUES (1, 'sess_legacy', 1, 4, 1000, 2000, ?, '', '', '');
        `)
        .run('Обсудили メモリ検索 and legacyascii');
      legacy.prepare(`INSERT INTO summary_terms (term, shardId) VALUES ('legacyascii', 1);`).run();
      legacy
        .prepare(`
          INSERT INTO session_cursors (sessionId, lastObservedSeq, lastHintedSeq, lastDeepIndexedSeq, updatedAtMs)
          VALUES ('sess_legacy', 9, 7, 5, 1234);
        `)
        .run();
      legacy.exec('PRAGMA user_version=2');
      legacy.close();

      expect(
        openSqliteDatabaseSync(dbPath).prepare('PRAGMA user_version').get(),
      ).toMatchObject({ user_version: 2 });

      const db = openSummaryShardIndexDb({ dbPath });
      db.init();

      // Retained source text is re-tokenized, so previously unsearchable
      // non-ASCII content becomes searchable without a server refetch.
      expect(
        db.search({ query: 'Обсудили', scope: { type: 'global' }, maxResults: 10 }).map((hit) => hit.sessionId),
      ).toEqual(['sess_legacy']);
      expect(
        db.search({ query: '検索', scope: { type: 'global' }, maxResults: 10 }).map((hit) => hit.sessionId),
      ).toEqual(['sess_legacy']);
      expect(
        db.search({ query: 'legacyascii', scope: { type: 'global' }, maxResults: 10 }).map((hit) => hit.sessionId),
      ).toEqual(['sess_legacy']);

      // The shard row and the progress cursors survive the term rebuild.
      expect(db.getLatestShardSeqTo({ sessionId: 'sess_legacy' })).toBe(4);
      expect(db.getSessionCursors({ sessionId: 'sess_legacy', nowMs: 5000 })).toMatchObject({
        lastObservedSeq: 9,
        lastHintedSeq: 7,
        lastDeepIndexedSeq: 5,
      });

      db.close();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('keeps session cursors intact when budget eviction removes derived shards', async () => {
    const dir = await mkdtemp(join(os.tmpdir(), 'happier-memory-db-evict-cursors-'));
    try {
      const dbPath = join(dir, 'memory.sqlite');
      const db = openSummaryShardIndexDb({ dbPath });
      db.init();

      db.insertSummaryShard({
        sessionId: 'sess_1',
        seqFrom: 1,
        seqTo: 2,
        createdAtFromMs: 1000,
        createdAtToMs: 1000,
        summary: 'oldestuniq',
        keywords: [],
        entities: [],
        decisions: [],
      });
      db.markHintRunSuccess({ sessionId: 'sess_1', seqTo: 2, nowMs: 1000 });
      db.markDeepIndexSuccess({ sessionId: 'sess_1', seqTo: 2, nowMs: 1000 });

      expect(db.deleteOldestSummaryShards({ limit: 1 })).toBe(1);
      expect(countRows(dbPath, 'summary_terms')).toBe(0);

      expect(db.getSessionCursors({ sessionId: 'sess_1', nowMs: 2000 })).toMatchObject({
        lastHintedSeq: 2,
        lastDeepIndexedSeq: 2,
      });

      db.close();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
