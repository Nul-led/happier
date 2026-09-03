import { EventEmitter } from 'node:events';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { join } from 'node:path';

import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { createRelayHostEngine } from './relayHostEngine.js';

type ServiceState = 'active' | 'inactive-installed' | 'missing' | 'indeterminate';

const harness = vi.hoisted(() => ({
  backend: 'systemd-user' as 'systemd-user' | 'launchd-user',
  events: [] as string[],
  homeDir: `/tmp/happier-lifecycle-postcondition-${Date.now()}-${Math.random().toString(16).slice(2)}`,
  installRequests: [] as Array<Readonly<{ env?: Record<string, string>; purpose?: unknown }>>,
  beforeInstallPrecondition: null as null | (() => Promise<void>),
  serviceState: 'missing' as ServiceState,
}));

vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>();
  return { ...actual, homedir: () => harness.homeDir };
});

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return {
    ...actual,
    spawnSync: (cmd: string, args?: readonly string[]) => {
      if (cmd === 'launchctl' && args?.[0] === 'list') {
        if (harness.serviceState === 'active') {
          return { status: 0, stdout: '123\t0\thappier-server', stderr: '' };
        }
        if (harness.serviceState === 'missing') {
          return { status: 113, stdout: '', stderr: 'Could not find service "happier-server" in domain for user gui: 501' };
        }
        return { status: 1, stdout: '', stderr: 'Operation not permitted' };
      }
      if (cmd !== 'systemctl' || !args?.includes('show')) {
        return { status: 0, stdout: '', stderr: '' };
      }
      if (harness.serviceState === 'indeterminate') {
        return { status: 1, stdout: '', stderr: 'status unavailable' };
      }
      if (harness.serviceState === 'missing') {
        return { status: 0, stdout: 'UnitFileState=\nActiveState=inactive\nSubState=dead\nLoadState=not-found\n', stderr: '' };
      }
      return {
        status: 0,
        stdout: harness.serviceState === 'active'
          ? 'UnitFileState=enabled\nActiveState=active\nSubState=running\nLoadState=loaded\n'
          : 'UnitFileState=disabled\nActiveState=inactive\nSubState=dead\nLoadState=loaded\n',
        stderr: '',
      };
    },
  };
});

vi.mock('node:net', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:net')>();
  return {
    ...actual,
    createConnection: () => {
      const socket = new EventEmitter() as EventEmitter & {
        destroy(): void;
        setTimeout(timeoutMs: number): void;
      };
      socket.destroy = () => undefined;
      socket.setTimeout = () => undefined;
      process.nextTick(() => socket.emit('error', new Error('connection refused')));
      return socket;
    },
  };
});

vi.mock('../service/index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../service/index.js')>();
  return {
    ...actual,
    resolveServiceBackend: () => harness.backend,
    buildServiceDefinition: () => ({ path: '/tmp/happier-lifecycle-postcondition.service', contents: '[Service]\n' }),
    planServiceAction: (params: { action: string }) => ({ action: params.action, writes: [], commands: [] }),
    applyServicePlan: async (plan: { action: string }) => {
      harness.events.push(`service:${plan.action}`);
    },
  };
});

vi.mock('../firstPartyRuntime/relayRuntimeInstall.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../firstPartyRuntime/relayRuntimeInstall.js')>();
  return {
    ...actual,
    installOrUpdateRelayRuntimeLocal: async (params: Readonly<{
      env?: Record<string, string>;
      purpose?: unknown;
      assertPersonalHomeMutationPrecondition?: () => Promise<void>;
    }>) => {
      await harness.beforeInstallPrecondition?.();
      await params.assertPersonalHomeMutationPrecondition?.();
      harness.installRequests.push(params);
      return { baseUrl: `http://127.0.0.1:${params.env?.PORT ?? '43123'}` };
    },
    uninstallRelayRuntimePayloadLocal: async () => {
      harness.events.push('payload:removed');
    },
  };
});

vi.mock('../firstPartyRuntime/withFirstPartyPayloadMutationLock.js', () => ({
  withFirstPartyPayloadMutationLock: async (params: { operation: () => Promise<unknown> }) => await params.operation(),
}));

function createEngine() {
  return createRelayHostEngine({
    resolveRemoteReleaseTarget: async () => ({ os: 'linux', arch: 'x64' }),
    runRemoteText: async () => ({ status: 0, stdout: '', stderr: '' }),
    copyLocalDirectoryToRemote: async () => {},
    installRemoteComponent: async () => ({ binaryPath: '/tmp/happier-server', versionId: 'stable-1' }),
  });
}

describe('RelayHostEngine lifecycle terminal postconditions', () => {
  const originalPlatform = process.platform;

  beforeEach(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform });
    harness.backend = 'systemd-user';
    harness.events.length = 0;
    harness.installRequests.length = 0;
    harness.beforeInstallPrecondition = null;
    harness.serviceState = 'missing';
  });

  afterAll(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform });
  });

  it.each(['active', 'indeterminate'] as const)(
    'fails stop when the service command succeeds but status remains %s',
    async (serviceState) => {
      harness.serviceState = serviceState;
      await expect(createEngine().control({
        target: { kind: 'local' },
        mode: 'user',
        channel: 'stable',
        action: 'stop',
      })).rejects.toMatchObject({
        code: 'relay_host_lifecycle_postcondition_failed',
        action: 'stop',
      });
      expect(harness.events).toEqual(['service:stop']);
    },
  );

  it.each(['active', 'inactive-installed', 'indeterminate'] as const)(
    'withholds payload cleanup when uninstall command succeeds but status remains %s',
    async (serviceState) => {
      harness.serviceState = serviceState;
      await expect(createEngine().control({
        target: { kind: 'local' },
        mode: 'user',
        channel: 'stable',
        action: 'uninstall',
      })).rejects.toMatchObject({
        code: 'relay_host_lifecycle_postcondition_failed',
        action: 'uninstall',
      });
      expect(harness.events).toEqual(['service:uninstall']);
    },
  );

  it('accepts explicit launchd missing-service evidence before uninstall payload cleanup', async () => {
    Object.defineProperty(process, 'platform', { value: 'darwin' });
    harness.backend = 'launchd-user';
    harness.serviceState = 'missing';

    await createEngine().control({
      target: { kind: 'local' },
      mode: 'user',
      channel: 'stable',
      action: 'uninstall',
    });

    expect(harness.events).toEqual(['service:uninstall', 'payload:removed']);
  });

  it('withholds uninstall payload cleanup when launchd service state is indeterminate', async () => {
    Object.defineProperty(process, 'platform', { value: 'darwin' });
    harness.backend = 'launchd-user';
    harness.serviceState = 'indeterminate';

    await expect(createEngine().control({
      target: { kind: 'local' },
      mode: 'user',
      channel: 'stable',
      action: 'uninstall',
    })).rejects.toMatchObject({
      code: 'relay_host_lifecycle_postcondition_failed',
      action: 'uninstall',
      terminalState: 'indeterminate',
    });
    expect(harness.events).toEqual(['service:uninstall']);
  });

  it('rejects a successful launchd stop command when the service-state probe fails', async () => {
    Object.defineProperty(process, 'platform', { value: 'darwin' });
    harness.backend = 'launchd-user';
    harness.serviceState = 'indeterminate';

    await expect(createEngine().control({
      target: { kind: 'local' },
      mode: 'user',
      channel: 'stable',
      action: 'stop',
    })).rejects.toMatchObject({
      code: 'relay_host_lifecycle_postcondition_failed',
      action: 'stop',
      terminalState: 'indeterminate',
    });
    expect(harness.events).toEqual(['service:stop']);
  });

  it('rejects a caller-fixed fresh Personal Home origin when its loopback port is lost before mutation', async () => {
    const { resolveRelayRuntimeDefaults } = await import('../firstPartyRuntime/relayRuntime.js');
    const defaults = resolveRelayRuntimeDefaults({
      platform: 'linux',
      mode: 'user',
      channel: 'stable',
      homeDir: harness.homeDir,
    });
    const occupyingServer = createServer();
    await rm(harness.homeDir, { recursive: true, force: true });
    try {
      await new Promise<void>((resolve, reject) => {
        occupyingServer.once('error', reject);
        occupyingServer.listen(defaults.serverPort, '127.0.0.1', resolve);
      });
      const requestedPurpose = {
        kind: 'personal-home' as const,
        canonicalServerUrl: `http://127.0.0.1:${defaults.serverPort}`,
      };

      await expect(createEngine().installOrUpdate({
        target: { kind: 'local' },
        mode: 'user',
        channel: 'stable',
        selfHostRelayBinaryOverride: '/tmp/happier-server',
        purpose: requestedPurpose,
        expectedPersonalHomeState: {
          installed: false,
          canonicalServerUrl: null,
          dataPresent: false,
        },
      })).rejects.toMatchObject({
        code: 'personal_home_bootstrap_interrupted',
      });

      expect(harness.installRequests).toHaveLength(0);
    } finally {
      await new Promise<void>((resolve) => occupyingServer.close(() => resolve()));
      await rm(harness.homeDir, { recursive: true, force: true });
    }
  });

  it('replans an occupied fresh Personal Home default origin for a standalone install', async () => {
    const { resolveRelayRuntimeDefaults } = await import('../firstPartyRuntime/relayRuntime.js');
    const defaults = resolveRelayRuntimeDefaults({
      platform: 'linux',
      mode: 'user',
      channel: 'stable',
      homeDir: harness.homeDir,
    });
    const occupyingServer = createServer();
    await rm(harness.homeDir, { recursive: true, force: true });
    try {
      await new Promise<void>((resolve, reject) => {
        occupyingServer.once('error', reject);
        occupyingServer.listen(defaults.serverPort, '127.0.0.1', resolve);
      });
      const requestedPurpose = {
        kind: 'personal-home' as const,
        canonicalServerUrl: `http://127.0.0.1:${defaults.serverPort}`,
      };

      const result = await createEngine().installOrUpdate({
        target: { kind: 'local' },
        mode: 'user',
        channel: 'stable',
        selfHostRelayBinaryOverride: '/tmp/happier-server',
        purpose: requestedPurpose,
      });

      expect(result.relayUrl).not.toBe(requestedPurpose.canonicalServerUrl);
      expect(result.purpose).toEqual({ kind: 'personal-home', canonicalServerUrl: result.relayUrl });
      expect(harness.installRequests).toHaveLength(1);
      expect(harness.installRequests[0]?.env?.PORT).toBe(new URL(result.relayUrl).port);
      expect(harness.installRequests[0]?.purpose).toEqual(result.purpose);
    } finally {
      await new Promise<void>((resolve) => occupyingServer.close(() => resolve()));
      await rm(harness.homeDir, { recursive: true, force: true });
    }
  });

  it('rechecks a caller-fixed fresh Personal Home port immediately before mutation', async () => {
    const { resolveRelayRuntimeDefaults } = await import('../firstPartyRuntime/relayRuntime.js');
    const defaults = resolveRelayRuntimeDefaults({
      platform: 'linux',
      mode: 'user',
      channel: 'stable',
      homeDir: harness.homeDir,
    });
    const occupyingServer = createServer();
    await rm(harness.homeDir, { recursive: true, force: true });
    harness.beforeInstallPrecondition = async () => {
      await new Promise<void>((resolve, reject) => {
        occupyingServer.once('error', reject);
        occupyingServer.listen(defaults.serverPort, '127.0.0.1', resolve);
      });
    };

    try {
      await expect(createEngine().installOrUpdate({
        target: { kind: 'local' },
        mode: 'user',
        channel: 'stable',
        selfHostRelayBinaryOverride: '/tmp/happier-server',
        purpose: {
          kind: 'personal-home',
          canonicalServerUrl: `http://127.0.0.1:${defaults.serverPort}`,
        },
        expectedPersonalHomeState: {
          installed: false,
          canonicalServerUrl: null,
          dataPresent: false,
        },
      })).rejects.toMatchObject({
        code: 'personal_home_bootstrap_interrupted',
      });
      expect(harness.installRequests).toHaveLength(0);
    } finally {
      await new Promise<void>((resolve) => occupyingServer.close(() => resolve()));
      await rm(harness.homeDir, { recursive: true, force: true });
    }
  });

  it('reuses retained custom data, database, and files paths when reinstall omits them', async () => {
    const { resolveRelayRuntimeDefaults } = await import('../firstPartyRuntime/relayRuntime.js');
    const defaults = resolveRelayRuntimeDefaults({
      platform: 'linux',
      mode: 'user',
      channel: 'stable',
      homeDir: harness.homeDir,
    });
    const customDataDir = join(harness.homeDir, 'custom', 'data');
    const customDatabasePath = join(harness.homeDir, 'custom', 'database', 'home.sqlite');
    const customFilesDir = join(harness.homeDir, 'custom', 'files');
    const envPath = join(defaults.configDir, 'server.env');
    const envText = [
      'PORT=43123',
      'HAPPIER_CANONICAL_SERVER_URL=http://127.0.0.1:43123',
      `HAPPIER_SERVER_LIGHT_DATA_DIR=${customDataDir}`,
      `DATABASE_URL=file:${customDatabasePath}`,
      `HAPPIER_SERVER_LIGHT_FILES_DIR=${customFilesDir}`,
      '',
    ].join('\n');
    await mkdir(defaults.configDir, { recursive: true });
    await mkdir(customDataDir, { recursive: true });
    await writeFile(join(defaults.installRoot, 'self-host-state.json'), JSON.stringify({
      purpose: { kind: 'personal-home', canonicalServerUrl: 'http://127.0.0.1:43123' },
    }));
    await writeFile(envPath, envText);

    try {
      const result = await createEngine().installOrUpdate({
        target: { kind: 'local' },
        mode: 'user',
        channel: 'stable',
        selfHostRelayBinaryOverride: '/tmp/happier-server',
      });

      expect(result.layout).toMatchObject({
        dataDir: customDataDir,
        databasePath: customDatabasePath,
        publicFilesDir: customFilesDir,
      });
      expect(harness.installRequests).toHaveLength(1);
      expect(harness.installRequests[0]?.purpose).toEqual({
        kind: 'personal-home',
        canonicalServerUrl: 'http://127.0.0.1:43123',
      });
      await expect(readFile(envPath, 'utf8')).resolves.toBe(envText);
    } finally {
      await rm(harness.homeDir, { recursive: true, force: true });
    }
  });
});
