import { expectTerminalNativeInvocation, terminalLauncherBoundary } from '@/testkit/process/terminalLauncher';
import { describe, expect, it, vi } from 'vitest';

import { runCodexProviderAttach } from './runCodexProviderAttach';

describe('runCodexProviderAttach', () => {
  it('launches the native Codex TUI against the runner-owned shared endpoint and thread', async () => {
    const spawnProcess = vi.fn(() => terminalLauncherBoundary({
      once: (event: string, handler: (...args: unknown[]) => void) => {
        if (event === 'exit') setImmediate(() => handler(0, null));
      },
    }));

    await expect(runCodexProviderAttach({
      sessionId: 'happy-session-1',
      metadata: { path: '/tmp/repo', codexSessionId: 'thread-1', codexBackendMode: 'appServer' },
      happyHomeDir: '/tmp/happier-home',
      command: 'codex',
      commandArgs: [],
      spawnProcess: spawnProcess as unknown as typeof import('node:child_process').spawn,
      readEndpointFn: async () => ({
        version: 1,
        sessionId: 'happy-session-1',
        endpoint: 'unix:///tmp/happier-codex/private/app-server.sock',
        updatedAt: 1,
      }),
    })).resolves.toBe(0);

    await expectTerminalNativeInvocation(spawnProcess.mock.calls,
      'codex',
      ['--remote', 'unix:///tmp/happier-codex/private/app-server.sock', '--cd', '/tmp/repo', 'resume', 'thread-1'],
      expect.objectContaining({ stdio: 'inherit', shell: false }),
    );
  });

  it('fails closed when the local endpoint descriptor is absent', async () => {
    const spawnProcess = vi.fn();
    await expect(runCodexProviderAttach({
      sessionId: 'happy-session-1',
      metadata: { path: '/tmp/repo', codexSessionId: 'thread-1', codexBackendMode: 'appServer' },
      happyHomeDir: '/tmp/happier-home',
      spawnProcess: spawnProcess as unknown as typeof import('node:child_process').spawn,
      readEndpointFn: async () => null,
    })).resolves.toBe(1);
    expect(spawnProcess).not.toHaveBeenCalled();
  });
});
