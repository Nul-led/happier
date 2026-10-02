import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest';

import type { ManagedCliUpdateRestart } from '@happier-dev/cli-common/firstPartyRuntime';

const { runLocalHappierJsonCommandMock, updateManagedLocalHappierCliMock } = vi.hoisted(() => ({
  runLocalHappierJsonCommandMock: vi.fn(),
  updateManagedLocalHappierCliMock: vi.fn(),
}));

// The Happier CLI is a subprocess boundary. The update transaction itself is proven at its owner
// (cli-common `runManagedCliUpdate`, and `updateManagedLocalHappierCli` in happierCli.test.ts);
// here the stand-in hands the kind's restart plan to the transaction the way it does.
vi.mock('../happierCli.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../happierCli.js')>();
  return {
    ...actual,
    runLocalHappierJsonCommand: runLocalHappierJsonCommandMock,
    updateManagedLocalHappierCli: updateManagedLocalHappierCliMock,
  };
});

import { createCliUpdateHandler } from './cliUpdate.js';

const CURRENT_CLI = { command: '/home/user/.happier/cli/current/happier', provenance: 'managed' as const, version: '0.2.13' };

function statusJson(params: Readonly<{ running: boolean; serviceManaged: boolean; version?: string }>) {
  return {
    server: {
      activeServerId: 'cloud',
      serverUrl: 'https://api.happier.dev',
      localServerUrl: null,
      publicServerUrl: 'https://api.happier.dev',
      webappUrl: 'https://app.happier.dev',
      comparableKey: 'api.happier.dev',
    },
    daemon: {
      running: params.running,
      pid: params.running ? 42 : null,
      httpPort: params.running ? 7777 : null,
      serviceManaged: params.serviceManaged,
      ...(params.version ? { startedWithCliVersion: params.version } : {}),
    },
    service: { installed: true, running: params.running },
    auth: { authenticated: true, machineRegistered: true, machineId: 'm1', needsAuth: false, accountId: 'acct' },
  };
}

/** The transaction's use of the plan: restart onto the target, and report what it proved. */
function transactionStandIn(targetVersion: string) {
  return async (params: Readonly<{ planRestart: (current: typeof CURRENT_CLI) => Promise<ManagedCliUpdateRestart | null> }>) => {
    const restart = await params.planRestart(CURRENT_CLI);
    await restart?.({ expectedVersion: targetVersion, phase: 'activated' });
    return { previousVersion: CURRENT_CLI.version, cli: { ...CURRENT_CLI, version: targetVersion }, restarted: restart !== null };
  };
}

type CliCall = Readonly<{ args: readonly string[]; processEnv?: NodeJS.ProcessEnv }>;

/**
 * Answers the CLI by what it was asked: each service's status reads in order (the default-following
 * one, or a pinned one by its instance), `ok` for every lifecycle command, and the service
 * inventory — none unless a test lists pinned services.
 */
function answerCli(params: Readonly<{
  defaultStatuses: readonly unknown[];
  pinned?: Readonly<Record<string, Readonly<{ relayUrl: string; statuses: readonly unknown[]; unreadable?: boolean; managedBy?: 'desktop' | null }>>>;
}>): void {
  const reads = new Map<string, number>();
  runLocalHappierJsonCommandMock.mockImplementation(async (call: CliCall) => {
    const command = call.args.join(' ');
    if (command === 'daemon service list --json') {
      return {
        entries: Object.entries(params.pinned ?? {}).map(([instance, service]) => ({
          serverId: instance,
          activeServerId: instance,
          relayUrl: service.relayUrl,
          targetMode: 'pinned',
          releaseChannel: 'stable',
          happierHomeDir: process.env.HAPPIER_HOME_DIR,
          managedBy: service.managedBy ?? null,
        })),
      };
    }
    if (command !== 'daemon status --json') {
      return { ok: true };
    }
    const instance = call.processEnv?.HAPPIER_DAEMON_SERVICE_INSTANCE_ID ?? 'default';
    if (instance !== 'default' && params.pinned?.[instance]?.unreadable) {
      throw new Error('unreadable service definition');
    }
    const statuses = instance === 'default' ? params.defaultStatuses : params.pinned?.[instance]?.statuses ?? [];
    const index = reads.get(instance) ?? 0;
    reads.set(instance, index + 1);
    return statuses[Math.min(index, statuses.length - 1)];
  });
}

function commandLog(): string[] {
  return runLocalHappierJsonCommandMock.mock.calls
    .map(([call]) => `${(call as CliCall).args.join(' ')}@${(call as CliCall).processEnv?.HAPPIER_DAEMON_SERVICE_INSTANCE_ID ?? 'default'}`)
    .filter((entry) => !entry.startsWith('daemon service list'));
}

async function run(params: unknown) {
  const events: unknown[] = [];
  const iterator = createCliUpdateHandler()(params, { signal: new AbortController().signal, emit: (event) => { events.push(event); } });
  for (;;) {
    const next = await iterator.next();
    if (next.done) return { result: next.value, events };
  }
}

describe('cli.update.v1', () => {
  const originalEnv = { ...process.env };
  afterEach(() => {
    vi.clearAllMocks();
    runLocalHappierJsonCommandMock.mockReset();
    process.env = { ...originalEnv };
  });

  it('restarts a running service daemon through the service\'s own relay selection and proves the new version', async () => {
    // A stack-pinned launch: the restart and its proof must not follow the pinned profile.
    process.env.HAPPIER_ACTIVE_SERVER_ID = 'stack-pinned';
    updateManagedLocalHappierCliMock.mockImplementation(transactionStandIn('0.2.14'));
    answerCli({ defaultStatuses: [
      statusJson({ running: true, serviceManaged: true, version: '0.2.13' }),
      statusJson({ running: true, serviceManaged: true, version: '0.2.14' }),
    ] });

    const { result } = await run({ channel: 'preview' });

    expect(updateManagedLocalHappierCliMock).toHaveBeenCalledWith(expect.objectContaining({ releaseRing: 'preview' }));
    expect(commandLog()).toEqual([
      'daemon status --json@default',
      'daemon service restart --json@default',
      'daemon status --json@default',
    ]);
    for (const [call] of runLocalHappierJsonCommandMock.mock.calls) {
      expect(call.cli.command).toBe(CURRENT_CLI.command);
      expect(call.processEnv.HAPPIER_ACTIVE_SERVER_ID).toBeUndefined();
    }
    expect(result).toEqual({ previousVersion: '0.2.13', version: '0.2.14', restarted: true });
  });

  it('does not start a daemon that was not running, nor restart a manual one', async () => {
    updateManagedLocalHappierCliMock.mockImplementation(transactionStandIn('0.2.14'));
    answerCli({ defaultStatuses: [statusJson({ running: false, serviceManaged: false })] });
    expect((await run({ channel: 'stable' })).result).toEqual({ previousVersion: '0.2.13', version: '0.2.14', restarted: false });

    answerCli({ defaultStatuses: [statusJson({ running: true, serviceManaged: false, version: '0.2.13' })] });
    expect((await run({ channel: 'stable' })).result).toMatchObject({ restarted: false });
    expect(runLocalHappierJsonCommandMock.mock.calls.some((call) => call[0].args.includes('restart'))).toBe(false);
  });

  it('fails the restart proof when the restarted daemon still runs the previous version', async () => {
    updateManagedLocalHappierCliMock.mockImplementation(transactionStandIn('0.2.14'));
    answerCli({ defaultStatuses: [statusJson({ running: true, serviceManaged: true, version: '0.2.13' })] });

    await expect(run({ channel: 'stable' })).rejects.toThrow(/runs 0\.2\.13 instead of 0\.2\.14/);
  });

  /**
   * One daemon per relay: a relay this computer also serves runs its own pinned service on the same
   * managed CLI. The update restarts every running service daemon of this home onto the new CLI and
   * proves each one — otherwise that relay's daemon keeps running the version the update replaced.
   */
  it('restarts each running pinned service daemon of this home too, and proves each on the new version', async () => {
    const home = mkdtempSync(join(tmpdir(), 'hsetup-cli-update-pinned-'));
    process.env.HAPPIER_HOME_DIR = home;
    onTestFinished(() => rmSync(home, { recursive: true, force: true }));
    updateManagedLocalHappierCliMock.mockImplementation(transactionStandIn('0.2.14'));
    answerCli({
      defaultStatuses: [
        statusJson({ running: true, serviceManaged: true, version: '0.2.13' }),
        statusJson({ running: true, serviceManaged: true, version: '0.2.14' }),
      ],
      pinned: {
        'relay-b': { relayUrl: 'https://relay-b.example.test', statuses: [
          statusJson({ running: true, serviceManaged: true, version: '0.2.13' }),
          statusJson({ running: true, serviceManaged: true, version: '0.2.14' }),
        ] },
        // Installed but stopped: an update does not start a daemon that was not running.
        'relay-c': { relayUrl: 'https://relay-c.example.test', statuses: [statusJson({ running: false, serviceManaged: false })] },
      },
    });

    const { result } = await run({ channel: 'stable' });

    expect(commandLog()).toEqual(expect.arrayContaining([
      'daemon service restart --json@default',
      'daemon service restart --json@relay-b',
    ]));
    expect(commandLog()).not.toContain('daemon service restart --json@relay-c');
    const restartB = runLocalHappierJsonCommandMock.mock.calls
      .map(([call]) => call as CliCall)
      .find((call) => call.args.join(' ') === 'daemon service restart --json' && call.processEnv?.HAPPIER_DAEMON_SERVICE_INSTANCE_ID === 'relay-b');
    expect(restartB?.processEnv).toMatchObject({ HAPPIER_DAEMON_SERVICE_TARGET_MODE: 'pinned', HAPPIER_SERVER_URL: 'https://relay-b.example.test' });
    expect(result).toEqual({ previousVersion: '0.2.13', version: '0.2.14', restarted: true });
  });

  it('fails the proof when a pinned service daemon did not come back on the new version', async () => {
    const home = mkdtempSync(join(tmpdir(), 'hsetup-cli-update-pinned-stale-'));
    process.env.HAPPIER_HOME_DIR = home;
    onTestFinished(() => rmSync(home, { recursive: true, force: true }));
    updateManagedLocalHappierCliMock.mockImplementation(transactionStandIn('0.2.14'));
    answerCli({
      defaultStatuses: [statusJson({ running: false, serviceManaged: false })],
      pinned: { 'relay-b': { relayUrl: 'https://relay-b.example.test', managedBy: 'desktop', statuses: [statusJson({ running: true, serviceManaged: true, version: '0.2.13' })] } },
    });

    await expect(run({ channel: 'stable' })).rejects.toThrow(/runs 0\.2\.13 instead of 0\.2\.14/);
  });

  it('keeps the update when only a pinned service the user installed does not come back, and names it', async () => {
    const home = mkdtempSync(join(tmpdir(), 'hsetup-cli-update-user-owned-'));
    process.env.HAPPIER_HOME_DIR = home;
    onTestFinished(() => rmSync(home, { recursive: true, force: true }));
    updateManagedLocalHappierCliMock.mockImplementation(transactionStandIn('0.2.14'));
    answerCli({
      defaultStatuses: [
        statusJson({ running: true, serviceManaged: true, version: '0.2.13' }),
        statusJson({ running: true, serviceManaged: true, version: '0.2.14' }),
      ],
      // No marker: the user installed this service. It is restarted, but it does not decide the update.
      pinned: { 'relay-b': { relayUrl: 'https://relay-b.example.test', statuses: [statusJson({ running: true, serviceManaged: true, version: '0.2.13' })] } },
    });

    const { result, events } = await run({ channel: 'stable' });

    expect(result).toEqual({ previousVersion: '0.2.13', version: '0.2.14', restarted: true });
    expect(commandLog()).toContain('daemon service restart --json@relay-b');
    expect(events).toContainEqual(expect.objectContaining({
      type: 'progress',
      stepId: 'cli.update.restartServices',
      // The shared wording names that exact pinned service's restart, not `service restart` (the default one).
      message: expect.stringMatching(/\(relay-b\) did not come back on 0\.2\.14 \(the background service runs 0\.2\.13 instead of 0\.2\.14\); the update was kept\. Start it with: \S+ --server relay-b service restart --instance=relay-b$/),
    }));
  });

  it('restarts every relay\'s service daemon even when one does not come back, then names the one that failed', async () => {
    const home = mkdtempSync(join(tmpdir(), 'hsetup-cli-update-attempt-all-'));
    process.env.HAPPIER_HOME_DIR = home;
    onTestFinished(() => rmSync(home, { recursive: true, force: true }));
    updateManagedLocalHappierCliMock.mockImplementation(transactionStandIn('0.2.14'));
    answerCli({
      // The default-following daemon does not come back on the new version…
      defaultStatuses: [statusJson({ running: true, serviceManaged: true, version: '0.2.13' })],
      // …which must not leave relay B's daemon stopped on the old one.
      pinned: { 'relay-b': { relayUrl: 'https://relay-b.example.test', statuses: [
        statusJson({ running: true, serviceManaged: true, version: '0.2.13' }),
        statusJson({ running: true, serviceManaged: true, version: '0.2.14' }),
      ] } },
    });

    await expect(run({ channel: 'stable' })).rejects.toThrow(/runs 0\.2\.13 instead of 0\.2\.14/);
    expect(commandLog()).toContain('daemon service restart --json@relay-b');
  });

  /** M6 — an unreadable pinned service is not "no daemon to restart": the run says so. */
  it('names a relay service it could not read instead of treating it as having no daemon to restart', async () => {
    const home = mkdtempSync(join(tmpdir(), 'hsetup-cli-update-pinned-unreadable-'));
    process.env.HAPPIER_HOME_DIR = home;
    onTestFinished(() => rmSync(home, { recursive: true, force: true }));
    updateManagedLocalHappierCliMock.mockImplementation(transactionStandIn('0.2.14'));
    answerCli({
      defaultStatuses: [statusJson({ running: false, serviceManaged: false })],
      pinned: { 'relay-b': { relayUrl: 'https://relay-b.example.test', statuses: [], unreadable: true } },
    });

    const { events } = await run({ channel: 'stable' });

    expect(JSON.stringify(events)).toContain('https://relay-b.example.test');
  });

  it('rejects an unknown channel without updating anything', async () => {
    await expect(run({ channel: 'nightly' })).rejects.toMatchObject({ code: 'invalid_params' });
    expect(updateManagedLocalHappierCliMock).not.toHaveBeenCalled();
  });
});
