import { createServer } from 'node:http';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { WebSocketServer } from 'ws';
import type { ExecService } from '@happier-dev/plugin-sdk/exec';
import type { AgentSessionRuntime, AgentSessionRuntimeContext } from '@happier-dev/plugin-sdk/agents/runtime';

import { createCodexNativeAppServerClient } from './client.js';
import { createCodexAppServerRuntime, startCodexAppServerRuntime } from './runtime.js';
import { openCodexNativeAppServerSession } from './native.js';

// The network fixture models pinned Codex 0.159.2's empty paginated rollout:
// name/set supplies metadata; a full read persists it; native resume then works.
async function withFixture(run: (fixture: {
  runtime: ReturnType<typeof createCodexAppServerRuntime>;
  requests: Array<{ method: string; params: Record<string, unknown> }>;
  resume(): Promise<unknown>;
  failRead(): void;
  openConfiguredSession(): Promise<AgentSessionRuntime>;
}) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), 'happier-codex-native-attach-'));
  const socketPath = process.platform === 'win32'
    ? `\\\\.\\pipe\\happier-codex-native-attach-${process.pid}-${Date.now()}`
    : join(root, 'app-server.sock');
  const server = createServer();
  const ws = new WebSocketServer({ server });
  const requests: Array<{ method: string; params: Record<string, unknown> }> = [];
  let named = false;
  let materialized = false;
  let rejectRead = false;
  const bindServer = (webSockets: WebSocketServer) => webSockets.on('connection', (socket) => socket.on('message', (payload) => {
    const message = JSON.parse(payload.toString()) as {
      id?: number; method: string; params?: Record<string, unknown>;
    };
    if (message.id === undefined) return;
    const params = message.params ?? {};
    requests.push({ method: message.method, params });
    let result: unknown = {};
    let error: unknown;
    if (message.method === 'thread/start') {
      result = { thread: { id: 'fresh-thread', turns: [] }, sandbox: { type: 'readOnly' }, reasoningEffort: 'low' };
    } else if (message.method === 'thread/name/set') {
      named = true;
    } else if (message.method === 'thread/read') {
      if (rejectRead) error = { code: -32000, message: 'rollout persistence failed' };
      else {
        materialized = named && params.includeTurns === true;
        result = { thread: { id: params.threadId, turns: [] } };
      }
    } else if (message.method === 'thread/resume') {
      if (params.threadId === 'fresh-thread' && !materialized) error = { code: -32000, message: 'no rollout found' };
      else result = { thread: { id: params.threadId, turns: [] }, sandbox: { type: 'readOnly' }, reasoningEffort: 'low' };
    } else if (message.method === 'experimentalFeature/list') {
      result = { data: [{ name: 'realtime_conversation', enabled: true }], nextCursor: null };
    }
    socket.send(JSON.stringify({ id: message.id, ...(error ? { error } : { result }) }));
    if (message.method === 'thread/realtime/start') {
      socket.send(JSON.stringify({ method: 'thread/realtime/started', params: { threadId: 'fresh-thread', realtimeSessionId: null, version: 'v3' } }));
      socket.send(JSON.stringify({ method: 'thread/realtime/sdp', params: { threadId: 'fresh-thread', sdp: 'answer' } }));
    }
  }));
  bindServer(ws);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(socketPath, resolve);
  });
  // Only tool resolution crosses the Exec boundary; the real client uses Unix transport.
  const exec = {
    systemTools: { resolve: async () => ({ executable: { kind: 'systemTool', id: 'codex-cli' }, executablePath: '/fixture/codex' }) },
  } as unknown as ExecService;
  const createClient = async () => await createCodexNativeAppServerClient({
    exec, processEnv: {}, transport: { kind: 'unixWebSocket', socketPath, realtimeConversationAdvertised: true },
  });
  const runtime = createCodexAppServerRuntime({
    directory: root, happierSessionId: 'actual-happier-session',
    resolveCurrentPolicy: () => ({ approvalPolicy: 'never', sandbox: 'read-only', sandboxPolicy: { type: 'readOnly' } }),
    host: { baseProcessEnv: {}, logger: { debug: vi.fn(), warn: vi.fn() }, createClient },
  });
  let nativeSession: AgentSessionRuntime | null = null;
  await runtime.updateConfig?.({ configOption: { id: 'reasoning_effort', value: 'low' } });
  try {
    await run({ runtime, requests, failRead: () => { rejectRead = true; }, async openConfiguredSession() {
      // Exec and host SDK services are genuine external boundaries; native/runtime/client logic stays real.
      const nativeExec = {
        ...exec,
        run: async (request: { args: readonly string[] }) => ({
          stdout: new TextEncoder().encode(request.args.includes('--version') ? 'codex-cli 0.159.2' : ''),
          stderr: new Uint8Array(),
          termination: { observed: { kind: 'exit', exitCode: 0 } },
        }),
        spawn: async (request: { args: readonly string[] }) => {
          const endpoint = request.args[request.args.indexOf('--listen') + 1];
          if (!endpoint?.startsWith('unix://')) throw new Error('Expected shared native socket launch');
          const nativeSocketPath = endpoint.slice('unix://'.length);
          await mkdir(dirname(nativeSocketPath), { recursive: true, mode: 0o700 });
          const nativeServer = createServer();
          const nativeWebSockets = new WebSocketServer({ server: nativeServer });
          bindServer(nativeWebSockets);
          await new Promise<void>((resolve, reject) => {
            nativeServer.once('error', reject);
            nativeServer.listen(nativeSocketPath, resolve);
          });
          let settleExit!: (value: unknown) => void;
          const exited = new Promise((resolve) => { settleExit = resolve; });
          return {
            wait: () => exited,
            dispose: async () => {
              for (const socket of nativeWebSockets.clients) socket.terminate();
              await new Promise<void>((resolve) => nativeWebSockets.close(() => resolve()));
              await new Promise<void>((resolve, reject) => nativeServer.close((error) => error ? reject(error) : resolve()));
              settleExit({ termination: { observed: { kind: 'exit', exitCode: 0 } } });
            },
          };
        },
      } as unknown as ExecService;
      const context = {
        signal: new AbortController().signal,
        services: { exec: nativeExec, logger: { debug: vi.fn(), warn: vi.fn() }, sessions: {} },
        session: { id: 'actual-happier-session', services: {} },
        ui: { title: { set: async () => undefined } },
      } as unknown as AgentSessionRuntimeContext;
      nativeSession = await openCodexNativeAppServerSession({
        kind: 'create', sessionId: 'actual-happier-session', cwd: root,
        launchEnvironment: { values: { CODEX_HOME: root }, unset: [] },
        configuration: {
          mode: { value: null, updatedAtMs: 0 }, model: { value: 'fixture-model', updatedAtMs: 1 },
          permissionIntent: { value: 'read-only', updatedAtMs: 1 },
          options: { reasoning_effort: { value: 'low', updatedAtMs: 1 } },
        },
        startupInstructions: { v: 1, id: 'fixture.startup', revision: 1, instructions: 'Actual startup instructions.' },
      }, context);
      return nativeSession;
    }, async resume() {
      const peer = await createClient();
      try { return await peer.request('thread/resume', { threadId: 'fresh-thread' }); }
      finally { await peer.dispose(); }
    } });
  } finally {
    await nativeSession?.dispose();
    await runtime.dispose();
    await new Promise<void>((resolve) => ws.close(() => resolve()));
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await rm(root, { recursive: true, force: true });
  }
}

describe('native Codex attachment preparation', () => {
  it.skipIf(process.platform === 'win32')('applies initial canonical effort before startup instructions initialize the native attachment thread', async () => {
    await withFixture(async ({ openConfiguredSession, requests }) => {
      const session = await openConfiguredSession();
      await session.prepareProviderCliAttach?.();
      expect(requests.find((r) => r.method === 'thread/start')?.params).toMatchObject({
        model: 'fixture-model', permissions: ':read-only',
        config: { model_reasoning_effort: 'low' },
        developerInstructions: 'Actual startup instructions.',
      });
      expect(requests.filter((r) => r.method === 'thread/start')).toHaveLength(1);
      expect(requests.some((r) => r.method === 'turn/start')).toBe(false);
    });
  });
  it('materializes zero-turn fresh threads once and preserves identity and policy on repeat attach', async () => {
    await withFixture(async ({ runtime, requests, resume }) => {
      await expect(runtime.prepareProviderCliAttach()).resolves.toBe('fresh-thread');
      await expect(runtime.prepareProviderCliAttach()).resolves.toBe('fresh-thread');
      expect(runtime.identity.read()).toEqual({ providerSessionId: 'fresh-thread' });
      await expect(resume()).resolves.toMatchObject({ thread: { id: 'fresh-thread', turns: [] }, sandbox: { type: 'readOnly' }, reasoningEffort: 'low' });
      await expect(resume()).resolves.toMatchObject({ thread: { id: 'fresh-thread', turns: [] } });
      expect(requests.filter((r) => r.method === 'thread/start')).toHaveLength(1);
      expect(requests.filter((r) => r.method === 'thread/name/set')).toEqual([{ method: 'thread/name/set', params: { threadId: 'fresh-thread', name: 'Happier session actual-happier-session' } }]);
      expect(requests.filter((r) => r.method === 'thread/read')).toEqual([{ method: 'thread/read', params: { threadId: 'fresh-thread', includeTurns: true } }]);
      expect(requests.some((r) => r.method === 'turn/start')).toBe(false);
      expect(requests.find((r) => r.method === 'thread/start')?.params).toMatchObject({ permissions: ':read-only', config: { model_reasoning_effort: 'low' } });
      await runtime.updateConfig?.({ modelId: 'later-model' });
      await expect(runtime.prepareProviderCliAttach()).resolves.toBe('fresh-thread');
      expect(requests.filter((r) => r.method === 'thread/start')).toHaveLength(1);
      await runtime.updateConfig?.({ permissionMode: 'acceptEdits' });
      await expect(runtime.prepareProviderCliAttach()).resolves.toBe('fresh-thread');
      expect(requests.filter((r) => r.method === 'thread/start')).toHaveLength(1);
    });
  });

  it('keeps an existing resumed thread name and does not initialize a new thread', async () => {
    await withFixture(async ({ runtime, requests }) => {
      await startCodexAppServerRuntime(runtime, { resumeId: 'existing-thread', importHistory: false });
      await expect(runtime.prepareProviderCliAttach()).resolves.toBe('existing-thread');
      expect(requests.filter((r) => ['thread/start', 'thread/name/set', 'thread/read', 'turn/start'].includes(r.method))).toEqual([]);
    });
  });

  it('materializes a realtime-published zero-turn thread before native resume without replacing its identity', async () => {
    await withFixture(async ({ runtime, requests, resume }) => {
      await startCodexAppServerRuntime(runtime);
      const started = await runtime.realtimeConversation.start({ transport: { kind: 'webrtc', offerSdp: 'offer' } });
      expect(started.status).toBe('started');
      if (started.status !== 'started') throw new Error('Realtime fixture failed to start');
      expect(runtime.identity.read()).toEqual({ providerSessionId: 'fresh-thread' });
      await expect(resume()).rejects.toThrow('no rollout found');

      await expect(runtime.prepareProviderCliAttach()).resolves.toBe('fresh-thread');
      await expect(resume()).resolves.toMatchObject({ thread: { id: 'fresh-thread', turns: [] } });
      await expect(runtime.prepareProviderCliAttach()).resolves.toBe('fresh-thread');
      await expect(resume()).resolves.toMatchObject({ thread: { id: 'fresh-thread', turns: [] } });
      expect(requests.filter((r) => r.method === 'thread/start')).toHaveLength(1);
      expect(requests.filter((r) => r.method === 'thread/name/set')).toHaveLength(1);
      expect(requests.filter((r) => r.method === 'thread/read')).toHaveLength(1);
      expect(requests.some((r) => r.method === 'turn/start')).toBe(false);
      await started.handle.stop();
      await runtime.updateConfig?.({ modelId: 'later-model' });
      await expect(runtime.prepareProviderCliAttach()).resolves.toBe('fresh-thread');
      expect(requests.filter((r) => r.method === 'thread/start')).toHaveLength(1);
      expect(requests.filter((r) => r.method === 'thread/read')).toHaveLength(1);
    });
  });

  it('withholds attachment identity if the fresh rollout cannot be materialized', async () => {
    await withFixture(async ({ runtime, failRead }) => {
      failRead();
      await expect(runtime.prepareProviderCliAttach()).rejects.toThrow('rollout persistence failed');
      expect(runtime.identity.read()).toEqual({ providerSessionId: null });
    });
  });
});
