import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import { reloadConfiguration } from '@/configuration';
import { SUPPORTED_SCHEMA_VERSION } from '@/persistence';
import { acquireSessionRunnerLock, sessionRunnerLockPathForSessionId } from '@/daemon/sessionRunnerLock';
import { writeTerminalAttachmentInfo } from '@/terminal/attachment/terminalAttachmentInfo';
import { createEnvKeyScope } from '@/testkit/env/envScope';
import { createAccountEncryptionCurrentnessFixture, createSessionRecordFixture } from '@/testkit/backends/sessionFixtures';

const transport = vi.hoisted(() => ({ rpc: vi.fn(async () => false) }));
// Remote Session RPC is the genuine transport boundary. Eligibility, local
// owner metadata, locks and command dispatch below remain real.
vi.mock('@/session/transport/rpc/sessionRpc', async importOriginal => ({
  ...await importOriginal<typeof import('@/session/transport/rpc/sessionRpc')>(),
  callSessionRpc: transport.rpc,
}));

import { handleAttachCommand } from './attach';

describe('recorded Herdr restoration through shared native attachment', () => {
  it.each(['absent', 'present', 'unknown'] as const)(
    'opens only a positively absent controller candidate without a switch RPC (%s)', async presence => {
      const home = await mkdtemp(join(tmpdir(), 'happier-03-cold-attach-'));
      const env = createEnvKeyScope(['HAPPIER_HOME_DIR']);
      env.patch({ HAPPIER_HOME_DIR: home });
      reloadConfiguration();
      transport.rpc.mockClear();
      const sessionId = 'cold-shared-controller';
      const terminal = { mode: 'herdr' as const, herdr: { sessionName: 'work', socketPath: join(home, 'recorded.sock'),
        paneId: 'recorded-pane', terminalId: 'old-runtime-terminal' } };
      await writeTerminalAttachmentInfo({ happyHomeDir: home, sessionId, terminal });
      const row = createSessionRecordFixture({ id: sessionId, active: true, encryptionMode: 'plain',
        metadata: JSON.stringify({ flavor: 'opencode', path: home, machineId: 'this-machine', terminal,
          agentRuntimeCapabilitiesV1: { localControl: { supported: true, topology: 'shared', attachStrategy: 'provider_attach', remoteWritable: true } } }) });
      const lock = presence === 'present' ? await acquireSessionRunnerLock({ happyHomeDir: home, sessionId, pid: process.pid }) : null;
      if (lock && !lock.ok) throw new Error('Could not admit fixture controller');
      if (presence === 'unknown') {
        const path = sessionRunnerLockPathForSessionId({ happyHomeDir: home, sessionId });
        if (!path) throw new Error('Missing canonical lock path');
        await mkdir(dirname(path), { recursive: true });
        await writeFile(path, '{invalid');
      }
      const opened: string[] = [];
      const exit = vi.spyOn(process, 'exit').mockImplementation((() => { throw new Error('OS exit requested'); }) as typeof process.exit);
      try {
        const result = handleAttachCommand([sessionId], {
          readCredentialsFn: async () => ({ token: 'fixture-token', encryption: null }),
          fetchSessionByIdFn: async () => row,
          getAccountEncryptionCurrentnessFn: async () => createAccountEncryptionCurrentnessFixture({ mode: 'plain' }),
          readSettingsFn: async () => ({ schemaVersion: SUPPORTED_SCHEMA_VERSION, onboardingCompleted: true, machineId: 'this-machine' }),
          runHerdrAttachFn: async ({ terminal: host }) => { opened.push(host.herdr?.paneId ?? ''); return 0; },
        });
        if (presence === 'absent') {
          await expect(result).resolves.toBeUndefined();
          expect(opened).toEqual(['recorded-pane']);
          expect(transport.rpc).not.toHaveBeenCalled();
        } else {
          await expect(result).rejects.toThrow('OS exit requested');
          expect(opened).toEqual([]);
          expect(transport.rpc).toHaveBeenCalled();
        }
      } finally {
        exit.mockRestore();
        if (lock?.ok) await lock.release();
        env.restore();
        reloadConfiguration();
        await rm(home, { recursive: true, force: true });
      }
    });
});
