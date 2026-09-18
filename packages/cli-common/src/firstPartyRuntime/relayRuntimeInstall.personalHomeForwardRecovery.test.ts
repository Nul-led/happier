import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

// The service manager is real; only its OS process boundary is simulated.
const processBoundary = vi.hoisted(() => ({ run: (_command: string, _args: readonly string[]) => undefined as void }));
vi.mock('node:child_process', async (importOriginal) => ({
  ...await importOriginal<typeof import('node:child_process')>(),
  spawnSync: (command: string, args: readonly string[] = []) => {
    processBoundary.run(command, args);
    return { status: 0, signal: null, stdout: '', stderr: '', pid: process.pid, output: [] };
  },
}));

import { installOrUpdateRelayRuntimeLocal } from './relayRuntimeInstall.js';
import { resolveRelayRuntimeDefaults } from './relayRuntime.js';
import { resolvePersonalHomeRuntimeLayout } from './personalHome/layout.js';
import { readPersonalHomeUpdateRecoveryRecord, resolvePersonalHomeUpdateRecoveryPath } from './personalHome/updateRecovery.js';
import { createRelayRuntimeInstallOrUpdateTaskKind } from '../systemTasks/kinds/relayRuntimeKinds.js';
import { createSystemTasksRunner } from '../systemTasks/interactiveTaskKinds.js';

afterEach(() => { processBoundary.run = () => undefined; });

describe('Personal Home exact candidate forward recovery through the installer', () => {
  it.each(['after-boundary', 'before-receipt', 'dead-receipt', 'activated', 'failed-readiness', 'legacy-candidate-less', 'committed'] as const)('recovers %s without replacing the candidate or acknowledged data', async (interruption) => {
    const homeDir = await mkdtemp(join(tmpdir(), 'happier-forward-update-'));
    const server = createServer((_request, response) => { response.end('{"version":"candidate-version"}'); });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing fixture listener');
    const canonicalServerUrl = `http://127.0.0.1:${address.port}`;
    try {
      const defaults = resolveRelayRuntimeDefaults({ platform: 'linux', mode: 'user', channel: 'preview', homeDir });
      const layout = resolvePersonalHomeRuntimeLayout({ platform: 'linux', mode: 'user', channel: 'preview', homeDir });
      const statePath = join(defaults.installRoot, 'self-host-state.json');
      const binaryPath = join(defaults.installRoot, 'bin', 'happier-server');
      const envPath = join(defaults.configDir, 'server.env');
      const receiptPath = join(layout.dataDir, 'startup-receipt.json');
      const servicePath = join(homeDir, '.config', 'systemd', 'user', `${defaults.serviceName}.service`);
      const purpose = { kind: 'personal-home' as const, canonicalServerUrl };
      const envText = `PORT=${address.port}\nHOST=127.0.0.1\nHAPPIER_SERVER_CANONICAL_URL=${canonicalServerUrl}\n`;
      const candidateState = { channel: 'preview', mode: 'user', version: 'candidate-version', updatedAt: '2026-09-05T00:00:00.000Z', purpose };
      const backupRoot = join(dirname(defaults.installRoot), '.relay-runtime-backup-exact');
      const restorePath = join(layout.backupsDir, 'restore-points', 'pre-upgrade-exact.tar');
      for (const directory of [dirname(binaryPath), defaults.configDir, layout.dataDir, backupRoot, dirname(restorePath)]) await mkdir(directory, { recursive: true });
      const candidateBinaryBytes = 'exact installed candidate';
      writeFileSync(binaryPath, interruption === 'after-boundary' ? 'prior runtime before candidate mutation' : candidateBinaryBytes);
      writeFileSync(envPath, interruption === 'after-boundary' ? 'PORT=3005\n' : envText);
      writeFileSync(statePath, JSON.stringify(interruption === 'committed' ? candidateState : { version: 'old-version', purpose }));
      writeFileSync(restorePath, 'old snapshot must never replace acknowledged writes');
      const retainedDataPath = join(layout.dataDir, 'acknowledged-write.txt');
      writeFileSync(retainedDataPath, 'acknowledged after candidate activation');
      const readiness = { authenticated: true, homeServerIdentityId: 'home-expected', accountCount: 1, sessionCount: 1 };
      const nonce = 'exact-candidate-nonce';
      const activation = { nonce, pid: 2147483647, host: '127.0.0.1', port: address.port, readiness };
      if (interruption !== 'before-receipt') writeFileSync(receiptPath, JSON.stringify({ ...activation, personalHomeReadiness: readiness }));
      let candidatePayload: Readonly<{ directoryName: 'candidate'; sha256: string }> | undefined;
      if (interruption === 'after-boundary') {
        const stagedBinaryPath = join(backupRoot, 'candidate', 'bin', 'happier-server');
        await mkdir(dirname(stagedBinaryPath), { recursive: true });
        writeFileSync(stagedBinaryPath, candidateBinaryBytes);
        const digest = createHash('sha256');
        digest.update('happier:relay-runtime-payload:v1\0');
        digest.update('dir\0bin\0');
        digest.update('file\0bin/happier-server\0');
        digest.update(candidateBinaryBytes);
        digest.update('\0');
        candidatePayload = { directoryName: 'candidate', sha256: `sha256:${digest.digest('hex')}` };
      }
      const record = {
        version: 1,
        phase: interruption === 'committed' ? 'committed' : interruption === 'activated' ? 'activated' : 'prepared',
        expectedStartupNonce: nonce,
        activation: interruption === 'activated' ? activation : null,
        ...(['legacy-candidate-less', 'committed'].includes(interruption) ? {} : {
          candidate: { envText, state: candidateState, ...(candidatePayload ? { payload: candidatePayload } : {}) },
        }),
        priorRunning: true,
        previousServiceDefinitionExisted: true,
        runtimeBackup: { directoryName: '.relay-runtime-backup-exact', hasPayload: false, hasRestorableServerBinary: false, hasMigrations: false, previousEnvText: null, previousStateText: null },
        restorePoint: { fileName: 'pre-upgrade-exact.tar', homeServerIdentityId: 'home-expected', schemaVersion: 'schema-v1' },
      };
      await mkdir(dirname(resolvePersonalHomeUpdateRecoveryPath(layout)), { recursive: true });
      writeFileSync(resolvePersonalHomeUpdateRecoveryPath(layout), JSON.stringify(record));
      let started = false;
      let wrongIdentity = interruption === 'failed-readiness';
      processBoundary.run = (command, args) => {
        if (command === 'systemctl' && args.includes('restart')) {
          expect(readFileSync(servicePath, 'utf8')).toContain(nonce);
          expect(readFileSync(binaryPath, 'utf8')).toBe('exact installed candidate');
          started = true;
          writeFileSync(receiptPath, JSON.stringify({ ...activation, pid: process.pid,
            personalHomeReadiness: { ...readiness, homeServerIdentityId: wrongIdentity ? 'wrong-home' : readiness.homeServerIdentityId } }));
        }
      };
      const invoke = () => installOrUpdateRelayRuntimeLocal({
        serverBinaryPath: join(homeDir, 'a-different-requested-candidate-that-does-not-exist'),
        version: 'must-not-install-this-version',
        channel: 'preview', mode: 'user', platform: 'linux', homeDir, purpose,
        resolvePersonalHomeUpdateLayout: async () => layout,
        assertPersonalHomeStopped: async () => undefined,
        readPersonalHomeWasRunning: async () => false,
      });
      if (interruption === 'legacy-candidate-less') {
        await expect(invoke()).rejects.toMatchObject({ code: 'personal_home_update_retry_required', recoveryAction: 'retry_prior_runtime' });
        const runner = createSystemTasksRunner({ kinds: {
          install: createRelayRuntimeInstallOrUpdateTaskKind({ installOrUpdate: async () => {
            const installed = await invoke();
            return { relayUrl: installed.baseUrl, mode: 'user' };
          } }),
        } });
        await runner.start({ taskId: 'recover-incomplete-update', kind: 'install', params: { target: { kind: 'local' }, mode: 'user', channel: 'preview' } });
        await vi.waitFor(async () => {
          const state = await runner.poll({ taskId: 'recover-incomplete-update', cursor: 0 });
          expect(state.result).toMatchObject({ ok: false, error: { code: 'personal_home_update_retry_required' } });
        });
        expect(started).toBe(false);
        expect(await readPersonalHomeUpdateRecoveryRecord(layout)).toMatchObject({ phase: 'prepared' });
        expect(await readFile(retainedDataPath, 'utf8')).toBe('acknowledged after candidate activation');
        expect(await readFile(restorePath, 'utf8')).toBe('old snapshot must never replace acknowledged writes');
        return;
      }
      if (wrongIdentity) {
        await expect(invoke()).rejects.toMatchObject({ code: 'personal_home_update_retry_required', recoveryAction: 'retry_exact_candidate' });
        expect(await readPersonalHomeUpdateRecoveryRecord(layout)).toMatchObject({ phase: 'prepared' });
        expect(await readFile(restorePath, 'utf8')).toBe('old snapshot must never replace acknowledged writes');
        wrongIdentity = false;
      }
      const result = await invoke();
      expect(result).toEqual({ baseUrl: canonicalServerUrl, version: 'candidate-version' });
      expect(started).toBe(interruption !== 'committed');
      expect(JSON.parse(await readFile(statePath, 'utf8'))).toEqual(candidateState);
      expect(await readFile(retainedDataPath, 'utf8')).toBe('acknowledged after candidate activation');
      expect(await readFile(binaryPath, 'utf8')).toBe('exact installed candidate');
      expect(await readPersonalHomeUpdateRecoveryRecord(layout)).toBeNull();
      await expect(readFile(restorePath)).rejects.toMatchObject({ code: 'ENOENT' });
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
      await rm(homeDir, { recursive: true, force: true });
    }
  }, 20_000);
});
