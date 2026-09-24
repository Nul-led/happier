import { describe, expect, it, vi } from 'vitest';
import type { SystemTaskExecutionRunner } from '@happier-dev/cli-common/systemTasks';

const localDaemonCliMock = vi.hoisted(() => ({
  readDaemonStatus: vi.fn(),
  restartService: vi.fn(),
  startService: vi.fn(),
  stopService: vi.fn(),
}));

vi.mock('../localDaemonCli.js', () => localDaemonCliMock);

import {
  createDaemonServiceRestartHandler,
  createDaemonServiceStopHandler,
} from './daemonService.js';

async function collectResult(
  handler: SystemTaskExecutionRunner,
  params: unknown,
) {
  const events: unknown[] = [];
  const iterator = handler(params, { taskId: 'test-task', signal: new AbortController().signal, now: Date.now, emit: (event) => events.push(event) });
  for (;;) {
    const next = await iterator.next();
    if (next.done) {
      return { events, result: next.value };
    }
    events.push(next.value);
  }
}

describe('daemonService lifecycle handlers', () => {
  it('stops the local daemon service through the canonical CLI wrapper', async () => {
    localDaemonCliMock.readDaemonStatus
      .mockResolvedValueOnce({
        serviceInstalled: true,
        daemonRunning: true,
        needsAuth: false,
        machineId: 'machine-local-1',
        daemonServerUrl: 'https://relay.example.test',
        daemonComparableKey: 'https://relay.example.test',
        daemonAccountId: 'acct_123',
        daemonMachineRegistered: true,
      })
      .mockResolvedValueOnce({
        serviceInstalled: true,
        daemonRunning: false,
        needsAuth: false,
        machineId: 'machine-local-1',
        daemonServerUrl: 'https://relay.example.test',
        daemonComparableKey: 'https://relay.example.test',
        daemonAccountId: 'acct_123',
        daemonMachineRegistered: true,
      });

    const handler = createDaemonServiceStopHandler();
    const outcome = await collectResult(handler, {
      target: { kind: 'local' },
      surface: 'desktop.ui',
      mode: 'user',
    });

    expect(localDaemonCliMock.stopService).toHaveBeenCalledTimes(1);
    expect(localDaemonCliMock.restartService).not.toHaveBeenCalled();
    expect(outcome.result).toEqual({
      serviceInstalled: true,
      daemonRunning: false,
      needsAuth: false,
      machineId: 'machine-local-1',
      daemonServerUrl: 'https://relay.example.test',
      daemonComparableKey: 'https://relay.example.test',
      daemonAccountId: 'acct_123',
      daemonMachineRegistered: true,
    });
  });

  it('restarts the local daemon service through the canonical CLI wrapper', async () => {
    localDaemonCliMock.readDaemonStatus.mockResolvedValue({
      serviceInstalled: true,
      daemonRunning: true,
      needsAuth: false,
      machineId: 'machine-local-1',
      daemonServerUrl: 'https://relay.example.test',
      daemonComparableKey: 'https://relay.example.test',
      daemonAccountId: 'acct_123',
      daemonMachineRegistered: true,
    });
    const handler = createDaemonServiceRestartHandler();
    const outcome = await collectResult(handler, {
      target: { kind: 'local' },
      surface: 'desktop.ui',
      mode: 'user',
    });

    expect(localDaemonCliMock.restartService).toHaveBeenCalledTimes(1);
    expect(localDaemonCliMock.startService).not.toHaveBeenCalled();
    expect(outcome.result).toEqual({
      serviceInstalled: true,
      daemonRunning: true,
      needsAuth: false,
      machineId: 'machine-local-1',
      daemonServerUrl: 'https://relay.example.test',
      daemonComparableKey: 'https://relay.example.test',
      daemonAccountId: 'acct_123',
      daemonMachineRegistered: true,
    });
  });
});
