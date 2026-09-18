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
    transferOpenSshFile: copyLocalDirectoryToRemoteSyncMock,
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

  it('forwards the exact bounded approval input to SSH stdin under the task result contract', async () => {
    runRemoteTextSyncMock.mockReset();
    runRemoteTextSyncMock.mockReturnValue({
      status: 0,
      stdout: successfulHomeTask({ outcome: 'erased', removedPaths: ['/srv/home'] }),
      stderr: '',
    });
    const approvalInput = '{"v":1,"operation":"erase","confirmed":true}\n';

    await expect(runRemotePersonalHomeCommandDefault({
      ssh: { target: 'dev@example.test', auth: 'agent' },
      auth: { mode: 'agent' },
      knownHostsMode: 'app',
      channel: 'stable',
      mode: 'user',
      args: ['home', 'erase', '--approval-stdin', '--json'],
      input: approvalInput,
      resultContract: 'task',
      timeoutMs: null,
    })).resolves.toEqual({ outcome: 'erased', removedPaths: ['/srv/home'] });

    expect(runRemoteTextSyncMock).toHaveBeenCalledWith(expect.objectContaining({
      input: approvalInput,
      timeoutMs: null,
    }));
  });

  it('preserves the canonical create envelope under the create result contract', async () => {
    runRemoteTextSyncMock.mockReset();
    const envelope = {
      v: 1,
      ok: true,
      kind: 'personal_home_create',
      data: { status: 'complete', profileId: 'profile-1' },
    };
    runRemoteTextSyncMock.mockReturnValue({ status: 0, stdout: JSON.stringify(envelope), stderr: '' });

    await expect(runRemotePersonalHomeCommandDefault({
      ssh: { target: 'dev@example.test', auth: 'agent' },
      auth: { mode: 'agent' },
      knownHostsMode: 'app',
      channel: 'stable',
      mode: 'user',
      args: ['home', 'create', '--json'],
      resultContract: 'create',
    })).resolves.toEqual(envelope);
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
        stdout: successfulHomeTask({ operationId: 'operation-1', uploadLocator: remoteArchive }),
        stderr: '',
      })
      .mockReturnValueOnce({
        status: 0,
        stdout: successfulHomeTask({
          operationId: 'operation-1',
          status: 'quarantined',
          bundleSha256: 'a'.repeat(64),
          expectedHomeServerIdentityId: 'srv_home_1',
          expectedCanonicalServerUrl: 'https://source.example.test',
          sourceDescriptorRevision: 7,
          homeServerIdentityId: 'srv_home_1',
          authenticated: true,
          accountCount: 1,
          sessionCount: 0,
          connectionDescriptor: { v: 1, homeServerIdentityId: 'srv_home_1', canonicalServerUrl: 'http://127.0.0.1:43123',
            revision: 8, endpoints: [{ kind: 'https', url: 'http://127.0.0.1:43123' }] },
        }),
        stderr: '',
      });
    const ensureRuntime = vi.fn(async () => undefined);
    const controller = new AbortController();

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
      expectedHomeServerIdentityId: 'srv_home_1',
      expectedCanonicalServerUrl: 'https://source.example.test',
      sourceDescriptorRevision: 7,
      signal: controller.signal,
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
    }, controller.signal);
    expect(copyLocalDirectoryToRemoteSyncMock).toHaveBeenCalledWith(expect.objectContaining({
      target: 'relocation@example.test',
      port: 2222,
      localPath: '/local/verified-home.tar',
      remotePath: remoteArchive,
      signal: controller.signal,
    }));
    const stageCommand = String(runRemoteTextSyncMock.mock.calls[1]?.[0]?.remoteCommand ?? '');
    expect(stageCommand).toContain("HAPPIER_PUBLIC_RELEASE_CHANNEL='preview'");
    expect(stageCommand).toContain("'home' 'relocation-destination' 'stage'");
    expect(stageCommand).not.toContain('--upload-receipt');
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
        }),
        stderr: '',
      })
      .mockReturnValueOnce({
        status: 0,
        stdout: successfulHomeTask({
          operationId: 'operation-windows',
          status: 'quarantined',
          bundleSha256: 'e'.repeat(64),
          expectedHomeServerIdentityId: 'srv_home_windows',
          expectedCanonicalServerUrl: 'https://source.example.test',
          sourceDescriptorRevision: 17,
          homeServerIdentityId: 'srv_home_windows',
          authenticated: true,
          accountCount: 1,
          sessionCount: 0,
          connectionDescriptor: { v: 1, homeServerIdentityId: 'srv_home_windows', canonicalServerUrl: 'http://127.0.0.1:43123',
            revision: 18, endpoints: [{ kind: 'https', url: 'http://127.0.0.1:43123' }] },
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
      expectedHomeServerIdentityId: 'srv_home_windows',
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
    expect(consumeCommand).not.toContain('--upload-receipt');
    expect(consumeCommand).not.toContain(uploadLocator);
    expect(runRemoteTextSyncMock.mock.calls).toHaveLength(2);
    expect(runRemoteTextSyncMock.mock.calls.some(([call]) => /(?:umask|mktemp|rm -f|rmdir)/u.test(String(call.remoteCommand)))).toBe(false);
  });

  it('asks the destination owner to abort an upload reservation after archive transfer fails', async () => {
    runRemoteTextSyncMock.mockReset();
    copyLocalDirectoryToRemoteSyncMock.mockReset();
    const uploadLocator = '/private/opaque/operation-transfer-failed/SECRET-bundle.tar';
    const controller = new AbortController();
    copyLocalDirectoryToRemoteSyncMock.mockImplementationOnce(() => {
      controller.abort();
      throw new Error(`scp connection closed while writing ${uploadLocator}`);
    });
    runRemoteTextSyncMock
      .mockReturnValueOnce({
        status: 0,
        stdout: successfulHomeTask({
          operationId: 'operation-transfer-failed',
          uploadLocator,
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
      signal: controller.signal,
    }).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toContain('scp connection closed');
    expect(JSON.stringify(failure)).not.toContain(uploadLocator);
    expect((failure as Error).message).not.toContain(uploadLocator);

    expect(runRemoteTextSyncMock).toHaveBeenCalledTimes(2);
    expect(runRemoteTextSyncMock.mock.calls[0]?.[0]?.signal).toBe(controller.signal);
    expect(runRemoteTextSyncMock.mock.calls[1]?.[0]?.signal).toBeUndefined();
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
        stdout: successfulHomeTask({ operationId: 'operation-3', uploadLocator: remoteArchive }),
        stderr: '',
      })
      .mockReturnValueOnce({
        status: 0,
        stdout: successfulHomeTask({
          operationId: 'operation-3',
          status: 'quarantined',
          bundleSha256: 'c'.repeat(64),
          expectedHomeServerIdentityId: 'srv_home_3',
          expectedCanonicalServerUrl: 'https://source.example.test',
          sourceDescriptorRevision: 11,
          homeServerIdentityId: 'srv_home_3',
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
      expectedHomeServerIdentityId: 'srv_home_3',
      expectedCanonicalServerUrl: 'https://source.example.test',
      sourceDescriptorRevision: 11,
    })).rejects.toThrow();
  });

  it('reconciles a lost stage response through destination status and still cleans transfer material', async () => {
    runRemoteTextSyncMock.mockReset();
    copyLocalDirectoryToRemoteSyncMock.mockReset();
    const remoteArchive = '/tmp/happier-personal-home-relocation/operation-2/bundle.tar';
    runRemoteTextSyncMock
      .mockReturnValueOnce({
        status: 0,
        stdout: successfulHomeTask({ operationId: 'operation-2', uploadLocator: remoteArchive }),
        stderr: '',
      })
      .mockImplementationOnce(() => { throw new Error('ssh response lost'); })
      .mockReturnValueOnce({
        status: 0,
        stdout: successfulHomeTask({
          operationId: 'operation-2',
          status: 'quarantined',
          bundleSha256: 'b'.repeat(64),
          expectedHomeServerIdentityId: 'srv_home_2',
          expectedCanonicalServerUrl: 'https://source.example.test',
          sourceDescriptorRevision: 9,
          homeServerIdentityId: 'srv_home_2',
          connectionDescriptor: { v: 1, homeServerIdentityId: 'srv_home_2', canonicalServerUrl: 'https://source.example.test', revision: 10, endpoints: [{ kind: 'https', url: 'https://destination.example.test' }] },
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
      expectedHomeServerIdentityId: 'srv_home_2',
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
        stdout: successfulHomeTask({ operationId: 'operation-cleanup', uploadLocator: remoteArchive }),
        stderr: '',
      })
      .mockReturnValueOnce({
        status: 0,
        stdout: successfulHomeTask({
          operationId: 'operation-cleanup',
          status: 'quarantined',
          bundleSha256: 'd'.repeat(64),
          expectedHomeServerIdentityId: 'srv_home_cleanup',
          expectedCanonicalServerUrl: 'https://source.example.test',
          sourceDescriptorRevision: 13,
          homeServerIdentityId: 'srv_home_cleanup',
          authenticated: true,
          accountCount: 1,
          sessionCount: 0,
          connectionDescriptor: { v: 1, homeServerIdentityId: 'srv_home_cleanup', canonicalServerUrl: 'http://127.0.0.1:43123',
            revision: 14, endpoints: [{ kind: 'https', url: 'http://127.0.0.1:43123' }] },
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
      expectedHomeServerIdentityId: 'srv_home_cleanup',
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
