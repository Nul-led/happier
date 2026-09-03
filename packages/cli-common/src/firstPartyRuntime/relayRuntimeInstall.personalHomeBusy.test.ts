import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

const serviceActions = vi.hoisted(() => [] as string[]);

vi.mock('../service/index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../service/index.js')>();
  return {
    ...actual,
    resolveServiceBackend: () => 'systemd-user',
    buildServiceDefinition: () => ({ path: '/tmp/happier-personal-home-busy.service', contents: '[Service]\n' }),
    planServiceAction: (params: { action: string }) => ({ action: params.action, writes: [], commands: [] }),
    applyServicePlan: async (plan: { action: string }) => {
      serviceActions.push(plan.action);
    },
  };
});

describe('installOrUpdateRelayRuntimeLocal Personal Home exclusion', () => {
  afterEach(() => {
    serviceActions.length = 0;
    vi.clearAllMocks();
  });

  it('does not stop, mutate, migrate, or start while backup owns the Home lock', async () => {
    const homeDir = await mkdtemp(join(tmpdir(), 'happier-relay-personal-home-busy-'));
    try {
      const payloadRoot = join(homeDir, 'payload');
      await mkdir(payloadRoot, { recursive: true });
      const serverBinaryPath = join(payloadRoot, 'happier-server');
      await writeFile(serverBinaryPath, '#!/bin/sh\n', 'utf8');
      const { resolveRelayRuntimeDefaults } = await import('./relayRuntime.js');
      const defaults = resolveRelayRuntimeDefaults({ platform: 'linux', mode: 'user', channel: 'preview', homeDir });
      const { withPersonalHomeOperationLock } = await import('./personalHome/lock.js');
      const { installOrUpdateRelayRuntimeLocal } = await import('./relayRuntimeInstall.js');
      let migrationRan = false;
      let legacyCleanupRan = false;

      await withPersonalHomeOperationLock(defaults.dataDir, 'backup', async () => {
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
          skipHealthCheck: true,
          runMigrationCommand: async () => {
            migrationRan = true;
          },
          cleanupLegacyServiceBeforeInstall: async () => {
            legacyCleanupRan = true;
          },
        })).rejects.toMatchObject({ code: 'operation_in_progress' });
      });

      expect(serviceActions).toEqual([]);
      expect(migrationRan).toBe(false);
      expect(legacyCleanupRan).toBe(false);
      await expect(access(join(defaults.installRoot, 'bin', 'happier-server'))).rejects.toMatchObject({ code: 'ENOENT' });
    } finally {
      await rm(homeDir, { recursive: true, force: true });
    }
  });
});
