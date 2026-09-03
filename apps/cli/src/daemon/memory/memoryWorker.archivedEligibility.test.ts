import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { applyEnvValues, restoreEnvValues, snapshotEnvValues } from '@/testkit/env/envSnapshot';
import { createDeferred } from '@/testkit/async/deferred';
import { createTempDir, removeTempDir } from '@/testkit/fs/tempDir';
import type { Credentials } from '@/persistence';

type SessionsPageArgs = Readonly<{ activeOnly?: boolean; archivedOnly?: boolean; cursor?: string; limit?: number }>;

const CREDENTIALS: Credentials = {
  token: 't',
  encryption: { type: 'legacy', secret: new Uint8Array(32).fill(1) },
};

function sessionRow(id: string, extra: Record<string, unknown> = {}) {
  return { id, seq: 1, createdAt: 1_000, updatedAt: 9_000, activeAt: 0, ...extra };
}

describe('memoryWorker archived eligibility and derived-index removal', () => {
  const envBackup = snapshotEnvValues(['HAPPIER_HOME_DIR', 'HAPPIER_SERVER_URL', 'HAPPIER_WEBAPP_URL']);
  let homeDir: string | undefined;
  let argvBackup: string[] = [];
  const startedWorkers = new Set<Readonly<{ stop: () => void | Promise<void> }>>();

  beforeEach(async () => {
    homeDir = await createTempDir('happier-memory-archived-');
    applyEnvValues({
      HAPPIER_HOME_DIR: homeDir,
      HAPPIER_SERVER_URL: 'https://api.example.test',
      HAPPIER_WEBAPP_URL: 'https://app.example.test',
    });
    argvBackup = process.argv.slice();
    process.argv = ['node', 'happier', 'daemon', 'start-sync'];
    vi.resetModules();
    vi.doMock('./transcript/fetchSemanticPage', () => ({
      fetchMemorySemanticTranscriptPage: vi.fn(async () => ({
        items: [],
        hasMore: false,
        nextCursor: null,
      })),
    }));
  });

  afterEach(async () => {
    let cleanupError: unknown;
    for (const worker of startedWorkers) {
      try {
        await worker.stop();
      } catch (error) {
        cleanupError ??= error;
      }
    }
    startedWorkers.clear();
    process.argv = argvBackup;
    restoreEnvValues(envBackup);
    vi.doUnmock('@/configuration');
    vi.doUnmock('@/session/transport/http/sessionsHttp');
    vi.doUnmock('@/session/systemRecords/memory/fetchMemorySystemRecords');
    vi.doUnmock('./transcript/fetchSemanticPage');
    vi.resetModules();
    vi.useRealTimers();
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

  function mockDaemonProcess(): void {
    vi.doMock('@/configuration', async () => {
      const actual = await vi.importActual<typeof import('@/configuration')>('@/configuration');
      return {
        ...actual,
        configuration: { ...actual.configuration, isDaemonProcess: true },
      };
    });
  }

  function mockSessionsHttp(handler: (args: SessionsPageArgs) => {
    sessions: Array<Record<string, unknown>>;
    nextCursor: string | null;
    hasNext: boolean;
  }) {
    const calls: SessionsPageArgs[] = [];
    const fetchSessionsPage = vi.fn(async (args: SessionsPageArgs) => {
      calls.push(args);
      return handler(args);
    });
    vi.doMock('@/session/transport/http/sessionsHttp', () => ({
      fetchSessionsPage,
      fetchSessionById: vi.fn(async () => ({})),
    }));
    return { calls, fetchSessionsPage };
  }

  async function startWorker(
    settings: Record<string, unknown>,
    deps: Readonly<{
      fetchDecryptedTranscriptPageAfterSeq?: (args: Readonly<{
        sessionId: string;
        afterSeq: number;
        limit: number;
      }>) => Promise<Array<{
        seq: number;
        createdAtMs: number;
        role: 'user' | 'agent';
        content: { type: 'text'; text: string };
        meta?: null;
      }>>;
      fetchCommittedSummaryShards?: (sessionId: string) => Promise<[]>;
    }> = {},
  ) {
    const { writeMemorySettingsToDisk } = await import('@/settings/memorySettings');
    await writeMemorySettingsToDisk({
      v: 1,
      enabled: true,
      indexMode: 'hints',
      worker: {
        tickIntervalMs: 500,
        inventoryRefreshIntervalMs: 5_000,
        maxSessionsPerTick: 1,
        sessionListPageLimit: 10,
      },
      ...settings,
    });
    const { startMemoryWorker } = await import('./memoryWorker');
    const worker = await startMemoryWorker({
      credentials: CREDENTIALS,
      machineId: 'machine_1',
      deps: {
        fetchDecryptedTranscriptPageAfterSeq:
          deps.fetchDecryptedTranscriptPageAfterSeq ?? (async () => []),
        fetchCommittedSummaryShards:
          deps.fetchCommittedSummaryShards ?? (async () => []),
      },
    });
    startedWorkers.add(worker);
    return worker;
  }

  async function seedIndexedSession(tier1DbPath: string, sessionId: string): Promise<void> {
    const { openSummaryShardIndexDb } = await import('./summaryShardIndexDb');
    const db = openSummaryShardIndexDb({ dbPath: tier1DbPath });
    db.insertSummaryShard({
      sessionId,
      seqFrom: 1,
      seqTo: 2,
      createdAtFromMs: 1,
      createdAtToMs: 2,
      summary: 'transcript about migrations',
      keywords: ['migrations'],
      entities: [],
      decisions: [],
    });
    db.close();
  }

  async function listIndexedSessionIds(tier1DbPath: string): Promise<string[]> {
    const { openSummaryShardIndexDb } = await import('./summaryShardIndexDb');
    const db = openSummaryShardIndexDb({ dbPath: tier1DbPath });
    try {
      return [...db.listIndexedSessionIds()];
    } finally {
      db.close();
    }
  }

  async function searchIndexedSessionIds(tier1DbPath: string): Promise<string[]> {
    const { openSummaryShardIndexDb } = await import('./summaryShardIndexDb');
    const db = openSummaryShardIndexDb({ dbPath: tier1DbPath });
    try {
      return db.search({ query: 'migrations', scope: { type: 'global' }, maxResults: 10 })
        .map((hit) => hit.sessionId);
    } finally {
      db.close();
    }
  }

  it('never requests the archived inventory under new_only while archived eligibility is off', async () => {
    vi.useFakeTimers();
    mockDaemonProcess();
    const { calls } = mockSessionsHttp(() => ({ sessions: [sessionRow('s1')], nextCursor: null, hasNext: false }));

    const worker = await startWorker({ backfillPolicy: 'new_only' });
    await vi.advanceTimersByTimeAsync(6_000);

    expect(calls.length).toBeGreaterThan(0);
    expect(calls.some((call) => call.archivedOnly === true)).toBe(false);
    await vi.waitFor(() => {
      expect(worker.getWorkerStatus()).toMatchObject({ state: 'idle', currentPhase: null });
    });
    worker.stop();
  });

  it('reports a background indexing failure instead of remaining indexing', async () => {
    vi.useFakeTimers();
    mockDaemonProcess();
    mockSessionsHttp(() => ({ sessions: [sessionRow('failing-index')], nextCursor: null, hasNext: false }));
    vi.doMock('./transcript/fetchSemanticPage', () => ({
      fetchMemorySemanticTranscriptPage: vi.fn(async () => {
        throw new Error('background_index_failed');
      }),
    }));

    const worker = await startWorker({ backfillPolicy: 'all_history' });
    await vi.advanceTimersByTimeAsync(500);

    await vi.waitFor(() => {
      expect(worker.getWorkerStatus()).toMatchObject({ state: 'error', currentPhase: null });
    });
  });

  it('enforces disk budgets even when inventory has no indexing candidates', async () => {
    vi.useFakeTimers();
    mockDaemonProcess();
    mockSessionsHttp(() => ({ sessions: [], nextCursor: null, hasNext: false }));
    const worker = await startWorker({});
    const tier1DbPath = worker.getTier1DbPath()!;
    const { openSummaryShardIndexDb } = await import('./summaryShardIndexDb');
    const budgetSeed = openSummaryShardIndexDb({ dbPath: tier1DbPath });
    budgetSeed.insertSummaryShard({
      sessionId: 'budget-only',
      seqFrom: 1,
      seqTo: 1,
      createdAtFromMs: 1,
      createdAtToMs: 1,
      summary: 'x'.repeat(2 * 1024 * 1024),
      keywords: [],
      entities: [],
      decisions: [],
    });
    budgetSeed.checkpointAndVacuum();
    budgetSeed.close();
    const { writeMemorySettingsToDisk } = await import('@/settings/memorySettings');
    await writeMemorySettingsToDisk({
      v: 1,
      enabled: true,
      indexMode: 'hints',
      budgets: { maxDiskMbLight: 1, maxDiskMbDeep: 1 },
    });
    await worker.reloadSettings();

    await vi.advanceTimersByTimeAsync(1_000);
    const stopPromise = worker.stop();
    await vi.runAllTimersAsync();
    await stopPromise;

    expect(await listIndexedSessionIds(tier1DbPath)).toEqual([]);
  });

  it('never requests the archived inventory under all_history while archived eligibility is off', async () => {
    vi.useFakeTimers();
    mockDaemonProcess();
    const { calls } = mockSessionsHttp(() => ({ sessions: [sessionRow('s1')], nextCursor: null, hasNext: false }));

    const worker = await startWorker({ backfillPolicy: 'all_history' });
    await vi.advanceTimersByTimeAsync(6_000);

    expect(calls.length).toBeGreaterThan(0);
    expect(calls.some((call) => call.archivedOnly === true)).toBe(false);
    worker.stop();
  });

  it('pages the archived inventory under new_only when archived eligibility is on', async () => {
    vi.useFakeTimers();
    mockDaemonProcess();
    const { calls } = mockSessionsHttp((args) => ({
      sessions: args.archivedOnly ? [sessionRow('archived_1')] : [sessionRow('s1')],
      nextCursor: null,
      hasNext: false,
    }));

    const worker = await startWorker({ backfillPolicy: 'new_only', includeArchivedSessions: true });
    await vi.advanceTimersByTimeAsync(6_000);

    expect(calls.some((call) => call.archivedOnly === true)).toBe(true);
    worker.stop();
  });

  it('pages the archived inventory under all_history when archived eligibility is on', async () => {
    vi.useFakeTimers();
    mockDaemonProcess();
    const { calls } = mockSessionsHttp((args) => ({
      sessions: args.archivedOnly ? [sessionRow('archived_1')] : [sessionRow('s1')],
      nextCursor: null,
      hasNext: false,
    }));

    const worker = await startWorker({ backfillPolicy: 'all_history', includeArchivedSessions: true });
    await vi.advanceTimersByTimeAsync(6_000);

    expect(calls.some((call) => call.archivedOnly === true)).toBe(true);
    worker.stop();
  });

  it('reports the archived eligibility this daemon actually applies', async () => {
    mockSessionsHttp(() => ({ sessions: [], nextCursor: null, hasNext: false }));
    const worker = await startWorker({ includeArchivedSessions: true });
    expect(worker.getSettings().includeArchivedSessions).toBe(true);
    worker.stop();
  });

  it('purges derived index rows and worker state for a removed session', async () => {
    mockSessionsHttp(() => ({ sessions: [], nextCursor: null, hasNext: false }));
    const worker = await startWorker({});
    const tier1DbPath = worker.getTier1DbPath()!;
    await seedIndexedSession(tier1DbPath, 'removal_gone');
    await seedIndexedSession(tier1DbPath, 'removal_kept');
    expect(await searchIndexedSessionIds(tier1DbPath)).toContain('removal_gone');

    await worker.removeSessions(['removal_gone']);

    const after = await searchIndexedSessionIds(tier1DbPath);
    expect(after).not.toContain('removal_gone');
    expect(after).toContain('removal_kept');
    worker.stop();
  });

  it('purges a session that becomes archived while archived eligibility is off', async () => {
    mockSessionsHttp(() => ({ sessions: [], nextCursor: null, hasNext: false }));
    const worker = await startWorker({ includeArchivedSessions: false });
    const tier1DbPath = worker.getTier1DbPath()!;
    await seedIndexedSession(tier1DbPath, 'archived_off');
    expect(await searchIndexedSessionIds(tier1DbPath)).toContain('archived_off');

    await worker.applySessionArchivedState({ sessionId: 'archived_off', archived: true });

    expect(await searchIndexedSessionIds(tier1DbPath)).not.toContain('archived_off');
    worker.stop();
  });

  it('retains a session that becomes archived while archived eligibility is on', async () => {
    mockSessionsHttp(() => ({ sessions: [], nextCursor: null, hasNext: false }));
    const worker = await startWorker({ includeArchivedSessions: true });
    const tier1DbPath = worker.getTier1DbPath()!;
    await seedIndexedSession(tier1DbPath, 'archived_on');

    await worker.applySessionArchivedState({ sessionId: 'archived_on', archived: true });

    expect(await searchIndexedSessionIds(tier1DbPath)).toContain('archived_on');
    worker.stop();
  });

  it('reconciles missed archive events for indexed sessions when archived eligibility is off', async () => {
    mockSessionsHttp((args) => ({
      sessions: args.archivedOnly ? [sessionRow('stale_archived')] : [],
      nextCursor: null,
      hasNext: false,
    }));
    const worker = await startWorker({});
    const tier1DbPath = worker.getTier1DbPath()!;
    await seedIndexedSession(tier1DbPath, 'stale_archived');
    await seedIndexedSession(tier1DbPath, 'still_active');
    expect(await searchIndexedSessionIds(tier1DbPath)).toContain('stale_archived');

    await worker.reloadSettings();

    const after = await searchIndexedSessionIds(tier1DbPath);
    expect(after).not.toContain('stale_archived');
    expect(after).toContain('still_active');
    worker.stop();
  });

  it('reconciles the whole retained indexed set, including archived pages far past the listing head', async () => {
    // One Session per page, with the stale archived row deep in the listing:
    // the retained indexed set is what must be covered, not a fixed number of
    // server pages.
    const archivedIds = Array.from({ length: 40 }, (_, index) => `arch_${index + 1}`);
    mockSessionsHttp((args) => {
      if (!args.archivedOnly) return { sessions: [], nextCursor: null, hasNext: false };
      const index = args.cursor ? Number(args.cursor) : 0;
      const id = archivedIds[index];
      const next = index + 1;
      return {
        sessions: id ? [sessionRow(id)] : [],
        nextCursor: next < archivedIds.length ? String(next) : null,
        hasNext: next < archivedIds.length,
      };
    });
    const worker = await startWorker({
      worker: {
        tickIntervalMs: 500,
        inventoryRefreshIntervalMs: 5_000,
        maxSessionsPerTick: 1,
        sessionListPageLimit: 1,
      },
    });
    const tier1DbPath = worker.getTier1DbPath()!;
    await seedIndexedSession(tier1DbPath, 'arch_31');
    await seedIndexedSession(tier1DbPath, 'still_active');

    await worker.reloadSettings();

    const after = await searchIndexedSessionIds(tier1DbPath);
    expect(after).not.toContain('arch_31');
    expect(after).toContain('still_active');
    expect(worker.getSettings().includeArchivedSessions).toBe(false);
    worker.stop();
  });

  it('keeps reporting archived-inclusive eligibility until the exclusion reconciliation succeeds', async () => {
    vi.useFakeTimers();
    mockDaemonProcess();
    let archivedListingFails = true;
    mockSessionsHttp((args) => {
      if (!args.archivedOnly) return { sessions: [], nextCursor: null, hasNext: false };
      if (archivedListingFails) throw new Error('transient_archived_listing_failure');
      return { sessions: [sessionRow('stale_archived')], nextCursor: null, hasNext: false };
    });
    const worker = await startWorker({});
    const tier1DbPath = worker.getTier1DbPath()!;
    await seedIndexedSession(tier1DbPath, 'stale_archived');

    await worker.reloadSettings();

    // The archived rows are still searchable, so the daemon must not advertise
    // that it applies the exclusion yet.
    expect(worker.getSettings().includeArchivedSessions).toBe(true);
    expect(await searchIndexedSessionIds(tier1DbPath)).toContain('stale_archived');

    archivedListingFails = false;
    await vi.advanceTimersByTimeAsync(6_000);

    expect(worker.getSettings().includeArchivedSessions).toBe(false);
    expect(await searchIndexedSessionIds(tier1DbPath)).not.toContain('stale_archived');
    worker.stop();
  });

  it('forgets the cached Session crypto context of a removed session', async () => {
    const fetchSessionById = vi.fn(async () => ({
      id: 'crypto_session',
      seq: 0,
      createdAt: Number.MAX_SAFE_INTEGER,
      archivedAt: null,
    }));
    const fetchSessionsPage = vi.fn(async () => ({ sessions: [], nextCursor: null, hasNext: false }));
    vi.doMock('@/session/transport/http/sessionsHttp', () => ({ fetchSessionsPage, fetchSessionById }));
    vi.doMock('@/session/systemRecords/memory/fetchMemorySystemRecords', () => ({
      fetchMemorySummaryShardSystemRecords: vi.fn(async () => []),
    }));
    vi.doMock('./transcript/fetchSemanticPage', () => ({
      fetchMemorySemanticTranscriptPage: vi.fn(async () => ({
        items: [],
        hasMore: false,
        nextCursor: null,
      })),
    }));

    const worker = await startWorker({});
    await worker.ensureUpToDate('crypto_session');
    await worker.ensureUpToDate('crypto_session');
    // Each explicit daemon refresh reads current Session metadata for the
    // new-only eligibility decision. The crypto context itself is cached, so
    // the first refresh performs one additional read and the second does not.
    expect(fetchSessionById).toHaveBeenCalledTimes(3);

    await worker.removeSessions(['crypto_session']);
    await worker.ensureUpToDate('crypto_session');

    // Removal invalidates only the crypto-context read; the next explicit
    // refresh therefore performs its ordinary eligibility read plus one new
    // context read.
    expect(fetchSessionById).toHaveBeenCalledTimes(5);
    worker.stop();
  });

  it('lists the Session identities the derived index still retains', async () => {
    mockSessionsHttp(() => ({ sessions: [], nextCursor: null, hasNext: false }));
    const worker = await startWorker({});
    const tier1DbPath = worker.getTier1DbPath()!;
    await worker.removeSessions(worker.listIndexedSessionIds());
    await seedIndexedSession(tier1DbPath, 'retained_1');
    await seedIndexedSession(tier1DbPath, 'retained_2');

    expect([...worker.listIndexedSessionIds()].sort()).toEqual(['retained_1', 'retained_2']);

    await worker.removeSessions(['retained_1']);
    expect([...worker.listIndexedSessionIds()]).toEqual(['retained_2']);
    worker.stop();
  });

  it('includes deep-only rows in retained access reconciliation', async () => {
    const fetchSessionById = vi.fn(async ({ sessionId }: { sessionId: string }) => (
      sessionId === 'deep-kept' ? { id: sessionId } : null
    ));
    vi.doMock('@/session/transport/http/sessionsHttp', () => ({
      fetchSessionsPage: vi.fn(async () => ({ sessions: [], nextCursor: null, hasNext: false })),
      fetchSessionById,
    }));
    const worker = await startWorker({ indexMode: 'deep' });
    const { openDeepIndexDb } = await import('./deepIndex/deepIndexDb');
    const deepDb = openDeepIndexDb({ dbPath: worker.getDeepDbPath()! });
    for (const sessionId of ['deep-kept', 'deep-revoked']) {
      deepDb.insertChunk({
        sessionId,
        seqFrom: 1,
        seqTo: 1,
        createdAtFromMs: 1,
        createdAtToMs: 1,
        text: `retained ${sessionId}`,
      });
    }
    deepDb.close();

    expect([...worker.listIndexedSessionIds()].sort()).toEqual(['deep-kept', 'deep-revoked']);
    await worker.reconcileRetainedSessionAccess();
    expect([...worker.listIndexedSessionIds()]).toEqual(['deep-kept']);
    expect(fetchSessionById.mock.calls.map(([input]) => input.sessionId).sort()).toEqual([
      'deep-kept',
      'deep-revoked',
    ]);
    worker.stop();
  });

  it('waits for in-flight indexing before purging a removed Session', async () => {
    const transcriptRelease = createDeferred();
    const transcriptStarted = createDeferred();
    vi.doMock('@/session/transport/http/sessionsHttp', () => ({
      fetchSessionsPage: vi.fn(async () => ({ sessions: [], nextCursor: null, hasNext: false })),
      fetchSessionById: vi.fn(async () => sessionRow('removed-in-flight', { archivedAt: null })),
    }));
    const worker = await startWorker(
      { indexMode: 'deep', backfillPolicy: 'all_history' },
      {
        fetchDecryptedTranscriptPageAfterSeq: async () => {
          transcriptStarted.resolve();
          await transcriptRelease.promise;
          return [{
            seq: 1,
            createdAtMs: 1,
            role: 'user' as const,
            content: { type: 'text' as const, text: 'must not survive removal' },
            meta: null,
          }];
        },
      },
    );

    const indexing = worker.ensureUpToDate('removed-in-flight');
    await transcriptStarted.promise;
    let removalSettled = false;
    const removal = worker.removeSessions(['removed-in-flight']).then(() => {
      removalSettled = true;
    });
    await Promise.resolve();
    const removalSettledBeforeRelease = removalSettled;

    transcriptRelease.resolve();
    await Promise.all([indexing, removal]);

    expect(removalSettledBeforeRelease).toBe(false);
    expect(worker.listIndexedSessionIds()).not.toContain('removed-in-flight');
    await worker.stop();
  });

  it('does not let explicit ensureUpToDate bypass archived opt-in', async () => {
    const fetchTranscript = vi.fn(async () => [{
      seq: 1,
      createdAtMs: 1,
      role: 'user' as const,
      content: { type: 'text' as const, text: 'archived explicit history' },
      meta: null,
    }]);
    vi.doMock('@/session/transport/http/sessionsHttp', () => ({
      fetchSessionsPage: vi.fn(async () => ({ sessions: [], nextCursor: null, hasNext: false })),
      fetchSessionById: vi.fn(async () => sessionRow('archived-explicit', { archivedAt: 9_000 })),
    }));
    const worker = await startWorker(
      { indexMode: 'deep', includeArchivedSessions: false },
      { fetchDecryptedTranscriptPageAfterSeq: fetchTranscript },
    );

    await worker.ensureUpToDate('archived-explicit');

    expect(fetchTranscript).not.toHaveBeenCalled();
    expect(worker.listIndexedSessionIds()).not.toContain('archived-explicit');
    worker.stop();
  });

  it('seeds new_only progress before deep work for pre-enablement Sessions', async () => {
    const rows = [
      {
        seq: 1,
        createdAtMs: 1,
        role: 'user' as const,
        content: { type: 'text' as const, text: 'old history must stay excluded' },
        meta: null,
      },
    ];
    const fetchTranscript = vi.fn(async ({ afterSeq }: { afterSeq: number }) =>
      rows.filter((row) => row.seq > afterSeq));
    vi.doMock('@/session/transport/http/sessionsHttp', () => ({
      fetchSessionsPage: vi.fn(async () => ({ sessions: [], nextCursor: null, hasNext: false })),
      fetchSessionById: vi.fn(async () => sessionRow('old-explicit', {
        seq: 1,
        createdAt: 1,
        archivedAt: null,
      })),
    }));
    const worker = await startWorker(
      { indexMode: 'deep', backfillPolicy: 'new_only', enabledAtMs: 5_000 },
      { fetchDecryptedTranscriptPageAfterSeq: fetchTranscript },
    );

    await worker.ensureUpToDate('old-explicit');
    expect(fetchTranscript).toHaveBeenCalledWith(expect.objectContaining({ afterSeq: 1 }));

    rows.push({
      seq: 2,
      createdAtMs: 6_000,
      role: 'user',
      content: { type: 'text', text: 'new follow-up remains discoverable' },
      meta: null,
    });
    await worker.ensureUpToDate('old-explicit');

    const { openDeepIndexDb } = await import('./deepIndex/deepIndexDb');
    const db = openDeepIndexDb({ dbPath: worker.getDeepDbPath()! });
    expect(db.search({ query: 'history', scope: { type: 'global' }, maxResults: 10 })).toEqual([]);
    expect(db.search({ query: 'follow-up', scope: { type: 'global' }, maxResults: 10 })
      .map((hit) => hit.sessionId)).toEqual(['old-explicit']);
    db.close();
    worker.stop();
  });

  it('preserves new_only allowInitialBackfill semantics in bulk ensureUpToDate', async () => {
    const afterSeqBySession = new Map<string, number>();
    vi.doMock('@/session/transport/http/sessionsHttp', () => ({
      fetchSessionsPage: vi.fn(async ({ archivedOnly }: SessionsPageArgs) => ({
        sessions: archivedOnly
          ? []
          : [
              sessionRow('old-bulk', { seq: 8, createdAt: 1, archivedAt: null }),
              sessionRow('new-bulk', { seq: 2, createdAt: 6_000, archivedAt: null }),
            ],
        nextCursor: null,
        hasNext: false,
      })),
      fetchSessionById: vi.fn(async ({ sessionId }: { sessionId: string }) => ({
        id: sessionId,
        archivedAt: null,
      })),
    }));
    const worker = await startWorker(
      { indexMode: 'deep', backfillPolicy: 'new_only', enabledAtMs: 5_000 },
      {
        fetchDecryptedTranscriptPageAfterSeq: async ({ sessionId, afterSeq }) => {
          afterSeqBySession.set(sessionId, afterSeq);
          return [];
        },
      },
    );

    await worker.ensureUpToDate();

    expect(afterSeqBySession).toEqual(new Map([
      ['old-bulk', 8],
      ['new-bulk', 0],
    ]));
    worker.stop();
  });

  it('does not request the archived inventory for reconciliation when nothing is indexed', async () => {
    const { calls } = mockSessionsHttp(() => ({ sessions: [], nextCursor: null, hasNext: false }));
    const worker = await startWorker({});
    await worker.removeSessions(await listIndexedSessionIds(worker.getTier1DbPath()!));
    const before = calls.length;

    await worker.reloadSettings();

    expect(calls.slice(before).some((call) => call.archivedOnly === true)).toBe(false);
    worker.stop();
  });
});
