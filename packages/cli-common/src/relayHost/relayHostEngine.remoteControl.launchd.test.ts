import { describe, expect, it } from 'vitest';

describe('RelayHostEngine (remote launchd control)', () => {
  it('does not emit a raw remote deletion command for Personal Home erase', async () => {
    const remoteCommands: string[] = [];
    const { createRelayHostEngine } = await import('./relayHostEngine.js');
    const engine = createRelayHostEngine({
      resolveRemoteReleaseTarget: async () => ({ os: 'linux', arch: 'x64' }),
      runRemoteText: async ({ remoteCommand }) => {
        remoteCommands.push(remoteCommand);
        return { status: 0, stdout: '', stderr: '' };
      },
      copyLocalDirectoryToRemote: async () => {},
      installRemoteComponent: async () => ({ binaryPath: '/tmp/happier-server', versionId: 'stable-1' }),
    });

    await expect(engine.control({
      target: { kind: 'ssh', ssh: { target: 'dev@example.test', auth: 'agent' } },
      mode: 'user',
      channel: 'stable',
      purpose: { kind: 'personal-home', canonicalServerUrl: 'http://127.0.0.1:43123' },
      action: 'erase',
      confirmErase: true,
    } as never)).rejects.toThrow('not supported by relay runtime control');
    expect(remoteCommands).toEqual([]);
  });

  it('preserves remote Personal Home data during uninstall by delegating to the remote CLI', async () => {
    const remoteCommands: string[] = [];
    const { createRelayHostEngine } = await import('./relayHostEngine.js');

    const engine = createRelayHostEngine({
      resolveRemoteReleaseTarget: async () => ({ os: 'linux', arch: 'x64' }),
      runRemoteText: async ({ remoteCommand }) => {
        remoteCommands.push(remoteCommand);
        if (remoteCommand.includes('relay host uninstall')) {
          return {
            status: 0,
            stdout: `${JSON.stringify({ v: 1, ok: true, kind: 'relay_host_uninstall', data: { ok: true } })}\n`,
            stderr: '',
          };
        }
        return { status: 0, stdout: '', stderr: '' };
      },
      copyLocalDirectoryToRemote: async () => {},
      installRemoteComponent: async () => {
        throw new Error('remote component installation must not run during uninstall');
      },
    });

    await expect(engine.control({
      target: {
        kind: 'ssh',
        ssh: { target: 'dev@example.test', auth: 'agent' },
      },
      mode: 'user',
      channel: 'stable',
      purpose: { kind: 'personal-home', canonicalServerUrl: 'http://127.0.0.1:43123' },
      action: 'uninstall',
    })).resolves.toBeUndefined();

    expect(remoteCommands).toHaveLength(1);
    const command = remoteCommands[0] ?? '';
    expect(command).toContain('$HOME/.happier/cli/current/happier relay host uninstall');
    expect(command).toContain('--yes');
    expect(command).toContain('--json');
    // No source-side deletion primitive: the remote canonical owner performs all cleanup.
    expect(command).not.toMatch(/rm -rf/u);
    expect(command).not.toContain('systemctl');
    expect(command).not.toContain('launchctl');
  });

  it('uses the remote uid when restarting a user launchd relay over ssh', async () => {
    const remoteCommands: string[] = [];
    const { createRelayHostEngine } = await import('./relayHostEngine.js');

    const engine = createRelayHostEngine({
      resolveRemoteReleaseTarget: async () => ({ os: 'darwin', arch: 'arm64' }),
      runRemoteText: async ({ remoteCommand }) => {
        remoteCommands.push(remoteCommand);
        if (remoteCommand.includes('server.env')) {
          return { status: 0, stdout: 'PORT=3005\nHAPPIER_SERVER_HOST=127.0.0.1\n', stderr: '' };
        }
        if (remoteCommand.includes('if [ -f ')) {
          return { status: 0, stdout: 'yes\n', stderr: '' };
        }
        return { status: 0, stdout: '', stderr: '' };
      },
      copyLocalDirectoryToRemote: async () => {},
      installRemoteComponent: async () => ({
        binaryPath: '$HOME/.happier/happier-server/current/happier-server',
        versionId: 'publicdev-1',
      }),
    });

    await expect(engine.control({
      target: {
        kind: 'ssh',
        ssh: {
          target: 'dev@example.test',
          auth: 'agent',
        },
      },
      mode: 'user',
      channel: 'preview',
      action: 'restart',
    })).resolves.toBeUndefined();

    expect(remoteCommands[0]).toContain('launchctl kickstart -k');
    expect(remoteCommands[0]).toContain('gui/$(id -u)/happier-server-preview');
    expect(remoteCommands[0]).not.toContain(`gui/${typeof process.getuid === 'function' ? process.getuid() : 0}/happier-server-preview`);
  });
});
