import { describe, expect, it, vi } from 'vitest';

const { runRemoteTextSyncMock } = vi.hoisted(() => ({
  runRemoteTextSyncMock: vi.fn(),
}));

vi.mock('@happier-dev/cli-common/ssh', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@happier-dev/cli-common/ssh')>();
  return {
    ...actual,
    runRemoteTextSync: runRemoteTextSyncMock,
  };
});

import { runRemoteDaemonServiceCommandDefault, runRemotePersonalHomeCommandDefault } from './remoteSshManageHostTasks.js';

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
});
