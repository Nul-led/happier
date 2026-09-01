import { describe, expect, it, vi } from 'vitest';
import { readFile, stat } from 'node:fs/promises';

import { createSystemTasksRunner } from '../interactiveTaskKinds.js';
import type { SystemTaskJsonObject } from '@happier-dev/protocol';
import { createRemoteSshManageHostTaskKind } from './remoteSshManageHostKind.js';

async function waitForPendingPrompt(
  runner: ReturnType<typeof createSystemTasksRunner>,
  params: Readonly<{ taskId: string; cursor: number }>,
) {
  let latest = await runner.poll(params);
  for (let attempt = 0; attempt < 50; attempt += 1) {
    latest = await runner.poll(params);
    if (latest.pendingPrompt) {
      return latest;
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error(`Expected pending prompt for ${params.taskId}: ${JSON.stringify(latest)}`);
}

async function waitForResult(
  runner: ReturnType<typeof createSystemTasksRunner>,
  params: Readonly<{ taskId: string; cursor: number }>,
) {
  let latest = await runner.poll(params);
  for (let attempt = 0; attempt < 50; attempt += 1) {
    latest = await runner.poll(params);
    if (latest.result) {
      return latest;
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error(`Expected final result for ${params.taskId}: ${JSON.stringify(latest)}`);
}

describe('createRemoteSshManageHostTaskKind', () => {
  it('calls the injected relocation coordinator with the exact remote target and publication/readback prompts', async () => {
    const descriptor = {
      v: 1 as const,
      homeServerIdentityId: 'srv_home1',
      canonicalServerUrl: 'https://destination.test',
      revision: 8,
      endpoints: [{ kind: 'https' as const, url: 'https://destination.test' }],
    };
    const runPersonalHomeRelocation = vi.fn(async (input: {
      destinationMachineId: string;
      operationId: string;
      publishDestination(facts: SystemTaskJsonObject): Promise<unknown>;
      readPublishedDescriptor(homeServerIdentityId: string): Promise<unknown>;
    }) => {
      const published = await input.publishDestination({
        operationId: input.operationId,
        homeServerIdentityId: 'srv_home1',
        canonicalServerUrl: descriptor.canonicalServerUrl,
        minimumOuterRevisionExclusive: 7,
        endpoints: descriptor.endpoints,
      });
      const current = await input.readPublishedDescriptor('srv_home1');
      return { operationId: input.operationId, status: 'committed', published, current } as SystemTaskJsonObject;
    });
    const kind = createRemoteSshManageHostTaskKind({
      resolveHostTrust: async () => ({ status: 'trusted' }),
      testConnection: async () => {},
      installRemoteCli: async () => {},
      runDaemonServiceCommand: async () => {},
      runRelayRuntimeCommand: async () => {},
      runPersonalHomeRelocation,
    });
    const runner = createSystemTasksRunner({ kinds: { 'remote.ssh.manageHost.v1': kind } });
    await runner.start({
      taskId: 'remote-relocate',
      kind: 'remote.ssh.manageHost.v1',
      params: {
        action: 'personalHome.relocate',
        channel: 'preview',
        relayRuntime: { channel: 'preview', mode: 'system' },
        personalHomeRelocation: { operationId: 'operation-1', destinationMachineId: 'machine-2', sourceDescriptorRevision: 7, recoveryAction: 'return_to_source' },
        ssh: { target: 'relocation@example.test', auth: 'agent', port: 2222 },
      },
    });
    const publishPrompt = await waitForPendingPrompt(runner, { taskId: 'remote-relocate', cursor: 0 });
    expect(publishPrompt.pendingPrompt).toMatchObject({
      kind: 'personal_home.publish_relocation_descriptor.v1',
      data: { operationId: 'operation-1', homeServerIdentityId: 'srv_home1' },
    });
    await runner.respond({ taskId: 'remote-relocate', answer: { descriptor } });
    const readPrompt = await waitForPendingPrompt(runner, { taskId: 'remote-relocate', cursor: publishPrompt.nextCursor });
    expect(readPrompt.pendingPrompt).toMatchObject({
      kind: 'personal_home.read_relocation_descriptor.v1',
      data: { operationId: 'operation-1', homeServerIdentityId: 'srv_home1' },
    });
    await runner.respond({ taskId: 'remote-relocate', answer: { descriptor } });
    const result = await waitForResult(runner, { taskId: 'remote-relocate', cursor: readPrompt.nextCursor });
    expect(result.result).toMatchObject({ ok: true, data: { action: 'personalHome.relocate', personalHome: { operationId: 'operation-1', status: 'committed' } } });
    expect(result.result).not.toHaveProperty('data.personalHome.archivePath');
    expect(result.result).not.toHaveProperty('data.personalHome.destinationDataDir');
    expect(runPersonalHomeRelocation).toHaveBeenCalledWith(expect.objectContaining({
      ssh: expect.objectContaining({ target: 'relocation@example.test', port: 2222 }),
      channel: 'preview',
      mode: 'system',
      destinationMachineId: 'machine-2',
      operationId: 'operation-1',
      sourceDescriptorRevision: 7,
      recoveryAction: 'return_to_source',
    }));
  });

  it('fails closed before relocation when its operation and exact runtime target are absent', async () => {
    const runPersonalHomeRelocation = vi.fn(async () => ({}));
    const kind = createRemoteSshManageHostTaskKind({
      resolveHostTrust: async () => ({ status: 'trusted' }), testConnection: async () => {}, installRemoteCli: async () => {},
      runDaemonServiceCommand: async () => {}, runRelayRuntimeCommand: async () => {}, runPersonalHomeRelocation,
    });
    await expect(kind.run({
      params: { action: 'personalHome.relocate', ssh: { target: 'relocation@example.test', auth: 'agent' } },
      emit: () => undefined,
      prompt: async () => ({}),
    })).rejects.toMatchObject({ code: 'invalid_params' });
    expect(runPersonalHomeRelocation).not.toHaveBeenCalled();
  });

  it('inspects, prompts with exact facts, then invokes installed-CLI erase with a bound token', async () => {
    const runPersonalHomeCommand = vi.fn(async ({ args }: { args: readonly string[] }): Promise<SystemTaskJsonObject> => {
      if (args[1] === 'status') return { purpose: { kind: 'personal-home', canonicalServerUrl: 'http://127.0.0.1:43123' }, identity: { homeServerIdentityId: 'home-1' }, storage: { ownedErasePaths: ['/data/db', '/data/files'], estimatedOwnedBytes: 99 } };
      return { removedPaths: ['/data/db', '/data/files'], remainingUnknownPaths: [], stoppedRunningHome: true };
    });
    const kind = createRemoteSshManageHostTaskKind({
      resolveHostTrust: async () => ({ status: 'trusted' }), testConnection: async () => {}, installRemoteCli: async () => {},
      runDaemonServiceCommand: async () => {}, runRelayRuntimeCommand: async () => {}, runPersonalHomeCommand,
    });
    const runner = createSystemTasksRunner({ kinds: { 'remote.ssh.manageHost.v1': kind } });
    await runner.start({ taskId: 'remote-erase', kind: 'remote.ssh.manageHost.v1', params: { action: 'personalHome.erase', channel: 'preview', relayRuntime: { channel: 'preview', mode: 'system' }, ssh: { target: 'dev@example.test', auth: 'agent' } } });
    const prompt = await waitForPendingPrompt(runner, { taskId: 'remote-erase', cursor: 0 });
    expect(prompt.pendingPrompt).toMatchObject({ kind: 'personal_home.confirm_remote_erase.v1', data: { paths: ['/data/db', '/data/files'], estimatedBytes: 99 } });
    await runner.respond({ taskId: 'remote-erase', answer: { confirmed: true } });
    const result = await waitForResult(runner, { taskId: 'remote-erase', cursor: prompt.nextCursor });
    expect(result.result).toMatchObject({ ok: true, data: { action: 'personalHome.erase', personalHome: { stoppedRunningHome: true } } });
    expect(runPersonalHomeCommand.mock.calls[0]?.[0]).toMatchObject({ channel: 'preview', mode: 'system' });
    expect(runPersonalHomeCommand.mock.calls[0]?.[0].args).toEqual(['home', 'status', '--json', '--channel', 'preview', '--mode', 'system']);
    expect(runPersonalHomeCommand.mock.calls[1]?.[0].args).toEqual(['home', 'erase', '--json', '--channel', 'preview', '--mode', 'system', '--confirmation-token', expect.stringMatching(/^[a-f0-9]{64}$/)]);
  });

  it('does not invoke remote erase when exact-facts confirmation is declined', async () => {
    const runPersonalHomeCommand = vi.fn(async () => ({ purpose: { kind: 'personal-home', canonicalServerUrl: 'http://127.0.0.1:43123' }, identity: null, storage: { ownedErasePaths: ['/data/db'], estimatedOwnedBytes: 1 } }));
    const kind = createRemoteSshManageHostTaskKind({ resolveHostTrust: async () => ({ status: 'trusted' }), testConnection: async () => {}, installRemoteCli: async () => {}, runDaemonServiceCommand: async () => {}, runRelayRuntimeCommand: async () => {}, runPersonalHomeCommand });
    const runner = createSystemTasksRunner({ kinds: { 'remote.ssh.manageHost.v1': kind } });
    await runner.start({ taskId: 'remote-decline', kind: 'remote.ssh.manageHost.v1', params: { action: 'personalHome.erase', relayRuntime: { channel: 'stable', mode: 'user' }, ssh: { target: 'dev@example.test', auth: 'agent' } } });
    const prompt = await waitForPendingPrompt(runner, { taskId: 'remote-decline', cursor: 0 });
    await runner.respond({ taskId: 'remote-decline', answer: { confirmed: false } });
    const result = await waitForResult(runner, { taskId: 'remote-decline', cursor: prompt.nextCursor });
    expect(result.result).toMatchObject({ ok: false, error: { code: 'confirmation_required' } });
    expect(runPersonalHomeCommand).toHaveBeenCalledOnce();
  });

  it('does not invoke remote erase for a malformed affirmative prompt answer', async () => {
    const runPersonalHomeCommand = vi.fn(async () => ({ purpose: { kind: 'personal-home', canonicalServerUrl: 'http://127.0.0.1:43123' }, identity: null, storage: { ownedErasePaths: ['/data/db'], estimatedOwnedBytes: 1 } }));
    const kind = createRemoteSshManageHostTaskKind({ resolveHostTrust: async () => ({ status: 'trusted' }), testConnection: async () => {}, installRemoteCli: async () => {}, runDaemonServiceCommand: async () => {}, runRelayRuntimeCommand: async () => {}, runPersonalHomeCommand });

    await expect(kind.run({
      params: { action: 'personalHome.erase', relayRuntime: { channel: 'stable', mode: 'user' }, ssh: { target: 'dev@example.test', auth: 'agent' } },
      emit: () => undefined,
      prompt: async () => ({ confirmed: true, extra: true }),
    })).rejects.toMatchObject({ code: 'confirmation_required' });
    expect(runPersonalHomeCommand).toHaveBeenCalledOnce();
  });

  it('rejects malformed inspection ownership facts before prompting or erasing', async () => {
    const runPersonalHomeCommand = vi.fn(async () => ({
      purpose: { kind: 'generic', canonicalServerUrl: 'http://127.0.0.1:43123' },
      identity: 'home-1',
      storage: { ownedErasePaths: ['/data/db'], estimatedOwnedBytes: 1 },
    }));
    const prompt = vi.fn(async () => ({ confirmed: true }));
    const kind = createRemoteSshManageHostTaskKind({ resolveHostTrust: async () => ({ status: 'trusted' }), testConnection: async () => {}, installRemoteCli: async () => {}, runDaemonServiceCommand: async () => {}, runRelayRuntimeCommand: async () => {}, runPersonalHomeCommand });

    await expect(kind.run({
      params: { action: 'personalHome.erase', relayRuntime: { channel: 'stable', mode: 'user' }, ssh: { target: 'dev@example.test', auth: 'agent' } },
      emit: () => undefined,
      prompt,
    })).rejects.toMatchObject({ code: 'invalid_cli_response' });
    expect(prompt).not.toHaveBeenCalled();
    expect(runPersonalHomeCommand).toHaveBeenCalledOnce();
  });

  it('fails closed before inspection when remote erase has no explicit runtime target', async () => {
    const runPersonalHomeCommand = vi.fn(async () => ({}));
    const kind = createRemoteSshManageHostTaskKind({ resolveHostTrust: async () => ({ status: 'trusted' }), testConnection: async () => {}, installRemoteCli: async () => {}, runDaemonServiceCommand: async () => {}, runRelayRuntimeCommand: async () => {}, runPersonalHomeCommand });

    await expect(kind.run({
      params: { action: 'personalHome.erase', ssh: { target: 'dev@example.test', auth: 'agent' } },
      emit: () => undefined,
      prompt: async () => ({ confirmed: true }),
    })).rejects.toMatchObject({ code: 'invalid_params' });
    expect(runPersonalHomeCommand).not.toHaveBeenCalled();
  });

  it('fails closed before inspection when remote erase runtime targeting is incomplete', async () => {
    const runPersonalHomeCommand = vi.fn(async () => ({}));
    const kind = createRemoteSshManageHostTaskKind({ resolveHostTrust: async () => ({ status: 'trusted' }), testConnection: async () => {}, installRemoteCli: async () => {}, runDaemonServiceCommand: async () => {}, runRelayRuntimeCommand: async () => {}, runPersonalHomeCommand });

    await expect(kind.run({
      params: { action: 'personalHome.erase', relayRuntime: {}, ssh: { target: 'dev@example.test', auth: 'agent' } },
      emit: () => undefined,
      prompt: async () => ({ confirmed: true }),
    })).rejects.toMatchObject({ code: 'invalid_params' });
    expect(runPersonalHomeCommand).not.toHaveBeenCalled();
  });
  it('fails closed when SSH host trust is declined', async () => {
    const trustAccept = vi.fn(async () => {});
    const kind = createRemoteSshManageHostTaskKind({
      resolveHostTrust: async () => ({
        status: 'prompt',
        promptKind: 'ssh.trustHost',
        promptMessage: 'Trust host?',
        promptData: {
          host: 'example.test',
          keyType: 'ssh-ed25519',
          fingerprint: 'SHA256:abc',
        },
        accept: trustAccept,
      }),
      testConnection: async () => {
        throw new Error('should not reach connection test when declined');
      },
      installRemoteCli: async () => {
        throw new Error('should not install cli when declined');
      },
      runDaemonServiceCommand: async () => {
        throw new Error('should not run daemon command when declined');
      },
      runRelayRuntimeCommand: async () => {
        throw new Error('should not run relay runtime command when declined');
      },
    });

    const runner = createSystemTasksRunner({
      kinds: { 'remote.ssh.manageHost.v1': kind },
    });

    await runner.start({
      taskId: 'trust-decline',
      kind: 'remote.ssh.manageHost.v1',
      params: {
        action: 'testConnection',
        ssh: {
          target: 'dev@example.test',
          auth: 'agent',
        },
      },
    });

    const firstPoll = await waitForPendingPrompt(runner, { taskId: 'trust-decline', cursor: 0 });
    expect(firstPoll.pendingPrompt).toEqual({
      kind: 'ssh.trustHost',
      data: {
        host: 'example.test',
        keyType: 'ssh-ed25519',
        fingerprint: 'SHA256:abc',
      },
    });

    await runner.respond({
      taskId: 'trust-decline',
      answer: { trusted: false },
    });

    const finalPoll = await waitForResult(runner, { taskId: 'trust-decline', cursor: firstPoll.nextCursor });
    expect(finalPoll.result).toEqual({
      protocolVersion: 1,
      taskId: 'trust-decline',
      ok: false,
      error: {
        code: 'host_trust_declined',
        message: 'SSH host trust was declined.',
      },
    });
    expect(trustAccept).not.toHaveBeenCalled();
  });

  it('prompts for an SSH password when missing and passes it to the install step', async () => {
    const installRemoteCli = vi.fn(async () => {});
    const kind = createRemoteSshManageHostTaskKind({
      resolveHostTrust: async () => ({ status: 'trusted' }),
      testConnection: async () => {
        throw new Error('should not call testConnection during installOrUpdateCli');
      },
      installRemoteCli,
      runDaemonServiceCommand: async () => {
        throw new Error('should not call daemon commands during installOrUpdateCli');
      },
      runRelayRuntimeCommand: async () => {
        throw new Error('should not call relay runtime commands during installOrUpdateCli');
      },
    });

    const runner = createSystemTasksRunner({
      kinds: { 'remote.ssh.manageHost.v1': kind },
    });

    await runner.start({
      taskId: 'password-prompt',
      kind: 'remote.ssh.manageHost.v1',
      params: {
        action: 'installOrUpdateCli',
        ssh: {
          target: 'dev@example.test',
          auth: 'password',
        },
      },
    });

    const firstPoll = await waitForPendingPrompt(runner, { taskId: 'password-prompt', cursor: 0 });
    expect(firstPoll.pendingPrompt).toEqual({
      kind: 'ssh.password',
      data: {
        target: 'dev@example.test',
      },
    });

    await runner.respond({
      taskId: 'password-prompt',
      answer: { password: 'secret-password' },
    });

    const finalPoll = await waitForResult(runner, { taskId: 'password-prompt', cursor: firstPoll.nextCursor });
    expect(finalPoll.result?.ok).toBe(true);
    expect(installRemoteCli).toHaveBeenCalledWith(expect.objectContaining({
      ssh: expect.objectContaining({
        target: 'dev@example.test',
      }),
      auth: {
        mode: 'password',
        password: 'secret-password',
      },
    }));
  });

  it('accepts publicdev as an alias for the dev channel label', async () => {
    const installRemoteCli = vi.fn(async () => {});
    const kind = createRemoteSshManageHostTaskKind({
      resolveHostTrust: async () => ({ status: 'trusted' }),
      testConnection: async () => {
        throw new Error('should not call testConnection during installOrUpdateCli');
      },
      installRemoteCli,
      runDaemonServiceCommand: async () => {
        throw new Error('should not call daemon commands during installOrUpdateCli');
      },
      runRelayRuntimeCommand: async () => {
        throw new Error('should not call relay runtime commands during installOrUpdateCli');
      },
    });

    const runner = createSystemTasksRunner({
      kinds: { 'remote.ssh.manageHost.v1': kind },
    });

    await runner.start({
      taskId: 'channel-alias',
      kind: 'remote.ssh.manageHost.v1',
      params: {
        action: 'installOrUpdateCli',
        channel: 'publicdev',
        ssh: {
          target: 'dev@example.test',
          auth: 'agent',
        },
      },
    });

    const finalPoll = await waitForResult(runner, { taskId: 'channel-alias', cursor: 0 });
    expect(finalPoll.result?.ok).toBe(true);
    expect(installRemoteCli).toHaveBeenCalledWith(expect.objectContaining({
      channel: 'dev',
    }));
  });

  it('runs relay runtime status after resolving host trust', async () => {
    const runRelayRuntimeCommand = vi.fn(async () => ({ installed: false }));
    const kind = createRemoteSshManageHostTaskKind({
      resolveHostTrust: async () => ({ status: 'trusted' }),
      testConnection: async () => {
        throw new Error('should not call testConnection during relayRuntime.status');
      },
      installRemoteCli: async () => {
        throw new Error('should not call installRemoteCli during relayRuntime.status');
      },
      runDaemonServiceCommand: async () => {
        throw new Error('should not call daemon commands during relayRuntime.status');
      },
      runRelayRuntimeCommand,
    });

    const runner = createSystemTasksRunner({
      kinds: { 'remote.ssh.manageHost.v1': kind },
    });

    await runner.start({
      taskId: 'relay-status',
      kind: 'remote.ssh.manageHost.v1',
      params: {
        action: 'relayRuntime.status',
        ssh: {
          target: 'dev@example.test',
          auth: 'agent',
        },
      },
    });

    const finalPoll = await waitForResult(runner, { taskId: 'relay-status', cursor: 0 });
    expect(finalPoll.result?.ok).toBe(true);
    expect(runRelayRuntimeCommand).toHaveBeenCalledWith(expect.objectContaining({
      action: 'status',
      ssh: expect.objectContaining({ target: 'dev@example.test' }),
    }));
  });

  it('threads the requested channel into CLI and daemon-service actions', async () => {
    const installRemoteCli = vi.fn(async () => {});
    const runDaemonServiceCommand = vi.fn(async () => {});

    const kind = createRemoteSshManageHostTaskKind({
      resolveHostTrust: async () => ({ status: 'trusted' }),
      testConnection: async () => {
        throw new Error('should not call testConnection during daemonService.restart');
      },
      installRemoteCli,
      runDaemonServiceCommand,
      runRelayRuntimeCommand: async () => {
        throw new Error('should not call relay runtime commands during daemonService.restart');
      },
    });

    const runner = createSystemTasksRunner({
      kinds: { 'remote.ssh.manageHost.v1': kind },
    });

    await runner.start({
      taskId: 'daemon-channel',
      kind: 'remote.ssh.manageHost.v1',
      params: {
        action: 'daemonService.restart',
        channel: 'dev',
        ssh: {
          target: 'dev@example.test',
          auth: 'agent',
        },
      },
    });

    const finalPoll = await waitForResult(runner, { taskId: 'daemon-channel', cursor: 0 });
    expect(finalPoll.result?.ok).toBe(true);
    expect(installRemoteCli).toHaveBeenCalledWith(expect.objectContaining({
      channel: 'dev',
    }));
    expect(runDaemonServiceCommand).toHaveBeenCalledWith(expect.objectContaining({
      channel: 'dev',
      action: 'restart',
    }));
  });

  it('accepts ssh.identityPrivateKey for keyfile auth by materializing a temp identity file for the run', async () => {
    let observedIdentityPath: string | null = null;
    const privateKeyMaterial = '-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----\n';

    const kind = createRemoteSshManageHostTaskKind({
      resolveHostTrust: async () => ({ status: 'trusted' }),
      testConnection: async ({ auth }) => {
        if (auth.mode !== 'keyFile') {
          throw new Error('expected keyFile auth');
        }
        observedIdentityPath = auth.privateKeyPath;
        const contents = await readFile(auth.privateKeyPath, 'utf8');
        expect(contents).toContain('abc');
      },
      installRemoteCli: async () => {
        throw new Error('should not install cli during testConnection');
      },
      runDaemonServiceCommand: async () => {
        throw new Error('should not run daemon commands during testConnection');
      },
      runRelayRuntimeCommand: async () => {
        throw new Error('should not run relay runtime commands during testConnection');
      },
    });

    const runner = createSystemTasksRunner({
      kinds: { 'remote.ssh.manageHost.v1': kind },
    });

    await runner.start({
      taskId: 'key-material',
      kind: 'remote.ssh.manageHost.v1',
      params: {
        action: 'testConnection',
        ssh: {
          target: 'dev@example.test',
          auth: 'keyfile',
          identityPrivateKey: privateKeyMaterial,
        },
      },
    });

    const finalPoll = await waitForResult(runner, { taskId: 'key-material', cursor: 0 });
    expect(finalPoll.result?.ok).toBe(true);
    expect(typeof observedIdentityPath).toBe('string');

    // Cleanup should remove the temp identity file after the run completes.
    if (observedIdentityPath) {
      await expect(stat(observedIdentityPath)).rejects.toBeTruthy();
    }
  });
});
