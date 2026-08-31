import { describe, expect, it } from 'vitest';

import { createRelayHostEngine } from './relayHostEngine.js';

type RemoteUninstallFixture = Readonly<{ status: number; stdout: string; stderr: string }>;

function renderRemoteUninstallSuccessEnvelope(): string {
  return `${JSON.stringify({ v: 1, ok: true, kind: 'relay_host_uninstall', data: { ok: true } })}\n`;
}

function renderRemoteUninstallFailureEnvelope(message: string): string {
  return `${JSON.stringify({ v: 1, ok: false, kind: 'relay_host', error: { code: 'remote_error', message } })}\n`;
}

describe('RelayHostEngine remote installation ownership', () => {
  it('delegates installation to the canonical remote CLI installer', async () => {
    const installedComponents: string[] = [];
    const commands: string[] = [];
    const engine = createRelayHostEngine({
      resolveRemoteReleaseTarget: async () => ({ os: 'linux', arch: 'x64' }),
      copyLocalDirectoryToRemote: async () => {},
      installRemoteComponent: async ({ componentId }) => {
        installedComponents.push(componentId);
        return {
          binaryPath: '$HOME/.happier/cli-dev/current/happier',
          versionId: 'cli-dev-1',
        };
      },
      runRemoteText: async ({ remoteCommand }) => {
        commands.push(remoteCommand);
        if (remoteCommand.includes('relay host install')) {
          return {
            status: 0,
            stdout: `${JSON.stringify({
              ok: true,
              kind: 'relay_host_install',
              data: { relayUrl: 'http://127.0.0.1:3005', mode: 'user' },
            })}\n`,
            stderr: '',
          };
        }
        return { status: 0, stdout: '', stderr: '' };
      },
    });

    await expect(engine.installOrUpdate({
      target: { kind: 'ssh', ssh: { target: 'dev@example.test', auth: 'agent' } },
      channel: 'dev',
      mode: 'user',
      env: { PORT: '3005' },
    })).resolves.toEqual({ relayUrl: 'http://127.0.0.1:3005', mode: 'user' });

    expect(installedComponents).toEqual(['happier-cli']);
    expect(commands.some((command) => command.includes('relay host install'))).toBe(true);
    expect(commands.some((command) => command.includes('--env') && command.includes('PORT=3005'))).toBe(true);
    expect(commands.some((command) => command.includes('self-host-state.json'))).toBe(false);
    expect(commands.some((command) => command.includes('systemctl'))).toBe(false);
  });

  it('forwards an explicit local server payload through the canonical remote installer', async () => {
    const installations: Array<{ componentId: string; localBinaryPath?: string }> = [];
    let installCommand = '';
    const engine = createRelayHostEngine({
      resolveRemoteReleaseTarget: async () => ({ os: 'linux', arch: 'x64' }),
      copyLocalDirectoryToRemote: async () => {},
      installRemoteComponent: async ({ componentId, localBinaryPath }) => {
        installations.push({ componentId, ...(localBinaryPath ? { localBinaryPath } : {}) });
        return {
          binaryPath: componentId === 'happier-cli'
            ? '$HOME/.happier/cli-preview/current/happier'
            : '/home/remote/.happier/happier-server/preview/current/bin/happier-server',
          versionId: 'preview-1',
        };
      },
      runRemoteText: async ({ remoteCommand }) => {
        installCommand = remoteCommand;
        return {
          status: 0,
          stdout: `${JSON.stringify({
            ok: true,
            kind: 'relay_host_install',
            data: { relayUrl: 'http://127.0.0.1:3005', mode: 'system' },
          })}\n`,
          stderr: '',
        };
      },
    });

    await engine.installOrUpdate({
      target: { kind: 'ssh', ssh: { target: 'dev@example.test', auth: 'agent' } },
      channel: 'preview',
      mode: 'system',
      selfHostRelayBinaryOverride: '/tmp/local/happier-server',
    });

    expect(installations).toEqual([
      { componentId: 'happier-cli' },
      { componentId: 'happier-server', localBinaryPath: '/tmp/local/happier-server' },
    ]);
    expect(installCommand).toContain('--server-binary');
    expect(installCommand).toContain('/home/remote/.happier/happier-server/preview/current/bin/happier-server');
    expect(installCommand).toContain('--mode system');
  });

  it('surfaces the canonical remote installer error instead of interpreting partial output', async () => {
    const engine = createRelayHostEngine({
      resolveRemoteReleaseTarget: async () => ({ os: 'linux', arch: 'x64' }),
      copyLocalDirectoryToRemote: async () => {},
      installRemoteComponent: async () => ({
        binaryPath: '$HOME/.happier/cli/current/happier',
        versionId: 'stable-1',
      }),
      runRemoteText: async () => ({
        status: 1,
        stdout: `${JSON.stringify({
          ok: false,
          kind: 'relay_host',
          error: { message: 'predecessor recovery could not be verified' },
        })}\n`,
        stderr: 'remote command failed',
      }),
    });

    await expect(engine.installOrUpdate({
      target: { kind: 'ssh', ssh: { target: 'dev@example.test', auth: 'agent' } },
      channel: 'stable',
      mode: 'user',
    })).rejects.toThrow('predecessor recovery could not be verified');
  });
});

describe('RelayHostEngine remote uninstall delegation', () => {
  const sshTarget = { target: { kind: 'ssh', ssh: { target: 'dev@example.test', auth: 'agent' } } } as const;

  function createUninstallEngine(params: Readonly<{
    runRemoteText: (params: Readonly<{ remoteCommand: string }>) => Promise<RemoteUninstallFixture>;
    installRemoteComponent?: (params: Readonly<{ componentId: string }>) => Promise<Readonly<{
      binaryPath: string;
      versionId: string;
    }>>;
  }>) {
    return createRelayHostEngine({
      resolveRemoteReleaseTarget: async () => ({ os: 'linux', arch: 'x64' }),
      copyLocalDirectoryToRemote: async () => {},
      installRemoteComponent: params.installRemoteComponent ?? (async () => {
        throw new Error('remote component installation must not run during uninstall');
      }),
      runRemoteText: async ({ remoteCommand }) => await params.runRemoteText({ remoteCommand }),
    });
  }

  it('delegates uninstall to the installed canonical remote CLI and emits no direct cleanup', async () => {
    const commands: string[] = [];
    const engine = createUninstallEngine({
      runRemoteText: async ({ remoteCommand }) => {
        commands.push(remoteCommand);
        return { status: 0, stdout: renderRemoteUninstallSuccessEnvelope(), stderr: '' };
      },
    });

    await expect(engine.control({
      ...sshTarget,
      channel: 'dev',
      mode: 'user',
      action: 'uninstall',
    } as never)).resolves.toBeUndefined();

    expect(commands).toHaveLength(1);
    const command = commands[0] ?? '';
    expect(command).toContain('$HOME/.happier/cli-dev/current/happier relay host uninstall');
    expect(command).toContain("--channel 'dev'");
    expect(command).toContain('--mode user');
    expect(command).toContain('--yes');
    expect(command).toContain('--json');
    // Thin transport adapter: the source side makes no deletion decision of its own.
    expect(command).not.toContain('rm ');
    expect(command).not.toContain('systemctl');
    expect(command).not.toContain('launchctl');
    expect(command).not.toContain('schtasks');
  });

  it('preserves the canonical channel ring and mode exactly through existing normalization', async () => {
    const commands: string[] = [];
    const engine = createUninstallEngine({
      runRemoteText: async ({ remoteCommand }) => {
        commands.push(remoteCommand);
        return { status: 0, stdout: renderRemoteUninstallSuccessEnvelope(), stderr: '' };
      },
    });

    await expect(engine.control({
      ...sshTarget,
      channel: 'stable',
      mode: 'system',
      action: 'uninstall',
    } as never)).resolves.toBeUndefined();

    expect(commands).toHaveLength(1);
    const command = commands[0] ?? '';
    expect(command).toContain('$HOME/.happier/cli/current/happier relay host uninstall');
    expect(command).toContain("--channel 'stable'");
    expect(command).toContain('--mode system');
  });

  it('never names persistent Home data in any source-side uninstall command', async () => {
    const commands: string[] = [];
    const engine = createUninstallEngine({
      runRemoteText: async ({ remoteCommand }) => {
        commands.push(remoteCommand);
        return { status: 0, stdout: renderRemoteUninstallSuccessEnvelope(), stderr: '' };
      },
    });

    await expect(engine.control({
      ...sshTarget,
      channel: 'dev',
      mode: 'user',
      action: 'uninstall',
    } as never)).resolves.toBeUndefined();

    for (const command of commands) {
      expect(command).not.toMatch(/rm -rf/u);
      expect(command).not.toContain('dataDir');
      expect(command).not.toContain('private-files');
      expect(command).not.toContain('backups');
      expect(command).not.toContain('handy-master-secret');
      expect(command).not.toContain('server.env');
      expect(command).not.toContain('.happier/self-host');
    }
  });

  it('surfaces the remote CLI error text and never falls back to direct cleanup', async () => {
    const commands: string[] = [];
    const engine = createUninstallEngine({
      runRemoteText: async ({ remoteCommand }) => {
        commands.push(remoteCommand);
        return {
          status: 1,
          stdout: renderRemoteUninstallFailureEnvelope('relay host service stop failed: unit is degraded'),
          stderr: 'remote command failed',
        };
      },
    });

    await expect(engine.control({
      ...sshTarget,
      channel: 'dev',
      mode: 'user',
      action: 'uninstall',
    } as never)).rejects.toThrow('relay host service stop failed: unit is degraded');
    expect(commands).toHaveLength(1);
    expect(commands[0]).toContain('relay host uninstall');
  });

  it('does not treat exit status 0 with malformed or non-success JSON as success', async () => {
    const commands: string[] = [];
    const engine = createUninstallEngine({
      runRemoteText: async ({ remoteCommand }) => {
        commands.push(remoteCommand);
        return { status: 0, stdout: '', stderr: '' };
      },
    });

    await expect(engine.control({
      ...sshTarget,
      channel: 'dev',
      mode: 'user',
      action: 'uninstall',
    } as never)).rejects.toThrow(/relay host uninstall/i);
    expect(commands).toHaveLength(1);
    expect(commands[0]).toContain('relay host uninstall');
    expect(commands[0]).not.toContain('rm ');
  });

  it('rejects a success-shaped envelope with the wrong kind', async () => {
    const commands: string[] = [];
    const engine = createUninstallEngine({
      runRemoteText: async ({ remoteCommand }) => {
        commands.push(remoteCommand);
        return {
          status: 0,
          stdout: `${JSON.stringify({ v: 1, ok: true, kind: 'relay_host_status', data: {} })}\n`,
          stderr: '',
        };
      },
    });

    await expect(engine.control({
      ...sshTarget,
      channel: 'dev',
      mode: 'user',
      action: 'uninstall',
    } as never)).rejects.toThrow(/relay host uninstall/i);
    expect(commands).toHaveLength(1);
  });

  it.each([
    ['missing protocol version', { ok: true, kind: 'relay_host_uninstall', data: { ok: true } }],
    ['unsupported protocol version', { v: 2, ok: true, kind: 'relay_host_uninstall', data: { ok: true } }],
    ['missing success fact', { v: 1, ok: true, kind: 'relay_host_uninstall', data: {} }],
    ['false success fact', { v: 1, ok: true, kind: 'relay_host_uninstall', data: { ok: false } }],
  ])('rejects a success-shaped envelope with %s', async (_description, envelope) => {
    const commands: string[] = [];
    const engine = createUninstallEngine({
      runRemoteText: async ({ remoteCommand }) => {
        commands.push(remoteCommand);
        return { status: 0, stdout: `${JSON.stringify(envelope)}\n`, stderr: '' };
      },
    });

    await expect(engine.control({
      ...sshTarget,
      channel: 'dev',
      mode: 'user',
      action: 'uninstall',
    } as never)).rejects.toThrow(/relay host uninstall/i);
    expect(commands).toHaveLength(1);
  });

  it('rejects stdout noise around an otherwise valid success envelope', async () => {
    const commands: string[] = [];
    const engine = createUninstallEngine({
      runRemoteText: async ({ remoteCommand }) => {
        commands.push(remoteCommand);
        return {
          status: 0,
          stdout: `unexpected log line\n${renderRemoteUninstallSuccessEnvelope()}`,
          stderr: '',
        };
      },
    });

    await expect(engine.control({
      ...sshTarget,
      channel: 'dev',
      mode: 'user',
      action: 'uninstall',
    } as never)).rejects.toThrow(/relay host uninstall/i);
    expect(commands).toHaveLength(1);
  });

  it('fails closed with an actionable error when the canonical remote CLI is absent', async () => {
    const commands: string[] = [];
    const engine = createUninstallEngine({
      runRemoteText: async ({ remoteCommand }) => {
        commands.push(remoteCommand);
        return {
          status: 127,
          stdout: '',
          stderr: "bash: line 1: /home/dev/.happier/cli-dev/current/happier: No such file or directory",
        };
      },
    });

    await expect(engine.control({
      ...sshTarget,
      channel: 'dev',
      mode: 'user',
      action: 'uninstall',
    } as never)).rejects.toThrow(/Happier CLI/i);
    // Exactly one command was attempted and no destructive fallback ran.
    expect(commands).toHaveLength(1);
    expect(commands[0]).toContain('relay host uninstall');
    expect(commands[0]).not.toContain('rm ');
    expect(commands[0]).not.toContain('systemctl');
    expect(commands[0]).not.toContain('launchctl');
  });
});
