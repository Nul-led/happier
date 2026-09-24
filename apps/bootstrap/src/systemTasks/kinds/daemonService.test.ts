import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { SystemTaskExecutionRunner } from '@happier-dev/cli-common/systemTasks';

import { createDaemonServiceStartHandler, createDaemonServiceStatusHandler } from './daemonService.js';

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

describe('daemonService system task handlers', () => {
  (process.platform === 'win32' ? it.skip : it).each([undefined, 'preview'] as const)('reports the daemon check through the live task stream after command acquisition (%s)', async (channel) => {
    const fixtureDir = mkdtempSync(join(tmpdir(), 'hsetup-daemon-progress-'));
    const command = join(fixtureDir, 'happier');
    writeFileSync(command, '#!/usr/bin/env node\nprocess.stdout.write(JSON.stringify({daemon:{running:true},service:{installed:true},auth:{machineId:"test-machine",needsAuth:false}}));\n');
    chmodSync(command, 0o755);
    vi.stubEnv('HAPPIER_BOOTSTRAP_CLI_PATH', command);
    try {
      const outcome = await collectResult(createDaemonServiceStatusHandler(), {
        target: { kind: 'local' }, surface: 'desktop.ui', ...(channel ? { channel } : {}),
      });
      expect(outcome.result).toMatchObject({ machineId: 'test-machine', daemonRunning: true });
      expect(outcome.events).toContainEqual(expect.objectContaining({
        type: 'cli.acquisition.progress', data: { phase: 'checkingDaemon' },
      }));
    } finally {
      vi.unstubAllEnvs();
      rmSync(fixtureDir, { recursive: true, force: true });
    }
  });

  it('rejects invalid daemon service params for the status task', async () => {
    const handler = createDaemonServiceStatusHandler();

    await expect(collectResult(handler, null)).rejects.toMatchObject({
      code: 'invalid_params',
    });
  });

  it('rejects daemon service start params that target a non-local machine', async () => {
    const handler = createDaemonServiceStartHandler();

    await expect(collectResult(handler, {
      target: { kind: 'remote' },
      surface: 'desktop.ui',
      mode: 'user',
    })).rejects.toMatchObject({
      code: 'invalid_params',
    });
  });
});
