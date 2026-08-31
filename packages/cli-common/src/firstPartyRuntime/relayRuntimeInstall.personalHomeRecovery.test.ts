import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
      const serverBinaryPath = join(payloadRoot, 'happier-server');
      await writeFile(serverBinaryPath, '#!/bin/sh\n', 'utf8');
      const { resolveRelayRuntimeDefaults } = await import('./relayRuntime.js');
      const defaults = resolveRelayRuntimeDefaults({ platform: 'linux', mode: 'user', channel: 'preview', homeDir });
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
        assertPersonalHomeStopped: async () => undefined,
        env: { PORT: '43123', AUTH_ANONYMOUS_SIGNUP_ENABLED: '0' },
        runServiceCommands: true,
        skipHealthCheck: true,
      });

      expect(serviceEvents).toContain('service:stop');
    } finally {
      await rm(homeDir, { recursive: true, force: true });
    }
  }, 20_000);

  it('creates a restore point for default startup auto-migration and disposes it only after state commit', async () => {
    const homeDir = await mkdtemp(join(tmpdir(), 'happier-personal-home-recovery-success-'));
    try {
      const payloadRoot = join(homeDir, 'payload');
      await mkdir(payloadRoot, { recursive: true });
      const serverBinaryPath = join(payloadRoot, 'happier-server');
      await writeFile(serverBinaryPath, '#!/bin/sh\n', 'utf8');
      const events: string[] = [];
      const { resolveRelayRuntimeDefaults } = await import('./relayRuntime.js');
      const defaults = resolveRelayRuntimeDefaults({ platform: 'linux', mode: 'user', channel: 'preview', homeDir });
      const statePath = join(defaults.installRoot, 'self-host-state.json');
      await mkdir(dirname(statePath), { recursive: true });
      await writeFile(statePath, `${JSON.stringify({ version: '0.2.0-installed' })}\n`, 'utf8');
      applyServicePlanMock.mockImplementation(async (plan: { action?: string }) => {
        const action = String(plan.action ?? 'unknown');
        events.push(`service:${action}`);
        if (action === 'install') expect(events).toContain('restore-point:create');
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
        createPersonalHomeRestorePoint: (async (context: { happierVersion: string | null }) => {
          expect(context.happierVersion).toBe('0.2.0-installed');
          events.push('restore-point:create');
          return {
            restore: async () => events.push('restore-point:restore'),
            dispose: async () => {
              const state = JSON.parse(await readFile(statePath, 'utf8')) as { version?: string };
              expect(state.version).toBe('0.3.0-test');
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
    } finally {
      await rm(homeDir, { recursive: true, force: true });
    }
  });

  it('does not replace the payload, migrate, or start when restore-point verification fails', async () => {
    const homeDir = await mkdtemp(join(tmpdir(), 'happier-personal-home-recovery-create-failure-'));
    try {
      const payloadRoot = join(homeDir, 'payload');
      await mkdir(payloadRoot, { recursive: true });
      const serverBinaryPath = join(payloadRoot, 'happier-server');
      await writeFile(serverBinaryPath, '#!/bin/sh\necho new-runtime\n', 'utf8');
      const { resolveRelayRuntimeDefaults } = await import('./relayRuntime.js');
      const defaults = resolveRelayRuntimeDefaults({ platform: 'linux', mode: 'user', channel: 'preview', homeDir });
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

  it('rolls back runtime and Home data when the activated Personal Home identity mismatches the restore point', async () => {
    const homeDir = await mkdtemp(join(tmpdir(), 'happier-personal-home-recovery-identity-mismatch-'));
    try {
      const payloadRoot = join(homeDir, 'payload');
      await mkdir(payloadRoot, { recursive: true });
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

  it('restores Personal Home data before reactivating the previous runtime after candidate failure', async () => {
    const homeDir = await mkdtemp(join(tmpdir(), 'happier-personal-home-recovery-rollback-'));
    try {
      const payloadRoot = join(homeDir, 'payload');
      await mkdir(payloadRoot, { recursive: true });
      const serverBinaryPath = join(payloadRoot, 'happier-server');
      await writeFile(serverBinaryPath, '#!/bin/sh\necho new-runtime\n', 'utf8');
      const { resolveRelayRuntimeDefaults } = await import('./relayRuntime.js');
      const defaults = resolveRelayRuntimeDefaults({ platform: 'linux', mode: 'user', channel: 'preview', homeDir });
      const installedBinaryPath = join(defaults.installRoot, 'bin', 'happier-server');
      const databasePath = join(defaults.dataDir, 'home.sqlite');
      await mkdir(dirname(installedBinaryPath), { recursive: true });
      await mkdir(dirname(databasePath), { recursive: true });
      await writeFile(installedBinaryPath, '#!/bin/sh\necho old-runtime\n', 'utf8');
      await writeFile(databasePath, 'old-home-bytes', 'utf8');
      await writeFile('/tmp/happier-personal-home-recovery.service', '[Service]\n', 'utf8');
      const events: string[] = [];
      let installCount = 0;
      applyServicePlanMock.mockImplementation(async (plan: { action?: string }) => {
        const action = String(plan.action ?? 'unknown');
        events.push(`service:${action}`);
        if (action === 'install') {
          installCount += 1;
          if (installCount === 2) {
            expect(await readFile(databasePath, 'utf8')).toBe('old-home-bytes');
            events.push('previous-service:reactivated');
          }
        }
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
        assertPersonalHomeStopped: async () => undefined,
        env: { PORT: '43123', AUTH_ANONYMOUS_SIGNUP_ENABLED: '0' },
        runServiceCommands: true,
        createPersonalHomeRestorePoint: async () => ({
          backup: { path: join(homeDir, 'restore-point.tar') },
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

      await expect(readFile(installedBinaryPath, 'utf8')).resolves.toContain('old-runtime');
      await expect(readFile(databasePath, 'utf8')).resolves.toBe('old-home-bytes');
      expect(events.indexOf('restore-point:restore')).toBeLessThan(events.indexOf('previous-service:reactivated'));
      expect(events.indexOf('previous-service:reactivated')).toBeLessThan(events.indexOf('restore-point:finalize'));
      expect(events).toContain('restore-point:dispose');
    } finally {
      await rm(homeDir, { recursive: true, force: true });
    }
  });

  it('reports incomplete rollback and retains recovery artifacts when the candidate cannot be stopped', async () => {
    const homeDir = await mkdtemp(join(tmpdir(), 'happier-personal-home-recovery-stop-failure-'));
    try {
      const payloadRoot = join(homeDir, 'payload');
      await mkdir(payloadRoot, { recursive: true });
      const serverBinaryPath = join(payloadRoot, 'happier-server');
      await writeFile(serverBinaryPath, '#!/bin/sh\necho new-runtime\n', 'utf8');
      const { resolveRelayRuntimeDefaults } = await import('./relayRuntime.js');
      const defaults = resolveRelayRuntimeDefaults({ platform: 'linux', mode: 'user', channel: 'preview', homeDir });
      const installedBinaryPath = join(defaults.installRoot, 'bin', 'happier-server');
      await mkdir(dirname(installedBinaryPath), { recursive: true });
      await writeFile(installedBinaryPath, '#!/bin/sh\necho old-runtime\n', 'utf8');
      let stopCount = 0;
      applyServicePlanMock.mockImplementation(async (plan: { action?: string }) => {
        if (plan.action === 'stop' && ++stopCount === 2) throw new Error('candidate stop failed');
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
        assertPersonalHomeStopped: async () => undefined,
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
  });

  it('does not reactivate the previous runtime when Personal Home data restore fails', async () => {
    const homeDir = await mkdtemp(join(tmpdir(), 'happier-personal-home-recovery-data-failure-'));
    try {
      const payloadRoot = join(homeDir, 'payload');
      await mkdir(payloadRoot, { recursive: true });
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
