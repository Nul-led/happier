import { describe, expect, it, vi } from 'vitest';

import { createCodexSharedAppServer } from './sharedServer.js';

describe('createCodexSharedAppServer', () => {
  it('starts one private socket server and connects Happier clients over its WebSocket transport', async () => {
    const processHandle = { dispose: vi.fn(async () => undefined) };
    const spawn = vi.fn(async () => processHandle);
    const createClient = vi.fn(async (params: unknown) => ({ params }));
    const removeRuntimeDirectory = vi.fn(async () => undefined);
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
        waitForSocket: vi.fn(async () => undefined),
        removeRuntimeDirectory,
        createClient: createClient as never,
        probeRealtime: async () => true,
      },
    });

    expect(server?.endpoint).toBe('unix:///tmp/happier-codex-private/private/app-server.sock');
    await server?.createClient({
      cwd: '/repo',
      processEnv: { HOME: '/home/test' },
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
