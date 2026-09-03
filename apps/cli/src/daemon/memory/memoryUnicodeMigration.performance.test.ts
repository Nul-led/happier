import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { openSqliteDatabaseSync } from '../persistence/sqliteSync';
import { openDeepIndexDb } from './deepIndex/deepIndexDb';
import { openSummaryShardIndexDb } from './summaryShardIndexDb';

const REPRESENTATIVE_ROW_COUNT = 25_000;

async function fileBytes(path: string): Promise<number> {
  const entries = await Promise.all([path, `${path}-wal`, `${path}-shm`].map(async (candidate) => {
    try { return await stat(candidate); } catch { return null; }
  }));
  return entries.reduce((total, entry) => total + (entry?.size ?? 0), 0);
}

describe('daemon memory Unicode migration performance', () => {
  it.skipIf(process.env.HAPPIER_RUN_MEMORY_MIGRATION_PERFORMANCE !== '1')('measures retained-source term rebuilds for 25,000 rows per tier', async () => {
    const root = await mkdtemp(join(tmpdir(), 'happier-memory-unicode-performance-'));
    try {
      const summaryPath = join(root, 'memory.sqlite');
      openSummaryShardIndexDb({ dbPath: summaryPath }).close();
      const summaryLegacy = openSqliteDatabaseSync(summaryPath);
      const insertSummary = summaryLegacy.prepare(`
        INSERT INTO summary_shards (
          sessionId, seqFrom, seqTo, createdAtFromMs, createdAtToMs,
          summary, keywordsText, entitiesText, decisionsText
        ) VALUES (?, ?, ?, ?, ?, ?, ?, '', '');
      `);
      const insertSummaryTerm = summaryLegacy.prepare(`INSERT INTO summary_terms (term, shardId) VALUES ('legacyascii', ?);`);
      summaryLegacy.exec('BEGIN IMMEDIATE');
      for (let index = 0; index < REPRESENTATIVE_ROW_COUNT; index += 1) {
        const result = insertSummary.run(
          `s-${index % 100}`,
          index,
          index,
          index,
          index,
          `Architecture review ${index}: Unicode search 搜索 поиск and identifier session_handoff.`,
          'legacyascii',
        ) as { lastInsertRowid?: number | bigint };
        insertSummaryTerm.run(Number(result.lastInsertRowid));
      }
      summaryLegacy.exec('PRAGMA user_version=3; COMMIT;');
      summaryLegacy.close();

      const summaryStartedAt = performance.now();
      const summary = openSummaryShardIndexDb({ dbPath: summaryPath });
      const summaryElapsedMs = performance.now() - summaryStartedAt;
      expect(summary.getSummaryIndexStats().lightShardCount).toBe(REPRESENTATIVE_ROW_COUNT);
      expect(summary.search({ query: '搜索', scope: { type: 'global' }, maxResults: 1 })).toHaveLength(1);
      summary.close();

      const deepPath = join(root, 'deep.sqlite');
      openDeepIndexDb({ dbPath: deepPath }).close();
      const deepLegacy = openSqliteDatabaseSync(deepPath);
      const insertChunk = deepLegacy.prepare(`
        INSERT INTO message_chunks (
          sessionId, seqFrom, seqTo, createdAtFromMs, createdAtToMs, text
        ) VALUES (?, ?, ?, ?, ?, ?);
      `);
      const insertChunkTerm = deepLegacy.prepare(`INSERT INTO chunk_terms (term, chunkId) VALUES ('legacyascii', ?);`);
      deepLegacy.exec('BEGIN IMMEDIATE');
      for (let index = 0; index < REPRESENTATIVE_ROW_COUNT; index += 1) {
        const result = insertChunk.run(
          `s-${index % 100}`,
          index,
          index,
          index,
          index,
          `Transcript chunk ${index}: Unicode search 搜索 поиск and identifier session_handoff.`,
        ) as { lastInsertRowid?: number | bigint };
        insertChunkTerm.run(Number(result.lastInsertRowid));
      }
      deepLegacy.exec('PRAGMA user_version=1; COMMIT;');
      deepLegacy.close();

      const deepStartedAt = performance.now();
      const deep = openDeepIndexDb({ dbPath: deepPath });
      const deepElapsedMs = performance.now() - deepStartedAt;
      expect(deep.getDeepIndexStats().deepChunkCount).toBe(REPRESENTATIVE_ROW_COUNT);
      expect(deep.search({ query: '搜索', scope: { type: 'global' }, maxResults: 1 })).toHaveLength(1);
      deep.close();

      console.info(JSON.stringify({
        benchmark: 'daemon-memory-unicode-retained-source-migration',
        rowsPerTier: REPRESENTATIVE_ROW_COUNT,
        summaryElapsedMs: Math.round(summaryElapsedMs),
        summaryDatabaseBytes: await fileBytes(summaryPath),
        deepElapsedMs: Math.round(deepElapsedMs),
        deepDatabaseBytes: await fileBytes(deepPath),
      }));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 120_000);
});
