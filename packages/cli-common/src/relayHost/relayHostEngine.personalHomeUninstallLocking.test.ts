import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

describe('RelayHostEngine Personal Home uninstall locking', () => {
  afterEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('acquires the Home lock for preserved Home data even when runtime state and caller purpose are absent', async () => {
    const events: string[] = [];
    const homeDir = await mkdtemp(join(tmpdir(), 'happier-personal-home-uninstall-layout-lock-'));
    const currentDataDir = join(homeDir, 'current-data');
    const legacyDataDir = join(homeDir, 'legacy-data');

    vi.doMock('node:os', async () => {
      const actual = await vi.importActual<typeof import('node:os')>('node:os');
      return { ...actual, homedir: () => homeDir };
    });
    vi.doMock('node:child_process', async () => {
      const actual = await vi.importActual<typeof import('node:child_process')>('node:child_process');
      return { ...actual, spawnSync: () => ({ status: 0, stdout: '', stderr: '' }) };
    });
    vi.doMock('../service/index.js', async () => {
      const actual = await vi.importActual<typeof import('../service/index.js')>('../service/index.js');
      return {
        ...actual,
        resolveServiceBackend: () => 'systemd-user',
        buildServiceDefinition: () => ({ path: '/tmp/happier-personal-home.service', contents: '[Service]\n' }),
        planServiceAction: (params: { action: string }) => ({ action: params.action, writes: [], commands: [] }),
        applyServicePlan: async (plan: { action: string }) => {
          events.push(`service:${plan.action}`);
        },
      };
    });
    vi.doMock('../firstPartyRuntime/withFirstPartyPayloadMutationLock.js', () => ({
      withFirstPartyPayloadMutationLock: async (params: { operation: () => Promise<unknown> }) => {
        events.push('payload:acquired');
        try {
          return await params.operation();
        } finally {
          events.push('payload:released');
        }
      },
    }));
    vi.doMock('../firstPartyRuntime/personalHome/lock.js', () => ({
      withPersonalHomeOperationLock: async (dataDir: string, operation: string, run: () => Promise<unknown>) => {
        events.push(`home:${operation}:acquired:${dataDir}`);
        try {
          return await run();
        } finally {
          events.push(`home:${operation}:released`);
        }
      },
    }));
    vi.doMock('../firstPartyRuntime/relayRuntimeInstall.js', async () => {
      const actual = await vi.importActual<typeof import('../firstPartyRuntime/relayRuntimeInstall.js')>(
        '../firstPartyRuntime/relayRuntimeInstall.js',
      );
      return {
        ...actual,
        uninstallRelayRuntimePayloadLocal: async () => {
          events.push('payload:removed');
        },
      };
    });

    const { createRelayHostEngine } = await import('./relayHostEngine.js');
    const { resolveRelayRuntimeDefaults } = await import('../firstPartyRuntime/relayRuntime.js');
    const defaults = resolveRelayRuntimeDefaults({ platform: process.platform, mode: 'user', channel: 'stable', homeDir });
    await mkdir(defaults.configDir, { recursive: true });
    await mkdir(currentDataDir, { recursive: true });
    await writeFile(join(currentDataDir, 'handy-master-secret.txt'), 'preserved-home-secret');
    await writeFile(join(defaults.configDir, 'server.env'), [
      `HAPPIER_SERVER_LIGHT_DATA_DIR=${currentDataDir}`,
      `HAPPY_SERVER_LIGHT_DATA_DIR=${legacyDataDir}`,
      '',
    ].join('\n'));
    const engine = createRelayHostEngine({
      resolveRemoteReleaseTarget: async () => ({ os: 'linux', arch: 'x64' }),
      runRemoteText: async () => ({ status: 0, stdout: '', stderr: '' }),
      copyLocalDirectoryToRemote: async () => {},
      installRemoteComponent: async () => ({ binaryPath: '/tmp/happier-server', versionId: 'stable-1' }),
    });

    await engine.control({
      target: { kind: 'local' },
      mode: 'user',
      channel: 'stable',
      action: 'uninstall',
    });

    expect(events).toEqual([
      'payload:acquired',
      `home:uninstall:acquired:${currentDataDir}`,
      'service:uninstall',
      'payload:removed',
      'home:uninstall:released',
      'payload:released',
    ]);
    await rm(homeDir, { recursive: true, force: true });
  }, 60_000);

  it('does not stop the service or remove payload while backup owns the Home lock', async () => {
    const homeDir = await mkdtemp(join(tmpdir(), 'happier-personal-home-uninstall-busy-'));
    const events: string[] = [];
    try {
      vi.doMock('node:os', async () => {
        const actual = await vi.importActual<typeof import('node:os')>('node:os');
        return { ...actual, homedir: () => homeDir };
      });
      vi.doMock('node:child_process', async () => {
        const actual = await vi.importActual<typeof import('node:child_process')>('node:child_process');
        return { ...actual, spawnSync: () => ({ status: 0, stdout: '', stderr: '' }) };
      });
      vi.doMock('../service/index.js', async () => {
        const actual = await vi.importActual<typeof import('../service/index.js')>('../service/index.js');
        return {
          ...actual,
          resolveServiceBackend: () => 'systemd-user',
          buildServiceDefinition: () => ({ path: '/tmp/happier-personal-home.service', contents: '[Service]\n' }),
          planServiceAction: (params: { action: string }) => ({ action: params.action, writes: [], commands: [] }),
          applyServicePlan: async (plan: { action: string }) => {
            events.push(`service:${plan.action}`);
          },
        };
      });
      vi.doMock('../firstPartyRuntime/personalHome/lock.js', async () => (
        await vi.importActual<typeof import('../firstPartyRuntime/personalHome/lock.js')>(
          '../firstPartyRuntime/personalHome/lock.js',
        )
      ));
      vi.doMock('../firstPartyRuntime/relayRuntimeInstall.js', async () => {
        const actual = await vi.importActual<typeof import('../firstPartyRuntime/relayRuntimeInstall.js')>(
          '../firstPartyRuntime/relayRuntimeInstall.js',
        );
        return {
          ...actual,
          uninstallRelayRuntimePayloadLocal: async () => {
            events.push('payload:removed');
          },
        };
      });

      const { resolveRelayRuntimeDefaults } = await import('../firstPartyRuntime/relayRuntime.js');
      const defaults = resolveRelayRuntimeDefaults({ platform: process.platform, mode: 'user', channel: 'stable', homeDir });
      const { withPersonalHomeOperationLock } = await import('../firstPartyRuntime/personalHome/lock.js');
      const { createRelayHostEngine } = await import('./relayHostEngine.js');
      const engine = createRelayHostEngine({
        resolveRemoteReleaseTarget: async () => ({ os: 'linux', arch: 'x64' }),
        runRemoteText: async () => ({ status: 0, stdout: '', stderr: '' }),
        copyLocalDirectoryToRemote: async () => {},
        installRemoteComponent: async () => ({ binaryPath: '/tmp/happier-server', versionId: 'stable-1' }),
      });

      await withPersonalHomeOperationLock(defaults.dataDir, 'backup', async () => {
        await expect(engine.control({
          target: { kind: 'local' },
          mode: 'user',
          channel: 'stable',
          purpose: { kind: 'personal-home', canonicalServerUrl: 'http://127.0.0.1:43123' },
          action: 'uninstall',
        })).rejects.toMatchObject({ code: 'operation_in_progress' });
      });

      expect(events).toEqual([]);
    } finally {
      await rm(homeDir, { recursive: true, force: true });
    }
  }, 60_000);
});
