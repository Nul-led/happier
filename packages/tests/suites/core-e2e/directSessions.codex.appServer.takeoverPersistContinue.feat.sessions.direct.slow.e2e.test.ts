import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { readNonAuthoritativeLinkedExternalSessionV1FromMetadata, type ExternalSessionTakeoverStartInputV1 } from '@happier-dev/protocol';
import { RPC_METHODS } from '@happier-dev/protocol/rpc';

import { createRunDirs } from '../../src/testkit/runDir';
import {
  resolveTestDbProvider,
  startServerLight,
  type StartedServer,
} from '../../src/testkit/process/serverLight';
import { createTestAuth } from '../../src/testkit/auth';
import { seedCliAuthForTestAccount } from '../../src/testkit/cliAuth';
import { enableExternalSessionPassiveRestoreForAccount } from '../../src/testkit/externalSessionLiveLifecycleFixture';
import {
  replaceTestDaemonWithoutStoppingSessions,
  startTestDaemon,
  type StartedDaemon,
} from '../../src/testkit/daemon/daemon';
import { createUserScopedSocketCollector } from '../../src/testkit/socketClient';
import { createDataKeyRpcClient, unwrapDataKeyRpcResult } from '../../src/testkit/syntheticAgent/rpcClient';
import { waitFor } from '../../src/testkit/timing';
import { fetchSessionMetadataV2 } from '../../src/testkit/sessionHandoffMetadata';
import { fetchJson } from '../../src/testkit/http';
import { redactHarnessLogText } from '../../src/testkit/process/harnessLogRedaction';
import {
  readFakeCodexAppServerRequestLog,
  writeFakeCodexAppServerScript,
} from '../../src/testkit/codexAppServerRemoteHarness';

const run = createRunDirs({ runLabel: 'core' });
const suiteDbProvider = resolveTestDbProvider(process.env, {
  fallbackProvider: 'sqlite',
});
const tmuxAvailable = process.platform !== 'win32' && spawnSync('tmux', ['-V'], { stdio: 'ignore' }).status === 0;

type JsonRecord = Record<string, unknown>;

function requireRecord(value: unknown, context: string): JsonRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Expected ${context} to be an object.`);
  }
  return value as JsonRecord;
}

function requireString(value: unknown, context: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Expected ${context} to be a non-empty string.`);
  }
  return value;
}

function requireNumber(value: unknown, context: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`Expected ${context} to be a non-negative safe integer.`);
  }
  return value;
}

async function fetchPublicMessages(params: Readonly<{
  baseUrl: string;
  token: string;
  sessionId: string;
}>): Promise<JsonRecord[]> {
  const response = await fetchJson<{ messages?: unknown }>(
    `${params.baseUrl}/v1/sessions/${params.sessionId}/messages?afterSeq=0&limit=200`,
    {
      headers: { Authorization: `Bearer ${params.token}` },
      timeoutMs: 30_000,
    },
  );
  if (response.status !== 200 || !Array.isArray(response.data?.messages)) {
    throw new Error(`Failed to read imported Codex transcript (status=${response.status}).`);
  }
  return response.data.messages.map((row, index) =>
    requireRecord(row, `imported transcript row ${index}`));
}

async function writeStoppedCodexOwnerMarker(params: Readonly<{
  daemonHomeDir: string;
  linkedDirectory: string;
  sessionId: string;
  remoteSessionId: string;
}>): Promise<void> {
  const deadPid = 2_147_483_647;
  const marker = {
    pid: deadPid,
    happySessionId: params.sessionId,
    happyHomeDir: params.daemonHomeDir,
    createdAt: 1,
    updatedAt: Date.now(),
    flavor: 'codex',
    startedBy: 'terminal',
    cwd: params.linkedDirectory,
    processCommandHash: '0'.repeat(64),
    processStartTimeMs: 1,
    processCommand: 'stopped-fake-codex-owner',
    metadata: {
      flavor: 'codex',
      codexSessionId: params.remoteSessionId,
    },
  };
  for (const basename of ['daemon-sessions', 'daemon-sessions.dev']) {
    const markerDir = join(params.daemonHomeDir, 'tmp', basename);
    await mkdir(markerDir, { recursive: true });
    await writeFile(
      join(markerDir, `pid-${deadPid}.json`),
      JSON.stringify(marker),
      'utf8',
    );
  }
}

describe('core e2e: direct Codex app-server sessions takeover+continue', () => {
  let server: StartedServer | null = null;
  let daemon: StartedDaemon | null = null;
  let retiredDaemon: StartedDaemon | null = null;
  let tmuxTmpDir: string | null = null;

  afterEach(async (context) => {
    if (context.task.result?.state === 'fail' && daemon) {
      for (const path of [daemon.proc.stderrPath, daemon.state.daemonLogPath]) {
        if (!path) continue;
        const log = await readFile(path, 'utf8').catch(() => null);
        if (log) console.error(`Takeover daemon diagnostics (${path}):\n${redactHarnessLogText(log).slice(-8_000)}`);
      }
    }
    await daemon?.stop().catch(() => {});
    daemon = null;
    await retiredDaemon?.proc.stop().catch(() => {});
    retiredDaemon = null;
    await server?.stop().catch(() => {});
    server = null;
    if (tmuxTmpDir) {
      try {
        execFileSync('tmux', ['kill-server'], { env: { ...process.env, TMUX: undefined, TMUX_PANE: undefined, TMUX_TMPDIR: tmuxTmpDir }, stdio: 'ignore' });
      } catch {
        // The isolated server may already have exited when its last window closed.
      }
      await rm(tmuxTmpDir, { recursive: true, force: true });
      tmuxTmpDir = null;
    }
  });

  afterAll(async () => {
    await daemon?.stop().catch(() => {});
    await retiredDaemon?.proc.stop().catch(() => {});
    await server?.stop().catch(() => {});
  });

  for (const { targetStorageMode, terminalMode, restartDaemon } of [
    { targetStorageMode: 'persisted', terminalMode: 'plain', restartDaemon: true },
    { targetStorageMode: 'persisted', terminalMode: 'tmux', restartDaemon: true },
    { targetStorageMode: 'external-linked', terminalMode: 'tmux', restartDaemon: true },
    { targetStorageMode: 'persisted', terminalMode: 'tmux', restartDaemon: false },
  ] as const) {
    it.skipIf(targetStorageMode === 'persisted' && terminalMode === 'tmux' && !tmuxAvailable)(
      targetStorageMode === 'external-linked'
        ? 'rejects external-linked takeover after daemon restart when Codex cannot prevent native writes'
        : restartDaemon
          ? `retains ${targetStorageMode} takeover in ${terminalMode} across daemon restart and resumes the same vendor thread`
          : 'resumes persisted takeover in tmux without daemon restart', async () => {
    const testDir = run.testDir(`direct-sessions-codex-app-server-takeover-${targetStorageMode}-${terminalMode}-${restartDaemon ? 'restart' : 'initial'}-continue`);
    if (targetStorageMode === 'persisted' && terminalMode === 'tmux') {
      // Keep the Unix socket path below the platform limit even when the test root is long.
      tmuxTmpDir = await mkdtemp('/tmp/h413-tmux-');
    }
    const daemonHomeDir = resolve(join(testDir, 'daemon-home'));
    const codexHomeDir = resolve(join(testDir, '.codex'));
    const rolloutDir = resolve(join(codexHomeDir, 'sessions', '2026', '07', '26'));
    const appServerRequestLogPath = resolve(join(testDir, 'fake-codex-app-server.requests.jsonl'));
    const remoteSessionId = '44444444-4444-4444-4444-444444444444';
    const linkedDirectory = resolve(join(testDir, 'project'));
    const importedMarker = 'CODEX_DIRECT_TAKEOVER_IMPORTED_HISTORY';

    await mkdir(daemonHomeDir, { recursive: true });
    await mkdir(rolloutDir, { recursive: true });
    await mkdir(linkedDirectory, { recursive: true });
    await writeFile(
      resolve(join(rolloutDir, `rollout-2026-07-26T00-00-00-${remoteSessionId}.jsonl`)),
      [
        JSON.stringify({
          type: 'session_meta',
          timestamp: '2026-07-26T00:00:00.000Z',
          payload: {
            id: remoteSessionId,
            timestamp: '2026-07-26T00:00:00.000Z',
            cwd: linkedDirectory,
          },
        }),
        JSON.stringify({
          type: 'response_item',
          timestamp: '2026-07-26T00:00:01.000Z',
          payload: {
            type: 'message',
            role: 'assistant',
            content: [{ type: 'output_text', text: importedMarker }],
          },
        }),
      ].join('\n') + '\n',
      'utf8',
    );

    const fakeAppServer = await writeFakeCodexAppServerScript({
      dir: testDir,
      requestLogPath: appServerRequestLogPath,
      captureTerminalEnvironment: true,
    });

    const assertResumedInRequestedTerminal = async () => {
      await waitFor(async () => (await readFakeCodexAppServerRequestLog(appServerRequestLogPath))
        .some((entry) => entry.method === 'thread/resume' && entry.params?.threadId === remoteSessionId), {
        timeoutMs: 45_000,
        context: `${targetStorageMode} takeover resumes its original Codex thread`,
      });
      const resumed = (await readFakeCodexAppServerRequestLog(appServerRequestLogPath))
        .filter((entry) => entry.method === 'thread/resume' && entry.params?.threadId === remoteSessionId);
      expect(resumed).toHaveLength(1);
      if (tmuxTmpDir) {
        expect(resumed[0]?.terminal?.tmux).toContain(`${tmuxTmpDir}/`);
        expect(resumed[0]?.terminal?.pane).toMatch(/^%\d+$/);
        execFileSync('tmux', ['has-session', '-t', 'takeover-terminal'], {
          env: { ...process.env, TMUX: undefined, TMUX_PANE: undefined, TMUX_TMPDIR: tmuxTmpDir },
        });
      }
    };

    server = await startServerLight({
      testDir,
      dbProvider: suiteDbProvider,
      extraEnv: {
        HAPPIER_E2E_PROVIDER_SKIP_SERVER_SHARED_DEPS_BUILD: '1',
      },
    });
    const serverBaseUrl = server.baseUrl;
    const auth = await createTestAuth(serverBaseUrl);
    await enableExternalSessionPassiveRestoreForAccount({
      account: { auth, machineKey: auth.accountMachineKey },
      serverBaseUrl,
    });

    const seeded = await seedCliAuthForTestAccount({
      cliHome: daemonHomeDir,
      serverUrl: server.baseUrl,
      auth,
      mode: 'dataKey',
    });

    const daemonEnv = {
      ...process.env,
      CI: '1',
      HAPPIER_HOME_DIR: daemonHomeDir,
      HAPPIER_SERVER_URL: serverBaseUrl,
      HAPPIER_WEBAPP_URL: serverBaseUrl,
      HAPPIER_DAEMON_STARTUP_SOURCE: 'background-service',
      CODEX_HOME: codexHomeDir,
      HAPPIER_CODEX_APP_SERVER_BIN: fakeAppServer,
      HAPPIER_CODEX_APP_SERVER_RPC_TIMEOUT_MS: '2000',
      HAPPIER_E2E_PROVIDER_USE_CLI_SOURCE_ENTRYPOINT: '1',
      HAPPIER_E2E_PROVIDER_SKIP_CLI_SHARED_DEPS_BUILD: '1',
      HAPPIER_E2E_CLI_SNAPSHOT_NODE_MODULES_MODE: 'symlink',
    };
    daemon = await startTestDaemon({
      testDir,
      happyHomeDir: daemonHomeDir,
      env: daemonEnv,
    });

    const ui = createUserScopedSocketCollector(serverBaseUrl, auth.token);
    ui.connect();
    await waitFor(() => ui.isConnected(), {
      timeoutMs: 20_000,
      context: 'socket connected for direct Codex app-server persisted takeover',
    });

    try {
      const machineRpc = createDataKeyRpcClient(ui, auth.accountMachineKey);
      const route = (method: string): string => `${seeded.machineId}:${method}`;

      let link: Awaited<ReturnType<typeof machineRpc.call>> | null = null;
      await waitFor(async () => {
        link = await machineRpc.call(route(RPC_METHODS.DAEMON_EXTERNAL_SESSION_LINK_ENSURE), {
          machineId: seeded.machineId,
          providerId: 'codex',
          remoteSessionId,
          titleHint: 'Direct Codex app-server linked session',
          directoryHint: linkedDirectory,
          codexBackendMode: 'appServer',
          source: { kind: 'codexHome', home: 'user' },
        });
        return link.ok === true;
      }, { timeoutMs: 30_000, context: 'direct Codex app-server link RPC available' });
      if (!link) throw new Error('Expected direct Codex app-server link response.');
      const linkResult = requireRecord(
        unwrapDataKeyRpcResult(link, 'direct Codex app-server persisted link'),
        'direct Codex app-server persisted link',
      );
      expect(linkResult).toEqual(expect.objectContaining({ ok: true, created: true }));
      const sessionId = requireString(linkResult.sessionId, 'linked session id');
      const linkedMetadata = await fetchSessionMetadataV2({
        baseUrl: serverBaseUrl,
        token: auth.token,
        sessionId,
        machineKeys: [auth.accountMachineKey],
      });
      const linked = readNonAuthoritativeLinkedExternalSessionV1FromMetadata(linkedMetadata);
      if (!linked?.qualifiedIdentity) {
        throw new Error('Expected canonical qualified linked-session identity.');
      }
      expect(linked.source).toMatchObject({ kind: 'codexHome', home: 'user', homePath: codexHomeDir });
      expect(linked.linkData).toMatchObject({
        runtimeDescriptorV1: {
          agentId: 'codex',
          agent: { backendMode: 'appServer', providerSessionId: remoteSessionId },
        },
      });
      await writeStoppedCodexOwnerMarker({
        daemonHomeDir,
        linkedDirectory,
        sessionId,
        remoteSessionId,
      });
      expect(unwrapDataKeyRpcResult(await machineRpc.call(
        route(RPC_METHODS.DAEMON_EXTERNAL_SESSION_BACKGROUND_FOLLOW_SET),
        {
          machineId: seeded.machineId,
          sessionId,
          agentId: linked.agentId,
          remoteSessionId: linked.remoteSessionId,
          source: linked.source,
          enabled: false,
        },
      ), 'disable background follow before persisted takeover')).toEqual(
        expect.objectContaining({ ok: true, enabled: false }),
      );

      const ordinaryPage = await machineRpc.call(
        route(RPC_METHODS.DAEMON_EXTERNAL_SESSION_TRANSCRIPT_PAGE),
        {
          machineId: seeded.machineId,
          agentId: linked.agentId,
          remoteSessionId: linked.remoteSessionId,
          source: linked.source,
          direction: 'older',
        },
      );
      expect(unwrapDataKeyRpcResult(ordinaryPage, 'ordinary linked transcript page')).toEqual(
        expect.objectContaining({ ok: true, tailCursor: expect.any(String) }),
      );

      const request = {
        v: 1 as const,
        idempotencyKey: `codex-takeover-${randomUUID()}`,
        sessionId,
        source: {
          machineId: seeded.machineId,
          remoteSessionId,
          qualifiedIdentity: linked.qualifiedIdentity,
          linkGeneration: String(linked.linkedAtMs),
        },
        plan: 'takeover' as const,
        targetStorageMode,
        targetDirectory: linkedDirectory,
        targetRuntimeMode: 'terminal' as const,
        ...(terminalMode === 'tmux' ? { terminal: {
          mode: 'tmux' as const,
          tmux: { sessionName: 'takeover-terminal', isolated: true, tmpDir: tmuxTmpDir ?? testDir },
        } } : {}),
      } satisfies ExternalSessionTakeoverStartInputV1['request'];

      const start = await machineRpc.call(
        route(RPC_METHODS.DAEMON_EXTERNAL_SESSION_TAKEOVER_START),
        { request },
        180_000,
      );
      const startResult = requireRecord(
        unwrapDataKeyRpcResult(start, 'durable Codex takeover start'),
        'durable Codex takeover start',
      );
      expect(startResult).toEqual(expect.objectContaining({
        ok: true,
        progress: expect.objectContaining({
          status: 'awaiting_user_resume',
          phase: 'validating',
          currentStorageState: 'machine_only',
          revision: 0,
        }),
      }));
      const startProgress = requireRecord(startResult.progress, 'takeover start progress');
      const operationId = requireString(startProgress.operationId, 'takeover operation id');
      const startRevision = requireNumber(startProgress.revision, 'takeover start revision');

      const duplicateStart = await machineRpc.call(
        route(RPC_METHODS.DAEMON_EXTERNAL_SESSION_TAKEOVER_START),
        { request },
        180_000,
      );
      expect(unwrapDataKeyRpcResult(duplicateStart, 'idempotent Codex takeover start')).toEqual(startResult);

      const status = await machineRpc.call(
        route(RPC_METHODS.DAEMON_EXTERNAL_SESSION_OPERATION_STATUS_GET),
        { sessionId, operationId, revision: startRevision },
      );
      expect(unwrapDataKeyRpcResult(status, 'Codex takeover status')).toEqual(startResult);

      const requestsBeforeResume = await readFakeCodexAppServerRequestLog(appServerRequestLogPath);
      expect(requestsBeforeResume.filter((entry) => entry.method === 'thread/resume')).toEqual([]);

      const publishedBeforeResume = await fetchSessionMetadataV2({
        baseUrl: serverBaseUrl,
        token: auth.token,
        sessionId,
        machineKeys: [auth.accountMachineKey],
      });
      expect(publishedBeforeResume.externalSessionOperationV1).toEqual({
        v: 1,
        progress: startProgress,
      });

      if (targetStorageMode === 'external-linked') {
        const originalDaemon = daemon;
        if (!originalDaemon) throw new Error('Expected running daemon before takeover restart.');
        daemon = await replaceTestDaemonWithoutStoppingSessions({
          testDir, happyHomeDir: daemonHomeDir, env: daemonEnv, originalDaemon,
        });
        retiredDaemon = originalDaemon;
        await waitFor(async () => {
          try {
            const recovered = requireRecord(unwrapDataKeyRpcResult(await machineRpc.call(
              route(RPC_METHODS.DAEMON_EXTERNAL_SESSION_OPERATION_STATUS_GET),
              { sessionId, operationId, revision: startRevision },
            ), 'external-linked takeover restart status'), 'external-linked takeover restart status');
            const progress = requireRecord(recovered.progress, 'external-linked takeover restart progress');
            return recovered.ok === true && progress.status === 'awaiting_user_resume' && progress.revision === startRevision;
          } catch {
            // The replacement daemon may not have reconnected its machine RPC route yet.
            return false;
          }
        }, { timeoutMs: 60_000, context: 'external-linked takeover checkpoint hydrates after daemon restart' });
        const resumed = requireRecord(unwrapDataKeyRpcResult(await machineRpc.call(
          route(RPC_METHODS.DAEMON_EXTERNAL_SESSION_OPERATION_RESUME),
          { sessionId, operationId, revision: startRevision },
          180_000,
        ), 'external-linked takeover resume'), 'external-linked takeover resume');
        // Codex's current declaration does not guarantee native writer prevention.
        expect(resumed, JSON.stringify(resumed)).toMatchObject({ ok: false, error: { code: 'not_allowed' } });
        expect((await readFakeCodexAppServerRequestLog(appServerRequestLogPath))
          .filter((entry) => entry.method === 'thread/resume')).toEqual([]);
        return;
      }

      const importResume = await machineRpc.call(
        route(RPC_METHODS.DAEMON_EXTERNAL_SESSION_OPERATION_RESUME),
        { sessionId, operationId, revision: startRevision },
        180_000,
      );
      const importResumeResult = requireRecord(
        unwrapDataKeyRpcResult(importResume, 'durable Codex takeover import resume'),
        'durable Codex takeover import resume',
      );
      expect(importResumeResult).toEqual(expect.objectContaining({
        ok: true,
        progress: expect.objectContaining({
          operationId,
          status: 'awaiting_user_resume',
          phase: 'admitting',
          currentStorageState: 'snapshot_complete',
          checkpoint: expect.objectContaining({
            importedItemCount: 1,
            requiredItemFailures: expect.objectContaining({ total: 0 }),
          }),
        }),
      }));
      const importProgress = requireRecord(importResumeResult.progress, 'imported takeover progress');
      const importRevision = requireNumber(importProgress.revision, 'imported takeover revision');
      expect(importRevision).toBeGreaterThan(startRevision);
      const importedMetadata = await fetchSessionMetadataV2({
        baseUrl: serverBaseUrl,
        token: auth.token,
        sessionId,
        machineKeys: [auth.accountMachineKey],
      });
      expect(readNonAuthoritativeLinkedExternalSessionV1FromMetadata(importedMetadata)?.linkData)
        .toMatchObject({ runtimeDescriptorV1: { agent: { backendMode: 'appServer' } } });
      expect((await readFakeCodexAppServerRequestLog(appServerRequestLogPath))
        .filter((entry) => entry.method === 'thread/resume')).toEqual([]);

      if (restartDaemon) {
        // This is deliberately after the persisted-takeover import → admission
        // transition: the operation is now durable but non-terminal, so boot must
        // hydrate it without reading or resuming the native Codex thread.
        const appServerRequestsBeforeRestart = await readFakeCodexAppServerRequestLog(
          appServerRequestLogPath,
        );
        const originalDaemon = daemon;
        if (!originalDaemon) throw new Error('Expected running daemon before persisted takeover restart.');
        const originalDaemonPid = originalDaemon.state.pid;
        const replacement = await replaceTestDaemonWithoutStoppingSessions({
          testDir,
          happyHomeDir: daemonHomeDir,
          env: daemonEnv,
          originalDaemon,
        });
        retiredDaemon = originalDaemon;
        daemon = replacement;
        expect(replacement.state.pid).not.toBe(originalDaemonPid);

        let recoveredStatus: JsonRecord | null = null;
        await waitFor(async () => {
          try {
            const statusAfterRestart = requireRecord(
              unwrapDataKeyRpcResult(await machineRpc.call(
                route(RPC_METHODS.DAEMON_EXTERNAL_SESSION_OPERATION_STATUS_GET),
                { sessionId, operationId, revision: importRevision },
              ), 'Codex takeover status after daemon restart'),
              'Codex takeover status after daemon restart',
            );
            const progressAfterRestart = requireRecord(
              statusAfterRestart.progress,
              'Codex takeover progress after daemon restart',
            );
            if (
              statusAfterRestart.ok === true
              && progressAfterRestart.operationId === operationId
              && progressAfterRestart.revision === importRevision
              && progressAfterRestart.status === 'awaiting_user_resume'
              && progressAfterRestart.phase === 'admitting'
            ) {
              recoveredStatus = statusAfterRestart;
              return true;
            }
          } catch {
            // The replacement daemon may not have reconnected to the machine RPC route yet.
          }
          return false;
        }, {
          timeoutMs: 60_000,
          context: 'persisted takeover admission checkpoint hydrates after daemon restart',
        });
        expect(recoveredStatus).toEqual(importResumeResult);
        expect(await readFakeCodexAppServerRequestLog(appServerRequestLogPath))
          .toEqual(appServerRequestsBeforeRestart);
      }

      const admissionResume = await machineRpc.call(
        route(RPC_METHODS.DAEMON_EXTERNAL_SESSION_OPERATION_RESUME),
        { sessionId, operationId, revision: importRevision },
        180_000,
      );
      const admissionResumeResult = requireRecord(
        unwrapDataKeyRpcResult(admissionResume, 'durable Codex takeover admission resume'),
        'durable Codex takeover admission resume',
      );
      expect(admissionResumeResult, JSON.stringify(admissionResumeResult)).toEqual(expect.objectContaining({
        ok: true,
        progress: expect.objectContaining({
          operationId,
          status: 'completed',
          phase: 'finalizing',
          currentStorageState: 'hosted',
          checkpoint: expect.objectContaining({
            importedItemCount: 1,
            requiredItemFailures: expect.objectContaining({ total: 0 }),
          }),
        }),
      }));
      const completedProgress = requireRecord(
        admissionResumeResult.progress,
        'completed takeover progress',
      );
      const completedRevision = requireNumber(completedProgress.revision, 'completed takeover revision');
      expect(completedRevision).toBeGreaterThan(importRevision);
      await assertResumedInRequestedTerminal();

      const appServerRequests = await readFakeCodexAppServerRequestLog(appServerRequestLogPath);
      expect(appServerRequests.some((entry) =>
        entry.method === 'thread/interrupt'
        || entry.method === 'turn/interrupt')).toBe(false);

      const hostedMetadata = await fetchSessionMetadataV2({
        baseUrl: serverBaseUrl,
        token: auth.token,
        sessionId,
        machineKeys: [auth.accountMachineKey],
      });
      expect(hostedMetadata.externalSessionV1).toBeUndefined();
      expect(hostedMetadata.externalSessionOperationV1).toEqual({
        v: 1,
        progress: completedProgress,
      });
      expect(await fetchPublicMessages({
        baseUrl: serverBaseUrl,
        token: auth.token,
        sessionId,
      })).toEqual(expect.arrayContaining([
        expect.objectContaining({
          content: expect.stringContaining(importedMarker),
        }),
      ]));

      const staleResume = await machineRpc.call(
        route(RPC_METHODS.DAEMON_EXTERNAL_SESSION_OPERATION_RESUME),
        { sessionId, operationId, revision: startRevision },
      );
      expect(unwrapDataKeyRpcResult(staleResume, 'stale Codex takeover resume')).toEqual({
        ok: false,
        error: expect.objectContaining({ code: 'stale_revision' }),
      });
      expect(await readFakeCodexAppServerRequestLog(appServerRequestLogPath)).toEqual(appServerRequests);

      const terminalStatus = await machineRpc.call(
        route(RPC_METHODS.DAEMON_EXTERNAL_SESSION_OPERATION_STATUS_GET),
        { sessionId, operationId, revision: completedRevision },
      );
      expect(unwrapDataKeyRpcResult(terminalStatus, 'terminal Codex takeover status')).toEqual(
        admissionResumeResult,
      );
    } finally {
      ui.close();
    }
    }, 300_000);
  }
});
