import { beforeEach, describe, expect, it, vi } from 'vitest';

// Filesystem reads are the disclosure boundary; the real handler and logger remain composed.
const filesystem = vi.hoisted(() => ({ statSync: vi.fn<(...args: unknown[]) => unknown>() }));
vi.mock('node:fs', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:fs')>();
  filesystem.statSync.mockImplementation((...args) => Reflect.apply(original.statSync, original, args));
  return { ...original, statSync: filesystem.statSync };
});

import { DaemonPluginInvocationLogReadRequestV1Schema } from '@happier-dev/protocol';

import { createDaemonPluginInvocationLogReadHandler } from './daemonPluginInvocationLogs';
import { logger } from '@/ui/logger';

function expectNoLogRead(): void {
  expect(filesystem.statSync.mock.calls.filter(([path]) => path === logger.getLogPath())).toHaveLength(0);
}

const request = DaemonPluginInvocationLogReadRequestV1Schema.parse({
  version: 1,
  target: {
    serverIdentityId: 'srv_plugin_logs',
    machineId: 'machine-logs',
  },
  query: {
    pluginId: 'acme.example',
    occurrenceId: 'generation-1',
    correlationId: 'correlation-1',
  },
});

describe('daemon plugin invocation log RPC handler', () => {
  beforeEach(() => {
    filesystem.statSync.mockClear();
  });
  it('rejects a stale or cross-machine target before the canonical logger can read', async () => {
    const handler = createDaemonPluginInvocationLogReadHandler({
      resolveCurrentTarget: async () => ({
        serverIdentityId: 'srv_plugin_logs',
        machineId: 'machine-current',
      }),
    });

    await expect(handler(request)).resolves.toEqual({
      version: 1,
      kind: 'unavailable',
      code: 'plugin_log_target_mismatch',
    });
    expectNoLogRead();
  });

  it('honors cancellation before resolving target currentness or reading logs', async () => {
    const controller = new AbortController();
    const cancelled = new Error('cancelled');
    controller.abort(cancelled);
    const resolveCurrentTarget = vi.fn(async () => ({
      serverIdentityId: 'srv_plugin_logs',
      machineId: 'machine-logs',
    }));
    const handler = createDaemonPluginInvocationLogReadHandler({
      resolveCurrentTarget,
    });

    await expect(handler(request, { signal: controller.signal })).rejects.toBe(cancelled);
    expect(resolveCurrentTarget).not.toHaveBeenCalled();
    expectNoLogRead();
  });

  it('rechecks cancellation after target currentness resolves before reading the logger', async () => {
    const controller = new AbortController();
    const cancelled = new Error('cancelled-after-currentness');
    const handler = createDaemonPluginInvocationLogReadHandler({
      resolveCurrentTarget: async () => {
        controller.abort(cancelled);
        return {
          serverIdentityId: 'srv_plugin_logs',
          machineId: 'machine-logs',
        };
      },
    });

    await expect(handler(request, { signal: controller.signal })).rejects.toBe(cancelled);
    expectNoLogRead();
  });
});
