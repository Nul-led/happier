import { describe, expect, it, vi } from 'vitest';

import { createCodexSharedAppServer } from './sharedServer.js';

describe('createCodexSharedAppServer', () => {
  it('uses the canonical app-server startup budget for the shared-control version probe', async () => {
    const run = vi.fn(async () => ({
      stdout: new TextEncoder().encode('codex-cli 0.131.0'),
      stderr: new Uint8Array(),
      exitCode: 0,
    }));
    const server = await createCodexSharedAppServer({
      exec: {
        systemTools: { resolve: vi.fn(async () => ({ executable: { kind: 'systemTool', id: 'codex-cli' } })) },
        run,
      } as never,
      processEnv: {},
      platform: 'linux',
      dependencies: {
        createRuntimeDirectory: async () => '/tmp/happier-codex-version-probe',
        removeRuntimeDirectory: async () => undefined,
      },
    });

    expect(run).toHaveBeenCalledWith(expect.objectContaining({
      args: ['--version'],
      timeoutMs: 60_000,
    }), undefined);
    await server?.dispose();
  });

  it('starts one private socket server and connects Happier clients over its WebSocket transport', async () => {
    const processHandle = { dispose: vi.fn(async () => undefined) };
    const spawn = vi.fn(async () => processHandle);
    const createClient = vi.fn(async (params: unknown) => ({ params }));
    const removeRuntimeDirectory = vi.fn(async () => undefined);
    const waitForSocket = vi.fn(async () => undefined);
    const server = await createCodexSharedAppServer({
      exec: {
        systemTools: { resolve: vi.fn(async () => ({ executable: { kind: 'systemTool', id: 'codex-cli' } })) },
        spawn,
      } as never,
      processEnv: { HOME: '/home/test' },
      platform: 'linux',
      dependencies: {
        readCodexVersion: async () => 'codex-cli 0.131.0',
        createRuntimeDirectory: async () => '/tmp/happier-codex-private',
        waitForSocket,
        removeRuntimeDirectory,
        createClient: createClient as never,
        probeRealtime: async () => true,
      },
    });

    expect(server?.endpoint).toBe('unix:///tmp/happier-codex-private/private/app-server.sock');
    await server?.createClient({
      cwd: '/repo',
      processEnv: {
        HOME: '/home/test',
        HAPPIER_CODEX_APP_SERVER_STARTUP_RPC_TIMEOUT_MS: '90000',
      },
      configOverrides: ['model="gpt-5"'],
      disableUserMcpServers: false,
    });
    expect(spawn).toHaveBeenCalledWith(expect.objectContaining({
      args: [
        'app-server', '--listen', 'unix:///tmp/happier-codex-private/private/app-server.sock',
        '--enable', 'realtime_conversation',
        '-c', 'model="gpt-5"',
      ],
    }), undefined);
    expect(waitForSocket).toHaveBeenCalledWith(
      '/tmp/happier-codex-private/private/app-server.sock',
      processHandle,
      90_000,
    );
    expect(createClient).toHaveBeenCalledWith(expect.objectContaining({
      transport: {
        kind: 'unixWebSocket',
        socketPath: '/tmp/happier-codex-private/private/app-server.sock',
        realtimeConversationAdvertised: true,
      },
    }));
    await server?.dispose();
    expect(processHandle.dispose).toHaveBeenCalledTimes(1);
    expect(removeRuntimeDirectory).toHaveBeenCalledWith('/tmp/happier-codex-private');
  });

  it.each([
    ['linux', 'codex-cli 0.130.0', false],
    ['win32', 'codex-cli 0.153.0', false],
    ['win32', 'codex-cli 0.154.0', false],
    ['win32', 'codex-cli 0.999.0', false],
  ] as const)('uses the first safe shared app-server release on %s: %s', async (platform, version, expected) => {
    const spawn = vi.fn();
    const server = await createCodexSharedAppServer({
      exec: { systemTools: { resolve: vi.fn() }, spawn } as never,
      processEnv: {},
      platform,
      dependencies: {
        readCodexVersion: async () => version,
        createRuntimeDirectory: async () => '/tmp/happier-codex-version-gate',
        removeRuntimeDirectory: async () => undefined,
      },
    });
    expect(Boolean(server)).toBe(expected);
    expect(spawn).not.toHaveBeenCalled();
    await server?.dispose();
  });
});
