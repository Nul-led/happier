import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { resolveRelayRuntimeDefaults } from '../firstPartyRuntime/relayRuntime.js';
import type { PersonalHomeRestoreHooks } from '../firstPartyRuntime/personalHome/restore.js';
import { normalizePersonalHomeRestorableConfigurationV1 } from '../firstPartyRuntime/personalHome/configuration.js';

describe('RelayHostEngine (Personal Home purpose)', () => {
  it('fails the production install before mutation when canonical status still reports the Home active', async () => {
    const originalPlatform = process.platform;
    const homeDir = await mkdtemp(join(tmpdir(), 'personal-home-engine-still-running-'));
    try {
      Object.defineProperty(process, 'platform', { value: 'linux' });
      vi.doMock('node:os', async () => {
        const actual = await vi.importActual<typeof import('node:os')>('node:os');
        return { ...actual, homedir: () => homeDir };
      });
      vi.doMock('node:child_process', async () => {
        const actual = await vi.importActual<typeof import('node:child_process')>('node:child_process');
        return {
          ...actual,
          spawnSync: (_command: string, args: readonly string[] = []) => {
            const requestsPreviewUnit = args.some((value) => value.includes('happier-server-preview'));
            return requestsPreviewUnit
              ? {
                  status: 0,
                  stdout: 'LoadState=loaded\nActiveState=active\nSubState=running\nUnitFileState=enabled\n',
                  stderr: '',
                }
              : {
                  status: 0,
                  stdout: 'LoadState=not-found\nActiveState=inactive\nSubState=dead\nUnitFileState=disabled\n',
                  stderr: '',
                };
          },
        };
      });
      vi.doMock('../firstPartyRuntime/relayRuntimeInstall.js', async () => {
        const actual = await vi.importActual<typeof import('../firstPartyRuntime/relayRuntimeInstall.js')>('../firstPartyRuntime/relayRuntimeInstall.js');
        return {
          ...actual,
          installOrUpdateRelayRuntimeLocal: async (params: { assertPersonalHomeStopped?: () => Promise<void> }) => {
            expect(params.assertPersonalHomeStopped).toBeTypeOf('function');
            await params.assertPersonalHomeStopped!();
            throw new Error('installer mutated after stopped assertion');
          },
        };
      });
      const payloadRoot = join(homeDir, 'payload');
      await mkdir(payloadRoot, { recursive: true });
      const serverBinaryPath = join(payloadRoot, 'happier-server');
      await writeFile(serverBinaryPath, '#!/bin/sh\n', 'utf8');

      const { createRelayHostEngine } = await import('./relayHostEngine.js');
      const engine = createRelayHostEngine({
        resolveRemoteReleaseTarget: async () => ({ os: 'linux', arch: 'x64' }),
        runRemoteText: async () => ({ status: 0, stdout: '', stderr: '' }),
        copyLocalDirectoryToRemote: async () => {},
        installRemoteComponent: async () => ({ binaryPath: '', versionId: 'preview-1' }),
      });

      await expect(engine.installOrUpdate({
        target: { kind: 'local' },
        mode: 'user',
        channel: 'preview',
        selfHostRelayBinaryOverride: serverBinaryPath,
        purpose: { kind: 'personal-home', canonicalServerUrl: 'http://127.0.0.1:43123' },
        env: { PORT: '43123', AUTH_ANONYMOUS_SIGNUP_ENABLED: '0' },
      })).rejects.toThrow('Personal Home is still running after the managed service stop');
    } finally {
      Object.defineProperty(process, 'platform', { value: originalPlatform });
      vi.doUnmock('../firstPartyRuntime/relayRuntimeInstall.js');
      vi.doUnmock('node:child_process');
      vi.doUnmock('node:os');
      vi.resetModules();
      vi.clearAllMocks();
      await rm(homeDir, { recursive: true, force: true });
    }
  });

  it('provides canonical configuration storage preflight to upgrade rollback', async () => {
    const originalPlatform = process.platform;
    const homeDir = await mkdtemp(join(tmpdir(), 'personal-home-engine-upgrade-rollback-'));
    let restoreHooks: PersonalHomeRestoreHooks | undefined;
    try {
      Object.defineProperty(process, 'platform', { value: 'linux' });
      vi.doMock('node:os', async () => {
        const actual = await vi.importActual<typeof import('node:os')>('node:os');
        return { ...actual, homedir: () => homeDir };
      });
      vi.doMock('../firstPartyRuntime/relayRuntimeInstall.js', async () => {
        const actual = await vi.importActual<typeof import('../firstPartyRuntime/relayRuntimeInstall.js')>('../firstPartyRuntime/relayRuntimeInstall.js');
        return {
          ...actual,
          installOrUpdateRelayRuntimeLocal: async (params: { personalHomeRestoreHooks?: PersonalHomeRestoreHooks }) => {
            restoreHooks = params.personalHomeRestoreHooks;
            return { baseUrl: 'http://127.0.0.1:43123' };
          },
        };
      });
      const payloadRoot = join(homeDir, 'payload');
      await mkdir(payloadRoot, { recursive: true });
      const serverBinaryPath = join(payloadRoot, 'happier-server');
      await writeFile(serverBinaryPath, '#!/bin/sh\n', 'utf8');
      const defaults = resolveRelayRuntimeDefaults({ platform: 'linux', mode: 'user', channel: 'preview', homeDir });
      await mkdir(defaults.configDir, { recursive: true });
      await writeFile(join(defaults.configDir, 'server.env'), 'PORT=43123\n', 'utf8');

      const { createRelayHostEngine } = await import('./relayHostEngine.js');
      const engine = createRelayHostEngine({
        resolveRemoteReleaseTarget: async () => ({ os: 'linux', arch: 'x64' }),
        runRemoteText: async () => ({ status: 0, stdout: '', stderr: '' }),
        copyLocalDirectoryToRemote: async () => {},
        installRemoteComponent: async () => ({ binaryPath: '', versionId: 'preview-1' }),
      });

      await engine.installOrUpdate({
        target: { kind: 'local' },
        mode: 'user',
        channel: 'preview',
        selfHostRelayBinaryOverride: serverBinaryPath,
        purpose: { kind: 'personal-home', canonicalServerUrl: 'http://127.0.0.1:43123' },
        env: { PORT: '43123', AUTH_ANONYMOUS_SIGNUP_ENABLED: '0' },
      });

      expect(restoreHooks?.inspectConfigurationStorage).toBeTypeOf('function');
      expect(restoreHooks?.readDataCountsFromDatabase).toBeTypeOf('function');
      expect(restoreHooks?.requireDataCountVerification).toBe(true);
      const storage = await restoreHooks!.inspectConfigurationStorage!(
        normalizePersonalHomeRestorableConfigurationV1({ canonicalServerUrl: 'http://127.0.0.1:43123' }, 'home-identity'),
      );
      expect(storage.targetPath).toBe(join(defaults.configDir, 'server.env'));
      expect(storage.incomingBytes).toBeGreaterThan(0);
      expect(storage.rollbackBytes).toBe(Buffer.byteLength('PORT=43123\n'));
    } finally {
      Object.defineProperty(process, 'platform', { value: originalPlatform });
      vi.doUnmock('../firstPartyRuntime/relayRuntimeInstall.js');
      vi.doUnmock('node:os');
      vi.resetModules();
      vi.clearAllMocks();
      await rm(homeDir, { recursive: true, force: true });
    }
  });

  it('writes one authoritative closed-signup assignment and constructs the service from that env file', async () => {
    const originalPlatform = process.platform;
    const homeDir = await mkdtemp(join(tmpdir(), 'personal-home-engine-signup-'));
    try {
      Object.defineProperty(process, 'platform', { value: 'linux' });
      vi.doMock('node:os', async () => {
        const actual = await vi.importActual<typeof import('node:os')>('node:os');
        return { ...actual, homedir: () => homeDir };
      });
      const payloadRoot = join(homeDir, 'payload');
      await mkdir(payloadRoot, { recursive: true });
      const serverBinaryPath = join(payloadRoot, 'happier-server');
      await writeFile(serverBinaryPath, '#!/bin/sh\n', 'utf8');
      const defaults = resolveRelayRuntimeDefaults({ platform: 'linux', mode: 'user', channel: 'preview', homeDir });
      await mkdir(defaults.configDir, { recursive: true });
      await writeFile(join(defaults.configDir, 'server.env'), [
        'PORT=43123',
        'AUTH_ANONYMOUS_SIGNUP_ENABLED=1',
        'AUTH_ANONYMOUS_SIGNUP_ENABLED=0',
        '',
      ].join('\n'), 'utf8');

      const { createRelayHostEngine } = await import('./relayHostEngine.js');
      const engine = createRelayHostEngine({
        resolveRemoteReleaseTarget: async () => ({ os: 'linux', arch: 'x64' }),
        runRemoteText: async () => ({ status: 0, stdout: '', stderr: '' }),
        copyLocalDirectoryToRemote: async () => {},
        installRemoteComponent: async () => ({ binaryPath: '', versionId: 'preview-1' }),
        localInstallPolicy: { runServiceCommands: false, skipHealthCheck: true },
      });

      await engine.installOrUpdate({
        target: { kind: 'local' },
        mode: 'user',
        channel: 'preview',
        selfHostRelayBinaryOverride: serverBinaryPath,
        purpose: { kind: 'personal-home', canonicalServerUrl: 'http://127.0.0.1:43123' },
        env: { PORT: '43123', AUTH_ANONYMOUS_SIGNUP_ENABLED: '0' },
      });

      const envText = await readFile(join(defaults.configDir, 'server.env'), 'utf8');
      expect(envText.match(/^AUTH_ANONYMOUS_SIGNUP_ENABLED=0$/gmu)).toHaveLength(1);
      expect(envText).not.toContain('AUTH_ANONYMOUS_SIGNUP_ENABLED=1');
      const unitText = await readFile(join(homeDir, '.config', 'systemd', 'user', 'happier-server-preview.service'), 'utf8');
      expect(unitText).toContain('AUTH_ANONYMOUS_SIGNUP_ENABLED=0');
      const status = await engine.readStatus({
        target: { kind: 'local' },
        mode: 'user',
        channel: 'preview',
      });
      expect(status.anonymousSignupEnabled).toBe(false);
    } finally {
      Object.defineProperty(process, 'platform', { value: originalPlatform });
      vi.resetModules();
      vi.clearAllMocks();
      await rm(homeDir, { recursive: true, force: true });
    }
  });

  it('does not expose Personal Home erase through generic relay runtime control', async () => {
    const { createRelayHostEngine } = await import('./relayHostEngine.js');
    const engine = createRelayHostEngine({
      resolveRemoteReleaseTarget: async () => ({ os: 'linux', arch: 'x64' }),
      runRemoteText: async () => ({ status: 0, stdout: '', stderr: '' }),
      copyLocalDirectoryToRemote: async () => {},
      installRemoteComponent: async () => ({
        binaryPath: '$HOME/.happier/happier-server/current/happier-server',
        versionId: 'stable-1',
      }),
    });

    await expect(engine.control({
      target: { kind: 'local' },
      mode: 'user',
      channel: 'stable',
      action: 'erase',
    } as never)).rejects.toThrow('not supported by relay runtime control');
  });

  it('reports canonical origin and persistent layout facts for a managed Personal Home', async () => {
    const originalPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'linux' });
    try {
      vi.doMock('node:os', async () => {
        const actual = await vi.importActual<typeof import('node:os')>('node:os');
        return { ...actual, homedir: () => '/tmp/personal-home-engine-test' };
      });
      vi.doMock('node:fs', async () => {
        const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
        return { ...actual, existsSync: () => false };
      });
      vi.doMock('node:child_process', async () => {
        const actual = await vi.importActual<typeof import('node:child_process')>('node:child_process');
        return {
          ...actual,
          spawnSync: () => ({ status: 0, stdout: 'LoadState=not-found\n', stderr: '' }),
        };
      });

      const { createRelayHostEngine } = await import('./relayHostEngine.js');
      const engine = createRelayHostEngine({
        resolveRemoteReleaseTarget: async () => ({ os: 'linux', arch: 'x64' }),
        runRemoteText: async () => ({ status: 0, stdout: '', stderr: '' }),
        copyLocalDirectoryToRemote: async () => {},
        installRemoteComponent: async () => ({
          binaryPath: '$HOME/.happier/happier-server/current/happier-server',
          versionId: 'stable-1',
        }),
      });

      const status = await engine.readStatus({
        target: { kind: 'local' },
        channel: 'stable',
        mode: 'user',
        purpose: {
          kind: 'personal-home',
          canonicalServerUrl: 'http://127.0.0.1:43123',
        },
      });

      expect(status.canonicalServerUrl).toBe('http://127.0.0.1:43123');
      expect(status.purpose).toEqual({
        kind: 'personal-home',
        canonicalServerUrl: 'http://127.0.0.1:43123',
      });
      expect(status.layout?.dataDir).toContain('/.happier/self-host/data');
      expect(status.layout?.databasePath).toBe(`${status.layout?.dataDir}/happier-server-light.sqlite`);
      expect(status.dataPresent).toBe(false);
    } finally {
      Object.defineProperty(process, 'platform', { value: originalPlatform });
      vi.resetModules();
      vi.clearAllMocks();
    }
  });

  it('recovers the persisted Personal Home purpose without trusting a caller-supplied classification', async () => {
    const originalPlatform = process.platform;
    const homeDir = await mkdtemp(join(tmpdir(), 'personal-home-engine-purpose-'));
    try {
      const defaults = resolveRelayRuntimeDefaults({
        platform: 'linux',
        mode: 'user',
        channel: 'preview',
        homeDir,
      });
      await mkdir(defaults.installRoot, { recursive: true });
      await mkdir(defaults.configDir, { recursive: true });
      const currentDataDir = join(homeDir, 'current-data');
      const legacyDataDir = join(homeDir, 'legacy-data');
      await writeFile(join(defaults.installRoot, 'self-host-state.json'), JSON.stringify({
        version: '0.3.0-test',
        purpose: {
          kind: 'personal-home',
          canonicalServerUrl: 'http://127.0.0.1:43123',
        },
      }), 'utf8');
      await writeFile(join(defaults.configDir, 'server.env'), [
        'PORT=43123',
        'HAPPIER_SERVER_HOST=127.0.0.1',
        `HAPPIER_SERVER_LIGHT_DATA_DIR=${currentDataDir}`,
        `HAPPY_SERVER_LIGHT_DATA_DIR=${legacyDataDir}`,
        `HAPPIER_SERVER_LIGHT_FILES_DIR=${join(currentDataDir, 'current-public')}`,
        `HAPPY_SERVER_LIGHT_FILES_DIR=${join(legacyDataDir, 'legacy-public')}`,
        `HAPPIER_SERVER_LIGHT_PRIVATE_FILES_DIR=${join(currentDataDir, 'current-private')}`,
        `HAPPY_SERVER_LIGHT_PRIVATE_FILES_DIR=${join(legacyDataDir, 'legacy-private')}`,
        'HAPPIER_CANONICAL_SERVER_URL=http://127.0.0.1:43123',
        'AUTH_ANONYMOUS_SIGNUP_ENABLED=0',
        '',
      ].join('\n'), 'utf8');

      Object.defineProperty(process, 'platform', { value: 'linux' });
      vi.doMock('node:os', async () => {
        const actual = await vi.importActual<typeof import('node:os')>('node:os');
        return { ...actual, homedir: () => homeDir };
      });
      vi.doMock('node:fs', async () => await vi.importActual<typeof import('node:fs')>('node:fs'));
      vi.doMock('node:child_process', async () => {
        const actual = await vi.importActual<typeof import('node:child_process')>('node:child_process');
        return {
          ...actual,
          spawnSync: () => ({ status: 0, stdout: 'LoadState=not-found\n', stderr: '' }),
        };
      });

      const { createRelayHostEngine } = await import('./relayHostEngine.js');
      const engine = createRelayHostEngine({
        resolveRemoteReleaseTarget: async () => ({ os: 'linux', arch: 'x64' }),
        runRemoteText: async () => ({ status: 0, stdout: '', stderr: '' }),
        copyLocalDirectoryToRemote: async () => {},
        installRemoteComponent: async () => ({
          binaryPath: '$HOME/.happier/happier-server/current/happier-server',
          versionId: 'preview-1',
        }),
      });

      const status = await engine.readStatus({
        target: { kind: 'local' },
        channel: 'preview',
        mode: 'user',
      });

      expect(status.purpose).toEqual({
        kind: 'personal-home',
        canonicalServerUrl: 'http://127.0.0.1:43123',
      });
      expect(status.canonicalServerUrl).toBe('http://127.0.0.1:43123');
      expect(status.baseUrl).toBe('http://127.0.0.1:43123');
      expect(status.anonymousSignupEnabled).toBe(false);
      expect(status.layout).toMatchObject({
        dataDir: currentDataDir,
        publicFilesDir: join(currentDataDir, 'current-public'),
        privateFilesDir: join(currentDataDir, 'current-private'),
      });
    } finally {
      Object.defineProperty(process, 'platform', { value: originalPlatform });
      vi.resetModules();
      vi.clearAllMocks();
      await rm(homeDir, { recursive: true, force: true });
    }
  });

  it('reports meaningful retained managed-layout data without requiring a persisted runtime purpose', async () => {
    const originalPlatform = process.platform;
    const homeDir = await mkdtemp(join(tmpdir(), 'personal-home-engine-retained-data-'));
    try {
      const defaults = resolveRelayRuntimeDefaults({ platform: 'linux', mode: 'user', channel: 'stable', homeDir });
      await mkdir(defaults.configDir, { recursive: true });
      await mkdir(defaults.dataDir, { recursive: true });
      await writeFile(join(defaults.configDir, 'server.env'), [
        `HAPPIER_SERVER_LIGHT_DATA_DIR=${defaults.dataDir}`,
        '',
      ].join('\n'));
      await writeFile(join(defaults.dataDir, 'handy-master-secret.txt'), 'retained-secret');

      Object.defineProperty(process, 'platform', { value: 'linux' });
      vi.doMock('node:os', async () => {
        const actual = await vi.importActual<typeof import('node:os')>('node:os');
        return { ...actual, homedir: () => homeDir };
      });
      vi.doMock('node:child_process', async () => {
        const actual = await vi.importActual<typeof import('node:child_process')>('node:child_process');
        return { ...actual, spawnSync: () => ({ status: 1, stdout: '', stderr: '' }) };
      });

      const { createRelayHostEngine } = await import('./relayHostEngine.js');
      const engine = createRelayHostEngine({
        resolveRemoteReleaseTarget: async () => ({ os: 'linux', arch: 'x64' }),
        runRemoteText: async () => ({ status: 0, stdout: '', stderr: '' }),
        copyLocalDirectoryToRemote: async () => {},
        installRemoteComponent: async () => ({ binaryPath: '', versionId: 'stable-1' }),
      });

      const status = await engine.readStatus({
        target: { kind: 'local' },
        channel: 'stable',
        mode: 'user',
      });

      expect(status.installed).toBe(false);
      expect(status.purpose).toBeUndefined();
      expect(status.dataPresent).toBe(true);
    } finally {
      Object.defineProperty(process, 'platform', { value: originalPlatform });
      vi.resetModules();
      vi.clearAllMocks();
      await rm(homeDir, { recursive: true, force: true });
    }
  });
});
