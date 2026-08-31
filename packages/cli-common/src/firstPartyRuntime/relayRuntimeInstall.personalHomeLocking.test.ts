import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolveRelayRuntimeDefaults } from './relayRuntime.js';

const lockEvents = vi.hoisted(() => [] as string[]);

vi.mock('./withFirstPartyPayloadMutationLock.js', () => ({
  withFirstPartyPayloadMutationLock: vi.fn(async (params: { operation: () => Promise<unknown> }) => {
    lockEvents.push('payload:acquired');
    try {
      return await params.operation();
    } finally {
      lockEvents.push('payload:released');
    }
  }),
}));

vi.mock('./personalHome/lock.js', () => ({
  withPersonalHomeOperationLock: vi.fn(async (_dataDir: string, operation: string, run: () => Promise<unknown>) => {
    lockEvents.push(`home:${operation}:acquired`);
    try {
      return await run();
    } finally {
      lockEvents.push(`home:${operation}:released`);
    }
  }),
}));

describe('installOrUpdateRelayRuntimeLocal Personal Home locking', () => {
  afterEach(() => {
    lockEvents.length = 0;
    vi.clearAllMocks();
  });

  it('holds the payload mutation lock outside the common Home upgrade lock for the complete install', async () => {
    const homeDir = await mkdtemp(join(tmpdir(), 'happier-relay-personal-home-locking-'));
    try {
      const payloadRoot = join(homeDir, 'payload');
      await mkdir(payloadRoot, { recursive: true });
      const serverBinaryPath = join(payloadRoot, 'happier-server');
      await writeFile(serverBinaryPath, '#!/bin/sh\n', 'utf8');

      const { installOrUpdateRelayRuntimeLocal } = await import('./relayRuntimeInstall.js');
      await installOrUpdateRelayRuntimeLocal({
        serverBinaryPath,
        channel: 'preview',
        mode: 'user',
        platform: 'linux',
        homeDir,
        purpose: { kind: 'personal-home', canonicalServerUrl: 'http://127.0.0.1:43123' },
        assertPersonalHomeStopped: async () => undefined,
        env: { PORT: '43123', AUTH_ANONYMOUS_SIGNUP_ENABLED: '0' },
        runServiceCommands: false,
        skipHealthCheck: true,
      });

      expect(lockEvents).toEqual([
        'payload:acquired',
        'home:upgrade:acquired',
        'home:upgrade:released',
        'payload:released',
      ]);
    } finally {
      await rm(homeDir, { recursive: true, force: true });
    }
  });

  it('checks relocation activation state under the Home upgrade lock before a direct Personal Home install', async () => {
    const homeDir = await mkdtemp(join(tmpdir(), 'happier-relay-personal-home-relocation-gate-'));
    try {
      const defaults = resolveRelayRuntimeDefaults({ platform: 'linux', mode: 'user', channel: 'preview', homeDir });
      const destinationDataDir = join(homeDir, 'relocation-destination');
      await mkdir(join(defaults.dataDir, '.operations'), { recursive: true });
      await writeFile(join(defaults.dataDir, '.operations', 'relocation.json'), `${JSON.stringify({
        version: 1,
        phase: 'committed',
        sourceDataDir: defaults.dataDir,
        destinationDataDir,
        homeServerIdentityId: 'home-identity',
        bundleSha256: 'a'.repeat(64),
        priorSourceRunning: true,
      })}\n`, { mode: 0o600 });
      const payloadRoot = join(homeDir, 'payload');
      await mkdir(payloadRoot, { recursive: true });
      const serverBinaryPath = join(payloadRoot, 'happier-server');
      await writeFile(serverBinaryPath, '#!/bin/sh\n', 'utf8');

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
        runServiceCommands: false,
        skipHealthCheck: true,
      })).rejects.toMatchObject({ code: 'PERSONAL_HOME_RELOCATION_ACTIVATION_BLOCKED' });
      expect(lockEvents).toEqual([
        'payload:acquired',
        'home:upgrade:acquired',
        'home:upgrade:released',
        'payload:released',
      ]);
    } finally {
      await rm(homeDir, { recursive: true, force: true });
    }
  });
});
