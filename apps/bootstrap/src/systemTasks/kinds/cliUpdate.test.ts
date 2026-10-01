import { describe, expect, it, vi } from 'vitest';
import { systemTasks } from '@happier-dev/cli-common';

import { createCliUpdateHandler } from './cliUpdate.js';

async function run(handler: ReturnType<typeof createCliUpdateHandler>, params: unknown) {
  const events: unknown[] = [];
  const iterator = handler(params, { taskId: 't', signal: new AbortController().signal, now: Date.now, emit: (event) => events.push(event) });
  for (;;) {
    const next = await iterator.next();
    if (next.done) return { events, result: next.value };
    events.push(next.value);
  }
}

describe('cli.update.v1', () => {
  it('hands the transaction a restart that goes through the service owner and proves the new version', async () => {
    const restartService = vi.fn(async () => undefined);
    let daemonVersion = '0.3.0';
    restartService.mockImplementation(async () => { daemonVersion = '0.3.2'; });
    const handler = createCliUpdateHandler({
      updateManagedCli: async ({ planServiceDaemonRestart }) => {
        const restartServiceDaemon = await planServiceDaemonRestart();
        expect(typeof restartServiceDaemon).toBe('function');
        await restartServiceDaemon?.({ expectedVersion: '0.3.2', phase: 'activated' });
        return { previousVersion: '0.3.0', version: '0.3.2', restarted: true };
      },
      readDaemonStatus: async () => ({ serviceInstalled: true, daemonRunning: true, daemonServiceManaged: true, daemonCliVersion: daemonVersion, serviceTargetMode: 'pinned', serviceManagedBy: 'desktop' }),
      restartService,
    });

    const outcome = await run(handler, { channel: 'preview', relayUrl: 'http://127.0.0.1:43110' });

    expect(outcome.result).toEqual({ previousVersion: '0.3.0', version: '0.3.2', restarted: true });
    expect(restartService).toHaveBeenCalledWith({ releaseRing: 'preview', relayUrl: 'http://127.0.0.1:43110' });
  });

  it('fails the restart proof when the service comes back on another version, so the transaction restores', async () => {
    const handler = createCliUpdateHandler({
      updateManagedCli: async ({ planServiceDaemonRestart }) => {
        const restartServiceDaemon = await planServiceDaemonRestart();
        await expect(restartServiceDaemon?.({ expectedVersion: '0.3.2', phase: 'activated' }))
          .rejects.toThrow('runs 0.3.0 instead of 0.3.2');
        throw new systemTasks.SystemTaskExecutionError('cli_update_rolled_back', 'Happier CLI 0.3.2 did not start on this machine; 0.3.0 was restored.');
      },
      readDaemonStatus: async () => ({ serviceInstalled: true, daemonRunning: true, daemonServiceManaged: true, daemonCliVersion: '0.3.0', serviceTargetMode: 'default-following', serviceManagedBy: null }),
      restartService: async () => undefined,
    });
    await expect(run(handler, {})).rejects.toMatchObject({ code: 'cli_update_rolled_back' });
  });

  it('restarts nothing when the service\'s daemon was not running (or is a manual daemon)', async () => {
    const restartService = vi.fn(async () => undefined);
    const seen: unknown[] = [];
    for (const status of [
      { serviceInstalled: true, daemonRunning: false, daemonServiceManaged: null, daemonCliVersion: null, serviceTargetMode: 'default-following' as const },
      { serviceInstalled: true, daemonRunning: true, daemonServiceManaged: false, daemonCliVersion: '0.3.0', serviceTargetMode: 'default-following' as const },
      { serviceInstalled: true, daemonRunning: true, daemonServiceManaged: null, daemonCliVersion: '0.3.0', serviceTargetMode: 'default-following' as const },
      { serviceInstalled: true, daemonRunning: true, daemonServiceManaged: true, daemonCliVersion: '0.3.0', serviceTargetMode: null },
    ]) {
      await run(createCliUpdateHandler({
        updateManagedCli: async ({ planServiceDaemonRestart }) => {
          seen.push(await planServiceDaemonRestart());
          return { previousVersion: '0.3.0', version: '0.3.2', restarted: false };
        },
        readDaemonStatus: async () => status,
        restartService,
      }), {});
    }
    expect(seen).toEqual([null, null, null, null]);
    expect(restartService).not.toHaveBeenCalled();
  });

  it('keeps an update when a user-owned pinned service fails to return and reports that target', async () => {
    const outcome = await run(createCliUpdateHandler({
      updateManagedCli: async ({ planServiceDaemonRestart }) => {
        const restart = await planServiceDaemonRestart();
        await restart?.({ expectedVersion: '0.3.2', phase: 'activated' });
        return { previousVersion: '0.3.0', version: '0.3.2', restarted: true };
      },
      readDaemonStatus: async () => ({ serviceInstalled: true, daemonRunning: true, daemonServiceManaged: true, daemonCliVersion: '0.3.0', serviceTargetMode: 'pinned', serviceManagedBy: null, serviceServerId: 'company' }),
      restartService: async () => undefined,
    }), { channel: 'preview', relayUrl: 'https://company.test' });
    expect(outcome.result).toMatchObject({ version: '0.3.2' });
    expect(outcome.events).toContainEqual(expect.objectContaining({ type: 'progress', message: expect.stringContaining('https://company.test') }));
    expect(outcome.events).toContainEqual(expect.objectContaining({ type: 'progress', message: expect.stringContaining('hprev --server company service restart --instance=company') }));
  });

  it('passes a named refusal through for a CLI Happier did not install, reading no service status', async () => {
    const readDaemonStatus = vi.fn(async () => { throw new Error('must not read the service of a CLI Happier did not install'); });
    const handler = createCliUpdateHandler({
      readDaemonStatus,
      updateManagedCli: async () => {
        throw new systemTasks.SystemTaskExecutionError('cli_not_managed', 'The Happier CLI at /repo/apps/cli/bin/happier.mjs was not installed by Happier, so it is not updated here.');
      },
    });
    await expect(run(handler, {})).rejects.toMatchObject({ code: 'cli_not_managed' });
  });

  it('rejects an unknown channel', async () => {
    await expect(run(createCliUpdateHandler(), { channel: 'nightly' })).rejects.toMatchObject({ code: 'invalid_params' });
  });
});
