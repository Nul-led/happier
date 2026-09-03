import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Credentials } from '@/persistence';
import { applyEnvValues, restoreEnvValues, snapshotEnvValues } from '@/testkit/env/envSnapshot';
import { createTempDir, removeTempDir } from '@/testkit/fs/tempDir';
import { openSqliteDatabaseSync } from '../persistence/sqliteSync';

type RemovalEvent = 'deleted' | 'revoked' | 'reset';

const CREDENTIALS: Credentials = {
  token: 't',
  encryption: { type: 'legacy', secret: new Uint8Array(32).fill(1) },
};

function createSource<T>() {
  const listeners = new Set<(change: T) => void | Promise<void>>();
  return {
    subscribe: (listener: (change: T) => void | Promise<void>) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    emit: async (change: T) => {
      for (const listener of listeners) await listener(change);
    },
  };
}

function countRows(dbPath: string, sql: string, ...bindings: unknown[]): number {
  const db = openSqliteDatabaseSync(dbPath);
  try {
    const row = db.prepare(sql).get(...(bindings as never[])) as { n?: unknown } | undefined;
    return Number(row?.n ?? 0);
  } finally {
    db.close();
  }
}

describe('memoryWorker retained removal while disabled', () => {
  const envBackup = snapshotEnvValues(['HAPPIER_HOME_DIR', 'HAPPIER_SERVER_URL', 'HAPPIER_WEBAPP_URL']);
  let homeDir: string | undefined;
  const startedWorkers = new Set<Readonly<{ stop: () => void }>>();

  beforeEach(async () => {
    homeDir = await createTempDir('happier-memory-disabled-removal-');
    applyEnvValues({
      HAPPIER_HOME_DIR: homeDir,
      HAPPIER_SERVER_URL: 'https://api.example.test',
      HAPPIER_WEBAPP_URL: 'https://app.example.test',
    });
    vi.resetModules();
  });

  afterEach(async () => {
    let cleanupError: unknown;
    for (const worker of startedWorkers) {
      try {
        worker.stop();
      } catch (error) {
        cleanupError ??= error;
      }
    }
    startedWorkers.clear();
    restoreEnvValues(envBackup);
    vi.doUnmock('@/session/transport/http/sessionsHttp');
    vi.resetModules();
    if (homeDir) {
      try {
        await removeTempDir(homeDir);
      } catch (error) {
        cleanupError ??= error;
      }
    }
    homeDir = undefined;
    if (cleanupError) throw cleanupError;
  });

  async function startSeededWorker() {
    vi.doMock('@/session/transport/http/sessionsHttp', () => ({
      fetchSessionsPage: vi.fn(async () => ({ sessions: [], nextCursor: null, hasNext: false })),
      fetchSessionById: vi.fn(async ({ sessionId }: { sessionId: string }) => (
        sessionId === 'kept' ? { id: sessionId } : null
      )),
    }));

    const { writeMemorySettingsToDisk } = await import('@/settings/memorySettings');
    await writeMemorySettingsToDisk({
      v: 1,
      enabled: true,
      indexMode: 'deep',
      deleteOnDisable: false,
    });

    const { startMemoryWorker } = await import('./memoryWorker');
    const worker = await startMemoryWorker({
      credentials: CREDENTIALS,
      machineId: 'machine_1',
      deps: {
        fetchDecryptedTranscriptPageAfterSeq: async () => [],
        fetchCommittedSummaryShards: async () => [],
      },
    });
    startedWorkers.add(worker);

    const tier1DbPath = worker.getTier1DbPath()!;
    const deepDbPath = worker.getDeepDbPath()!;
    const { openSummaryShardIndexDb } = await import('./summaryShardIndexDb');
    const { openDeepIndexDb } = await import('./deepIndex/deepIndexDb');
    const tier1 = openSummaryShardIndexDb({ dbPath: tier1DbPath });
    const deep = openDeepIndexDb({ dbPath: deepDbPath });
    for (const sessionId of ['gone', 'kept']) {
      tier1.insertSummaryShard({
        sessionId,
        seqFrom: 1,
        seqTo: 2,
        createdAtFromMs: 1,
        createdAtToMs: 2,
        summary: `retained memory marker for ${sessionId}`,
        keywords: ['retained', 'memory', 'marker'],
        entities: [],
        decisions: [],
      });
      tier1.markHintRunSuccess({ sessionId, seqTo: 2, nowMs: 3 });
      tier1.recordMemorySessionIndexState({
        sessionId,
        status: 'indexed',
        selectedByBackfillPolicy: 'all_history',
        updatedAtMs: 3,
      });
      deep.insertChunk({
        sessionId,
        seqFrom: 1,
        seqTo: 2,
        createdAtFromMs: 1,
        createdAtToMs: 2,
        text: `retained memory marker for ${sessionId}`,
      });
      deep.upsertEmbedding({
        sessionId,
        seqFrom: 1,
        seqTo: 2,
        provider: 'local_transformers',
        modelId: 'model',
        embedding: new Float32Array([0.1, 0.2]),
        updatedAtMs: 3,
      });
    }
    tier1.close();
    deep.close();

    return { worker, tier1DbPath, deepDbPath, writeMemorySettingsToDisk };
  }

  async function runDisabledRemoval(event: RemovalEvent): Promise<void> {
    const { worker, tier1DbPath, deepDbPath, writeMemorySettingsToDisk } = await startSeededWorker();
    await writeMemorySettingsToDisk({
      v: 1,
      enabled: false,
      indexMode: 'deep',
      deleteOnDisable: false,
    });
    await worker.reloadSettings();
    expect(worker.getTier1DbPath()).toBeNull();
    expect(worker.getDeepDbPath()).toBeNull();

    const deleted = createSource<{ sessionId: string }>();
    const revoked = createSource<{ sessionId: string }>();
    const reset = createSource<{ cursor: number }>();
    const archived = createSource<{ sessionId: string; archived: boolean }>();
    const { subscribeMemorySessionRemoval } = await import('./subscribeMemorySessionRemoval');
    const dispose = subscribeMemorySessionRemoval({
      memoryWorker: worker,
      onSessionDeletedChange: deleted.subscribe,
      onSessionAccessRevoked: revoked.subscribe,
      onSessionAccessReset: reset.subscribe,
      onSessionArchivedStateChange: archived.subscribe,
    });

    if (event === 'deleted') await deleted.emit({ sessionId: 'gone' });
    if (event === 'revoked') await revoked.emit({ sessionId: 'gone' });
    if (event === 'reset') await reset.emit({ cursor: 7 });

    // Event completion is the custody boundary: retained disk state must
    // already be purged before the source is allowed to acknowledge it.
    const { openSummaryShardIndexDb } = await import('./summaryShardIndexDb');
    const { openDeepIndexDb } = await import('./deepIndex/deepIndexDb');
    const disabledTier1 = openSummaryShardIndexDb({ dbPath: tier1DbPath });
    const disabledDeep = openDeepIndexDb({ dbPath: deepDbPath });
    expect(disabledTier1.listIndexedSessionIds()).toEqual(['kept']);
    expect(disabledDeep.listIndexedSessionIds()).toEqual(['kept']);
    disabledTier1.close();
    disabledDeep.close();
    expect(countRows(tier1DbPath, 'SELECT COUNT(*) AS n FROM session_cursors WHERE sessionId = ?;', 'gone')).toBe(0);
    expect(countRows(tier1DbPath, 'SELECT COUNT(*) AS n FROM memory_session_index_state WHERE sessionId = ?;', 'gone')).toBe(0);
    expect(countRows(tier1DbPath, 'SELECT COUNT(*) AS n FROM summary_terms;')).toBe(
      countRows(tier1DbPath, 'SELECT COUNT(*) AS n FROM summary_terms t JOIN summary_shards s ON s.shardId = t.shardId;'),
    );
    expect(countRows(deepDbPath, 'SELECT COUNT(*) AS n FROM message_chunks WHERE sessionId = ?;', 'gone')).toBe(0);
    expect(countRows(deepDbPath, 'SELECT COUNT(*) AS n FROM chunk_embeddings WHERE sessionId = ?;', 'gone')).toBe(0);
    expect(countRows(deepDbPath, 'SELECT COUNT(*) AS n FROM chunk_terms;')).toBe(
      countRows(deepDbPath, 'SELECT COUNT(*) AS n FROM chunk_terms t JOIN message_chunks c ON c.chunkId = t.chunkId;'),
    );

    await writeMemorySettingsToDisk({
      v: 1,
      enabled: true,
      indexMode: 'deep',
      deleteOnDisable: false,
    });
    await worker.reloadSettings();

    const { searchTier1Memory, searchTier2Memory } = await import('./searchMemory');
    const query = {
      v: 1 as const,
      query: 'retained',
      scope: { type: 'global' as const },
      mode: 'auto' as const,
      maxResults: 10,
    };
    const tier1Result = searchTier1Memory({ dbPath: tier1DbPath, query });
    const deepResult = await searchTier2Memory({ dbPath: deepDbPath, query, previewChars: 200 });
    expect(tier1Result.ok && tier1Result.hits.map((hit) => hit.sessionId)).toEqual(['kept']);
    expect(deepResult.ok && deepResult.hits.map((hit) => hit.sessionId)).toEqual(['kept']);
    dispose();
  }

  it('purges a deleted Session while memory is disabled before search can be re-enabled', async () => {
    await runDisabledRemoval('deleted');
  });

  it('purges an access-revoked Session while memory is disabled before search can be re-enabled', async () => {
    await runDisabledRemoval('revoked');
  });

  it('reconciles retained Session access on cursor reset while memory is disabled', async () => {
    await runDisabledRemoval('reset');
  });
});
