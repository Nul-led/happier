import { describe, expect, it, vi } from 'vitest';

describe('RelayHostEngine durable service authority', () => {
  it('quarantines a Windows scheduled task by disabling and stopping it, then proves the postcondition', async () => {
    const originalPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'win32' });
    let enabled = true;
    let active = true;
    const powerShellCommands: string[] = [];

    try {
      vi.doMock('node:os', async () => {
        const actual = await vi.importActual<typeof import('node:os')>('node:os');
        return { ...actual, homedir: () => 'C:\\Users\\tester' };
      });
      vi.doMock('node:child_process', async () => {
        const actual = await vi.importActual<typeof import('node:child_process')>('node:child_process');
        return {
          ...actual,
          spawnSync: (cmd: string, args?: readonly string[]) => {
            const command = Array.isArray(args) ? String(args.at(-1) ?? '') : '';
            if (cmd === 'where') return { status: 0, stdout: '', stderr: '' };
            if (cmd === 'powershell.exe') {
              powerShellCommands.push(command);
              if (command.includes('Disable-ScheduledTask')) enabled = false;
              if (command.includes('Stop-ScheduledTask')) active = false;
              if (command.includes('ConvertTo-Json')) {
                return {
                  status: 0,
                  stdout: JSON.stringify({ exists: true, enabled, active, stateLabel: active ? 'Running' : 'Ready', stateValue: active ? 4 : 3 }),
                  stderr: '',
                };
              }
              return { status: 0, stdout: '', stderr: '' };
            }
            if (cmd === 'schtasks') return { status: 0, stdout: '', stderr: '' };
            return { status: 0, stdout: '', stderr: '' };
          },
        };
      });

      const { createRelayHostEngine } = await import('./relayHostEngine.js');
      const engine = createRelayHostEngine({
        resolveRemoteReleaseTarget: async () => ({ os: 'linux', arch: 'x64' }),
        runRemoteText: async () => ({ status: 0, stdout: '', stderr: '' }),
        copyLocalDirectoryToRemote: async () => {},
        installRemoteComponent: async () => ({ binaryPath: 'unused', versionId: 'unused' }),
      });

      await engine.control({
        target: { kind: 'local' },
        mode: 'user',
        channel: 'stable',
        action: 'quarantine',
      });
      await engine.control({
        target: { kind: 'local' },
        mode: 'user',
        channel: 'stable',
        action: 'quarantine',
      });

      expect(powerShellCommands.some((command) => command.includes('Disable-ScheduledTask'))).toBe(true);
      expect(powerShellCommands.some((command) => command.includes('Stop-ScheduledTask'))).toBe(true);
      await expect(engine.readStatus({ target: { kind: 'local' }, mode: 'user', channel: 'stable' }))
        .resolves.toMatchObject({ service: { enabled: false, active: false } });

    } finally {
      Object.defineProperty(process, 'platform', { value: originalPlatform });
      vi.resetModules();
      vi.clearAllMocks();
    }
  });
});
