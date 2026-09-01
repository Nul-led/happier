import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

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

});
