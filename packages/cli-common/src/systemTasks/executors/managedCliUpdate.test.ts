import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  installVersionedPayload,
  readInstalledVersionMarkersSync,
  resolveFirstPartyInstallLayout,
} from '../../firstPartyRuntime/index.js';
import { updateManagedLocalFirstPartyComponent } from './happierJsonExecutor.js';

async function createPayload(rootDir: string, versionId: string): Promise<string> {
  const payloadRoot = join(rootDir, `payload-${versionId}`);
  await mkdir(join(payloadRoot, 'package-dist'), { recursive: true });
  await writeFile(join(payloadRoot, process.platform === 'win32' ? 'happier.exe' : 'happier'), versionId, 'utf8');
  await writeFile(join(payloadRoot, 'package-dist', 'index.mjs'), 'export {};\n', 'utf8');
  return payloadRoot;
}

/** The staged fixture binary "prints" the version its content names — what a real `--version` does. */
async function readFixtureVersion(command: string): Promise<string | null> {
  return await readFile(command, 'utf8').catch(() => null);
}

describe('updateManagedLocalFirstPartyComponent', () => {
  it('updates the managed CLI in place through the install owner and reports both versions', async () => {
    const homeDir = await mkdtemp(join(tmpdir(), 'happier-managed-update-'));
    // The release download is the one external boundary; the install itself is real.
    const processEnv: NodeJS.ProcessEnv = { HAPPIER_HOME_DIR: homeDir, HAPPIER_STACK_REPO_DIR: homeDir };
    try {
      await installVersionedPayload({ componentId: 'happier-cli', versionId: '0.3.0', payloadRoot: await createPayload(homeDir, '0.3.0'), processEnv });
      const result = await updateManagedLocalFirstPartyComponent({ componentId: 'happier-cli', processEnv }, {
        preparePayload: async () => ({ versionId: '0.3.2', payloadRoot: await createPayload(homeDir, '0.3.2'), cleanup: async () => undefined }),
        readVersion: readFixtureVersion,
      });

      expect(result).toMatchObject({ previousVersion: '0.3.0', version: '0.3.2', restarted: false });
      expect(readInstalledVersionMarkersSync(resolveFirstPartyInstallLayout({ componentId: 'happier-cli', processEnv })).currentVersionId).toBe('0.3.2');
    } finally {
      await rm(homeDir, { recursive: true, force: true });
    }
  });

  it('refuses by name for a CLI the managed install path did not place, without downloading', async () => {
    const homeDir = await mkdtemp(join(tmpdir(), 'happier-managed-update-override-'));
    const cliPath = join(homeDir, 'dev-happier');
    await writeFile(cliPath, 'dev', 'utf8');
    let prepared = false;
    try {
      await expect(updateManagedLocalFirstPartyComponent({
        componentId: 'happier-cli',
        processEnv: { HAPPIER_HOME_DIR: homeDir, HAPPIER_STACK_REPO_DIR: homeDir, HAPPIER_BOOTSTRAP_CLI_PATH: cliPath },
        envVarNames: ['HAPPIER_BOOTSTRAP_CLI_PATH'],
      }, {
        preparePayload: async () => {
          prepared = true;
          throw new Error('must not download');
        },
      })).rejects.toMatchObject({ code: 'cli_not_managed', message: expect.stringContaining(cliPath) });
      expect(prepared).toBe(false);
    } finally {
      await rm(homeDir, { recursive: true, force: true });
    }
  });

  it('runs the one update transaction: a restart that is not proven restores the previous version by name', async () => {
    const homeDir = await mkdtemp(join(tmpdir(), 'happier-managed-update-rollback-'));
    const processEnv: NodeJS.ProcessEnv = { HAPPIER_HOME_DIR: homeDir, HAPPIER_STACK_REPO_DIR: homeDir };
    const restarts: string[] = [];
    try {
      await installVersionedPayload({ componentId: 'happier-cli', versionId: '0.3.0', payloadRoot: await createPayload(homeDir, '0.3.0'), processEnv });
      await expect(updateManagedLocalFirstPartyComponent({
        componentId: 'happier-cli',
        processEnv,
        planServiceDaemonRestart: async () => async ({ expectedVersion, phase }) => {
          restarts.push(`${phase}:${expectedVersion}`);
          if (phase === 'activated') throw new Error('the new daemon never became the owner');
        },
      }, {
        preparePayload: async () => ({ versionId: '0.3.2', payloadRoot: await createPayload(homeDir, '0.3.2'), cleanup: async () => undefined }),
        readVersion: readFixtureVersion,
      })).rejects.toMatchObject({ code: 'cli_update_rolled_back', message: expect.stringContaining('0.3.0 was restored') });

      expect(restarts).toEqual(['activated:0.3.2', 'restored:0.3.0']);
      expect(readInstalledVersionMarkersSync(resolveFirstPartyInstallLayout({ componentId: 'happier-cli', processEnv })).currentVersionId).toBe('0.3.0');
    } finally {
      await rm(homeDir, { recursive: true, force: true });
    }
  });

  it('activates nothing when the downloaded CLI does not run (staged smoke)', async () => {
    const homeDir = await mkdtemp(join(tmpdir(), 'happier-managed-update-smoke-'));
    const processEnv: NodeJS.ProcessEnv = { HAPPIER_HOME_DIR: homeDir, HAPPIER_STACK_REPO_DIR: homeDir };
    try {
      await installVersionedPayload({ componentId: 'happier-cli', versionId: '0.3.0', payloadRoot: await createPayload(homeDir, '0.3.0'), processEnv });
      await expect(updateManagedLocalFirstPartyComponent({ componentId: 'happier-cli', processEnv }, {
        preparePayload: async () => ({ versionId: '0.3.2', payloadRoot: await createPayload(homeDir, '0.3.2'), cleanup: async () => undefined }),
        readVersion: async () => null,
      })).rejects.toMatchObject({ code: 'cli_update_smoke_failed' });
      expect(readInstalledVersionMarkersSync(resolveFirstPartyInstallLayout({ componentId: 'happier-cli', processEnv })).currentVersionId).toBe('0.3.0');
    } finally {
      await rm(homeDir, { recursive: true, force: true });
    }
  });
});
