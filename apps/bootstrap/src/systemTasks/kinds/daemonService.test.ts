import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { SystemTaskExecutionRunner } from '@happier-dev/cli-common/systemTasks';

import { createDaemonServiceStartHandler, createDaemonServiceStatusHandler } from './daemonService.js';
import { readDaemonStatus } from '../localDaemonCli.js';

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
    writeFileSync(command, '#!/usr/bin/env node\nprocess.stdout.write(JSON.stringify({daemon:{running:true},service:{installed:true,autostart:"on-demand"},auth:{machineId:"test-machine",needsAuth:false}}));\n');
    chmodSync(command, 0o755);
    vi.stubEnv('HAPPIER_BOOTSTRAP_CLI_PATH', command);
    try {
      const outcome = await collectResult(createDaemonServiceStatusHandler(), {
        target: { kind: 'local' }, surface: 'desktop.ui', ...(channel ? { channel } : {}),
      });
      expect(outcome.result).toMatchObject({ machineId: 'test-machine', daemonRunning: true, serviceAutostart: null, serviceTargetMode: null, serviceManagedBy: null, serviceServerId: null });
      expect(await readDaemonStatus()).toMatchObject({ serviceAutostart: 'on-demand' });
      expect(outcome.events).toContainEqual(expect.objectContaining({
        type: 'cli.acquisition.progress', data: { phase: 'checkingDaemon' },
      }));
    } finally {
      vi.unstubAllEnvs();
      rmSync(fixtureDir, { recursive: true, force: true });
    }
  });

  (process.platform === 'win32' ? it.skip : it)('reads the daemon of the Home it names, with its account label and CLI update fact, never the terminal\'s active server', async () => {
    const fixtureDir = mkdtempSync(join(tmpdir(), 'hsetup-daemon-scoped-'));
    const command = join(fixtureDir, 'happier');
    const logPath = join(fixtureDir, 'calls.log');
    writeFileSync(command, [
      '#!/usr/bin/env node',
      "const { appendFileSync } = require('node:fs');",
      'const argv = process.argv.slice(2);',
      `appendFileSync(${JSON.stringify(logPath)}, JSON.stringify({ argv, targetMode: process.env.HAPPIER_DAEMON_SERVICE_TARGET_MODE ?? null }) + '\\n');`,
      "if (argv[0] === 'server' && argv[1] === 'list') {",
      "  process.stdout.write(JSON.stringify({ ok: true, data: { activeServerId: 'cloud', profiles: [{ id: 'cloud', serverUrl: 'https://api.happier.dev' }, { id: 'home', serverUrl: 'http://127.0.0.1:43110' }] } }));",
      '} else {',
      "  process.stdout.write(JSON.stringify({ server: { serverUrl: 'http://127.0.0.1:43110', comparableKey: 'http://127.0.0.1:43110' }, daemon: { running: true }, service: { installed: true }, auth: { machineId: 'm-home', needsAuth: false, accountId: 'acct-1', accountLabel: 'alice' } }));",
      '}',
    ].join('\n'));
    chmodSync(command, 0o755);
    vi.stubEnv('HAPPIER_BOOTSTRAP_CLI_PATH', command);
    vi.stubEnv('HAPPIER_HOME_DIR', fixtureDir);
    try {
      const outcome = await collectResult(createDaemonServiceStatusHandler(), {
        target: { kind: 'local' }, surface: 'desktop.ui', relayUrl: 'http://127.0.0.1:43110',
      });
      expect(outcome.result).toMatchObject({
        machineId: 'm-home',
        daemonRunning: true,
        daemonAccountId: 'acct-1',
        daemonAccountLabel: 'alice',
        cliUpdate: null,
      });
      const calls = readFileSync(logPath, 'utf8').trim().split('\n').map((line) => JSON.parse(line) as { argv: string[]; targetMode: string | null });
      expect(calls).toEqual([
        { argv: ['server', 'list', '--json'], targetMode: 'default-following' },
        { argv: ['--server', 'home', 'daemon', 'status', '--json'], targetMode: 'pinned' },
      ]);
    } finally {
      vi.unstubAllEnvs();
      rmSync(fixtureDir, { recursive: true, force: true });
    }
  });


  it('reports a Home the CLI has never been set up for as not installed, without reading another server', async () => {
    const fixtureDir = mkdtempSync(join(tmpdir(), 'hsetup-daemon-unscoped-'));
    const command = join(fixtureDir, 'happier');
    writeFileSync(command, [
      '#!/usr/bin/env node',
      'const argv = process.argv.slice(2);',
      "if (argv[0] === 'server' && argv[1] === 'list') process.stdout.write(JSON.stringify({ ok: true, data: { activeServerId: 'cloud', profiles: [] } }));",
      "else { process.stderr.write('unexpected ' + argv.join(' ')); process.exit(1); }",
    ].join('\n'));
    chmodSync(command, 0o755);
    vi.stubEnv('HAPPIER_BOOTSTRAP_CLI_PATH', command);
    vi.stubEnv('HAPPIER_HOME_DIR', fixtureDir);
    try {
      const outcome = await collectResult(createDaemonServiceStatusHandler(), {
        target: { kind: 'local' }, surface: 'desktop.ui', relayUrl: 'http://127.0.0.1:43110',
      });
      expect(outcome.result).toMatchObject({ serviceInstalled: false, daemonRunning: false, needsAuth: true, machineId: null });
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
