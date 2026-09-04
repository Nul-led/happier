import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdir, stat, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { applyEnvValues, restoreEnvValues, snapshotEnvValues } from '@/testkit/env/envSnapshot';
import { createTempDir, removeTempDir } from '@/testkit/fs/tempDir';
import type { Credentials, StoredCredentials } from '@/persistence';

describe('memoryWorker', () => {
  const envBackup = snapshotEnvValues(['HAPPIER_HOME_DIR', 'HAPPIER_SERVER_URL', 'HAPPIER_WEBAPP_URL']);
  let homeDir: string | undefined;

  beforeEach(async () => {
    homeDir = await createTempDir('happier-memory-worker-');
    applyEnvValues({
      HAPPIER_HOME_DIR: homeDir,
      HAPPIER_SERVER_URL: 'https://api.example.test',
      HAPPIER_WEBAPP_URL: 'https://app.example.test',
    });
    vi.resetModules();
  });

  afterEach(async () => {
    restoreEnvValues(envBackup);
    vi.doUnmock('./hints/runMemoryHintsExecutionRun');
    vi.doUnmock('./transcript/fetchSemanticPage');
    vi.doUnmock('@/api/session/fetchEncryptedTranscriptWindow');
    vi.doUnmock('@/configuration');
    vi.doUnmock('@/session/replay/fetchEncryptedTranscriptMessages');
    vi.doUnmock('@/session/systemRecords/memory/commitMemorySystemRecords');
    vi.doUnmock('@/session/systemRecords/memory/fetchMemorySystemRecords');
    vi.doUnmock('@/session/transport/http/sessionSystemRecordsHttp');
    vi.doUnmock('@/session/transport/http/sessionsHttp');
    vi.doUnmock('@/ui/logger');
    vi.doUnmock('node:fs/promises');
    vi.resetModules();
    if (homeDir) await removeTempDir(homeDir);
  });

  it('creates the tier-1 sqlite DB when enabled', async () => {
    const { writeMemorySettingsToDisk } = await import('@/settings/memorySettings');
    await writeMemorySettingsToDisk({ v: 1, enabled: true, indexMode: 'hints' });

    const { configuration } = await import('@/configuration');
    const { startMemoryWorker } = await import('./memoryWorker');

    const credentials: Credentials = { token: 't', encryption: { type: 'legacy', secret: new Uint8Array(32).fill(1) } };
    const worker = await startMemoryWorker({
      credentials,
      machineId: 'machine_1',
    });

    await worker.reloadSettings();
    const s = await stat(join(configuration.activeServerDir, 'memory', 'memory.sqlite'));
    expect(s.isFile()).toBe(true);

    await worker.stop();
  });

  it.runIf(process.platform !== 'win32')('refuses a symlinked memory root before creating an index', async () => {
    const { writeMemorySettingsToDisk } = await import('@/settings/memorySettings');
    await writeMemorySettingsToDisk({ v: 1, enabled: true, indexMode: 'hints' });

    const { configuration } = await import('@/configuration');
    const outside = join(homeDir!, 'outside-memory');
    await mkdir(outside, { recursive: true });
    await mkdir(configuration.activeServerDir, { recursive: true });
    await symlink(outside, join(configuration.activeServerDir, 'memory'));

    const { startMemoryWorker } = await import('./memoryWorker');
    const credentials: Credentials = {
      token: 't',
      encryption: { type: 'legacy', secret: new Uint8Array(32).fill(1) },
    };

    await expect(startMemoryWorker({ credentials, machineId: 'machine_1' }))
      .rejects.toThrow('Protected local state must not be a symbolic link');
    await expect(stat(join(outside, 'memory.sqlite'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('loads persisted settings when the worker starts so status matches the saved machine configuration', async () => {
    const { writeMemorySettingsToDisk } = await import('@/settings/memorySettings');
    await writeMemorySettingsToDisk({ v: 1, enabled: true, indexMode: 'hints' });

    const { startMemoryWorker } = await import('./memoryWorker');

    const credentials: Credentials = { token: 't', encryption: { type: 'legacy', secret: new Uint8Array(32).fill(1) } };
    const worker = await startMemoryWorker({
      credentials,
      machineId: 'machine_1',
    });

    expect(worker.getSettings().enabled).toBe(true);
    expect(worker.getTier1DbPath()).toBeTruthy();

    await worker.stop();
  });

  it('creates the deep sqlite DB when enabled in deep mode', async () => {
    const { writeMemorySettingsToDisk } = await import('@/settings/memorySettings');
    await writeMemorySettingsToDisk({ v: 1, enabled: true, indexMode: 'deep' });

    const { configuration } = await import('@/configuration');
    const { startMemoryWorker } = await import('./memoryWorker');

    const credentials: Credentials = { token: 't', encryption: { type: 'legacy', secret: new Uint8Array(32).fill(1) } };
    const worker = await startMemoryWorker({
      credentials,
      machineId: 'machine_1',
    });

    await worker.reloadSettings();
    const s = await stat(join(configuration.activeServerDir, 'memory', 'deep.sqlite'));
    expect(s.isFile()).toBe(true);

    await worker.stop();
  });


  it('resolves embeddings diagnostics on settings reload even before any session indexing runs', async () => {
    const { writeMemorySettingsToDisk } = await import('@/settings/memorySettings');
    await writeMemorySettingsToDisk({
      v: 1,
      enabled: true,
      indexMode: 'deep',
      embeddings: {
        mode: 'custom',
        custom: {
          kind: 'openai_compatible',
          baseUrl: 'https://embeddings.example.test/v1',
          apiKey: { _isSecretValue: true, value: 'sk-test' },
          model: 'text-embedding-3-small',
        },
      },
    });

    const { startMemoryWorker } = await import('./memoryWorker');

    const credentials: Credentials = { token: 't', encryption: { type: 'legacy', secret: new Uint8Array(32).fill(1) } };
    const worker = await startMemoryWorker({
      credentials,
      machineId: 'machine_1',
      deps: {
        fetchDecryptedTranscriptPageAfterSeq: async () => [],
      },
    });

    await worker.reloadSettings();

    expect(worker.getEmbeddingsDiagnostics()).toMatchObject({
      mode: 'custom',
      providerKind: 'openai_compatible',
      modelId: 'text-embedding-3-small',
      runtimeState: 'ready',
      usingFallback: false,
    });

    await worker.stop();
  });

  it('deletes DBs when disabled with deleteOnDisable=true', async () => {
    const { writeMemorySettingsToDisk } = await import('@/settings/memorySettings');
    await writeMemorySettingsToDisk({ v: 1, enabled: true, indexMode: 'hints' });

    const { configuration } = await import('@/configuration');
    const { startMemoryWorker } = await import('./memoryWorker');

    const credentials: Credentials = { token: 't', encryption: { type: 'legacy', secret: new Uint8Array(32).fill(1) } };
    const worker = await startMemoryWorker({
      credentials,
      machineId: 'machine_1',
    });

    await worker.reloadSettings();
    const dummyCacheDir = join(configuration.activeServerDir, 'memory', 'models', 'transformers');
    await mkdir(dummyCacheDir, { recursive: true });
    await writeFile(join(dummyCacheDir, 'dummy.bin'), 'x', 'utf8');
    await writeMemorySettingsToDisk({ v: 1, enabled: false, indexMode: 'hints', deleteOnDisable: true });
    await worker.reloadSettings();

    await expect(stat(join(configuration.activeServerDir, 'memory', 'memory.sqlite'))).rejects.toBeTruthy();
    await expect(stat(join(dummyCacheDir, 'dummy.bin'))).rejects.toBeTruthy();
    expect(worker.getWorkerStatus()).toMatchObject({ state: 'disabled', currentSessionId: null, currentPhase: null });
    await worker.stop();
  });

  it('reports delete-on-disable filesystem failures to the settings caller', async () => {
    const actualFsPromises = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
    vi.doMock('node:fs/promises', () => ({
      ...actualFsPromises,
      rm: vi.fn(async (path: string, options?: Parameters<typeof actualFsPromises.rm>[1]) => {
        if (String(path).endsWith('/memory')) {
          throw new Error('memory_delete_failed');
        }
        return await actualFsPromises.rm(path, options);
      }),
    }));

    const { writeMemorySettingsToDisk } = await import('@/settings/memorySettings');
    await writeMemorySettingsToDisk({ v: 1, enabled: true, indexMode: 'hints' });
    const { startMemoryWorker } = await import('./memoryWorker');
    const credentials: Credentials = { token: 't', encryption: { type: 'legacy', secret: new Uint8Array(32).fill(1) } };
    const worker = await startMemoryWorker({ credentials, machineId: 'machine_1' });

    await writeMemorySettingsToDisk({
      v: 1,
      enabled: false,
      indexMode: 'hints',
      deleteOnDisable: true,
    });

    await expect(worker.reloadSettings()).rejects.toThrow('memory_delete_failed');
    await worker.stop();
  });

  it('ingests committed memory summary system records into the tier-1 index', async () => {
    vi.doMock('@/session/transport/http/sessionsHttp', () => ({
      fetchSessionsPage: vi.fn(async () => ({ sessions: [], nextCursor: null, hasNext: false })),
      fetchSessionById: vi.fn(async () => ({
        id: 'sess-1', seq: 12, createdAt: 1_000, updatedAt: 2_000,
        active: false, activeAt: 0, archivedAt: null,
      })),
    }));
    vi.doMock('./transcript/fetchSemanticPage', () => ({
      fetchMemorySemanticTranscriptPage: vi.fn(async () => ({
        items: [],
        hasMore: false,
        nextCursor: null,
      })),
    }));
    const { writeMemorySettingsToDisk } = await import('@/settings/memorySettings');
    await writeMemorySettingsToDisk({
      v: 1,
      enabled: true,
      indexMode: 'hints',
      backfillPolicy: 'all_history',
    });

    const { startMemoryWorker } = await import('./memoryWorker');
    const { searchTier1Memory } = await import('./searchMemory');

    const credentials: Credentials = { token: 't', encryption: { type: 'legacy', secret: new Uint8Array(32).fill(1) } };
    const worker = await startMemoryWorker({
      credentials,
      machineId: 'machine_1',
      deps: {
        fetchDecryptedTranscriptPageAfterSeq: async () => [],
        fetchCommittedSummaryShards: async () => [
          {
            v: 1,
            seqFrom: 10,
            seqTo: 12,
            createdAtFromMs: 1000,
            createdAtToMs: 2000,
            summary: 'We discussed integrating OpenClaw memory search.',
            keywords: ['openclaw', 'memory'],
            entities: ['Happier'],
            decisions: ['Make memory search opt-in'],
          },
        ],
      },
    });

    await worker.reloadSettings();
    await worker.ensureUpToDate('sess-1');

    const dbPath = worker.getTier1DbPath();
    expect(dbPath).toBeTruthy();

    const result = searchTier1Memory({
      dbPath: dbPath!,
      query: { v: 1, query: 'openclaw', scope: { type: 'global' }, mode: 'hints' },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.hits.length).toBe(1);
    expect(result.hits[0]!.sessionId).toBe('sess-1');

    await worker.stop();
  }, 60_000);

  it('indexes transcript text into the deep index when ensureUpToDate is called', async () => {
    vi.doMock('@/session/transport/http/sessionsHttp', () => ({
      fetchSessionsPage: vi.fn(async () => ({ sessions: [], nextCursor: null, hasNext: false })),
      fetchSessionById: vi.fn(async () => ({
        id: 'sess-1', seq: 2, createdAt: 1_000, updatedAt: 2_000,
        active: false, activeAt: 0, archivedAt: null,
      })),
    }));
    const { writeMemorySettingsToDisk } = await import('@/settings/memorySettings');
    await writeMemorySettingsToDisk({
      v: 1,
      enabled: true,
      indexMode: 'deep',
      backfillPolicy: 'all_history',
    });

    const { startMemoryWorker } = await import('./memoryWorker');
    const { searchTier2Memory } = await import('./searchMemory');

    const credentials: Credentials = { token: 't', encryption: { type: 'legacy', secret: new Uint8Array(32).fill(1) } };
    const worker = await startMemoryWorker({
      credentials,
      machineId: 'machine_1',
      deps: {
        fetchDecryptedTranscriptPageAfterSeq: async () => [
          { seq: 1, createdAtMs: 1000, role: 'user' as const, content: { type: 'text', text: 'hello openclaw' } },
          { seq: 2, createdAtMs: 2000, role: 'agent' as const, content: { type: 'text', text: 'we discussed memory search' } },
        ],
        fetchCommittedSummaryShards: async () => [],
      },
    });

    await worker.reloadSettings();
    await worker.ensureUpToDate('sess-1');

    const tier1Path = worker.getTier1DbPath();
    expect(tier1Path).toBeTruthy();
    if (tier1Path) {
      const { openSummaryShardIndexDb } = await import('./summaryShardIndexDb');
      const tier1 = openSummaryShardIndexDb({ dbPath: tier1Path });
      const cursors = tier1.getSessionCursors({ sessionId: 'sess-1', nowMs: Date.now() });
      expect(cursors.lastDeepIndexedSeq).toBe(2);
      tier1.close();
    }

    const deepPath = worker.getDeepDbPath();
    expect(deepPath).toBeTruthy();

    const result = await searchTier2Memory({
      dbPath: deepPath!,
      query: { v: 1, query: 'openclaw', scope: { type: 'global' }, mode: 'deep' },
      previewChars: 240,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.hits.length).toBeGreaterThan(0);
    expect(result.hits[0]!.sessionId).toBe('sess-1');

    await worker.stop();
  });

  it('rebuilds an advanced empty projection when a content-policy change admits earlier rows', async () => {
    vi.doMock('@/session/transport/http/sessionsHttp', () => ({
      fetchSessionsPage: vi.fn(async () => ({ sessions: [], nextCursor: null, hasNext: false })),
      fetchSessionById: vi.fn(async () => ({
        id: 'sess-policy', seq: 1, createdAt: 1_000, updatedAt: 2_000,
        active: false, activeAt: 0, archivedAt: null,
      })),
    }));
    vi.doMock('./transcript/fetchSemanticPage', () => ({
      fetchMemorySemanticTranscriptPage: vi.fn(async () => ({
        items: [{
          sessionId: 'sess-policy',
          id: '1',
          seq: 1,
          createdAtMs: 1_000,
          role: 'assistant',
          kind: 'assistant_message',
          text: 'newly admitted policy memory',
          textChars: 28,
        }],
        nextCursor: null,
        hasMore: false,
        diagnostics: {
          rawRowsScanned: 1,
          pagesFetched: 1,
          scanLimitReached: false,
          payloadTruncations: 0,
          semanticRowsFound: 1,
        },
      })),
    }));

    const { writeMemorySettingsToDisk } = await import('@/settings/memorySettings');
    await writeMemorySettingsToDisk({
      v: 1,
      enabled: true,
      indexMode: 'deep',
      backfillPolicy: 'all_history',
      contentPolicy: { includeUserMessages: true, includeAssistantMessages: false },
    });

    const { startMemoryWorker } = await import('./memoryWorker');
    const { searchTier2Memory } = await import('./searchMemory');
    const credentials: Credentials = {
      token: 't',
      encryption: { type: 'legacy', secret: new Uint8Array(32).fill(1) },
    };
    const worker = await startMemoryWorker({
      credentials,
      machineId: 'machine_1',
      deps: {
        fetchDecryptedTranscriptPageAfterSeq: async () => [{
          seq: 1,
          createdAtMs: 1_000,
          role: 'agent' as const,
          content: { type: 'text', text: 'newly admitted policy memory' },
        }],
        fetchCommittedSummaryShards: async () => [],
      },
    });

    await worker.ensureUpToDate('sess-policy');
    const deepPath = worker.getDeepDbPath()!;
    const beforePolicyChange = await searchTier2Memory({
      dbPath: deepPath,
      query: { v: 1, query: 'admitted', scope: { type: 'global' }, mode: 'deep' },
      previewChars: 240,
    });
    expect(beforePolicyChange.ok && beforePolicyChange.hits).toEqual([]);

    await writeMemorySettingsToDisk({
      v: 1,
      enabled: true,
      indexMode: 'deep',
      backfillPolicy: 'all_history',
      contentPolicy: { includeUserMessages: true, includeAssistantMessages: true },
    });
    await worker.reloadSettings();

    expect(worker.getSettings().contentPolicy.includeAssistantMessages).toBe(true);
    const rebuilt = await searchTier2Memory({
      dbPath: deepPath,
      query: { v: 1, query: 'admitted', scope: { type: 'global' }, mode: 'deep' },
      previewChars: 240,
    });
    expect(rebuilt.ok && rebuilt.hits.map((hit) => hit.sessionId)).toEqual(['sess-policy']);

    await worker.stop();
  });

  it('purges retained deep artifacts when deep policy changes while hints mode is active', async () => {
    const { writeMemorySettingsToDisk } = await import('@/settings/memorySettings');
    await writeMemorySettingsToDisk({
      v: 1,
      enabled: true,
      indexMode: 'deep',
      deep: { includeToolOutput: true },
    });
    const { startMemoryWorker } = await import('./memoryWorker');
    const { openDeepIndexDb } = await import('./deepIndex/deepIndexDb');
    const { openSummaryShardIndexDb } = await import('./summaryShardIndexDb');
    const { searchTier2Memory } = await import('./searchMemory');
    const credentials: Credentials = {
      token: 't',
      encryption: { type: 'legacy', secret: new Uint8Array(32).fill(1) },
    };
    const worker = await startMemoryWorker({ credentials, machineId: 'machine_1' });
    const deepPath = worker.getDeepDbPath()!;

    await writeMemorySettingsToDisk({
      v: 1,
      enabled: true,
      indexMode: 'hints',
      deep: { includeToolOutput: true },
    });
    await worker.reloadSettings();

    const seed = openDeepIndexDb({ dbPath: deepPath });
    seed.insertChunk({
      sessionId: 'sess-stale-deep-policy',
      seqFrom: 1,
      seqTo: 1,
      createdAtFromMs: 1,
      createdAtToMs: 1,
      text: 'stale private tool output',
      policyKey: 'old-deep-tool-output-policy',
    });
    seed.close();

    await writeMemorySettingsToDisk({
      v: 1,
      enabled: true,
      indexMode: 'hints',
      deep: { includeToolOutput: false },
    });
    await worker.reloadSettings();

    const result = await searchTier2Memory({
      dbPath: deepPath,
      query: { v: 1, query: 'private tool', scope: { type: 'global' }, mode: 'deep' },
      previewChars: 240,
    });
    expect(result.ok && result.hits).toEqual([]);
    expect(worker.getSettings().deep.includeToolOutput).toBe(false);

    const tier1Path = worker.getTier1DbPath()!;
    const tier1Seed = openSummaryShardIndexDb({ dbPath: tier1Path });
    tier1Seed.trySeedSessionCursorsIfMissing({
      sessionId: 'sess-deep-cursor-only',
      nowMs: 10,
      lastHintedSeq: 0,
      lastDeepIndexedSeq: 99,
    });
    tier1Seed.close();
    await writeMemorySettingsToDisk({
      v: 1,
      enabled: true,
      indexMode: 'hints',
      deep: { includeToolOutput: true },
    });
    await worker.reloadSettings();
    const tier1Read = openSummaryShardIndexDb({ dbPath: tier1Path });
    expect(tier1Read.getSessionCursors({ sessionId: 'sess-deep-cursor-only', nowMs: 20 }).lastDeepIndexedSeq).toBe(0);
    tier1Read.close();
    await worker.stop();
  });

  it('uses the role-filtered transcript message API for default deep indexing', async () => {
    const fetchSessionById = vi.fn(async () => ({
      id: 'sess-role-filter',
      seq: 1,
      createdAt: 1_000,
      updatedAt: 1_000,
      active: false,
      activeAt: 0,
      archivedAt: null,
      encryptionMode: 'plain',
    }));
    vi.doMock('@/session/transport/http/sessionsHttp', () => ({
      fetchSessionsPage: vi.fn(async () => ({ sessions: [], nextCursor: null, hasNext: false })),
      fetchSessionById,
    }));
    const fetchEncryptedTranscriptPageAfterSeq = vi.fn(async () => []);
    vi.doMock('@/api/session/fetchEncryptedTranscriptWindow', () => ({
      fetchEncryptedTranscriptPageAfterSeq,
    }));
    const fetchEncryptedTranscriptMessagesPage = vi.fn(async (args: { roles?: readonly string[] }) => ({
      messages: args.roles?.includes('agent')
        ? [
          {
            id: 'row-agent',
            seq: 1,
            createdAt: 1000,
            messageRole: 'agent',
            content: {
              t: 'plain',
              v: {
                role: 'agent',
                content: {
                  type: 'codex',
                  provider: 'codex',
                  data: { type: 'message', message: 'role filtered deep memory row' },
                },
              },
            },
          },
        ]
        : [],
      hasMore: false,
      nextBeforeSeq: null,
      nextAfterSeq: null,
    }));
    vi.doMock('@/session/replay/fetchEncryptedTranscriptMessages', () => ({
      fetchEncryptedTranscriptMessagesPage,
    }));
    vi.doMock('@/session/transport/http/sessionSystemRecordsHttp', async () => {
      const actual = await vi.importActual<typeof import('@/session/transport/http/sessionSystemRecordsHttp')>(
        '@/session/transport/http/sessionSystemRecordsHttp',
      );
      return {
        ...actual,
        fetchSessionSystemRecordsPage: vi.fn(async () => ({
          records: [],
          nextCursor: null,
          hasNext: false,
        })),
      };
    });

    const { writeMemorySettingsToDisk } = await import('@/settings/memorySettings');
    await writeMemorySettingsToDisk({
      v: 1,
      enabled: true,
      indexMode: 'deep',
      backfillPolicy: 'all_history',
    });

    const { startMemoryWorker } = await import('./memoryWorker');
    const { searchTier2Memory } = await import('./searchMemory');

    const credentials: StoredCredentials = { token: 't', encryption: null };
    const worker = await startMemoryWorker({
      credentials,
      machineId: 'machine_1',
    });

    await worker.reloadSettings();
    await worker.ensureUpToDate('sess-role-filter');

    const deepPath = worker.getDeepDbPath();
    expect(deepPath).toBeTruthy();
    const result = await searchTier2Memory({
      dbPath: deepPath!,
      query: { v: 1, query: 'filtered', scope: { type: 'global' }, mode: 'deep' },
      previewChars: 240,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.hits.some((hit) => hit.sessionId === 'sess-role-filter')).toBe(true);
    expect(fetchEncryptedTranscriptMessagesPage).toHaveBeenCalledWith(expect.objectContaining({
      roles: ['user', 'agent'],
      scope: 'main',
    }));
    expect(fetchEncryptedTranscriptPageAfterSeq).not.toHaveBeenCalled();

    await worker.stop();
  });

  it('logs retryable selected-transcript fetch failures through the shared server endpoint classifier', async () => {
    const fetchSessionById = vi.fn(async () => ({
      id: 'sess-maintenance',
      seq: 1,
      createdAt: 1_000,
      updatedAt: 1_000,
      active: false,
      activeAt: 0,
      archivedAt: null,
    }));
    const fetchSessionsPage = vi.fn(async () => ({ sessions: [], nextCursor: null, hasNext: false }));
    const maintenanceError = Object.assign(new Error('planned maintenance'), {
      response: { status: 503 },
    });
    const fetchEncryptedTranscriptMessagesPage = vi.fn(async () => {
      throw maintenanceError;
    });
    const loggerDebug = vi.fn();
    const runMemoryHintsExecutionRun = vi.fn(async () => {
      throw new Error('summarizer should not run when transcript rows are unavailable');
    });

    vi.doMock('@/ui/logger', () => ({
      logger: { debug: loggerDebug },
    }));
    vi.doMock('@/session/transport/http/sessionsHttp', () => ({
      fetchSessionById,
      fetchSessionsPage,
    }));
    vi.doMock('@/session/replay/fetchEncryptedTranscriptMessages', () => ({
      fetchEncryptedTranscriptMessagesPage,
    }));
    vi.doMock('./transcript/fetchSemanticPage', () => ({
      fetchMemorySemanticTranscriptPage: vi.fn(async () => {
        await fetchEncryptedTranscriptMessagesPage();
      }),
    }));
    vi.doMock('./hints/runMemoryHintsExecutionRun', () => ({
      runMemoryHintsExecutionRun,
    }));
    vi.doMock('@/session/systemRecords/memory/fetchMemorySystemRecords', () => ({
      fetchMemorySummaryShardSystemRecords: async () => [],
    }));
    vi.doMock('@/session/systemRecords/memory/commitMemorySystemRecords', () => ({
      commitMemorySystemRecords: async () => {},
    }));

    const { resetServerEndpointFailureLogSamplingForTests } = await import('@/api/client/serverEndpointFailureLog');
    resetServerEndpointFailureLogSamplingForTests();
    const { writeMemorySettingsToDisk } = await import('@/settings/memorySettings');
    await writeMemorySettingsToDisk({
      v: 1,
      enabled: true,
      indexMode: 'hints',
      backfillPolicy: 'all_history',
      coveragePolicy: { type: 'full' },
      hints: {
        updateMode: 'continuous',
        idleDelayMs: 0,
        windowSizeMessages: 5,
        targetShardMessages: 10,
        maxShardChars: 12_000,
        maxSummaryChars: 500,
        maxKeywords: 5,
        maxEntities: 5,
        maxDecisions: 5,
        maxRunsPerHour: 999,
        maxShardsPerSession: 250,
        failureBackoffBaseMs: 0,
        failureBackoffMaxMs: 0,
      },
    });

    const { startMemoryWorker } = await import('./memoryWorker');

    const credentials: Credentials = { token: 't', encryption: { type: 'legacy', secret: new Uint8Array(32).fill(1) } };
    const worker = await startMemoryWorker({
      credentials,
      machineId: 'machine_1',
    });

    await worker.reloadSettings();
    await expect(worker.ensureUpToDate('sess-maintenance')).rejects.toBe(maintenanceError);

    expect(fetchEncryptedTranscriptMessagesPage).toHaveBeenCalled();
    expect(runMemoryHintsExecutionRun).not.toHaveBeenCalled();
    expect(loggerDebug).toHaveBeenCalledWith(
      '[API] memory worker selected transcript rows temporarily unavailable; will retry or recover when the server is ready.',
      expect.objectContaining({
        classification: expect.objectContaining({
          retryable: true,
          statusCode: 503,
        }),
      }),
    );
    expect(loggerDebug.mock.calls.map((call) => call[0])).not.toContain(
      '[memoryWorker] Failed to fetch/decrypt transcript page (best-effort)',
    );

    await worker.stop();
  });

  it('continues background deep indexing for recently updated inactive sessions when backfill policy is new_only', async () => {
    vi.useFakeTimers();
    const argvBackup = process.argv.slice();
    try {
      process.argv = ['node', 'happier', 'daemon', 'start-sync'];
      vi.doMock('@/configuration', async () => {
        const actual = await vi.importActual<typeof import('@/configuration')>('@/configuration');
        return {
          ...actual,
          configuration: {
            ...actual.configuration,
            isDaemonProcess: true,
          },
        };
      });
      let observedSeq = 1;
      const fetchSessionsPage = vi.fn(async ({ activeOnly }: { activeOnly?: boolean }) => ({
        sessions: activeOnly
          ? []
          : [
            {
              id: 'sess-1',
              seq: observedSeq,
              createdAt: 1_000,
              updatedAt: 9_000,
              activeAt: 0,
            },
          ],
        nextCursor: null,
        hasNext: false,
      }));
      const fetchSessionById = vi.fn(async () => ({}));
      const fetchEncryptedTranscriptPageAfterSeq = vi.fn(async () => []);

      vi.doMock('@/session/transport/http/sessionsHttp', () => ({
        fetchSessionsPage,
        fetchSessionById,
      }));
      vi.doMock('@/api/session/fetchEncryptedTranscriptWindow', () => ({
        fetchEncryptedTranscriptPageAfterSeq,
      }));
      vi.doMock('./transcript/fetchSemanticPage', () => ({
        fetchMemorySemanticTranscriptPage: vi.fn(async () => ({
          items: [],
          hasMore: false,
          nextCursor: null,
        })),
      }));
      vi.doMock('@/session/systemRecords/memory/fetchMemorySystemRecords', () => ({
        fetchMemorySummaryShardSystemRecords: async () => [],
      }));
      vi.doMock('@/session/systemRecords/memory/commitMemorySystemRecords', () => ({
        commitMemorySystemRecords: async () => {},
      }));

      const { writeMemorySettingsToDisk } = await import('@/settings/memorySettings');
      await writeMemorySettingsToDisk({
        v: 1,
        enabled: true,
        indexMode: 'deep',
        backfillPolicy: 'new_only',
        worker: {
          tickIntervalMs: 500,
          inventoryRefreshIntervalMs: 5_000,
          maxSessionsPerTick: 1,
          sessionListPageLimit: 10,
        },
      });

      const rows = [
        { seq: 1, createdAtMs: 1_000, role: 'user' as const, content: { type: 'text', text: 'initial deep memory row' } },
      ];
      let secondPageRequested = false;

      const { startMemoryWorker } = await import('./memoryWorker');
      const credentials: Credentials = { token: 't', encryption: { type: 'legacy', secret: new Uint8Array(32).fill(1) } };
      const worker = await startMemoryWorker({
        credentials,
        machineId: 'machine_1',
        deps: {
          fetchDecryptedTranscriptPageAfterSeq: async ({ afterSeq }) => {
            if (afterSeq === 1) secondPageRequested = true;
            return rows.filter((row) => row.seq > afterSeq);
          },
        },
      });

      await worker.reloadSettings();

      const { openSummaryShardIndexDb } = await import('./summaryShardIndexDb');
      const tier1Before = openSummaryShardIndexDb({ dbPath: worker.getTier1DbPath()! });
      tier1Before.markDeepIndexSuccess({ sessionId: 'sess-1', seqTo: 1, nowMs: 5_000 });
      expect(tier1Before.getSessionCursors({ sessionId: 'sess-1', nowMs: 5_000 }).lastDeepIndexedSeq).toBe(1);
      tier1Before.close();

      rows.push({
        seq: 2,
        createdAtMs: 2_000,
        role: 'user' as const,
        content: { type: 'text', text: 'inactive session follow-up should be indexed' },
      });
      observedSeq = 2;

      await vi.advanceTimersByTimeAsync(5_000);
      for (let attempt = 0; attempt < 20 && !secondPageRequested; attempt += 1) {
        await vi.advanceTimersByTimeAsync(500);
      }
      expect(fetchSessionsPage).toHaveBeenCalled();
      expect(secondPageRequested).toBe(true);
      const tier1DbPath = worker.getTier1DbPath()!;
      const stopPromise = worker.stop();
      await vi.runAllTimersAsync();
      await stopPromise;

      const tier1After = openSummaryShardIndexDb({ dbPath: tier1DbPath });
      expect(tier1After.getSessionCursors({ sessionId: 'sess-1', nowMs: 15_000 }).lastDeepIndexedSeq).toBe(2);
      tier1After.close();

      expect(fetchSessionsPage).toHaveBeenCalledWith(expect.objectContaining({ activeOnly: false }));
    } finally {
      process.argv = argvBackup;
      vi.useRealTimers();
    }
  });
});
