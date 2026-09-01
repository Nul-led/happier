import { describe, expect, it, vi } from 'vitest';

const { copyLocalDirectoryToRemoteSyncMock, runRemoteTextSyncMock } = vi.hoisted(() => ({
  copyLocalDirectoryToRemoteSyncMock: vi.fn(),
  runRemoteTextSyncMock: vi.fn(),
}));

vi.mock('@happier-dev/cli-common/ssh', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@happier-dev/cli-common/ssh')>();
  return {
    ...actual,
    copyLocalDirectoryToRemoteSync: copyLocalDirectoryToRemoteSyncMock,
    runRemoteTextSync: runRemoteTextSyncMock,
  };
});

import {
  createRemoteSshPersonalHomeRelocationDestinationDefault,
  runRemoteDaemonServiceCommandDefault,
  runRemotePersonalHomeCommandDefault,
} from './remoteSshManageHostTasks.js';

function successfulHomeTask(data: Record<string, unknown>): string {
  return JSON.stringify({
    kind: 'personal_home_task_result',
    protocolVersion: 1,
    result: { protocolVersion: 1, taskId: 'remote-home-task', ok: true, data },
  });
}

describe('runRemoteDaemonServiceCommandDefault', () => {
  it('uses the canonical background-service command surface for remote lifecycle actions', async () => {
    runRemoteTextSyncMock.mockReset();

    await runRemoteDaemonServiceCommandDefault({
      ssh: {
        target: 'dev@example.test',
        auth: 'agent',
      },
      auth: { mode: 'agent' },
      knownHostsMode: 'app',
      action: 'restart',
      serviceMode: 'user',
      channel: 'preview',
    });

    expect(runRemoteTextSyncMock).toHaveBeenCalledTimes(1);
    expect(runRemoteTextSyncMock).toHaveBeenCalledWith(expect.objectContaining({
      remoteCommand: expect.stringContaining('service restart --mode=user --json'),
      errorPrefix: 'Remote background service command failed for dev@example.test',
    }));
    expect(runRemoteTextSyncMock).toHaveBeenCalledWith(expect.objectContaining({
      remoteCommand: expect.not.stringContaining('daemon service restart'),
    }));
  });

  it('runs the installed targeted Home CLI and strictly returns its final task result', async () => {
    runRemoteTextSyncMock.mockReset();
    runRemoteTextSyncMock.mockReturnValue({
      status: 0,
      stdout: [
        JSON.stringify({ type: 'progress', message: 'inspecting' }),
        JSON.stringify({
          kind: 'personal_home_task_result',
          protocolVersion: 1,
          result: { protocolVersion: 1, taskId: 'remote-home-status', ok: true, data: { running: false } },
        }),
      ].join('\n'),
      stderr: '',
    });

    await expect(runRemotePersonalHomeCommandDefault({
      ssh: { target: 'dev@example.test', auth: 'agent' },
      auth: { mode: 'agent' },
      knownHostsMode: 'app',
      channel: 'preview',
      mode: 'system',
      args: ['home', 'status', '--json', '--channel', 'preview', '--mode', 'system'],
    })).resolves.toEqual({ running: false });

    const remoteCommand = String(runRemoteTextSyncMock.mock.calls[0]?.[0]?.remoteCommand ?? '');
    expect(remoteCommand).toContain("HAPPIER_PUBLIC_RELEASE_CHANNEL='preview'");
    expect(remoteCommand).toContain("'home' 'status' '--json' '--channel' 'preview' '--mode' 'system'");
  });

  it('rejects a successful remote Home task envelope whose data is not an object', async () => {
    runRemoteTextSyncMock.mockReset();
    runRemoteTextSyncMock.mockReturnValue({
      status: 0,
      stdout: JSON.stringify({
        kind: 'personal_home_task_result',
        protocolVersion: 1,
        result: { protocolVersion: 1, taskId: 'remote-home-status', ok: true, data: 'unexpected' },
      }),
      stderr: '',
    });

    await expect(runRemotePersonalHomeCommandDefault({
      ssh: { target: 'dev@example.test', auth: 'agent' },
      auth: { mode: 'agent' },
      knownHostsMode: 'app',
      channel: 'stable',
      mode: 'user',
      args: ['home', 'status', '--json', '--channel', 'stable', '--mode', 'user'],
    })).rejects.toMatchObject({
      name: 'SystemTaskExecutionError',
      code: 'invalid_cli_response',
    });
  });

  it('uploads a verified archive privately, stages it through the exact installed CLI target, and cleans transfer material', async () => {
    runRemoteTextSyncMock.mockReset();
    copyLocalDirectoryToRemoteSyncMock.mockReset();
    const remoteDir = '/tmp/happier-personal-home-relocation.operation-1.ABC123';
    runRemoteTextSyncMock
      .mockReturnValueOnce({ status: 0, stdout: `${remoteDir}\n`, stderr: '' })
      .mockReturnValueOnce({
        status: 0,
        stdout: successfulHomeTask({
          operationId: 'operation-1',
          status: 'quarantined',
          bundleSha256: 'a'.repeat(64),
          expectedHomeServerIdentityId: 'home-1',
          expectedCanonicalServerUrl: 'https://source.example.test',
          sourceDescriptorRevision: 7,
          homeServerIdentityId: 'home-1',
          authenticated: true,
          accountCount: 1,
          sessionCount: 0,
          canonicalServerUrl: 'http://127.0.0.1:43123',
          minimumOuterRevisionExclusive: 7,
        }),
        stderr: '',
      })
      .mockReturnValueOnce({ status: 0, stdout: '', stderr: '' });
    const ensureRuntime = vi.fn(async () => undefined);

    const destination = createRemoteSshPersonalHomeRelocationDestinationDefault({
      ssh: { target: 'relocation@example.test', auth: 'agent', port: 2222 },
      auth: { mode: 'agent' },
      knownHostsMode: 'app',
      channel: 'preview',
      mode: 'system',
      ensureRuntime,
    });
    const result = await destination.stage({
      operationId: 'operation-1',
      archivePath: '/local/verified-home.tar',
      bundleSha256: 'a'.repeat(64),
      expectedHomeServerIdentityId: 'home-1',
      expectedCanonicalServerUrl: 'https://source.example.test',
      sourceDescriptorRevision: 7,
    });

    expect(result).toMatchObject({
      operationId: 'operation-1',
      status: 'quarantined',
      authenticated: true,
      accountCount: 1,
      sessionCount: 0,
    });
    expect(result).not.toHaveProperty('archivePath');
    expect(result).not.toHaveProperty('destinationDataDir');
    expect(ensureRuntime).toHaveBeenCalledWith({
      kind: 'personal-home',
      canonicalServerUrl: 'https://source.example.test',
    });
    expect(copyLocalDirectoryToRemoteSyncMock).toHaveBeenCalledWith(expect.objectContaining({
      target: 'relocation@example.test',
      port: 2222,
      localPath: '/local/verified-home.tar',
      remotePath: `${remoteDir}/bundle.tar`,
    }));
    const stageCommand = String(runRemoteTextSyncMock.mock.calls[1]?.[0]?.remoteCommand ?? '');
    expect(stageCommand).toContain("HAPPIER_PUBLIC_RELEASE_CHANNEL='preview'");
    expect(stageCommand).toContain("'home' 'relocation-destination' 'stage'");
    expect(stageCommand).toContain("'--archive' '/tmp/happier-personal-home-relocation.operation-1.ABC123/bundle.tar'");
    expect(stageCommand).toContain("'--channel' 'preview' '--mode' 'system'");
    expect(runRemoteTextSyncMock.mock.calls[2]?.[0]?.remoteCommand).toContain("rm -f -- '/tmp/happier-personal-home-relocation.operation-1.ABC123/bundle.tar'");
  });

  it('rejects quarantined remote facts without private authentication attestation', async () => {
    runRemoteTextSyncMock.mockReset();
    copyLocalDirectoryToRemoteSyncMock.mockReset();
    const remoteDir = '/tmp/happier-personal-home-relocation.operation-3.GHI789';
    runRemoteTextSyncMock
      .mockReturnValueOnce({ status: 0, stdout: `${remoteDir}\n`, stderr: '' })
      .mockReturnValueOnce({
        status: 0,
        stdout: successfulHomeTask({
          operationId: 'operation-3',
          status: 'quarantined',
          bundleSha256: 'c'.repeat(64),
          expectedHomeServerIdentityId: 'home-3',
          expectedCanonicalServerUrl: 'https://source.example.test',
          sourceDescriptorRevision: 11,
          homeServerIdentityId: 'home-3',
        }),
        stderr: '',
      })
      .mockReturnValueOnce({ status: 0, stdout: '', stderr: '' });

    const destination = createRemoteSshPersonalHomeRelocationDestinationDefault({
      ssh: { target: 'relocation@example.test', auth: 'agent' },
      auth: { mode: 'agent' },
      knownHostsMode: 'app',
      channel: 'stable',
      mode: 'user',
      ensureRuntime: vi.fn(async () => undefined),
    });

    await expect(destination.stage({
      operationId: 'operation-3',
      archivePath: '/local/verified-home.tar',
      bundleSha256: 'c'.repeat(64),
      expectedHomeServerIdentityId: 'home-3',
      expectedCanonicalServerUrl: 'https://source.example.test',
      sourceDescriptorRevision: 11,
    })).rejects.toThrow('unattested operation facts');
  });

  it('reconciles a lost stage response through destination status and still cleans transfer material', async () => {
    runRemoteTextSyncMock.mockReset();
    copyLocalDirectoryToRemoteSyncMock.mockReset();
    const remoteDir = '/tmp/happier-personal-home-relocation.operation-2.DEF456';
    runRemoteTextSyncMock
      .mockReturnValueOnce({ status: 0, stdout: `${remoteDir}\n`, stderr: '' })
      .mockImplementationOnce(() => { throw new Error('ssh response lost'); })
      .mockReturnValueOnce({
        status: 0,
        stdout: successfulHomeTask({
          operationId: 'operation-2',
          status: 'quarantined',
          bundleSha256: 'b'.repeat(64),
          expectedHomeServerIdentityId: 'home-2',
          expectedCanonicalServerUrl: 'https://source.example.test',
          sourceDescriptorRevision: 9,
          homeServerIdentityId: 'home-2',
          authenticated: true,
          accountCount: 1,
          sessionCount: 0,
        }),
        stderr: '',
      })
      .mockReturnValueOnce({ status: 0, stdout: '', stderr: '' });

    const destination = createRemoteSshPersonalHomeRelocationDestinationDefault({
      ssh: { target: 'relocation@example.test', auth: 'agent' },
      auth: { mode: 'agent' },
      knownHostsMode: 'system',
      channel: 'dev',
      mode: 'user',
      ensureRuntime: vi.fn(async () => undefined),
    });
    await expect(destination.stage({
      operationId: 'operation-2',
      archivePath: '/local/verified-home.tar',
      bundleSha256: 'b'.repeat(64),
      expectedHomeServerIdentityId: 'home-2',
      expectedCanonicalServerUrl: 'https://source.example.test',
      sourceDescriptorRevision: 9,
    })).resolves.toMatchObject({ operationId: 'operation-2', status: 'quarantined' });

    const statusCommand = String(runRemoteTextSyncMock.mock.calls[2]?.[0]?.remoteCommand ?? '');
    expect(statusCommand).toContain("'home' 'relocation-destination' 'status'");
    expect(statusCommand).toContain("'--operation-id' 'operation-2'");
    expect(runRemoteTextSyncMock.mock.calls[3]?.[0]?.remoteCommand).toContain('rmdir --');
  });

  it('preserves successful staged authority when transfer cleanup needs attention', async () => {
    runRemoteTextSyncMock.mockReset();
    copyLocalDirectoryToRemoteSyncMock.mockReset();
    const remoteDir = '/tmp/happier-personal-home-relocation.operation-cleanup.ABC123';
    runRemoteTextSyncMock
      .mockReturnValueOnce({ status: 0, stdout: `${remoteDir}\n`, stderr: '' })
      .mockReturnValueOnce({
        status: 0,
        stdout: successfulHomeTask({
          operationId: 'operation-cleanup',
          status: 'quarantined',
          bundleSha256: 'd'.repeat(64),
          expectedHomeServerIdentityId: 'home-cleanup',
          expectedCanonicalServerUrl: 'https://source.example.test',
          sourceDescriptorRevision: 13,
          homeServerIdentityId: 'home-cleanup',
          authenticated: true,
          accountCount: 1,
          sessionCount: 0,
          canonicalServerUrl: 'http://127.0.0.1:43123',
          minimumOuterRevisionExclusive: 13,
        }),
        stderr: '',
      })
      .mockImplementationOnce(() => { throw new Error('temporary transfer cleanup failed'); });

    const destination = createRemoteSshPersonalHomeRelocationDestinationDefault({
      ssh: { target: 'relocation@example.test', auth: 'agent' },
      auth: { mode: 'agent' },
      knownHostsMode: 'app',
      channel: 'preview',
      mode: 'user',
      ensureRuntime: vi.fn(async () => undefined),
    });

    await expect(destination.stage({
      operationId: 'operation-cleanup',
      archivePath: '/local/verified-home.tar',
      bundleSha256: 'd'.repeat(64),
      expectedHomeServerIdentityId: 'home-cleanup',
      expectedCanonicalServerUrl: 'https://source.example.test',
      sourceDescriptorRevision: 13,
    })).resolves.toMatchObject({
      operationId: 'operation-cleanup',
      status: 'quarantined',
      transferCleanupNeedsAttention: true,
    });
  });
});
