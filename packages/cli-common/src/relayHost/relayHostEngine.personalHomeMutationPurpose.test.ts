import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { resolveRelayRuntimeDefaults } from '../firstPartyRuntime/relayRuntime.js';

const CANONICAL_SERVER_URL = 'http://127.0.0.1:43123';
const PERSONAL_HOME_PURPOSE = { kind: 'personal-home', canonicalServerUrl: CANONICAL_SERVER_URL } as const;

describe('RelayHostEngine (Personal Home mutation seam)', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.resetModules();
    vi.clearAllMocks();
  });

  async function createInstalledPersonalHomeRuntime(): Promise<Readonly<{
    homeDir: string;
    defaults: ReturnType<typeof resolveRelayRuntimeDefaults>;
    dispose: () => Promise<void>;
  }>> {
    const homeDir = await mkdtemp(join(tmpdir(), 'personal-home-mutation-'));
    const defaults = resolveRelayRuntimeDefaults({ platform: 'linux', mode: 'user', channel: 'preview', homeDir });
    await mkdir(defaults.installRoot, { recursive: true });
    await mkdir(defaults.configDir, { recursive: true });
    await writeFile(join(defaults.installRoot, 'self-host-state.json'), JSON.stringify({
      version: '0.3.0-test',
      purpose: PERSONAL_HOME_PURPOSE,
    }), 'utf8');
    await writeFile(join(defaults.configDir, 'server.env'), [
      'PORT=43123',
      'HAPPIER_SERVER_HOST=127.0.0.1',
      `HAPPIER_PUBLIC_SERVER_URL=${CANONICAL_SERVER_URL}`,
      'AUTH_ANONYMOUS_SIGNUP_ENABLED=0',
      'HAPPIER_HOME_DEVICE_APPROVAL_REQUIRED=1',
    ].join('\n') + '\n', 'utf8');
    return {
      homeDir,
      defaults,
      dispose: async () => {
        await rm(homeDir, { recursive: true, force: true });
      },
    };
  }

  async function writeLocalServerBinary(homeDir: string): Promise<string> {
    const payloadRoot = join(homeDir, 'payload');
    await mkdir(payloadRoot, { recursive: true });
    const serverBinaryPath = join(payloadRoot, 'happier-server');
    await writeFile(serverBinaryPath, '#!/bin/sh\n', 'utf8');
    return serverBinaryPath;
  }

  async function writeRelocationMarker(params: Readonly<{
    dataDir: string;
    phase: 'staged' | 'verified' | 'pending' | 'committed';
    localRole: 'source' | 'destination';
  }>): Promise<void> {
    const sourceDataDir = params.localRole === 'source' ? params.dataDir : join(dirname(params.dataDir), 'relocation-source');
    const destinationDataDir = params.localRole === 'destination' ? params.dataDir : join(dirname(params.dataDir), 'relocation-destination');
    await mkdir(join(params.dataDir, '.operations'), { recursive: true });
    await writeFile(join(params.dataDir, '.operations', 'relocation.json'), `${JSON.stringify({
      version: 1,
      phase: params.phase,
      sourceDataDir,
      destinationDataDir,
      homeServerIdentityId: 'home-identity',
      bundleSha256: 'a'.repeat(64),
      priorSourceRunning: true,
    })}\n`, { mode: 0o600 });
  }

  function mockLinuxHost(homeDir: string): void {
    Object.defineProperty(process, 'platform', { value: 'linux' });
    vi.doMock('node:os', async () => {
      const actual = await vi.importActual<typeof import('node:os')>('node:os');
      return { ...actual, homedir: () => homeDir };
    });
    vi.doMock('node:child_process', async () => {
      const actual = await vi.importActual<typeof import('node:child_process')>('node:child_process');
      return {
        ...actual,
        spawnSync: () => ({ status: 0, stdout: 'LoadState=not-found\n', stderr: '' }),
      };
    });
    vi.doMock('../service/index.js', async () => {
      const actual = await vi.importActual<typeof import('../service/index.js')>('../service/index.js');
      return {
        ...actual,
        resolveServiceBackend: () => 'systemd-user',
      };
    });
  }

  function mockHealthyLocalHome(): void {
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ ok: true }),
    })) as unknown as typeof fetch;
    vi.doMock('node:net', async () => {
      const actual = await vi.importActual<typeof import('node:net')>('node:net');
      const { EventEmitter } = await vi.importActual<typeof import('node:events')>('node:events');
      return {
        ...actual,
        createConnection: () => {
          const socket = new EventEmitter() as import('node:events').EventEmitter & {
            setTimeout: (timeoutMs: number) => void;
            destroy: () => void;
          };
          socket.setTimeout = () => undefined;
          socket.destroy = () => undefined;
          process.nextTick(() => socket.emit('connect'));
          return socket;
        },
      };
    });
  }

  function mockStoppedLocalHome(): void {
    vi.doMock('node:net', async () => {
      const actual = await vi.importActual<typeof import('node:net')>('node:net');
      const { EventEmitter } = await vi.importActual<typeof import('node:events')>('node:events');
      return {
        ...actual,
        createConnection: () => {
          const socket = new EventEmitter() as import('node:events').EventEmitter & {
            setTimeout: (timeoutMs: number) => void;
            destroy: () => void;
          };
          socket.setTimeout = () => undefined;
          socket.destroy = () => undefined;
          process.nextTick(() => socket.emit('error', new Error('connection refused')));
          return socket;
        },
      };
    });
  }

  function mockRecordingHomeLock(lockEvents: string[]): void {
    vi.doMock('../firstPartyRuntime/personalHome/lock.js', async () => {
      const actual = await vi.importActual<typeof import('../firstPartyRuntime/personalHome/lock.js')>(
        '../firstPartyRuntime/personalHome/lock.js',
      );
      return {
        ...actual,
        withPersonalHomeOperationLock: async (dataDir: string, operation: string, run: () => Promise<unknown>) => {
          lockEvents.push(`home:${operation}:acquired`);
          try {
            return await run();
          } finally {
            lockEvents.push(`home:${operation}:released`);
          }
        },
      };
    });
  }

  async function createTestEngine() {
    const { createRelayHostEngine } = await import('./relayHostEngine.js');
    return createRelayHostEngine({
      resolveRemoteReleaseTarget: async () => ({ os: 'linux', arch: 'x64' }),
      runRemoteText: async () => ({ status: 0, stdout: '', stderr: '' }),
      copyLocalDirectoryToRemote: async () => {},
      installRemoteComponent: async () => ({ binaryPath: '/tmp/happier-server', versionId: 'preview-1' }),
    });
  }

  it('restart with an omitted purpose inherits the persisted Personal Home purpose and takes the Home operation lock', async () => {
    const runtime = await createInstalledPersonalHomeRuntime();
    const lockEvents: string[] = [];
    try {
      mockLinuxHost(runtime.homeDir);
      mockHealthyLocalHome();
      mockRecordingHomeLock(lockEvents);

      const engine = await createTestEngine();
      await engine.control({
        target: { kind: 'local' },
        mode: 'user',
        channel: 'preview',
        action: 'restart',
      });

      expect(lockEvents).toEqual(['home:lifecycle:acquired', 'home:lifecycle:released']);
      const envText = await readFile(join(runtime.defaults.configDir, 'server.env'), 'utf8');
      expect(envText).toContain('AUTH_ANONYMOUS_SIGNUP_ENABLED=0');
      const stateText = await readFile(join(runtime.defaults.installRoot, 'self-host-state.json'), 'utf8');
      expect(JSON.parse(stateText).purpose).toEqual(PERSONAL_HOME_PURPOSE);
    } finally {
      await runtime.dispose();
    }
  });

  it('does not deadlock lifecycle control inside an operation that already holds the Home lock in this process', async () => {
    const runtime = await createInstalledPersonalHomeRuntime();
    try {
      mockLinuxHost(runtime.homeDir);
      mockHealthyLocalHome();

      const engine = await createTestEngine();
      const { withPersonalHomeOperationLock } = await import('../firstPartyRuntime/personalHome/lock.js');
      await withPersonalHomeOperationLock(runtime.defaults.dataDir, 'backup', async () => {
        await engine.control({
          target: { kind: 'local' },
          mode: 'user',
          channel: 'preview',
          action: 'restart',
        });
      });
    } finally {
      await runtime.dispose();
    }
  });

  it('blocks ordinary Personal Home restart after a pending relocation interruption before any service command', async () => {
    const runtime = await createInstalledPersonalHomeRuntime();
    const serviceCommands: string[] = [];
    try {
      await writeRelocationMarker({ dataDir: runtime.defaults.dataDir, phase: 'pending', localRole: 'source' });
      Object.defineProperty(process, 'platform', { value: 'linux' });
      vi.doMock('node:os', async () => {
        const actual = await vi.importActual<typeof import('node:os')>('node:os');
        return { ...actual, homedir: () => runtime.homeDir };
      });
      vi.doMock('node:child_process', async () => {
        const actual = await vi.importActual<typeof import('node:child_process')>('node:child_process');
        return {
          ...actual,
          spawnSync: (cmd: string, args: readonly string[] = []) => {
            if (cmd === 'systemctl' && args.includes('restart')) serviceCommands.push(`${cmd} ${args.join(' ')}`);
            return { status: 0, stdout: 'LoadState=not-found\n', stderr: '' };
          },
        };
      });
      vi.doMock('../service/index.js', async () => {
        const actual = await vi.importActual<typeof import('../service/index.js')>('../service/index.js');
        return { ...actual, resolveServiceBackend: () => 'systemd-user' };
      });
      mockHealthyLocalHome();

      const engine = await createTestEngine();
      await expect(engine.control({
        target: { kind: 'local' },
        mode: 'user',
        channel: 'preview',
        action: 'restart',
      })).rejects.toMatchObject({ code: 'PERSONAL_HOME_RELOCATION_ACTIVATION_BLOCKED' });
      expect(serviceCommands).toEqual([]);
    } finally {
      await runtime.dispose();
    }
  });

  it('blocks Personal Home install activation when a committed marker identifies the local data as retained source', async () => {
    const runtime = await createInstalledPersonalHomeRuntime();
    try {
      await writeRelocationMarker({ dataDir: runtime.defaults.dataDir, phase: 'committed', localRole: 'source' });
      mockLinuxHost(runtime.homeDir);
      mockStoppedLocalHome();
      const serverBinaryPath = await writeLocalServerBinary(runtime.homeDir);

      const { createRelayHostEngine } = await import('./relayHostEngine.js');
      const engine = createRelayHostEngine({
        resolveRemoteReleaseTarget: async () => ({ os: 'linux', arch: 'x64' }),
        runRemoteText: async () => ({ status: 0, stdout: '', stderr: '' }),
        copyLocalDirectoryToRemote: async () => {},
        installRemoteComponent: async () => ({ binaryPath: serverBinaryPath, versionId: 'preview-2' }),
        localInstallPolicy: { runServiceCommands: false, skipHealthCheck: true },
      });

      await expect(engine.installOrUpdate({
        target: { kind: 'local' },
        mode: 'user',
        channel: 'preview',
        selfHostRelayBinaryOverride: serverBinaryPath,
      })).rejects.toMatchObject({ code: 'PERSONAL_HOME_RELOCATION_ACTIVATION_BLOCKED' });
    } finally {
      await runtime.dispose();
    }
  });

  it('a managed update with an omitted purpose preserves the persisted classification, closed signup, and approval policy', async () => {
    const runtime = await createInstalledPersonalHomeRuntime();
    const lockEvents: string[] = [];
    try {
      mockLinuxHost(runtime.homeDir);
      mockRecordingHomeLock(lockEvents);
      const serverBinaryPath = await writeLocalServerBinary(runtime.homeDir);

      const { createRelayHostEngine } = await import('./relayHostEngine.js');
      const engine = createRelayHostEngine({
        resolveRemoteReleaseTarget: async () => ({ os: 'linux', arch: 'x64' }),
        runRemoteText: async () => ({ status: 0, stdout: '', stderr: '' }),
        copyLocalDirectoryToRemote: async () => {},
        installRemoteComponent: async () => ({ binaryPath: serverBinaryPath, versionId: 'preview-2' }),
        localInstallPolicy: { runServiceCommands: false, skipHealthCheck: true },
      });

      await engine.installOrUpdate({
        target: { kind: 'local' },
        mode: 'user',
        channel: 'preview',
        selfHostRelayBinaryOverride: serverBinaryPath,
      });

      const stateText = await readFile(join(runtime.defaults.installRoot, 'self-host-state.json'), 'utf8');
      expect(JSON.parse(stateText).purpose).toEqual(PERSONAL_HOME_PURPOSE);

      const envText = await readFile(join(runtime.defaults.configDir, 'server.env'), 'utf8');
      expect(envText.match(/^AUTH_ANONYMOUS_SIGNUP_ENABLED=0$/gmu)).toHaveLength(1);
      expect(envText).not.toContain('AUTH_ANONYMOUS_SIGNUP_ENABLED=1');
      expect(envText).toContain('HAPPIER_HOME_DEVICE_APPROVAL_REQUIRED=1');
      expect(envText).toContain('HAPPIER_FEATURE_ENCRYPTION__STORAGE_POLICY=plaintext_only');
      expect(envText).toContain('HAPPIER_FEATURE_ENCRYPTION__DEFAULT_ACCOUNT_MODE=plain');

      expect(lockEvents).toContain('home:upgrade:acquired');

      const status = await engine.readStatus({
        target: { kind: 'local' },
        mode: 'user',
        channel: 'preview',
      });
      expect(status.purpose).toEqual(PERSONAL_HOME_PURPOSE);
      expect(status.canonicalServerUrl).toBe(CANONICAL_SERVER_URL);
      expect(status.anonymousSignupEnabled).toBe(false);
    } finally {
      await runtime.dispose();
    }
  });

  it('safe uninstall preserves the Personal Home classification for an omitted-purpose reinstall', async () => {
    const runtime = await createInstalledPersonalHomeRuntime();
    const lockEvents: string[] = [];
    try {
      mockLinuxHost(runtime.homeDir);
      mockStoppedLocalHome();
      mockRecordingHomeLock(lockEvents);
      const serverBinaryPath = await writeLocalServerBinary(runtime.homeDir);
      await mkdir(runtime.defaults.dataDir, { recursive: true });
      await writeFile(join(runtime.defaults.dataDir, 'handy-master-secret.txt'), 'preserved-home-secret');

      const { createRelayHostEngine } = await import('./relayHostEngine.js');
      const engine = createRelayHostEngine({
        resolveRemoteReleaseTarget: async () => ({ os: 'linux', arch: 'x64' }),
        runRemoteText: async () => ({ status: 0, stdout: '', stderr: '' }),
        copyLocalDirectoryToRemote: async () => {},
        installRemoteComponent: async () => ({ binaryPath: serverBinaryPath, versionId: 'preview-2' }),
        localInstallPolicy: { runServiceCommands: false, skipHealthCheck: true },
      });

      await engine.control({
        target: { kind: 'local' },
        mode: 'user',
        channel: 'preview',
        action: 'uninstall',
      });

      const statePath = join(runtime.defaults.installRoot, 'self-host-state.json');
      const uninstalledState = JSON.parse(await readFile(statePath, 'utf8'));
      expect(uninstalledState).toEqual({ purpose: PERSONAL_HOME_PURPOSE });
      expect(await readFile(join(runtime.defaults.dataDir, 'handy-master-secret.txt'), 'utf8')).toBe('preserved-home-secret');

      const uninstalledStatus = await engine.readStatus({
        target: { kind: 'local' },
        mode: 'user',
        channel: 'preview',
      });
      expect(uninstalledStatus).toMatchObject({
        installed: false,
        purpose: PERSONAL_HOME_PURPOSE,
        dataPresent: true,
      });

      await expect(engine.installOrUpdate({
        target: { kind: 'local' },
        mode: 'user',
        channel: 'preview',
        selfHostRelayBinaryOverride: serverBinaryPath,
      })).resolves.toMatchObject({ purpose: PERSONAL_HOME_PURPOSE });

      const reinstalledState = JSON.parse(await readFile(statePath, 'utf8'));
      expect(reinstalledState.purpose).toEqual(PERSONAL_HOME_PURPOSE);
      expect(lockEvents).toEqual([
        'home:uninstall:acquired',
        'home:uninstall:released',
        'home:upgrade:acquired',
        'home:upgrade:released',
      ]);
    } finally {
      await runtime.dispose();
    }
  });

  it('generic runtime uninstall does not retain a caller-requested Personal Home classification', async () => {
    const runtime = await createInstalledPersonalHomeRuntime();
    try {
      mockLinuxHost(runtime.homeDir);
      await writeFile(join(runtime.defaults.installRoot, 'self-host-state.json'), JSON.stringify({
        version: '0.3.0-test',
        purpose: { kind: 'generic' },
      }), 'utf8');

      const engine = await createTestEngine();
      await engine.control({
        target: { kind: 'local' },
        mode: 'user',
        channel: 'preview',
        purpose: PERSONAL_HOME_PURPOSE,
        action: 'uninstall',
      });

      expect(existsSync(join(runtime.defaults.installRoot, 'self-host-state.json'))).toBe(false);
    } finally {
      await runtime.dispose();
    }
  });

  it('fails closed before update when Home data exists but persisted purpose is missing', async () => {
    const runtime = await createInstalledPersonalHomeRuntime();
    const lockEvents: string[] = [];
    try {
      mockLinuxHost(runtime.homeDir);
      mockRecordingHomeLock(lockEvents);
      const serverBinaryPath = await writeLocalServerBinary(runtime.homeDir);
      await rm(join(runtime.defaults.installRoot, 'self-host-state.json'), { force: true });
      await mkdir(runtime.defaults.dataDir, { recursive: true });
      await writeFile(join(runtime.defaults.dataDir, 'handy-master-secret.txt'), 'preserved-home-secret');

      const { createRelayHostEngine } = await import('./relayHostEngine.js');
      const engine = createRelayHostEngine({
        resolveRemoteReleaseTarget: async () => ({ os: 'linux', arch: 'x64' }),
        runRemoteText: async () => ({ status: 0, stdout: '', stderr: '' }),
        copyLocalDirectoryToRemote: async () => {},
        installRemoteComponent: async () => ({ binaryPath: serverBinaryPath, versionId: 'preview-2' }),
        localInstallPolicy: { runServiceCommands: false, skipHealthCheck: true },
      });

      await expect(engine.installOrUpdate({
        target: { kind: 'local' },
        mode: 'user',
        channel: 'preview',
        selfHostRelayBinaryOverride: serverBinaryPath,
      })).rejects.toMatchObject({ code: 'PERSONAL_HOME_CLASSIFICATION_REQUIRED' });

      expect(lockEvents).toEqual([]);
      expect(existsSync(join(runtime.defaults.installRoot, 'self-host-state.json'))).toBe(false);
    } finally {
      await runtime.dispose();
    }
  });

  it('reinstalls preserved Home data when an explicit purpose matches the preserved configuration', async () => {
    const runtime = await createInstalledPersonalHomeRuntime();
    const lockEvents: string[] = [];
    try {
      mockLinuxHost(runtime.homeDir);
      mockRecordingHomeLock(lockEvents);
      const serverBinaryPath = await writeLocalServerBinary(runtime.homeDir);
      await rm(join(runtime.defaults.installRoot, 'self-host-state.json'), { force: true });
      await mkdir(runtime.defaults.dataDir, { recursive: true });
      await writeFile(join(runtime.defaults.dataDir, 'handy-master-secret.txt'), 'preserved-home-secret');

      const { createRelayHostEngine } = await import('./relayHostEngine.js');
      const engine = createRelayHostEngine({
        resolveRemoteReleaseTarget: async () => ({ os: 'linux', arch: 'x64' }),
        runRemoteText: async () => ({ status: 0, stdout: '', stderr: '' }),
        copyLocalDirectoryToRemote: async () => {},
        installRemoteComponent: async () => ({ binaryPath: serverBinaryPath, versionId: 'preview-2' }),
        localInstallPolicy: { runServiceCommands: false, skipHealthCheck: true },
      });

      await expect(engine.installOrUpdate({
        target: { kind: 'local' },
        mode: 'user',
        channel: 'preview',
        selfHostRelayBinaryOverride: serverBinaryPath,
        purpose: PERSONAL_HOME_PURPOSE,
      })).resolves.toMatchObject({ purpose: PERSONAL_HOME_PURPOSE });

      expect(lockEvents).toContain('home:upgrade:acquired');
      const state = JSON.parse(await readFile(join(runtime.defaults.installRoot, 'self-host-state.json'), 'utf8'));
      expect(state.purpose).toEqual(PERSONAL_HOME_PURPOSE);
    } finally {
      await runtime.dispose();
    }
  });

  it('rejects an explicit Personal Home purpose that re-points the persisted canonical origin without mutating the runtime', async () => {
    const runtime = await createInstalledPersonalHomeRuntime();
    const lockEvents: string[] = [];
    try {
      mockLinuxHost(runtime.homeDir);
      mockRecordingHomeLock(lockEvents);
      const serverBinaryPath = await writeLocalServerBinary(runtime.homeDir);

      const { createRelayHostEngine } = await import('./relayHostEngine.js');
      const engine = createRelayHostEngine({
        resolveRemoteReleaseTarget: async () => ({ os: 'linux', arch: 'x64' }),
        runRemoteText: async () => ({ status: 0, stdout: '', stderr: '' }),
        copyLocalDirectoryToRemote: async () => {},
        installRemoteComponent: async () => ({ binaryPath: serverBinaryPath, versionId: 'preview-2' }),
        localInstallPolicy: { runServiceCommands: false, skipHealthCheck: true },
      });

      await expect(engine.installOrUpdate({
        target: { kind: 'local' },
        mode: 'user',
        channel: 'preview',
        selfHostRelayBinaryOverride: serverBinaryPath,
        purpose: { kind: 'personal-home', canonicalServerUrl: 'http://localhost:43123' },
      })).rejects.toThrow(/canonical/i);

      const stateText = await readFile(join(runtime.defaults.installRoot, 'self-host-state.json'), 'utf8');
      expect(JSON.parse(stateText).purpose).toEqual(PERSONAL_HOME_PURPOSE);
      const envText = await readFile(join(runtime.defaults.configDir, 'server.env'), 'utf8');
      expect(envText).toContain(`HAPPIER_PUBLIC_SERVER_URL=${CANONICAL_SERVER_URL}`);
      expect(lockEvents).toEqual([]);
    } finally {
      await runtime.dispose();
    }
  });

  it('rejects an explicit generic purpose on an installed Personal Home runtime instead of declassifying it', async () => {
    const runtime = await createInstalledPersonalHomeRuntime();
    const lockEvents: string[] = [];
    try {
      mockLinuxHost(runtime.homeDir);
      mockRecordingHomeLock(lockEvents);

      const engine = await createTestEngine();
      await expect(engine.control({
        target: { kind: 'local' },
        mode: 'user',
        channel: 'preview',
        purpose: { kind: 'generic' },
        action: 'uninstall',
      } as never)).rejects.toThrow(/Personal Home/i);

      expect(lockEvents).toEqual([]);
      expect(existsSync(join(runtime.defaults.installRoot, 'self-host-state.json'))).toBe(true);
      const stateText = await readFile(join(runtime.defaults.installRoot, 'self-host-state.json'), 'utf8');
      expect(JSON.parse(stateText).purpose).toEqual(PERSONAL_HOME_PURPOSE);
    } finally {
      await runtime.dispose();
    }
  });
});
