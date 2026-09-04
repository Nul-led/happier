import { describe, expect, it, vi } from 'vitest';

function decodeBashSingleQuotedArgument(value: unknown): string {
  const raw = String(value ?? '');
  if (!raw.startsWith("'") || !raw.endsWith("'")) return raw;
  return raw.slice(1, -1).replaceAll("'\"'\"'", "'");
}

const { copyLocalDirectoryToRemoteSyncMock, runRemoteTextSyncMock } = vi.hoisted(() => ({
  copyLocalDirectoryToRemoteSyncMock: vi.fn(),
  runRemoteTextSyncMock: vi.fn(),
}));

vi.mock('@happier-dev/cli-common/ssh', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@happier-dev/cli-common/ssh')>();
  return {
    ...actual,
    copyLocalDirectoryToRemoteSync: copyLocalDirectoryToRemoteSyncMock,
    runOpenSshRemoteCommand: async (params: Parameters<typeof actual.runOpenSshRemoteCommand>[0]) => (
      await runRemoteTextSyncMock({
        ...params,
        remoteCommand: decodeBashSingleQuotedArgument(params.remoteCommand[2]),
      })
    ),
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
    const remoteArchive = '/tmp/happier-personal-home-relocation/operation-1/bundle.tar';
    runRemoteTextSyncMock
      .mockReturnValueOnce({
        status: 0,
        stdout: successfulHomeTask({ operationId: 'operation-1', uploadLocator: remoteArchive, uploadReceipt: '11111111-1111-4111-8111-111111111111' }),
        stderr: '',
      })
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
      });
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
      remotePath: remoteArchive,
    }));
    const stageCommand = String(runRemoteTextSyncMock.mock.calls[1]?.[0]?.remoteCommand ?? '');
    expect(stageCommand).toContain("HAPPIER_PUBLIC_RELEASE_CHANNEL='preview'");
    expect(stageCommand).toContain("'home' 'relocation-destination' 'stage'");
    expect(stageCommand).toContain("'--upload-receipt' '11111111-1111-4111-8111-111111111111'");
    expect(stageCommand).toContain("'--channel' 'preview' '--mode' 'system'");
    expect(runRemoteTextSyncMock).toHaveBeenCalledTimes(2);
  });

  it('uses destination-owned upload preparation and cleanup for a Windows relocation target', async () => {
    runRemoteTextSyncMock.mockReset();
    copyLocalDirectoryToRemoteSyncMock.mockReset();
    const uploadLocator = 'C:/Users/destination/AppData/Local/Temp/happier-personal-home-relocation/operation-windows.ABC123/bundle.tar';
    runRemoteTextSyncMock
      .mockReturnValueOnce({
        status: 0,
        stdout: successfulHomeTask({
          operationId: 'operation-windows',
          uploadLocator,
          uploadReceipt: '22222222-2222-4222-8222-222222222222',
        }),
        stderr: '',
      })
      .mockReturnValueOnce({
        status: 0,
        stdout: successfulHomeTask({
          operationId: 'operation-windows',
          status: 'quarantined',
          bundleSha256: 'e'.repeat(64),
          expectedHomeServerIdentityId: 'home-windows',
          expectedCanonicalServerUrl: 'https://source.example.test',
          sourceDescriptorRevision: 17,
          homeServerIdentityId: 'home-windows',
          authenticated: true,
          accountCount: 1,
          sessionCount: 0,
          canonicalServerUrl: 'http://127.0.0.1:43123',
          minimumOuterRevisionExclusive: 17,
        }),
        stderr: '',
      });

    const destination = createRemoteSshPersonalHomeRelocationDestinationDefault({
      ssh: { target: 'windows-destination@example.test', auth: 'agent' },
      auth: { mode: 'agent' },
      knownHostsMode: 'app',
      channel: 'stable',
      mode: 'system',
      ensureRuntime: vi.fn(async () => undefined),
    });

    await expect(destination.stage({
      operationId: 'operation-windows',
      archivePath: '/local/verified-home.tar',
      bundleSha256: 'e'.repeat(64),
      expectedHomeServerIdentityId: 'home-windows',
      expectedCanonicalServerUrl: 'https://source.example.test',
      sourceDescriptorRevision: 17,
    })).resolves.toMatchObject({ operationId: 'operation-windows', status: 'quarantined' });

    expect(copyLocalDirectoryToRemoteSyncMock).toHaveBeenCalledWith(expect.objectContaining({
      localPath: '/local/verified-home.tar',
      remotePath: uploadLocator,
    }));
    const prepareCommand = String(runRemoteTextSyncMock.mock.calls[0]?.[0]?.remoteCommand ?? '');
    const consumeCommand = String(runRemoteTextSyncMock.mock.calls[1]?.[0]?.remoteCommand ?? '');
    expect(prepareCommand).toContain("'home' 'relocation-destination' 'stage' '--operation-id' 'operation-windows' '--prepare-upload'");
    expect(consumeCommand).toContain("'--upload-receipt' '22222222-2222-4222-8222-222222222222'");
    expect(consumeCommand).not.toContain(uploadLocator);
    expect(runRemoteTextSyncMock.mock.calls).toHaveLength(2);
    expect(runRemoteTextSyncMock.mock.calls.some(([call]) => /(?:umask|mktemp|rm -f|rmdir)/u.test(String(call.remoteCommand)))).toBe(false);
  });

  it('asks the destination owner to abort an upload reservation after archive transfer fails', async () => {
    runRemoteTextSyncMock.mockReset();
    copyLocalDirectoryToRemoteSyncMock.mockReset();
    const uploadLocator = '/private/opaque/operation-transfer-failed/SECRET-bundle.tar';
    copyLocalDirectoryToRemoteSyncMock.mockImplementationOnce(() => {
      throw new Error(`scp connection closed while writing ${uploadLocator}`);
    });
    runRemoteTextSyncMock
      .mockReturnValueOnce({
        status: 0,
        stdout: successfulHomeTask({
          operationId: 'operation-transfer-failed',
          uploadLocator,
          uploadReceipt: '66666666-6666-4666-8666-666666666666',
        }),
        stderr: '',
      })
      .mockReturnValueOnce({
        status: 0,
        stdout: successfulHomeTask({ operationId: 'operation-transfer-failed', status: 'absent' }),
        stderr: '',
      });

    const destination = createRemoteSshPersonalHomeRelocationDestinationDefault({
      ssh: { target: 'relocation@example.test', auth: 'agent' },
      auth: { mode: 'agent' },
      knownHostsMode: 'app',
      channel: 'preview',
      mode: 'system',
      ensureRuntime: vi.fn(async () => undefined),
    });

    const failure = await destination.stage({
      operationId: 'operation-transfer-failed',
      archivePath: '/local/verified-home.tar',
      bundleSha256: 'f'.repeat(64),
      expectedHomeServerIdentityId: 'home-transfer-failed',
      expectedCanonicalServerUrl: 'https://source.example.test',
      sourceDescriptorRevision: 19,
    }).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toContain('scp connection closed');
    expect(JSON.stringify(failure)).not.toContain(uploadLocator);
    expect((failure as Error).message).not.toContain(uploadLocator);

    expect(runRemoteTextSyncMock).toHaveBeenCalledTimes(2);
    const abortCommand = String(runRemoteTextSyncMock.mock.calls[1]?.[0]?.remoteCommand ?? '');
    expect(abortCommand).toContain("'home' 'relocation-destination' 'abort'");
    expect(abortCommand).toContain("'--operation-id' 'operation-transfer-failed'");
    expect(runRemoteTextSyncMock.mock.calls.some(([call]) => String(call.remoteCommand).includes('--upload-receipt'))).toBe(false);
  });

  it('preserves the transfer failure and marks cleanup attention when destination abort cannot be confirmed', async () => {
    runRemoteTextSyncMock.mockReset();
    copyLocalDirectoryToRemoteSyncMock.mockReset();
    const uploadLocator = '/private/opaque/operation-abort-failed/SECRET-bundle.tar';
    copyLocalDirectoryToRemoteSyncMock.mockImplementationOnce(() => {
      throw new Error(`scp connection closed while writing ${uploadLocator}`);
    });
    runRemoteTextSyncMock
      .mockReturnValueOnce({
        status: 0,
        stdout: successfulHomeTask({
          operationId: 'operation-abort-failed',
          uploadLocator,
          uploadReceipt: '77777777-7777-4777-8777-777777777777',
        }),
        stderr: '',
      })
      .mockImplementationOnce(() => {
        throw new Error(`destination abort unavailable for ${uploadLocator}`);
      });

    const destination = createRemoteSshPersonalHomeRelocationDestinationDefault({
      ssh: { target: 'relocation@example.test', auth: 'agent' },
      auth: { mode: 'agent' },
      knownHostsMode: 'system',
      channel: 'stable',
      mode: 'user',
      ensureRuntime: vi.fn(async () => undefined),
    });

    const failure = await destination.stage({
      operationId: 'operation-abort-failed',
      archivePath: '/local/verified-home.tar',
      bundleSha256: '1'.repeat(64),
      expectedHomeServerIdentityId: 'home-abort-failed',
      expectedCanonicalServerUrl: 'https://source.example.test',
      sourceDescriptorRevision: 23,
    }).catch((error: unknown) => error);

    expect(failure).toMatchObject({
      message: expect.stringContaining('scp connection closed'),
      transferCleanupNeedsAttention: true,
    });
    expect((failure as Error).message).not.toContain(uploadLocator);
    expect(JSON.stringify(failure)).not.toContain(uploadLocator);
    expect(String((failure as Error & { cause?: unknown }).cause ?? '')).not.toContain(uploadLocator);

    expect(runRemoteTextSyncMock).toHaveBeenCalledTimes(2);
    expect(String(runRemoteTextSyncMock.mock.calls[1]?.[0]?.remoteCommand ?? '')).toContain("'relocation-destination' 'abort'");
  });

  it('does not abort when destination upload preparation itself fails', async () => {
    runRemoteTextSyncMock.mockReset();
    copyLocalDirectoryToRemoteSyncMock.mockReset();
    runRemoteTextSyncMock.mockImplementationOnce(() => {
      throw new Error('upload preparation failed');
    });

    const destination = createRemoteSshPersonalHomeRelocationDestinationDefault({
      ssh: { target: 'relocation@example.test', auth: 'agent' },
      auth: { mode: 'agent' },
      knownHostsMode: 'app',
      channel: 'dev',
      mode: 'user',
      ensureRuntime: vi.fn(async () => undefined),
    });

    await expect(destination.stage({
      operationId: 'operation-prepare-failed',
      archivePath: '/local/verified-home.tar',
      bundleSha256: '2'.repeat(64),
      expectedHomeServerIdentityId: 'home-prepare-failed',
      expectedCanonicalServerUrl: 'https://source.example.test',
      sourceDescriptorRevision: 29,
    })).rejects.toThrow('upload preparation failed');

    expect(copyLocalDirectoryToRemoteSyncMock).not.toHaveBeenCalled();
    expect(runRemoteTextSyncMock).toHaveBeenCalledTimes(1);
  });

  it('rejects quarantined remote facts without private authentication attestation', async () => {
    runRemoteTextSyncMock.mockReset();
    copyLocalDirectoryToRemoteSyncMock.mockReset();
    const remoteArchive = '/tmp/happier-personal-home-relocation/operation-3/bundle.tar';
    runRemoteTextSyncMock
      .mockReturnValueOnce({
        status: 0,
        stdout: successfulHomeTask({ operationId: 'operation-3', uploadLocator: remoteArchive, uploadReceipt: '33333333-3333-4333-8333-333333333333' }),
        stderr: '',
      })
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
      });

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
    const remoteArchive = '/tmp/happier-personal-home-relocation/operation-2/bundle.tar';
    runRemoteTextSyncMock
      .mockReturnValueOnce({
        status: 0,
        stdout: successfulHomeTask({ operationId: 'operation-2', uploadLocator: remoteArchive, uploadReceipt: '44444444-4444-4444-8444-444444444444' }),
        stderr: '',
      })
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
      });

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
    expect(runRemoteTextSyncMock).toHaveBeenCalledTimes(3);
  });

  it('preserves successful staged authority when destination-owned transfer cleanup needs attention', async () => {
    runRemoteTextSyncMock.mockReset();
    copyLocalDirectoryToRemoteSyncMock.mockReset();
    const remoteArchive = '/tmp/happier-personal-home-relocation/operation-cleanup/bundle.tar';
    runRemoteTextSyncMock
      .mockReturnValueOnce({
        status: 0,
        stdout: successfulHomeTask({ operationId: 'operation-cleanup', uploadLocator: remoteArchive, uploadReceipt: '55555555-5555-4555-8555-555555555555' }),
        stderr: '',
      })
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
          transferCleanupNeedsAttention: true,
        }),
        stderr: '',
      });

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

  it('parses an absent destination abort result that reports transfer cleanup attention', async () => {
    runRemoteTextSyncMock.mockReset();
    runRemoteTextSyncMock.mockReturnValueOnce({
      status: 0,
      stdout: successfulHomeTask({ operationId: 'operation-absent', status: 'absent', transferCleanupNeedsAttention: true }),
      stderr: '',
    });

    const destination = createRemoteSshPersonalHomeRelocationDestinationDefault({
      ssh: { target: 'relocation@example.test', auth: 'agent' },
      auth: { mode: 'agent' },
      knownHostsMode: 'system',
      channel: 'dev',
      mode: 'user',
      ensureRuntime: vi.fn(async () => undefined),
    });

    await expect(destination.abort('operation-absent')).resolves.toEqual({
      operationId: 'operation-absent',
      status: 'absent',
      transferCleanupNeedsAttention: true,
    });
  });
});
