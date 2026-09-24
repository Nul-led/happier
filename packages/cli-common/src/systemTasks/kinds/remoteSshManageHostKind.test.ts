import { describe, expect, it, vi } from 'vitest';
import { readFile, stat } from 'node:fs/promises';

import { createSystemTasksRunner } from '../interactiveTaskKinds.js';
import type { SystemTaskJsonObject } from '@happier-dev/protocol';
import {
  createRemoteSshManageHostTaskKind,
  parseRemotePersonalHomeApprovalInput,
  releaseChannelSwitchDeclinedMessage,
} from './remoteSshManageHostKind.js';
import { SERVICE_RECONCILIATION_DECLINED_MESSAGE } from './remoteSshBootstrapMachineKind.js';

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
  it.each([
    ['testConnection', 'testConnection'],
    ['relayRuntime.status', 'runRelayRuntimeCommand'],
    ['daemonService.restart', 'runDaemonServiceCommand'],
  ] as const)('forwards one task AbortSignal through host trust and %s execution', async (action, expectedOwner) => {
    const controller = new AbortController();
    const observedSignals: Array<Readonly<{ owner: string; signal?: AbortSignal }>> = [];
    const kind = createRemoteSshManageHostTaskKind({
      resolveHostTrust: async ({ signal }) => {
        observedSignals.push({ owner: 'resolveHostTrust', signal });
        return { status: 'trusted' };
      },
      testConnection: async ({ signal }) => {
        observedSignals.push({ owner: 'testConnection', signal });
      },
      installRemoteCli: async () => {},
      runDaemonServiceCommand: async ({ signal }) => {
        observedSignals.push({ owner: 'runDaemonServiceCommand', signal });
      },
      runRelayRuntimeCommand: async ({ signal }) => {
        observedSignals.push({ owner: 'runRelayRuntimeCommand', signal });
      },
    });

    await kind.run({
      params: {
        action,
        ssh: { target: 'dev@example.test', auth: 'agent' },
      },
      signal: controller.signal,
      emit: () => {},
      prompt: async () => {
        throw new Error('unexpected prompt');
      },
    });

    expect(observedSignals).toEqual([
      { owner: 'resolveHostTrust', signal: controller.signal },
      { owner: expectedOwner, signal: controller.signal },
    ]);
  });

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
        connectionDescriptor: descriptor,
      });
      const current = await input.readPublishedDescriptor('srv_home1');
      return { operationId: input.operationId, status: 'committed', published, current } as SystemTaskJsonObject;
    });
    const kind = createRemoteSshManageHostTaskKind({
      resolveHostTrust: async () => ({ status: 'trusted' }),
      testConnection: async () => {},
      installRemoteCli: vi.fn(async () => {}),
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

  it('forwards the task AbortSignal through relocation CLI installation and source coordination', async () => {
    const controller = new AbortController();
    const installRemoteCli = vi.fn(async () => {});
    const runPersonalHomeRelocation = vi.fn(async (input: { progress(stepId: string): void }) => {
      input.progress('preflight');
      return { status: 'committed' } as SystemTaskJsonObject;
    });
    const kind = createRemoteSshManageHostTaskKind({
      resolveHostTrust: async () => ({ status: 'trusted' }),
      testConnection: async () => {},
      installRemoteCli,
      runDaemonServiceCommand: async () => {},
      runRelayRuntimeCommand: async () => {},
      runPersonalHomeRelocation,
    });

    const events: Array<{ stepId?: string }> = [];
    await kind.run({
      params: {
        action: 'personalHome.relocate',
        relayRuntime: { channel: 'stable', mode: 'user' },
        personalHomeRelocation: { operationId: 'operation-1', destinationMachineId: 'machine-2', sourceDescriptorRevision: 7 },
        ssh: { target: 'relocation@example.test', auth: 'agent' },
      },
      signal: controller.signal,
      emit: (event) => events.push(event),
      prompt: async () => ({ descriptor: null }),
    });

    expect(installRemoteCli).toHaveBeenCalledWith(expect.objectContaining({ signal: controller.signal }));
    expect(runPersonalHomeRelocation).toHaveBeenCalledWith(expect.objectContaining({ signal: controller.signal }));
    expect(events).toContainEqual(expect.objectContaining({ stepId: 'personal_home.preflight' }));
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

  it('creates a Personal Home through the installed remote CLI and returns only strict descriptor facts', async () => {
    const controller = new AbortController();
    const descriptor = {
      v: 1 as const,
      homeServerIdentityId: 'srv_remote_home',
      canonicalServerUrl: 'http://127.0.0.1:43123',
      revision: 3,
      endpoints: [{ kind: 'iroh' as const, endpointId: 'a'.repeat(64), relayUrls: ['https://relay.example.test/'] }],
    };
    const runPersonalHomeCommand = vi.fn(async ({ args }: { args: readonly string[] }): Promise<SystemTaskJsonObject> => {
      if (args[0] === 'service') return {
          ok: true,
          data: {
            services: [{
              serviceType: 'daemon',
              label: 'happier-daemon.stable',
              ring: 'stable',
              targetMode: 'pinned',
              running: true,
            }],
          },
        };
      if (args[0] === 'self') return {
        ok: true,
        data: { defaultReleaseChannel: 'stable', managedReleaseChannels: [] },
      };
      return {
          v: 1,
          ok: true,
          kind: 'personal_home_create',
          data: {
            status: 'complete',
            profileId: 'remote-profile',
            homeServerIdentityId: 'srv_remote_home',
            canonicalServerUrl: 'http://127.0.0.1:43123',
            accountCreated: true,
            channel: 'preview',
            mode: 'system',
            descriptor,
            accountServiceLink: { kind: 'not_requested' },
          },
        };
    });
    const runPersonalHomePairDevice = vi.fn(async () => ({ kind: 'completed' as const, requestedDeviceLabel: null }));
    const enrollInvokingClient = vi.fn(async () => ({ kind: 'enrolled' as const }));
    const kind = createRemoteSshManageHostTaskKind({
      resolveHostTrust: async () => ({ status: 'trusted' }),
      testConnection: async () => {},
      installRemoteCli: async () => {},
      runDaemonServiceCommand: async () => {},
      runRelayRuntimeCommand: async () => {},
      runPersonalHomeCommand,
      runPersonalHomePairDevice,
      enrollInvokingClient,
    });

    const promptKinds: string[] = [];
    const result = await kind.run({
      params: {
        action: 'personalHome.create',
        channel: 'preview',
        relayRuntime: { channel: 'preview', mode: 'system' },
        pairDevice: true,
        enrollInvokingClient: true,
        ssh: { target: 'dev@example.test', auth: 'agent' },
      },
      signal: controller.signal,
      emit: () => undefined,
      prompt: async (prompt) => {
        promptKinds.push(prompt.kind);
        if (prompt.kind === 'daemon.replaceRemoteBackgroundServices') {
          expect(prompt.data).toMatchObject({ targetReleaseChannel: 'preview' });
          return { replaceExistingServices: true };
        }
        expect(prompt).toMatchObject({
          kind: 'releaseChannel.switchDefaultForSetup',
          data: { targetReleaseChannel: 'preview', currentDefaultReleaseChannel: 'stable' },
        });
        return { switchDefaultReleaseChannel: true };
      },
    });

    expect(runPersonalHomeCommand).toHaveBeenCalledWith(expect.objectContaining({
      channel: 'preview',
      mode: 'system',
      args: ['home', 'create', '--yes', '--json', '--link-account', 'never', '--channel', 'preview', '--mode', 'system', '--replace-services', '--switch-channel'],
      signal: controller.signal,
    }));
    expect(promptKinds).toEqual([
      'daemon.replaceRemoteBackgroundServices',
      'releaseChannel.switchDefaultForSetup',
    ]);
    expect(runPersonalHomePairDevice).toHaveBeenCalledWith(expect.objectContaining({
      channel: 'preview',
      mode: 'system',
      homeServerIdentityId: descriptor.homeServerIdentityId,
      args: ['home', 'pair-device', '--system-task-stream'],
    }));
    expect(enrollInvokingClient).toHaveBeenCalledWith(expect.objectContaining({
      channel: 'preview',
      descriptor,
    }));
    expect(result).toEqual({
      action: 'personalHome.create',
      personalHome: {
        status: 'complete',
        homeServerIdentityId: 'srv_remote_home',
        canonicalServerUrl: 'http://127.0.0.1:43123',
        accountCreated: true,
        channel: 'preview',
        mode: 'system',
        descriptor,
        pairing: { kind: 'completed', requestedDeviceLabel: null },
        invokingClientEnrollment: { kind: 'enrolled' },
      },
    });
    expect(JSON.stringify(result)).not.toMatch(/profileId|accessToken|credential|secret/i);
  });

  it('keeps remote service replacement and release-channel switching as separate decisions', async () => {
    const runPersonalHomeCommand = vi.fn(async ({ args }: { args: readonly string[] }): Promise<SystemTaskJsonObject> => {
      if (args[0] === 'service') {
        return {
          ok: true,
          data: {
            services: [{
              serviceType: 'daemon', label: 'happier-daemon.stable', ring: 'stable',
              targetMode: 'pinned', running: true,
            }],
          },
        };
      }
      if (args[0] === 'self') {
        return { ok: true, data: { defaultReleaseChannel: 'stable', managedReleaseChannels: [] } };
      }
      throw new Error('Home creation must not start after the channel decision is declined.');
    });
    const kind = createRemoteSshManageHostTaskKind({
      resolveHostTrust: async () => ({ status: 'trusted' }),
      testConnection: async () => {},
      installRemoteCli: async () => {},
      runDaemonServiceCommand: async () => {},
      runRelayRuntimeCommand: async () => {},
      runPersonalHomeCommand,
    });

    const promptKinds: string[] = [];
    await expect(kind.run({
      params: {
        action: 'personalHome.create',
        channel: 'preview',
        relayRuntime: { channel: 'preview', mode: 'user' },
        ssh: { target: 'dev@example.test', auth: 'agent' },
      },
      emit: () => undefined,
      prompt: async (prompt) => {
        promptKinds.push(prompt.kind);
        return prompt.kind === 'daemon.replaceRemoteBackgroundServices'
          ? { replaceExistingServices: true }
          : { switchDefaultReleaseChannel: false };
      },
    })).rejects.toMatchObject({
      code: 'release_channel_switch_declined',
      // Host-neutral remedy: the app's prompt cannot pass CLI flags.
      message: releaseChannelSwitchDeclinedMessage({ currentDefaultReleaseChannel: 'stable', targetReleaseChannel: 'preview' }),
    });

    expect(promptKinds).toEqual([
      'daemon.replaceRemoteBackgroundServices',
      'releaseChannel.switchDefaultForSetup',
    ]);
    expect(runPersonalHomeCommand).toHaveBeenCalledTimes(2);
  });

  it('does not replace remote services for Home creation without the existing prompt approval', async () => {
    const runPersonalHomeCommand = vi.fn(async ({ args }: { args: readonly string[] }): Promise<SystemTaskJsonObject> => ({
      ok: true,
      data: args[0] === 'service'
        ? {
            services: [{
              serviceType: 'daemon', label: 'happier-daemon.stable', ring: 'stable',
              targetMode: 'pinned', running: true,
            }],
          }
        : {},
    }));
    const kind = createRemoteSshManageHostTaskKind({
      resolveHostTrust: async () => ({ status: 'trusted' }),
      testConnection: async () => {},
      installRemoteCli: async () => {},
      runDaemonServiceCommand: async () => {},
      runRelayRuntimeCommand: async () => {},
      runPersonalHomeCommand,
    });

    await expect(kind.run({
      params: {
        action: 'personalHome.create',
        channel: 'preview',
        relayRuntime: { channel: 'preview', mode: 'user' },
        ssh: { target: 'dev@example.test', auth: 'agent' },
      },
      emit: () => undefined,
      prompt: async () => ({ replaceExistingServices: false }),
    })).rejects.toMatchObject({
      code: 'service_reconciliation_declined',
      // One host-neutral remedy for one code: the same sentence the machine
      // bootstrap refusal uses, true in the CLI and in the app.
      message: SERVICE_RECONCILIATION_DECLINED_MESSAGE,
    });

    expect(runPersonalHomeCommand).toHaveBeenCalledOnce();
    expect(runPersonalHomeCommand).toHaveBeenCalledWith(expect.objectContaining({
      args: ['service', 'list', '--json'],
    }));
  });

  it('preserves durable Home completion when optional pairing and invoking-client enrollment throw', async () => {
    const descriptor = {
      v: 1 as const,
      homeServerIdentityId: 'srv_remote_home',
      canonicalServerUrl: 'http://127.0.0.1:43123',
      revision: 1,
      endpoints: [{ kind: 'iroh' as const, endpointId: 'a'.repeat(64) }],
    };
    const kind = createRemoteSshManageHostTaskKind({
      resolveHostTrust: async () => ({ status: 'trusted' }),
      testConnection: async () => {},
      installRemoteCli: async () => {},
      runDaemonServiceCommand: async () => {},
      runRelayRuntimeCommand: async () => {},
      runPersonalHomeCommand: async () => ({
        v: 1,
        ok: true,
        kind: 'personal_home_create',
        data: {
          status: 'complete',
          profileId: 'remote-profile',
          homeServerIdentityId: descriptor.homeServerIdentityId,
          canonicalServerUrl: descriptor.canonicalServerUrl,
          accountCreated: true,
          channel: 'stable',
          mode: 'user',
          descriptor,
          accountServiceLink: { kind: 'not_requested' },
        },
      }),
      runPersonalHomePairDevice: async () => {
        throw new Error('bounded pairing failed');
      },
      enrollInvokingClient: async () => {
        throw new Error('bounded enrollment failed');
      },
    });

    const result = await kind.run({
      params: {
        action: 'personalHome.create',
        relayRuntime: { channel: 'stable', mode: 'user' },
        pairDevice: true,
        enrollInvokingClient: true,
        ssh: { target: 'dev@example.test', auth: 'agent' },
      },
      emit: () => undefined,
      prompt: async () => ({}),
    });

    expect(result).toEqual(expect.objectContaining({
      personalHome: expect.objectContaining({
        status: 'complete',
        pairing: { kind: 'failed', status: 502 },
        invokingClientEnrollment: { kind: 'failed' },
      }),
    }));
  });

  it('rejects secret-bearing or extra remote create fields instead of projecting them', async () => {
    const runPersonalHomeCommand = vi.fn(async () => ({
      v: 1, ok: true, kind: 'personal_home_create',
      data: {
        status: 'complete', profileId: 'remote-profile', homeServerIdentityId: 'srv_remote_home',
        canonicalServerUrl: 'http://127.0.0.1:43123', accountCreated: true, channel: 'stable', mode: 'user',
        descriptor: { v: 1, homeServerIdentityId: 'srv_remote_home', canonicalServerUrl: 'http://127.0.0.1:43123', revision: 1, endpoints: [{ kind: 'iroh', endpointId: 'a'.repeat(64) }] },
        accountServiceLink: { kind: 'not_requested' },
        accessToken: 'must-never-cross-the-boundary',
      },
    }));
    const kind = createRemoteSshManageHostTaskKind({
      resolveHostTrust: async () => ({ status: 'trusted' }), testConnection: async () => {}, installRemoteCli: async () => {},
      runDaemonServiceCommand: async () => {}, runRelayRuntimeCommand: async () => {}, runPersonalHomeCommand,
    });
    await expect(kind.run({
      params: { action: 'personalHome.create', relayRuntime: { channel: 'stable', mode: 'user' }, ssh: { target: 'dev@example.test', auth: 'agent' } },
      emit: () => undefined, prompt: async () => ({}),
    })).rejects.toMatchObject({ code: 'invalid_cli_response' });
  });

  it('rejects a remote create response without an identity-matched loopback Iroh descriptor', async () => {
    const runPersonalHomeCommand = vi.fn(async () => ({
      v: 1,
      ok: true,
      kind: 'personal_home_create',
      data: {
        status: 'complete',
        profileId: 'remote-profile',
        homeServerIdentityId: 'srv_remote_home',
        canonicalServerUrl: 'https://public.example.test',
        accountCreated: true,
        channel: 'stable',
        mode: 'user',
        descriptor: {
          v: 1,
          homeServerIdentityId: 'srv_other_home',
          canonicalServerUrl: 'https://public.example.test',
          revision: 1,
          endpoints: [{ kind: 'https', url: 'https://public.example.test' }],
        },
        accountServiceLink: { kind: 'not_requested' },
      },
    }));
    const kind = createRemoteSshManageHostTaskKind({
      resolveHostTrust: async () => ({ status: 'trusted' }), testConnection: async () => {}, installRemoteCli: async () => {},
      runDaemonServiceCommand: async () => {}, runRelayRuntimeCommand: async () => {}, runPersonalHomeCommand,
    });

    await expect(kind.run({
      params: { action: 'personalHome.create', relayRuntime: { channel: 'stable', mode: 'user' }, ssh: { target: 'dev@example.test', auth: 'agent' } },
      emit: () => undefined,
      prompt: async () => ({}),
    })).rejects.toMatchObject({ code: 'invalid_cli_response' });
  });

  it('confirms exact remote erase facts at the invoking client and revalidates them through ephemeral stdin', async () => {
    const controller = new AbortController();
    const inspection = {
      purpose: { kind: 'personal-home', canonicalServerUrl: 'http://127.0.0.1:53288' },
      running: true,
      identity: { homeServerIdentityId: 'home-1' },
      layout: { dataDir: '/srv/home', databasePath: '/srv/home/db.sqlite' },
      storage: { ownedErasePaths: ['/srv/home/db.sqlite', '/srv/home/files'], estimatedOwnedBytes: 4096, destinationEmpty: false },
      restoreRecovery: { status: 'none', affectedTargets: [] },
    };
    const runPersonalHomeCommand = vi.fn(async ({ args }: { args: readonly string[] }) => args[1] === 'status'
      ? inspection
      : ({ outcome: 'erased', removedPaths: inspection.storage.ownedErasePaths }));
    const kind = createRemoteSshManageHostTaskKind({
      resolveHostTrust: async () => ({ status: 'trusted' }), testConnection: async () => {}, installRemoteCli: async () => {},
      runDaemonServiceCommand: async () => {}, runRelayRuntimeCommand: async () => {}, runPersonalHomeCommand,
    });
    const prompt = vi.fn(async () => ({ confirmed: true }));
    await expect(kind.run({
      params: { action: 'personalHome.erase', relayRuntime: { channel: 'stable', mode: 'user' }, ssh: { target: 'dev@example.test', auth: 'agent' } },
      signal: controller.signal,
      emit: () => undefined,
      prompt,
    })).resolves.toEqual({
      action: 'personalHome.erase',
      personalHome: { outcome: 'erased', removedPaths: inspection.storage.ownedErasePaths },
    });
    expect(prompt).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'personal_home.confirm_remote_erase.v1',
      data: expect.objectContaining({
        sshHost: 'dev@example.test',
        homeServerIdentityId: 'home-1',
        paths: inspection.storage.ownedErasePaths,
        estimatedBytes: 4096,
      }),
    }));
    const eraseCall = runPersonalHomeCommand.mock.calls[1]?.[0] as { args: readonly string[]; input?: string; signal?: AbortSignal; timeoutMs?: number | null };
    expect(eraseCall.args).toEqual(['home', 'erase', '--json', '--approval-stdin', '--channel', 'stable', '--mode', 'user']);
    expect(eraseCall.args.join(' ')).not.toMatch(/confirmation-token|--yes|home-1|4096/u);
    expect(parseRemotePersonalHomeApprovalInput(eraseCall.input ?? '')).toEqual({
      v: 1,
      operation: 'erase',
      canonicalServerUrl: 'http://127.0.0.1:53288',
      homeServerIdentityId: 'home-1',
      paths: inspection.storage.ownedErasePaths,
      estimatedBytes: 4096,
      confirmed: true,
    });
    expect(eraseCall).not.toHaveProperty('signal');
    expect(eraseCall.timeoutMs).toBeNull();
  });

  it('returns remote status only after persisted Personal Home purpose and canonical identity are present', async () => {
    const runPersonalHomeCommand = vi.fn(async () => ({
      purpose: { kind: 'personal-home', canonicalServerUrl: 'http://127.0.0.1:53288' },
      running: true,
      identity: { homeServerIdentityId: 'home-1' },
      layout: { dataDir: '/srv/home' },
      storage: { ownedErasePaths: ['/srv/home'], estimatedOwnedBytes: 8, destinationEmpty: false },
      restoreRecovery: { status: 'none', affectedTargets: [] },
    }));
    const kind = createRemoteSshManageHostTaskKind({
      resolveHostTrust: async () => ({ status: 'trusted' }), testConnection: async () => {}, installRemoteCli: async () => {},
      runDaemonServiceCommand: async () => {}, runRelayRuntimeCommand: async () => {}, runPersonalHomeCommand,
    });

    await expect(kind.run({
      params: { action: 'personalHome.status', relayRuntime: { channel: 'stable', mode: 'user' }, ssh: { target: 'dev@example.test', auth: 'agent' } },
      emit: () => undefined, prompt: async () => ({}),
    })).resolves.toMatchObject({
      action: 'personalHome.status',
      personalHome: { purpose: { kind: 'personal-home' }, identity: { homeServerIdentityId: 'home-1' } },
    });
    expect(runPersonalHomeCommand).toHaveBeenCalledWith(expect.objectContaining({
      resultContract: 'task', args: ['home', 'status', '--json', '--channel', 'stable', '--mode', 'user'],
    }));
  });

  it('downloads the unchanged canonical remote backup through the shared transfer owner', async () => {
    const manifest = { format: 'happier-personal-home-backup', version: 1, homeServerIdentityId: 'home-1' };
    const runPersonalHomeCommand = vi.fn(async () => ({ path: '/srv/home/backups/home.tar', sha256: 'abc', archiveBytes: 10, manifest }));
    const transferPersonalHomeArchive = vi.fn(async () => undefined);
    const kind = createRemoteSshManageHostTaskKind({
      resolveHostTrust: async () => ({ status: 'trusted' }), testConnection: async () => {}, installRemoteCli: async () => {},
      runDaemonServiceCommand: async () => {}, runRelayRuntimeCommand: async () => {}, runPersonalHomeCommand,
      transferPersonalHomeArchive,
    });
    await expect(kind.run({
      params: {
        action: 'personalHome.backup', relayRuntime: { channel: 'stable', mode: 'user' },
        personalHomeOperation: { outputPath: '/work/home.tar' }, ssh: { target: 'dev@example.test', auth: 'agent' },
      }, emit: () => undefined, prompt: async () => ({}),
    })).resolves.toMatchObject({ personalHome: { path: '/work/home.tar', sha256: 'abc', archiveBytes: 10, manifest } });
    expect(transferPersonalHomeArchive).toHaveBeenCalledWith(expect.objectContaining({
      direction: 'download', remotePath: '/srv/home/backups/home.tar', localPath: '/work/home.tar',
    }));
  });

  it('stages, verifies, confirms, restores, and cleans an archive without approval or identity in argv', async () => {
    const controller = new AbortController();
    const inspection = {
      purpose: { kind: 'personal-home', canonicalServerUrl: 'http://127.0.0.1:53288' }, running: false,
      identity: { homeServerIdentityId: 'home-1' }, layout: { dataDir: '/srv/home' },
      storage: { ownedErasePaths: ['/srv/home/db.sqlite', '/srv/home/files'], estimatedOwnedBytes: 4096, destinationEmpty: false },
      restoreRecovery: { status: 'none', affectedTargets: [] },
    };
    const runPersonalHomeCommand = vi.fn(async ({ args }: { args: readonly string[] }): Promise<SystemTaskJsonObject> => {
      if (args[1] === 'status') return inspection as SystemTaskJsonObject;
      if (args.includes('--prepare-upload')) return { operationId: 'remote-restore-1', uploadLocator: '/tmp/reserved/bundle.tar' };
      if (args[1] === 'verify-backup') return { identityMatchesCurrentHome: 'match', archiveBytes: 100, manifest: { format: 'happier-personal-home-backup', version: 1, homeServerIdentityId: 'home-1' } };
      if (args[1] === 'restore') return { outcome: 'restored' };
      return { status: 'aborted' };
    });
    const transferPersonalHomeArchive = vi.fn(async () => undefined);
    const prompt = vi.fn(async () => ({ confirmed: true }));
    const kind = createRemoteSshManageHostTaskKind({
      resolveHostTrust: async () => ({ status: 'trusted' }), testConnection: async () => {}, installRemoteCli: async () => {},
      runDaemonServiceCommand: async () => {}, runRelayRuntimeCommand: async () => {}, runPersonalHomeCommand,
      transferPersonalHomeArchive, createOperationId: () => 'remote-restore-1',
    });

    await expect(kind.run({
      params: {
        action: 'personalHome.restore', relayRuntime: { channel: 'stable', mode: 'user' },
        personalHomeOperation: { archivePath: '/work/home.tar' }, ssh: { target: 'dev@example.test', auth: 'agent' },
      }, signal: controller.signal, emit: () => undefined, prompt,
    })).resolves.toMatchObject({ personalHome: { outcome: 'restored' } });
    expect(transferPersonalHomeArchive).toHaveBeenCalledWith(expect.objectContaining({
      direction: 'upload', localPath: '/work/home.tar', remotePath: '/tmp/reserved/bundle.tar',
    }));
    const restoreCall = runPersonalHomeCommand.mock.calls.find(([call]) => (call as { args: string[] }).args[1] === 'restore')?.[0] as { args: string[]; input?: string; signal?: AbortSignal; timeoutMs?: number | null };
    expect(restoreCall.args).toContain('--approval-stdin');
    expect(restoreCall.args.join(' ')).not.toMatch(/--yes|home-1|confirmation-token/u);
    expect(restoreCall).not.toHaveProperty('signal');
    expect(restoreCall.timeoutMs).toBeNull();
    expect(runPersonalHomeCommand.mock.calls.at(-1)?.[0]).toEqual(expect.objectContaining({
      args: expect.arrayContaining(['relocation-destination', 'abort']),
    }));
  });

  it('rejects secret-bearing or extra upload reservation fields before transferring bytes', async () => {
    const runPersonalHomeCommand = vi.fn(async ({ args }: { args: readonly string[] }): Promise<SystemTaskJsonObject> => {
      if (args.includes('--prepare-upload')) {
        return {
          operationId: 'remote-strict-reservation-1',
          uploadLocator: '/tmp/reserved/bundle.tar',
          uploadReceipt: 'must-remain-destination-local',
        };
      }
      throw new Error(`Unexpected command: ${args.join(' ')}`);
    });
    const transferPersonalHomeArchive = vi.fn(async () => undefined);
    const kind = createRemoteSshManageHostTaskKind({
      resolveHostTrust: async () => ({ status: 'trusted' }), testConnection: async () => {}, installRemoteCli: async () => {},
      runDaemonServiceCommand: async () => {}, runRelayRuntimeCommand: async () => {}, runPersonalHomeCommand,
      transferPersonalHomeArchive, createOperationId: () => 'remote-strict-reservation-1',
    });

    await expect(kind.run({
      params: {
        action: 'personalHome.verifyBackup', relayRuntime: { channel: 'stable', mode: 'user' },
        personalHomeOperation: { archivePath: '/work/home.tar' }, ssh: { target: 'dev@example.test', auth: 'agent' },
      }, emit: () => undefined, prompt: async () => ({}),
    })).rejects.toMatchObject({ code: 'invalid_cli_response' });
    expect(transferPersonalHomeArchive).not.toHaveBeenCalled();
  });

  it('cleans the exact upload reservation when remote archive verification fails', async () => {
    const runPersonalHomeCommand = vi.fn(async ({ args }: { args: readonly string[] }): Promise<SystemTaskJsonObject> => {
      if (args.includes('--prepare-upload')) return { operationId: 'remote-verify-1', uploadLocator: '/tmp/reserved/bundle.tar' };
      if (args[1] === 'verify-backup') throw new Error('archive verification failed');
      if (args.includes('abort')) return { status: 'aborted' };
      throw new Error(`Unexpected command: ${args.join(' ')}`);
    });
    const kind = createRemoteSshManageHostTaskKind({
      resolveHostTrust: async () => ({ status: 'trusted' }), testConnection: async () => {}, installRemoteCli: async () => {},
      runDaemonServiceCommand: async () => {}, runRelayRuntimeCommand: async () => {}, runPersonalHomeCommand,
      transferPersonalHomeArchive: async () => undefined, createOperationId: () => 'remote-verify-1',
    });

    await expect(kind.run({
      params: {
        action: 'personalHome.verifyBackup', relayRuntime: { channel: 'stable', mode: 'user' },
        personalHomeOperation: { archivePath: '/work/home.tar' }, ssh: { target: 'dev@example.test', auth: 'agent' },
      }, emit: () => undefined, prompt: async () => ({}),
    })).rejects.toThrow('archive verification failed');
    expect(runPersonalHomeCommand.mock.calls.at(-1)?.[0]).toEqual(expect.objectContaining({
      args: [
        'home', 'relocation-destination', 'abort', '--operation-id', 'remote-verify-1',
        '--json', '--channel', 'stable', '--mode', 'user',
      ],
    }));
  });

  it('cleans an upload reservation through a fresh bounded command after transfer cancellation', async () => {
    const controller = new AbortController();
    const runPersonalHomeCommand = vi.fn(async ({ args }: { args: readonly string[] }): Promise<SystemTaskJsonObject> => {
      if (args.includes('--prepare-upload')) return { operationId: 'remote-cancel-1', uploadLocator: '/tmp/reserved/bundle.tar' };
      if (args.includes('abort')) return { status: 'aborted' };
      throw new Error(`Unexpected command: ${args.join(' ')}`);
    });
    const kind = createRemoteSshManageHostTaskKind({
      resolveHostTrust: async () => ({ status: 'trusted' }), testConnection: async () => {}, installRemoteCli: async () => {},
      runDaemonServiceCommand: async () => {}, runRelayRuntimeCommand: async () => {}, runPersonalHomeCommand,
      transferPersonalHomeArchive: async () => {
        controller.abort();
        throw new Error('transfer cancelled');
      },
      createOperationId: () => 'remote-cancel-1',
    });

    await expect(kind.run({
      params: {
        action: 'personalHome.verifyBackup', relayRuntime: { channel: 'stable', mode: 'user' },
        personalHomeOperation: { archivePath: '/work/home.tar' }, ssh: { target: 'dev@example.test', auth: 'agent' },
      }, emit: () => undefined, prompt: async () => ({}), signal: controller.signal,
    })).rejects.toThrow('transfer cancelled');
    expect(runPersonalHomeCommand.mock.calls.at(-1)?.[0]).toEqual(expect.objectContaining({
      args: expect.arrayContaining(['relocation-destination', 'abort']),
    }));
    expect(runPersonalHomeCommand.mock.calls.at(-1)?.[0]).not.toHaveProperty('signal');
  });

  it('strictly rejects EOF, malformed, and extra-field ephemeral approvals', () => {
    const valid = {
      v: 1,
      operation: 'erase',
      canonicalServerUrl: 'http://127.0.0.1:53288',
      homeServerIdentityId: 'home-1',
      paths: ['/srv/home'],
      estimatedBytes: 4096,
      confirmed: true,
    } as const;
    expect(() => parseRemotePersonalHomeApprovalInput('')).toThrow();
    expect(() => parseRemotePersonalHomeApprovalInput('{')).toThrow();
    expect(() => parseRemotePersonalHomeApprovalInput(JSON.stringify({ ...valid, token: 'nope' }))).toThrow();
    expect(parseRemotePersonalHomeApprovalInput(JSON.stringify(valid))).toEqual(valid);
  });

  it('binds restore recovery to freshly inspected identity and affected targets through stdin only', async () => {
    const controller = new AbortController();
    const inspection = {
      purpose: { kind: 'personal-home', canonicalServerUrl: 'http://127.0.0.1:53288' }, running: false,
      identity: { homeServerIdentityId: 'home-1' }, layout: { dataDir: '/srv/home' },
      storage: { ownedErasePaths: ['/srv/home'], estimatedOwnedBytes: 2048, destinationEmpty: false },
      restoreRecovery: { status: 'rollback_available', affectedTargets: ['/srv/home', '/srv/home.rollback'] },
    };
    const runPersonalHomeCommand = vi.fn(async ({ args }: { args: readonly string[] }): Promise<SystemTaskJsonObject> => (
      args[1] === 'status' ? inspection : { outcome: 'rolled_back', affectedTargets: inspection.restoreRecovery.affectedTargets }
    ));
    const prompt = vi.fn(async () => ({ confirmed: true }));
    const kind = createRemoteSshManageHostTaskKind({
      resolveHostTrust: async () => ({ status: 'trusted' }), testConnection: async () => {}, installRemoteCli: async () => {},
      runDaemonServiceCommand: async () => {}, runRelayRuntimeCommand: async () => {}, runPersonalHomeCommand,
    });

    await expect(kind.run({
      params: {
        action: 'personalHome.recoverRestore', relayRuntime: { channel: 'stable', mode: 'user' },
        ssh: { target: 'dev@example.test', auth: 'agent' },
      }, signal: controller.signal, emit: () => undefined, prompt,
    })).resolves.toMatchObject({ personalHome: { outcome: 'rolled_back' } });
    expect(prompt).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'personal_home.confirm_remote_recover_restore.v1',
      data: expect.objectContaining({
        sshHost: 'dev@example.test', homeServerIdentityId: 'home-1',
        paths: ['/srv/home', '/srv/home.rollback'], estimatedBytes: 2048,
      }),
    }));
    const recoveryCall = runPersonalHomeCommand.mock.calls.at(-1)?.[0] as { args: readonly string[]; input?: string; signal?: AbortSignal; timeoutMs?: number | null };
    expect(recoveryCall.args).toEqual(['home', 'recover-restore', '--approval-stdin', '--json', '--channel', 'stable', '--mode', 'user']);
    expect(recoveryCall.args.join(' ')).not.toMatch(/home-1|2048|confirmation-token/u);
    expect(parseRemotePersonalHomeApprovalInput(recoveryCall.input ?? '')).toMatchObject({
      operation: 'recover-restore', homeServerIdentityId: 'home-1',
      paths: ['/srv/home', '/srv/home.rollback'], estimatedBytes: 2048,
    });
    expect(recoveryCall).not.toHaveProperty('signal');
    expect(recoveryCall.timeoutMs).toBeNull();
  });

  it.each([
    'personalHome.restore',
    'personalHome.recoverRestore',
    'personalHome.erase',
  ] as const)('refuses to cross the %s irreversible boundary when cancellation arrives after approval', async (action) => {
    const controller = new AbortController();
    const inspection = {
      purpose: { kind: 'personal-home', canonicalServerUrl: 'http://127.0.0.1:53288' }, running: false,
      identity: { homeServerIdentityId: 'home-1' }, layout: { dataDir: '/srv/home' },
      storage: { ownedErasePaths: ['/srv/home'], estimatedOwnedBytes: 2048, destinationEmpty: false },
      restoreRecovery: { status: 'rollback_available', affectedTargets: ['/srv/home', '/srv/home.rollback'] },
    };
    const runPersonalHomeCommand = vi.fn(async ({ args }: { args: readonly string[] }): Promise<SystemTaskJsonObject> => {
      if (args[1] === 'status') return inspection as SystemTaskJsonObject;
      if (args.includes('--prepare-upload')) return { operationId: 'remote-cancel-after-approval', uploadLocator: '/tmp/reserved/bundle.tar' };
      if (args[1] === 'verify-backup') return { identityMatchesCurrentHome: 'match', archiveBytes: 100, manifest: { format: 'happier-personal-home-backup', version: 1, homeServerIdentityId: 'home-1' } };
      if (args.includes('abort')) return { status: 'aborted' };
      return { outcome: 'mutation-must-not-start' };
    });
    const kind = createRemoteSshManageHostTaskKind({
      resolveHostTrust: async () => ({ status: 'trusted' }), testConnection: async () => {}, installRemoteCli: async () => {},
      runDaemonServiceCommand: async () => {}, runRelayRuntimeCommand: async () => {}, runPersonalHomeCommand,
      transferPersonalHomeArchive: async () => undefined, createOperationId: () => 'remote-cancel-after-approval',
    });

    await expect(kind.run({
      params: {
        action,
        relayRuntime: { channel: 'stable', mode: 'user' },
        ...(action === 'personalHome.restore' ? { personalHomeOperation: { archivePath: '/work/home.tar' } } : {}),
        ssh: { target: 'dev@example.test', auth: 'agent' },
      },
      signal: controller.signal,
      emit: () => undefined,
      prompt: async () => {
        controller.abort();
        return { confirmed: true };
      },
    })).rejects.toMatchObject({ name: 'AbortError' });

    expect(runPersonalHomeCommand.mock.calls.some(([call]) => {
      const command = (call as { args: readonly string[] }).args[1];
      return command === 'restore' || command === 'recover-restore' || command === 'erase';
    })).toBe(false);
    expect(runPersonalHomeCommand.mock.calls.find(([call]) => (call as { args: readonly string[] }).args[1] === 'status')?.[0])
      .toEqual(expect.objectContaining({ signal: controller.signal }));
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
