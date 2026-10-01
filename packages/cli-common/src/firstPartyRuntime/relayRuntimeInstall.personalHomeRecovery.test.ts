import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { writePersonalHomeServerArtifactCapability } from './personalHome/artifactContract.js';

const serviceEvents = vi.hoisted(() => [] as string[]);
const serviceSpecs = vi.hoisted(() => [] as Array<{ env: Record<string, string> }>);
const applyServicePlanMock = vi.hoisted(() => vi.fn(async (plan: { action?: string }) => {
  serviceEvents.push(`service:${String(plan.action ?? 'unknown')}`);
}));
const checkRelayRuntimeHealthMock = vi.hoisted(() => vi.fn(async () => ({
  reachable: true,
  url: 'http://127.0.0.1:43123',
})));

vi.mock('../service/index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../service/index.js')>();
  return {
    ...actual,
    resolveServiceBackend: () => 'systemd-user',
    buildServiceDefinition: (params: { spec?: { env?: Record<string, string> } }) => {
      serviceSpecs.push({ env: { ...(params.spec?.env ?? {}) } });
      return { path: '/tmp/happier-personal-home-recovery.service', contents: '[Service]\n' };
    },
    planServiceAction: (params: { action: string }) => ({ action: params.action, writes: [], commands: [] }),
    applyServicePlan: applyServicePlanMock,
  };
});

vi.mock('./relayRuntime.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./relayRuntime.js')>();
  return { ...actual, checkRelayRuntimeHealth: checkRelayRuntimeHealthMock };
});

async function writeStartupReceiptForLatestSpec(): Promise<void> {
  const activation = [...serviceSpecs].reverse().find((spec) => (
    spec.env.HAPPIER_SERVER_STARTUP_RECEIPT_PATH
    && spec.env.HAPPIER_SERVER_STARTUP_RECEIPT_NONCE
  ));
  if (!activation) return;
  const path = activation.env.HAPPIER_SERVER_STARTUP_RECEIPT_PATH;
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify({
    nonce: activation.env.HAPPIER_SERVER_STARTUP_RECEIPT_NONCE,
    pid: process.pid,
    host: '127.0.0.1',
    port: 43123,
    personalHomeReadiness: {
      authenticated: true,
      homeServerIdentityId: 'home-expected',
      accountCount: 1,
      sessionCount: 0,
    },
  }), 'utf8');
}

describe('installOrUpdateRelayRuntimeLocal Personal Home restore-point lifecycle', () => {
  beforeEach(() => {
    serviceEvents.length = 0;
    serviceSpecs.length = 0;
    applyServicePlanMock.mockImplementation(async (plan: { action?: string }) => {
      serviceEvents.push(`service:${String(plan.action ?? 'unknown')}`);
    });
    checkRelayRuntimeHealthMock.mockImplementation(async () => {
      await writeStartupReceiptForLatestSpec();
      return { reachable: true, url: 'http://127.0.0.1:43123' };
    });
  });

  afterEach(async () => {
    vi.clearAllMocks();
    await rm('/tmp/happier-personal-home-recovery.service', { force: true }).catch(() => undefined);
  });

  it('persists the immutable Personal Home purpose before the first service or payload mutation', async () => {
    const homeDir = await mkdtemp(join(tmpdir(), 'happier-personal-home-early-purpose-'));
    try {
      const payloadRoot = join(homeDir, 'payload');
      await mkdir(payloadRoot, { recursive: true });
      await writePersonalHomeServerArtifactCapability(payloadRoot);
      const serverBinaryPath = join(payloadRoot, 'happier-server');
      await writeFile(serverBinaryPath, '#!/bin/sh\n', 'utf8');
      const { resolveRelayRuntimeDefaults } = await import('./relayRuntime.js');
      const { resolvePersonalHomeRuntimeLayout } = await import('./personalHome/layout.js');
      const defaults = resolveRelayRuntimeDefaults({ platform: 'linux', mode: 'user', channel: 'preview', homeDir });
      const layout = resolvePersonalHomeRuntimeLayout({ platform: 'linux', mode: 'user', channel: 'preview', homeDir });
      const statePath = join(defaults.installRoot, 'self-host-state.json');
      const purpose = { kind: 'personal-home' as const, canonicalServerUrl: 'http://127.0.0.1:43123' };

      applyServicePlanMock.mockImplementation(async (plan: { action?: string }) => {
        const action = String(plan.action ?? 'unknown');
        serviceEvents.push(`service:${action}`);
        if (action === 'stop') {
          const state = JSON.parse(await readFile(statePath, 'utf8')) as { purpose?: unknown };
          expect(state.purpose).toEqual(purpose);
        }
      });

      const { installOrUpdateRelayRuntimeLocal } = await import('./relayRuntimeInstall.js');
      await installOrUpdateRelayRuntimeLocal({
        serverBinaryPath,
        channel: 'preview',
        mode: 'user',
        platform: 'linux',
        homeDir,
        version: '0.3.0-test',
        purpose,
        resolvePersonalHomeUpdateLayout: async () => layout,
        assertPersonalHomeStopped: async () => undefined,
        env: { PORT: '43123', AUTH_ANONYMOUS_SIGNUP_ENABLED: '0' },
        runServiceCommands: true,
        skipHealthCheck: true,
      });

      expect(serviceEvents).toContain('service:stop');
    } finally {
      await rm(homeDir, { recursive: true, force: true });
    }
  }, 30_000);

  it('recovers the prior runtime from the reachable legacy candidate-less durable record', async () => {
    const homeDir = await mkdtemp(join(tmpdir(), 'happier-personal-home-update-resume-'));
    try {
      const payloadRoot = join(homeDir, 'payload');
      await mkdir(payloadRoot, { recursive: true });
      await writePersonalHomeServerArtifactCapability(payloadRoot);
      const serverBinaryPath = join(payloadRoot, 'happier-server');
      await writeFile(serverBinaryPath, '#!/bin/sh\necho retry-runtime\n', 'utf8');
      const { resolveRelayRuntimeDefaults } = await import('./relayRuntime.js');
      const { resolvePersonalHomeRuntimeLayout } = await import('./personalHome/layout.js');
      const { writePersonalHomeUpdateRecoveryRecord } = await import('./personalHome/updateRecovery.js');
      const defaults = resolveRelayRuntimeDefaults({ platform: 'linux', mode: 'user', channel: 'preview', homeDir });
      const layout = resolvePersonalHomeRuntimeLayout({ platform: 'linux', mode: 'user', channel: 'preview', homeDir });
      const installedBinaryPath = join(defaults.installRoot, 'bin', 'happier-server');
      const envPath = join(defaults.configDir, 'server.env');
      const statePath = join(defaults.installRoot, 'self-host-state.json');
      const migrationsDir = join(defaults.dataDir, 'migrations', 'sqlite');
      await mkdir(dirname(installedBinaryPath), { recursive: true });
      await writeFile(installedBinaryPath, '#!/bin/sh\necho interrupted-candidate\n', 'utf8');
      await mkdir(dirname(envPath), { recursive: true });
      await writeFile(envPath, 'PORT=49999\nCANDIDATE_ONLY=1\n', 'utf8');
      await writeFile(statePath, `${JSON.stringify({ version: '0.3.0-interrupted' })}\n`, 'utf8');
      await mkdir(migrationsDir, { recursive: true });
      await writeFile(join(migrationsDir, 'candidate.sql'), '-- candidate migration\n', 'utf8');
      const runtimeBackupName = '.relay-runtime-backup-interrupted';
      const runtimeBackupRoot = join(dirname(defaults.installRoot), runtimeBackupName);
      await mkdir(join(runtimeBackupRoot, 'payload', 'bin'), { recursive: true });
      await writeFile(join(runtimeBackupRoot, 'payload', 'bin', 'happier-server'), '#!/bin/sh\necho original-runtime\n', 'utf8');
      await mkdir(join(runtimeBackupRoot, 'migrations'), { recursive: true });
      await writeFile(join(runtimeBackupRoot, 'migrations', 'original.sql'), '-- original migration\n', 'utf8');
      const restorePointFileName = 'pre-upgrade-interrupted.tar';
      await mkdir(join(layout.backupsDir, 'restore-points'), { recursive: true });
      await writeFile(join(layout.backupsDir, 'restore-points', restorePointFileName), 'verified-restore-point', 'utf8');
      await writePersonalHomeUpdateRecoveryRecord(layout, {
        version: 1,
        phase: 'prepared',
        priorRunning: true,
        previousServiceDefinitionExisted: true,
        runtimeBackup: {
          directoryName: runtimeBackupName,
          hasPayload: true,
          hasRestorableServerBinary: true,
          hasMigrations: true,
          previousEnvText: 'PORT=43123\nAUTH_ANONYMOUS_SIGNUP_ENABLED=0\n',
          previousStateText: JSON.stringify({ version: '0.2.0-original' }),
        },
        restorePoint: {
          fileName: restorePointFileName,
          homeServerIdentityId: 'home-expected',
          schemaVersion: 'schema-v1',
        },
      });
      const { installOrUpdateRelayRuntimeLocal } = await import('./relayRuntimeInstall.js');
      const restore = vi.fn(async () => ({ outcome: 'restored' } as never));
      const finalize = vi.fn(async () => ({ outcome: 'finalized' } as never));
      const dispose = vi.fn(async () => undefined);
      await expect(installOrUpdateRelayRuntimeLocal({
        serverBinaryPath,
        channel: 'preview',
        mode: 'user',
        platform: 'linux',
        homeDir,
        purpose: { kind: 'personal-home', canonicalServerUrl: 'http://127.0.0.1:43123' },
        resolvePersonalHomeUpdateLayout: async () => layout,
        assertPersonalHomeStopped: async () => undefined,
        env: { PORT: '43123', AUTH_ANONYMOUS_SIGNUP_ENABLED: '0' },
        runServiceCommands: true,
        skipHealthCheck: true,
        readPersonalHomeWasRunning: async () => false,
        openPersonalHomeRestorePoint: async () => ({
          backup: { path: join(layout.backupsDir, 'restore-points', restorePointFileName), manifest: {} },
          restore,
          recover: async () => ({ outcome: 'rolled_back', restartedHome: false }),
          finalize,
          dispose,
        } as never),
      } as never)).resolves.toEqual({ baseUrl: 'http://127.0.0.1:43123', version: '0.2.0-original' });
      const { readPersonalHomeUpdateRecoveryRecord } = await import('./personalHome/updateRecovery.js');
      await expect(readPersonalHomeUpdateRecoveryRecord(layout)).resolves.toBeNull();
      await expect(stat(runtimeBackupRoot)).rejects.toMatchObject({ code: 'ENOENT' });
      await expect(readFile(installedBinaryPath, 'utf8')).resolves.toContain('original-runtime');
      expect(restore).toHaveBeenCalledOnce();
      expect(finalize).toHaveBeenCalledOnce();
      expect(dispose).toHaveBeenCalledOnce();
      // The existing service was already stopped before candidate preparation;
      // recovery owns the exact durable candidate even though activation never began.
      expect(serviceEvents).toContain('service:install');
    } finally {
      await rm(homeDir, { recursive: true, force: true });
    }
  }, 20_000);

  it('fails closed on a path-substituted update record before runtime or Home mutation', async () => {
    const homeDir = await mkdtemp(join(tmpdir(), 'happier-personal-home-update-corrupt-'));
    try {
      const payloadRoot = join(homeDir, 'payload');
      await mkdir(payloadRoot, { recursive: true });
      await writePersonalHomeServerArtifactCapability(payloadRoot);
      const serverBinaryPath = join(payloadRoot, 'happier-server');
      await writeFile(serverBinaryPath, '#!/bin/sh\necho retry-runtime\n', 'utf8');
      const { resolveRelayRuntimeDefaults } = await import('./relayRuntime.js');
      const { resolvePersonalHomeRuntimeLayout } = await import('./personalHome/layout.js');
      const { resolvePersonalHomeUpdateRecoveryPath } = await import('./personalHome/updateRecovery.js');
      const defaults = resolveRelayRuntimeDefaults({ platform: 'linux', mode: 'user', channel: 'preview', homeDir });
      const layout = resolvePersonalHomeRuntimeLayout({ platform: 'linux', mode: 'user', channel: 'preview', homeDir });
      const installedBinaryPath = join(defaults.installRoot, 'bin', 'happier-server');
      await mkdir(dirname(installedBinaryPath), { recursive: true });
      await writeFile(installedBinaryPath, '#!/bin/sh\necho untouched-runtime\n', 'utf8');
      const recordPath = resolvePersonalHomeUpdateRecoveryPath(layout);
      await mkdir(dirname(recordPath), { recursive: true });
      await writeFile(recordPath, JSON.stringify({
        version: 1,
        phase: 'prepared',
        priorRunning: true,
        previousServiceDefinitionExisted: true,
        runtimeBackup: {
          directoryName: '../../substituted-runtime',
          hasPayload: true,
          hasRestorableServerBinary: true,
          hasMigrations: false,
          previousEnvText: null,
          previousStateText: null,
        },
        restorePoint: {
          fileName: 'pre-upgrade-corrupt.tar',
          homeServerIdentityId: 'home-expected',
          schemaVersion: 'schema-v1',
        },
      }), 'utf8');
      let restoreOpened = false;

      const { installOrUpdateRelayRuntimeLocal } = await import('./relayRuntimeInstall.js');
      await expect(installOrUpdateRelayRuntimeLocal({
        serverBinaryPath,
        channel: 'preview',
        mode: 'user',
        platform: 'linux',
        homeDir,
        purpose: { kind: 'personal-home', canonicalServerUrl: 'http://127.0.0.1:43123' },
        resolvePersonalHomeUpdateLayout: async () => layout,
        assertPersonalHomeStopped: async () => undefined,
        openPersonalHomeRestorePoint: async () => {
          restoreOpened = true;
          throw new Error('must not open a substituted restore point');
        },
      } as never)).rejects.toThrow('runtime backup name is invalid');

      expect(restoreOpened).toBe(false);
      expect(serviceEvents).toEqual([]);
      await expect(readFile(installedBinaryPath, 'utf8')).resolves.toContain('untouched-runtime');
    } finally {
      await rm(homeDir, { recursive: true, force: true });
    }
  });

  it('ignores a receipt without an immutable candidate and attempts prior-runtime recovery', async () => {
    const homeDir = await mkdtemp(join(tmpdir(), 'happier-personal-home-update-committed-'));
    try {
      const payloadRoot = join(homeDir, 'payload');
      await mkdir(payloadRoot, { recursive: true });
      await writePersonalHomeServerArtifactCapability(payloadRoot);
      const serverBinaryPath = join(payloadRoot, 'happier-server');
      await writeFile(serverBinaryPath, '#!/bin/sh\necho retry-runtime\n', 'utf8');
      const { resolveRelayRuntimeDefaults } = await import('./relayRuntime.js');
      const { resolvePersonalHomeRuntimeLayout } = await import('./personalHome/layout.js');
      const { readPersonalHomeUpdateRecoveryRecord, writePersonalHomeUpdateRecoveryRecord } = await import('./personalHome/updateRecovery.js');
      const defaults = resolveRelayRuntimeDefaults({ platform: 'linux', mode: 'user', channel: 'preview', homeDir });
      const layout = resolvePersonalHomeRuntimeLayout({ platform: 'linux', mode: 'user', channel: 'preview', homeDir });
      const installedBinaryPath = join(defaults.installRoot, 'bin', 'happier-server');
      await mkdir(dirname(installedBinaryPath), { recursive: true });
      await writeFile(installedBinaryPath, '#!/bin/sh\necho verified-candidate\n', 'utf8');
      const runtimeBackupName = '.relay-runtime-backup-committed';
      const runtimeBackupRoot = join(dirname(defaults.installRoot), runtimeBackupName);
      await mkdir(runtimeBackupRoot, { recursive: true });
      const restorePointFileName = 'pre-upgrade-committed.tar';
      const restorePointPath = join(layout.backupsDir, 'restore-points', restorePointFileName);
      await mkdir(dirname(restorePointPath), { recursive: true });
      await writeFile(restorePointPath, 'verified-restore-point', 'utf8');
      await mkdir(defaults.configDir, { recursive: true });
      await writeFile(join(defaults.configDir, 'server.env'), 'PORT=43123\n', 'utf8');
      const startupNonce = 'candidate-startup-nonce';
      await mkdir(layout.dataDir, { recursive: true });
      await writeFile(join(layout.dataDir, 'startup-receipt.json'), JSON.stringify({
        nonce: startupNonce,
        pid: process.pid,
        host: '127.0.0.1',
        port: 43123,
        personalHomeReadiness: {
          authenticated: true,
          homeServerIdentityId: 'home-expected',
          accountCount: 1,
          sessionCount: 0,
        },
      }));
      await writePersonalHomeUpdateRecoveryRecord(layout, {
        version: 1,
        phase: 'prepared',
        expectedStartupNonce: startupNonce,
        activation: null,
        priorRunning: true,
        previousServiceDefinitionExisted: true,
        runtimeBackup: {
          directoryName: runtimeBackupName,
          hasPayload: false,
          hasRestorableServerBinary: false,
          hasMigrations: false,
          previousEnvText: null,
          previousStateText: null,
        },
        restorePoint: {
          fileName: restorePointFileName,
          homeServerIdentityId: 'home-expected',
          schemaVersion: 'schema-v1',
        },
      });
      let restoreOpened = false;

      const { installOrUpdateRelayRuntimeLocal } = await import('./relayRuntimeInstall.js');
      await expect(installOrUpdateRelayRuntimeLocal({
        serverBinaryPath,
        channel: 'preview',
        mode: 'user',
        platform: 'linux',
        homeDir,
        purpose: { kind: 'personal-home', canonicalServerUrl: 'http://127.0.0.1:43123' },
        assertPersonalHomeStopped: async () => undefined,
        resolvePersonalHomeUpdateLayout: async () => layout,
        readPersonalHomeWasRunning: async () => true,
        openPersonalHomeRestorePoint: async () => {
          restoreOpened = true;
          throw new Error('injected prior-runtime restore failure');
        },
        createPersonalHomeRestorePoint: async () => {
          await expect(readFile(installedBinaryPath, 'utf8')).resolves.toContain('verified-candidate');
          throw new Error('retry reached new restore-point creation');
        },
        runServiceCommands: true,
        skipHealthCheck: true,
      } as never)).rejects.toMatchObject({
        code: 'personal_home_update_retry_required',
        recoveryAction: 'retry_prior_runtime',
      });

      expect(restoreOpened).toBe(true);
      await expect(readPersonalHomeUpdateRecoveryRecord(layout)).resolves.toMatchObject({ phase: 'prepared' });
      await expect(stat(runtimeBackupRoot)).resolves.toBeDefined();
      await expect(stat(restorePointPath)).resolves.toBeDefined();
    } finally {
      await rm(homeDir, { recursive: true, force: true });
    }
  }, 20_000);

  it('creates a restore point for default startup auto-migration and disposes it only after state commit', async () => {
    const homeDir = await mkdtemp(join(tmpdir(), 'happier-personal-home-recovery-success-'));
    try {
      const payloadRoot = join(homeDir, 'payload');
      await mkdir(payloadRoot, { recursive: true });
      await writePersonalHomeServerArtifactCapability(payloadRoot);
      const serverBinaryPath = join(payloadRoot, 'happier-server');
      await writeFile(serverBinaryPath, '#!/bin/sh\n', 'utf8');
      const events: string[] = [];
      const { resolveRelayRuntimeDefaults } = await import('./relayRuntime.js');
      const defaults = resolveRelayRuntimeDefaults({ platform: 'linux', mode: 'user', channel: 'preview', homeDir });
      const { resolvePersonalHomeRuntimeLayout } = await import('./personalHome/layout.js');
      const { readPersonalHomeUpdateRecoveryRecord } = await import('./personalHome/updateRecovery.js');
      const layout = resolvePersonalHomeRuntimeLayout({ platform: 'linux', mode: 'user', channel: 'preview', homeDir });
      const statePath = join(defaults.installRoot, 'self-host-state.json');
      await mkdir(dirname(statePath), { recursive: true });
      await writeFile(statePath, `${JSON.stringify({ version: '0.2.0-installed' })}\n`, 'utf8');
      applyServicePlanMock.mockImplementation(async (plan: { action?: string }) => {
        const action = String(plan.action ?? 'unknown');
        events.push(`service:${action}`);
        if (action === 'install') {
          expect(events).toContain('restore-point:create');
          await expect(readPersonalHomeUpdateRecoveryRecord(layout)).resolves.toMatchObject({ phase: 'prepared', priorRunning: true });
        }
      });

      const { installOrUpdateRelayRuntimeLocal } = await import('./relayRuntimeInstall.js');
      await installOrUpdateRelayRuntimeLocal({
        serverBinaryPath,
        channel: 'preview',
        mode: 'user',
        platform: 'linux',
        homeDir,
        version: '0.3.0-test',
        purpose: { kind: 'personal-home', canonicalServerUrl: 'http://127.0.0.1:43123' },
        assertPersonalHomeStopped: async () => undefined,
        env: { PORT: '43123', AUTH_ANONYMOUS_SIGNUP_ENABLED: '0' },
        runServiceCommands: true,
        skipHealthCheck: true,
        resolvePersonalHomeUpdateLayout: async () => layout,
        readPersonalHomeWasRunning: async () => true,
        openPersonalHomeRestorePoint: async () => { throw new Error('completed update must not reopen its restore point'); },
        createPersonalHomeRestorePoint: (async (context: { happierVersion: string | null }) => {
          expect(context.happierVersion).toBe('0.2.0-installed');
          events.push('restore-point:create');
          return {
            backup: {
              path: join(layout.backupsDir, 'restore-points', 'pre-upgrade-success.tar'),
              manifest: { homeServerIdentityId: 'home-expected', schemaVersion: 'schema-v1' },
            },
            restore: async () => events.push('restore-point:restore'),
            finalize: async () => ({ outcome: 'none', removedPaths: [] }),
            dispose: async () => {
              const state = JSON.parse(await readFile(statePath, 'utf8')) as { version?: string };
              expect(state.version).toBe('0.3.0-test');
              await expect(readPersonalHomeUpdateRecoveryRecord(layout)).resolves.toMatchObject({ phase: 'committed' });
              events.push('restore-point:dispose');
            },
          };
        }) as never,
      });

      expect(events).toEqual([
        'service:stop',
        'restore-point:create',
        'service:install',
        'restore-point:dispose',
      ]);
      await expect(readPersonalHomeUpdateRecoveryRecord(layout)).resolves.toBeNull();
    } finally {
      await rm(homeDir, { recursive: true, force: true });
    }
  });

  it('does not replace the payload, migrate, or start when restore-point verification fails', async () => {
    const homeDir = await mkdtemp(join(tmpdir(), 'happier-personal-home-recovery-create-failure-'));
    try {
      const payloadRoot = join(homeDir, 'payload');
      await mkdir(payloadRoot, { recursive: true });
      await writePersonalHomeServerArtifactCapability(payloadRoot);
      const serverBinaryPath = join(payloadRoot, 'happier-server');
      await writeFile(serverBinaryPath, '#!/bin/sh\necho new-runtime\n', 'utf8');
      const { resolveRelayRuntimeDefaults } = await import('./relayRuntime.js');
      const { resolvePersonalHomeRuntimeLayout } = await import('./personalHome/layout.js');
      const defaults = resolveRelayRuntimeDefaults({ platform: 'linux', mode: 'user', channel: 'preview', homeDir });
      const layout = resolvePersonalHomeRuntimeLayout({ platform: 'linux', mode: 'user', channel: 'preview', homeDir });
      const installedBinaryPath = join(defaults.installRoot, 'bin', 'happier-server');
      await mkdir(dirname(installedBinaryPath), { recursive: true });
      await writeFile(installedBinaryPath, '#!/bin/sh\necho old-runtime\n', 'utf8');
      let migrationRan = false;

      const { installOrUpdateRelayRuntimeLocal } = await import('./relayRuntimeInstall.js');
      await expect(installOrUpdateRelayRuntimeLocal({
        serverBinaryPath,
        channel: 'preview',
        mode: 'user',
        platform: 'linux',
        homeDir,
        purpose: { kind: 'personal-home', canonicalServerUrl: 'http://127.0.0.1:43123' },
        resolvePersonalHomeUpdateLayout: async () => layout,
        assertPersonalHomeStopped: async () => undefined,
        env: { PORT: '43123', AUTH_ANONYMOUS_SIGNUP_ENABLED: '0' },
        runServiceCommands: true,
        runMigrationCommand: async () => {
          migrationRan = true;
        },
        createPersonalHomeRestorePoint: async () => {
          throw new Error('restore point verification failed');
        },
      })).rejects.toThrow('restore point verification failed');

      await expect(readFile(installedBinaryPath, 'utf8')).resolves.toContain('old-runtime');
      expect(migrationRan).toBe(false);
      expect(serviceEvents).not.toContain('service:install');
    } finally {
      await rm(homeDir, { recursive: true, force: true });
    }
  });

  it('fails before restore-point creation, payload replacement, or migration when the Home is still running', async () => {
    const homeDir = await mkdtemp(join(tmpdir(), 'happier-personal-home-still-running-'));
    try {
      const payloadRoot = join(homeDir, 'payload');
      await mkdir(payloadRoot, { recursive: true });
      await writePersonalHomeServerArtifactCapability(payloadRoot);
      const serverBinaryPath = join(payloadRoot, 'happier-server');
      await writeFile(serverBinaryPath, '#!/bin/sh\necho new-runtime\n', 'utf8');
      const { resolveRelayRuntimeDefaults } = await import('./relayRuntime.js');
      const defaults = resolveRelayRuntimeDefaults({ platform: 'linux', mode: 'user', channel: 'preview', homeDir });
      const installedBinaryPath = join(defaults.installRoot, 'bin', 'happier-server');
      await mkdir(dirname(installedBinaryPath), { recursive: true });
      await writeFile(installedBinaryPath, '#!/bin/sh\necho old-runtime\n', 'utf8');
      let restorePointCreated = false;
      let migrationRan = false;

      const { installOrUpdateRelayRuntimeLocal } = await import('./relayRuntimeInstall.js');
      await expect(installOrUpdateRelayRuntimeLocal({
        serverBinaryPath,
        channel: 'preview',
        mode: 'user',
        platform: 'linux',
        homeDir,
        purpose: { kind: 'personal-home', canonicalServerUrl: 'http://127.0.0.1:43123' },
        env: { PORT: '43123', AUTH_ANONYMOUS_SIGNUP_ENABLED: '0' },
        runServiceCommands: true,
        assertPersonalHomeStopped: async () => {
          throw new Error('Personal Home is still running after stop');
        },
        createPersonalHomeRestorePoint: async () => {
          restorePointCreated = true;
          return null;
        },
        runMigrationCommand: async () => {
          migrationRan = true;
        },
      })).rejects.toThrow('Personal Home is still running after stop');

      await expect(readFile(installedBinaryPath, 'utf8')).resolves.toContain('old-runtime');
      expect(restorePointCreated).toBe(false);
      expect(migrationRan).toBe(false);
      expect(serviceEvents).not.toContain('service:install');
    } finally {
      await rm(homeDir, { recursive: true, force: true });
    }
  });

  it('durably selects the exact candidate before payload or configuration mutation can fail', async () => {
    const homeDir = await mkdtemp(join(tmpdir(), 'happier-personal-home-candidate-boundary-'));
    try {
      const payloadRoot = join(homeDir, 'payload');
      await mkdir(payloadRoot, { recursive: true });
      await writePersonalHomeServerArtifactCapability(payloadRoot);
      const serverBinaryPath = join(payloadRoot, 'happier-server');
      await writeFile(serverBinaryPath, '#!/bin/sh\necho selected-candidate\n', 'utf8');
      const { resolveRelayRuntimeDefaults } = await import('./relayRuntime.js');
      const { resolvePersonalHomeRuntimeLayout } = await import('./personalHome/layout.js');
      const { readPersonalHomeUpdateRecoveryRecord } = await import('./personalHome/updateRecovery.js');
      const defaults = resolveRelayRuntimeDefaults({ platform: 'linux', mode: 'user', channel: 'preview', homeDir });
      const layout = resolvePersonalHomeRuntimeLayout({ platform: 'linux', mode: 'user', channel: 'preview', homeDir });
      const installedBinaryPath = join(defaults.installRoot, 'bin', 'happier-server');
      await mkdir(dirname(installedBinaryPath), { recursive: true });
      await writeFile(installedBinaryPath, '#!/bin/sh\necho prior-runtime\n', 'utf8');
      await writeFile(join(defaults.installRoot, 'self-host-state.json'), `${JSON.stringify({ version: '0.2.0-prior' })}\n`, 'utf8');
      const restorePointPath = join(layout.backupsDir, 'restore-points', 'pre-upgrade-boundary.tar');
      await mkdir(dirname(restorePointPath), { recursive: true });
      await writeFile(restorePointPath, 'verified-backup', 'utf8');

      const { installOrUpdateRelayRuntimeLocal } = await import('./relayRuntimeInstall.js');
      await expect(installOrUpdateRelayRuntimeLocal({
        serverBinaryPath,
        channel: 'preview',
        mode: 'user',
        platform: 'linux',
        homeDir,
        version: '0.3.0-selected',
        purpose: { kind: 'personal-home', canonicalServerUrl: 'http://127.0.0.1:43123' },
        resolvePersonalHomeUpdateLayout: async () => layout,
        readPersonalHomeWasRunning: async () => false,
        assertPersonalHomeStopped: async () => undefined,
        openPersonalHomeRestorePoint: async () => { throw new Error('not reached'); },
        createPersonalHomeRestorePoint: async () => {
          // Force the later canonical server.env write to fail after the payload mutation.
          await mkdir(join(defaults.configDir, 'server.env'), { recursive: true });
          return {
            backup: { path: restorePointPath, manifest: { homeServerIdentityId: 'home-expected', schemaVersion: 'schema-v1' } },
            restore: async () => ({ outcome: 'restored' }),
            finalize: async () => ({ outcome: 'finalized' }),
            dispose: async () => undefined,
          } as never;
        },
        env: { PORT: '43123', AUTH_ANONYMOUS_SIGNUP_ENABLED: '0' },
        runServiceCommands: true,
        skipHealthCheck: true,
      })).rejects.toBeInstanceOf(Error);

      await expect(readPersonalHomeUpdateRecoveryRecord(layout)).resolves.toMatchObject({
        phase: 'prepared',
        expectedStartupNonce: expect.any(String),
        candidate: {
          envText: expect.stringContaining('PORT=43123'),
          state: { version: '0.3.0-selected' },
        },
      });
      await expect(readFile(installedBinaryPath, 'utf8')).resolves.toContain('selected-candidate');
      expect(serviceEvents).toContain('service:quarantine');
    } finally {
      await rm(homeDir, { recursive: true, force: true });
    }
  }, 20_000);

  it('keeps the prior runtime untouched when interrupted before the durable candidate boundary', async () => {
    const homeDir = await mkdtemp(join(tmpdir(), 'happier-personal-home-pre-candidate-boundary-'));
    try {
      const payloadRoot = join(homeDir, 'payload');
      await mkdir(payloadRoot, { recursive: true });
      await writePersonalHomeServerArtifactCapability(payloadRoot);
      const serverBinaryPath = join(payloadRoot, 'happier-server');
      await writeFile(serverBinaryPath, '#!/bin/sh\necho selected-candidate\n', 'utf8');
      const { resolveRelayRuntimeDefaults } = await import('./relayRuntime.js');
      const { resolvePersonalHomeRuntimeLayout } = await import('./personalHome/layout.js');
      const { readPersonalHomeUpdateRecoveryRecord } = await import('./personalHome/updateRecovery.js');
      const defaults = resolveRelayRuntimeDefaults({ platform: 'linux', mode: 'user', channel: 'preview', homeDir });
      const layout = resolvePersonalHomeRuntimeLayout({ platform: 'linux', mode: 'user', channel: 'preview', homeDir });
      const installedBinaryPath = join(defaults.installRoot, 'bin', 'happier-server');
      const statePath = join(defaults.installRoot, 'self-host-state.json');
      const envPath = join(defaults.configDir, 'server.env');
      const priorState = { version: '0.2.0-prior', purpose: { kind: 'personal-home', canonicalServerUrl: 'http://127.0.0.1:43123' } };
      const priorEnv = 'PORT=43123\nAUTH_ANONYMOUS_SIGNUP_ENABLED=0\n';
      await mkdir(dirname(installedBinaryPath), { recursive: true });
      await mkdir(defaults.configDir, { recursive: true });
      await writeFile(installedBinaryPath, '#!/bin/sh\necho prior-runtime\n', 'utf8');
      await writeFile(statePath, `${JSON.stringify(priorState)}\n`, 'utf8');
      await writeFile(envPath, priorEnv, 'utf8');

      const { installOrUpdateRelayRuntimeLocal } = await import('./relayRuntimeInstall.js');
      await expect(installOrUpdateRelayRuntimeLocal({
        serverBinaryPath,
        channel: 'preview',
        mode: 'user',
        platform: 'linux',
        homeDir,
        version: '0.3.0-selected',
        purpose: { kind: 'personal-home', canonicalServerUrl: 'http://127.0.0.1:43123' },
        resolvePersonalHomeUpdateLayout: async () => layout,
        readPersonalHomeWasRunning: async () => false,
        assertPersonalHomeStopped: async () => undefined,
        openPersonalHomeRestorePoint: async () => { throw new Error('not reached'); },
        createPersonalHomeRestorePoint: async () => {
          // This callback is the last fallible preparation boundary before the exact candidate
          // record can be committed. A hard interruption here must still leave the incumbent
          // payload, configuration, and state bytes untouched.
          expect(await readFile(installedBinaryPath, 'utf8')).toContain('prior-runtime');
          expect(await readFile(envPath, 'utf8')).toBe(priorEnv);
          expect(await readFile(statePath, 'utf8')).toBe(`${JSON.stringify(priorState)}\n`);
          throw new Error('simulated hard interruption before durable candidate selection');
        },
        env: { PORT: '43123', AUTH_ANONYMOUS_SIGNUP_ENABLED: '0' },
        runServiceCommands: false,
        skipHealthCheck: true,
      })).rejects.toThrow('simulated hard interruption before durable candidate selection');

      await expect(readPersonalHomeUpdateRecoveryRecord(layout)).resolves.toBeNull();
      await expect(readFile(installedBinaryPath, 'utf8')).resolves.toContain('prior-runtime');
      await expect(readFile(envPath, 'utf8')).resolves.toBe(priorEnv);
      await expect(readFile(statePath, 'utf8')).resolves.toBe(`${JSON.stringify(priorState)}\n`);
    } finally {
      await rm(homeDir, { recursive: true, force: true });
    }
  }, 20_000);

  it('rolls back runtime and Home data when the activated Personal Home identity mismatches the restore point', async () => {
    const homeDir = await mkdtemp(join(tmpdir(), 'happier-personal-home-recovery-identity-mismatch-'));
    try {
      const payloadRoot = join(homeDir, 'payload');
      await mkdir(payloadRoot, { recursive: true });
      await writePersonalHomeServerArtifactCapability(payloadRoot);
      const serverBinaryPath = join(payloadRoot, 'happier-server');
      await writeFile(serverBinaryPath, '#!/bin/sh\necho new-runtime\n', 'utf8');
      const { resolveRelayRuntimeDefaults } = await import('./relayRuntime.js');
      const defaults = resolveRelayRuntimeDefaults({ platform: 'linux', mode: 'user', channel: 'preview', homeDir });
      const installedBinaryPath = join(defaults.installRoot, 'bin', 'happier-server');
      const statePath = join(defaults.installRoot, 'self-host-state.json');
      await mkdir(dirname(installedBinaryPath), { recursive: true });
      await writeFile(installedBinaryPath, '#!/bin/sh\necho old-runtime\n', 'utf8');
      await writeFile(statePath, `${JSON.stringify({ version: '0.2.0-installed' })}\n`, 'utf8');
      await writeFile('/tmp/happier-personal-home-recovery.service', '[Service]\n', 'utf8');
      const restorePointPath = join(homeDir, 'restore-point.tar');
      await writeFile(restorePointPath, 'verified-backup', 'utf8');
      const events: string[] = [];
      const manifest = { homeServerIdentityId: 'home-expected' };

      const { installOrUpdateRelayRuntimeLocal } = await import('./relayRuntimeInstall.js');
      const error = await installOrUpdateRelayRuntimeLocal({
        serverBinaryPath,
        channel: 'preview',
        mode: 'user',
        platform: 'linux',
        homeDir,
        version: '0.3.0-test',
        purpose: { kind: 'personal-home', canonicalServerUrl: 'http://127.0.0.1:43123' },
        assertPersonalHomeStopped: async () => undefined,
        env: { PORT: '43123', AUTH_ANONYMOUS_SIGNUP_ENABLED: '0' },
        runServiceCommands: true,
        skipHealthCheck: true,
        createPersonalHomeRestorePoint: async () => ({
          backup: { path: restorePointPath, manifest },
          restore: async () => {
            events.push('restore-point:restore');
            return { outcome: 'restored' };
          },
          finalize: async () => {
            events.push('restore-point:finalize');
            return { outcome: 'finalized', removedPaths: [] };
          },
          dispose: async () => {
            events.push('restore-point:dispose');
          },
        }) as never,
        personalHomeRestoreHooks: {
          verifyIdentity: async (candidateManifest) => {
            events.push(`identity:verify:${candidateManifest.homeServerIdentityId}`);
            return false;
          },
        },
      }).then(() => null, (failure: unknown) => failure);

      expect(error).toBeInstanceOf(Error);
      expect(String((error as Error).message)).toContain('identity verification failed');
      expect(events).toEqual([
        'identity:verify:home-expected',
        'restore-point:restore',
        'restore-point:finalize',
        'restore-point:dispose',
      ]);
      await expect(readFile(installedBinaryPath, 'utf8')).resolves.toContain('old-runtime');
      await expect(readFile(statePath, 'utf8')).resolves.toContain('0.2.0-installed');
    } finally {
      await rm(homeDir, { recursive: true, force: true });
    }
  });

  it('quarantines and preserves candidate data when activation health is ambiguous', async () => {
    const homeDir = await mkdtemp(join(tmpdir(), 'happier-personal-home-recovery-rollback-'));
    try {
      const payloadRoot = join(homeDir, 'payload');
      await mkdir(payloadRoot, { recursive: true });
      await writePersonalHomeServerArtifactCapability(payloadRoot);
      const serverBinaryPath = join(payloadRoot, 'happier-server');
      await writeFile(serverBinaryPath, '#!/bin/sh\necho new-runtime\n', 'utf8');
      const { resolveRelayRuntimeDefaults } = await import('./relayRuntime.js');
      const { resolvePersonalHomeRuntimeLayout } = await import('./personalHome/layout.js');
      const defaults = resolveRelayRuntimeDefaults({ platform: 'linux', mode: 'user', channel: 'preview', homeDir });
      const layout = resolvePersonalHomeRuntimeLayout({ platform: 'linux', mode: 'user', channel: 'preview', homeDir });
      const installedBinaryPath = join(defaults.installRoot, 'bin', 'happier-server');
      const databasePath = join(defaults.dataDir, 'home.sqlite');
      await mkdir(dirname(installedBinaryPath), { recursive: true });
      await mkdir(dirname(databasePath), { recursive: true });
      await writeFile(installedBinaryPath, '#!/bin/sh\necho old-runtime\n', 'utf8');
      await writeFile(databasePath, 'old-home-bytes', 'utf8');
      await writeFile('/tmp/happier-personal-home-recovery.service', '[Service]\n', 'utf8');
      const events: string[] = [];
      applyServicePlanMock.mockImplementation(async (plan: { action?: string }) => {
        const action = String(plan.action ?? 'unknown');
        events.push(`service:${action}`);
        if (action === 'install') await writeStartupReceiptForLatestSpec();
      });
      checkRelayRuntimeHealthMock.mockImplementationOnce(async () => {
        await writeFile(databasePath, 'candidate-mutated-home', 'utf8');
        return { reachable: false, url: 'http://127.0.0.1:43123/health' };
      }).mockImplementationOnce(async () => ({
        reachable: true,
        url: 'http://127.0.0.1:43123/health',
      }));

      const { installOrUpdateRelayRuntimeLocal } = await import('./relayRuntimeInstall.js');
      await expect(installOrUpdateRelayRuntimeLocal({
        serverBinaryPath,
        channel: 'preview',
        mode: 'user',
        platform: 'linux',
        homeDir,
        purpose: { kind: 'personal-home', canonicalServerUrl: 'http://127.0.0.1:43123' },
        resolvePersonalHomeUpdateLayout: async () => layout,
        readPersonalHomeWasRunning: async () => true,
        openPersonalHomeRestorePoint: async () => {
          throw new Error('interrupted update should retain its existing restore-point owner');
        },
        assertPersonalHomeStopped: async () => undefined,
        env: { PORT: '43123', AUTH_ANONYMOUS_SIGNUP_ENABLED: '0' },
        runServiceCommands: true,
        createPersonalHomeRestorePoint: async () => ({
          backup: {
            path: join(homeDir, 'pre-upgrade-ambiguous.tar'),
            manifest: { homeServerIdentityId: 'home-expected', schemaVersion: 'schema-v1' },
          },
          restore: async () => {
            events.push('restore-point:restore');
            await writeFile(databasePath, 'old-home-bytes', 'utf8');
            return { outcome: 'restored' };
          },
          finalize: async () => {
            events.push('restore-point:finalize');
            return { outcome: 'finalized', removedPaths: [] };
          },
          dispose: async () => events.push('restore-point:dispose'),
        }) as never,
      })).rejects.toThrow('did not become healthy');

      await expect(readFile(installedBinaryPath, 'utf8')).resolves.toContain('new-runtime');
      await expect(readFile(databasePath, 'utf8')).resolves.toBe('candidate-mutated-home');
      expect(events).toContain('service:quarantine');
      expect(events).not.toContain('restore-point:restore');
      expect(events).not.toContain('restore-point:finalize');
      expect(events).not.toContain('restore-point:dispose');
    } finally {
      await rm(homeDir, { recursive: true, force: true });
    }
  });

  it('restores a previously stopped Personal Home without starting it', async () => {
    const homeDir = await mkdtemp(join(tmpdir(), 'happier-personal-home-recovery-stopped-'));
    try {
      const payloadRoot = join(homeDir, 'payload');
      await mkdir(payloadRoot, { recursive: true });
      await writePersonalHomeServerArtifactCapability(payloadRoot);
      const serverBinaryPath = join(payloadRoot, 'happier-server');
      await writeFile(serverBinaryPath, '#!/bin/sh\necho new-runtime\n', 'utf8');
      const { resolveRelayRuntimeDefaults } = await import('./relayRuntime.js');
      const defaults = resolveRelayRuntimeDefaults({ platform: 'linux', mode: 'user', channel: 'preview', homeDir });
      const installedBinaryPath = join(defaults.installRoot, 'bin', 'happier-server');
      await mkdir(dirname(installedBinaryPath), { recursive: true });
      await writeFile(installedBinaryPath, '#!/bin/sh\necho old-runtime\n', 'utf8');
      await writeFile('/tmp/happier-personal-home-recovery.service', '[Service]\n', 'utf8');
      const serviceApplications: Array<Readonly<{ action: string; runCommands: boolean }>> = [];
      applyServicePlanMock.mockImplementation(async (
        plan: { action?: string },
        options?: { runCommands?: boolean },
      ) => {
        serviceApplications.push({
          action: String(plan.action ?? 'unknown'),
          runCommands: options?.runCommands === true,
        });
      });
      checkRelayRuntimeHealthMock.mockResolvedValue({
        reachable: false,
        url: 'http://127.0.0.1:43123/health',
      });

      const { installOrUpdateRelayRuntimeLocal } = await import('./relayRuntimeInstall.js');
      await expect(installOrUpdateRelayRuntimeLocal({
        serverBinaryPath,
        channel: 'preview',
        mode: 'user',
        platform: 'linux',
        homeDir,
        purpose: { kind: 'personal-home', canonicalServerUrl: 'http://127.0.0.1:43123' },
        assertPersonalHomeStopped: async () => undefined,
        readPersonalHomeWasRunning: async () => false,
        env: { PORT: '43123', AUTH_ANONYMOUS_SIGNUP_ENABLED: '0' },
        runServiceCommands: true,
      })).rejects.toThrow('startup attestation did not arrive');

      expect(serviceApplications).toEqual(expect.arrayContaining([
        { action: 'install', runCommands: false },
      ]));
      expect(serviceApplications.filter(({ action, runCommands }) => action === 'install' && runCommands)).toHaveLength(1);
      await expect(readFile(installedBinaryPath, 'utf8')).resolves.toContain('old-runtime');
    } finally {
      await rm(homeDir, { recursive: true, force: true });
    }
  }, 30_000);

  it('reports incomplete rollback when the stop command succeeds but terminal state is not proven', async () => {
    const homeDir = await mkdtemp(join(tmpdir(), 'happier-personal-home-recovery-stop-failure-'));
    try {
      const payloadRoot = join(homeDir, 'payload');
      await mkdir(payloadRoot, { recursive: true });
      await writePersonalHomeServerArtifactCapability(payloadRoot);
      const serverBinaryPath = join(payloadRoot, 'happier-server');
      await writeFile(serverBinaryPath, '#!/bin/sh\necho new-runtime\n', 'utf8');
      const { resolveRelayRuntimeDefaults } = await import('./relayRuntime.js');
      const defaults = resolveRelayRuntimeDefaults({ platform: 'linux', mode: 'user', channel: 'preview', homeDir });
      const installedBinaryPath = join(defaults.installRoot, 'bin', 'happier-server');
      await mkdir(dirname(installedBinaryPath), { recursive: true });
      await writeFile(installedBinaryPath, '#!/bin/sh\necho old-runtime\n', 'utf8');
      applyServicePlanMock.mockImplementation(async (plan: { action?: string }) => {
        serviceEvents.push(`service:${String(plan.action ?? 'unknown')}`);
      });
      checkRelayRuntimeHealthMock.mockResolvedValue({ reachable: false, url: 'http://127.0.0.1:43123/health' });
      const restorePointPath = join(homeDir, 'restore-point.tar');
      await writeFile(restorePointPath, 'verified-backup', 'utf8');
      let disposed = false;

      const { installOrUpdateRelayRuntimeLocal } = await import('./relayRuntimeInstall.js');
      const error = await installOrUpdateRelayRuntimeLocal({
        serverBinaryPath,
        channel: 'preview',
        mode: 'user',
        platform: 'linux',
        homeDir,
        purpose: { kind: 'personal-home', canonicalServerUrl: 'http://127.0.0.1:43123' },
        assertPersonalHomeStopped: vi.fn(async () => {
          const stopAssertions = serviceEvents.filter((event) => event === 'stopped:asserted').length;
          serviceEvents.push('stopped:asserted');
          if (stopAssertions === 1) throw new Error('candidate remained active');
        }),
        env: { PORT: '43123', AUTH_ANONYMOUS_SIGNUP_ENABLED: '0' },
        runServiceCommands: true,
        createPersonalHomeRestorePoint: async () => ({
          backup: { path: restorePointPath },
          restore: async () => ({ outcome: 'restored' }),
          dispose: async () => { disposed = true; },
        }) as never,
      }).then(() => null, (failure: unknown) => failure);

      expect(error).toMatchObject({
        code: 'RELAY_RUNTIME_INSTALL_ROLLBACK_INCOMPLETE',
        recoveryArtifacts: { personalHomeRestorePointPath: restorePointPath },
      });
      const runtimeBackupRoot = (error as { recoveryArtifacts?: { runtimeBackupRoot?: string } }).recoveryArtifacts?.runtimeBackupRoot;
      expect(runtimeBackupRoot).toBeTruthy();
      await expect(stat(String(runtimeBackupRoot))).resolves.toMatchObject({});
      await expect(readFile(restorePointPath, 'utf8')).resolves.toBe('verified-backup');
      expect(disposed).toBe(false);
    } finally {
      await rm(homeDir, { recursive: true, force: true });
    }
  }, 30_000);

  it('does not reactivate the previous runtime when Personal Home data restore fails', async () => {
    const homeDir = await mkdtemp(join(tmpdir(), 'happier-personal-home-recovery-data-failure-'));
    try {
      const payloadRoot = join(homeDir, 'payload');
      await mkdir(payloadRoot, { recursive: true });
      await writePersonalHomeServerArtifactCapability(payloadRoot);
      const serverBinaryPath = join(payloadRoot, 'happier-server');
      await writeFile(serverBinaryPath, '#!/bin/sh\necho new-runtime\n', 'utf8');
      const { resolveRelayRuntimeDefaults } = await import('./relayRuntime.js');
      const defaults = resolveRelayRuntimeDefaults({ platform: 'linux', mode: 'user', channel: 'preview', homeDir });
      const installedBinaryPath = join(defaults.installRoot, 'bin', 'happier-server');
      await mkdir(dirname(installedBinaryPath), { recursive: true });
      await writeFile(installedBinaryPath, '#!/bin/sh\necho old-runtime\n', 'utf8');
      await writeFile('/tmp/happier-personal-home-recovery.service', '[Service]\n', 'utf8');
      let installCount = 0;
      applyServicePlanMock.mockImplementation(async (plan: { action?: string }) => {
        if (plan.action === 'install') installCount += 1;
      });
      checkRelayRuntimeHealthMock.mockResolvedValue({ reachable: false, url: 'http://127.0.0.1:43123/health' });
      const restorePointPath = join(homeDir, 'restore-point.tar');
      await writeFile(restorePointPath, 'verified-backup', 'utf8');

      const { installOrUpdateRelayRuntimeLocal } = await import('./relayRuntimeInstall.js');
      const error = await installOrUpdateRelayRuntimeLocal({
        serverBinaryPath,
        channel: 'preview',
        mode: 'user',
        platform: 'linux',
        homeDir,
        purpose: { kind: 'personal-home', canonicalServerUrl: 'http://127.0.0.1:43123' },
        assertPersonalHomeStopped: async () => undefined,
        env: { PORT: '43123', AUTH_ANONYMOUS_SIGNUP_ENABLED: '0' },
        runServiceCommands: true,
        createPersonalHomeRestorePoint: async () => ({
          backup: { path: restorePointPath },
          restore: async () => { throw new Error('data restore failed'); },
          dispose: async () => undefined,
        }) as never,
      }).then(() => null, (failure: unknown) => failure);

      expect(error).toMatchObject({ code: 'RELAY_RUNTIME_INSTALL_ROLLBACK_INCOMPLETE' });
      expect(installCount).toBe(1);
      await expect(readFile(restorePointPath, 'utf8')).resolves.toBe('verified-backup');
    } finally {
      await rm(homeDir, { recursive: true, force: true });
    }
  });
});
