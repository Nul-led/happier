import { EventEmitter } from 'node:events';

import { describe, expect, it, vi } from 'vitest';

describe('RelayHostEngine local Windows service control', () => {
  it('ends the scheduled task before running it during restart', async () => {
    const originalPlatform = process.platform;
    const originalFetch = globalThis.fetch;
    const commands: Array<Readonly<{ cmd: string; args: readonly string[] }>> = [];
    try {
      Object.defineProperty(process, 'platform', { value: 'win32' });
      globalThis.fetch = vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({ version: '0.3.0-test' }),
      })) as unknown as typeof fetch;
      vi.doMock('node:os', async () => {
        const actual = await vi.importActual<typeof import('node:os')>('node:os');
        return { ...actual, homedir: () => 'C:\\Users\\test' };
      });
      vi.doMock('node:child_process', async () => {
        const actual = await vi.importActual<typeof import('node:child_process')>('node:child_process');
        return {
          ...actual,
          spawnSync: (cmd: string, args: readonly string[] = []) => {
            commands.push({ cmd, args: [...args] });
            return { status: 0, stdout: '', stderr: '' };
          },
        };
      });
      vi.doMock('node:net', async () => {
        const actual = await vi.importActual<typeof import('node:net')>('node:net');
        return {
          ...actual,
          createConnection: () => {
            const socket = new EventEmitter() as EventEmitter & {
              setTimeout(timeoutMs: number): void;
              destroy(): void;
            };
            socket.setTimeout = () => undefined;
            socket.destroy = () => undefined;
            process.nextTick(() => socket.emit('connect'));
            return socket;
          },
        };
      });
      vi.doMock('../service/index.js', async () => {
        const actual = await vi.importActual<typeof import('../service/index.js')>('../service/index.js');
        return {
          ...actual,
          applyServicePlan: async (plan: Readonly<{ commands: readonly Readonly<{ cmd: string; args: readonly string[] }>[] }>) => {
            for (const command of plan.commands) commands.push(command);
          },
        };
      });

      const { createRelayHostEngine } = await import('./relayHostEngine.js');
      const engine = createRelayHostEngine({
        resolveRemoteReleaseTarget: async () => ({ os: 'linux', arch: 'x64' }),
        runRemoteText: async () => ({ status: 0, stdout: '', stderr: '' }),
        copyLocalDirectoryToRemote: async () => {},
        installRemoteComponent: async () => ({ binaryPath: '', versionId: 'stable-1' }),
      });

      await engine.control({
        target: { kind: 'local' },
        mode: 'user',
        channel: 'stable',
        action: 'restart',
      });

      const scheduledTaskCommands = commands.filter((entry) => entry.cmd === 'schtasks');
      expect(scheduledTaskCommands.map((entry) => entry.args.slice(0, 2))).toEqual([
        ['/End', '/TN'],
        ['/Run', '/TN'],
      ]);
    } finally {
      Object.defineProperty(process, 'platform', { value: originalPlatform });
      globalThis.fetch = originalFetch;
      vi.resetModules();
      vi.clearAllMocks();
      vi.doUnmock('../service/index.js');
    }
  });
});
