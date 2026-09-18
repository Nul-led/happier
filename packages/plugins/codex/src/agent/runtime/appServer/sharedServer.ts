import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { ExecService, PluginProcessHandle } from '@happier-dev/plugin-sdk/exec';

import { parseCodexCliStableVersion } from '../../cli/detect.js';
import {
  buildCodexAppServerArgs,
  buildCodexAppServerEnv,
  createCodexNativeAppServerClient,
  probeCodexRealtimeConversationFeature,
  type DisposableCodexAppServerClient,
} from './client.js';

type CodexAppServerEnv = Readonly<Record<string, string | undefined>>;
const SHARED_CONTROL_MIN_MINOR_UNIX = 131;

type Dependencies = Readonly<{
  readCodexVersion: (exec: ExecService, env: CodexAppServerEnv, signal?: AbortSignal) => Promise<string>;
  createRuntimeDirectory: () => Promise<string>;
  waitForSocket: (socketPath: string, process: PluginProcessHandle) => Promise<void>;
  removeRuntimeDirectory: (directory: string) => Promise<void>;
  createClient: typeof createCodexNativeAppServerClient;
  probeRealtime: typeof probeCodexRealtimeConversationFeature;
}>;

async function readCodexVersion(
  exec: ExecService,
  env: CodexAppServerEnv,
  signal?: AbortSignal,
): Promise<string> {
  const tool = await exec.systemTools.resolve({
    toolId: 'codex-cli',
    purpose: 'Check Codex shared local-control support',
    ...(signal ? { signal } : {}),
  });
  const result = await exec.run({
    executable: tool.executable,
    args: ['--version'],
    cwd: { root: 'workspace', relativePath: '' },
    env: buildCodexAppServerEnv(env),
    maxStdoutBytes: 4_096,
    maxStderrBytes: 4_096,
    timeoutMs: 5_000,
  }, signal ? { signal } : undefined);
  return new TextDecoder().decode(result.stdout);
}

function supportsSharedControl(versionOutput: string, platform: NodeJS.Platform): boolean {
  // Codex 0.154 added protected Windows AF_UNIX sockets, but Node's IPC path
  // transport connects Windows named pipes only. Fail closed until the host
  // provides an AF_UNIX-capable bridge for the plugin transport.
  if (platform === 'win32') return false;
  const version = parseCodexCliStableVersion(versionOutput);
  return Boolean(version && (version.major > 0 || version.minor >= SHARED_CONTROL_MIN_MINOR_UNIX));
}

async function waitForSocket(socketPath: string, process: PluginProcessHandle): Promise<void> {
  let terminated = false;
  void process.wait().then(() => { terminated = true; }, () => { terminated = true; });
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (terminated) throw new Error('Codex shared app-server exited before its socket was ready.');
    try {
      await stat(socketPath);
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }
  throw new Error(`Timed out waiting for Codex shared app-server socket at ${socketPath}`);
}

function defaultDependencies(): Dependencies {
  return {
    readCodexVersion,
    createRuntimeDirectory: async () => await mkdtemp(join(tmpdir(), 'happier-codex-')),
    waitForSocket,
    removeRuntimeDirectory: async (directory) => await rm(directory, { recursive: true, force: true }),
    createClient: createCodexNativeAppServerClient,
    probeRealtime: probeCodexRealtimeConversationFeature,
  };
}

export async function createCodexSharedAppServer(params: Readonly<{
  exec: ExecService;
  processEnv: CodexAppServerEnv;
  platform?: NodeJS.Platform;
  signal?: AbortSignal;
  dependencies?: Partial<Dependencies>;
}>): Promise<Readonly<{
  endpoint: string;
  createClient: (request: Readonly<{
    cwd: string;
    processEnv: CodexAppServerEnv;
    configOverrides: readonly string[];
    disableUserMcpServers: boolean;
  }>) => Promise<DisposableCodexAppServerClient>;
  dispose: () => Promise<void>;
}> | null> {
  const dependencies = { ...defaultDependencies(), ...params.dependencies };
  const versionOutput = await dependencies.readCodexVersion(
    params.exec,
    params.processEnv,
    params.signal,
  ).catch(() => '');
  if (!supportsSharedControl(versionOutput, params.platform ?? process.platform)) return null;

  const runtimeDirectory = await dependencies.createRuntimeDirectory();
  // Leave the socket parent absent so Codex creates it with its cross-platform
  // private-directory policy (0700 on Unix, a user-only DACL on Windows).
  const socketPath = join(runtimeDirectory, 'private', 'app-server.sock');
  const endpoint = `unix://${socketPath}`;
  let serverProcess: PluginProcessHandle | null = null;
  let realtimeConversationAdvertised = false;
  let startPromise: Promise<void> | null = null;
  let disposed = false;

  const ensureStarted = async (request: Readonly<{
    processEnv: CodexAppServerEnv;
    configOverrides: readonly string[];
    disableUserMcpServers: boolean;
  }>): Promise<void> => {
    startPromise ??= (async () => {
      const tool = await params.exec.systemTools.resolve({
        toolId: 'codex-cli',
        purpose: 'Launch the Codex shared app-server',
        ...(params.signal ? { signal: params.signal } : {}),
      });
      realtimeConversationAdvertised = await dependencies.probeRealtime({
        exec: params.exec,
        executable: tool.executable,
        env: request.processEnv,
        ...(params.signal ? { signal: params.signal } : {}),
      });
      serverProcess = await params.exec.spawn({
        executable: tool.executable,
        args: buildCodexAppServerArgs({
          env: request.processEnv,
          configOverrides: request.configOverrides,
          disableUserMcpServers: request.disableUserMcpServers,
          enableRealtimeConversation: realtimeConversationAdvertised,
          listenUrl: endpoint,
        }),
        cwd: { root: 'workspace', relativePath: '' },
        env: buildCodexAppServerEnv(request.processEnv),
        maxStdoutBytes: 4_096,
        maxStderrBytes: 16_384,
      }, params.signal ? { signal: params.signal } : undefined);
      await dependencies.waitForSocket(socketPath, serverProcess);
    })();
    try {
      await startPromise;
    } catch (error) {
      await serverProcess?.dispose().catch(() => undefined);
      await dependencies.removeRuntimeDirectory(runtimeDirectory);
      throw error;
    }
  };

  return {
    endpoint,
    createClient: async (request) => {
      await ensureStarted(request);
      return await dependencies.createClient({
        exec: params.exec,
        cwd: request.cwd,
        processEnv: request.processEnv,
        signal: params.signal,
        transport: {
          kind: 'unixWebSocket',
          socketPath,
          realtimeConversationAdvertised,
        },
      });
    },
    dispose: async () => {
      if (disposed) return;
      disposed = true;
      await serverProcess?.dispose().catch(() => undefined);
      await dependencies.removeRuntimeDirectory(runtimeDirectory);
    },
  };
}
