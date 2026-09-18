import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { installVersionedPayload, resolveInstalledFirstPartyComponentPaths } from '../../firstPartyRuntime/index.js';
import {
  DEFAULT_HAPPIER_CLI_ENV_VAR_NAMES,
  ensureLocalFirstPartyComponentCommand,
  resolveExplicitOrInstalledLocalFirstPartyCommand,
} from '../index.js';

afterEach(() => {
  vi.clearAllMocks();
});

describe('ensureLocalFirstPartyComponentCommand', () => {
  it('returns an explicit env-var command without attempting install', async () => {
    const preparePayload = vi.fn();
    const installPayload = vi.fn();

    await expect(ensureLocalFirstPartyComponentCommand(
      {
        componentId: 'happier-cli',
        processEnv: {
          ...process.env,
          [DEFAULT_HAPPIER_CLI_ENV_VAR_NAMES[0]]: '/tmp/explicit-happier',
        },
        envVarNames: DEFAULT_HAPPIER_CLI_ENV_VAR_NAMES,
        releaseRing: 'stable',
      },
      {
        preparePayload: preparePayload as never,
        installPayload: installPayload as never,
      },
    )).resolves.toBe('/tmp/explicit-happier');

    expect(preparePayload).not.toHaveBeenCalled();
    expect(installPayload).not.toHaveBeenCalled();
  });

  it('prepares and installs the component when no explicit/installed command exists', async () => {
    const rootDir = mkdtempSync(join(tmpdir(), 'cli-common-cli-acquire-'));
    const happyHomeDir = join(rootDir, '.happier-home');
    const previousCwd = process.cwd();

    const preparePayload = vi.fn(async () => ({
      versionId: '1.2.3',
      payloadRoot: join(rootDir, 'payload'),
      cleanup: async () => undefined,
    }));

    const installPayload = vi.fn(async (params: Parameters<typeof import('../../firstPartyRuntime/index.js')['installVersionedPayload']>[0]) => {
      const paths = resolveInstalledFirstPartyComponentPaths({
        componentId: params.componentId,
        processEnv: params.processEnv,
        releaseRing: params.releaseRing,
      });
      mkdirSync(dirname(paths.binaryPath), { recursive: true });
      writeFileSync(paths.binaryPath, '#!/bin/sh\necho ok\n', 'utf8');
      chmodSync(paths.binaryPath, 0o755);
    });

    try {
      process.chdir(rootDir);
      const command = await ensureLocalFirstPartyComponentCommand(
        {
          componentId: 'happier-cli',
          processEnv: {
            ...process.env,
            HAPPIER_HOME_DIR: happyHomeDir,
          },
          envVarNames: DEFAULT_HAPPIER_CLI_ENV_VAR_NAMES,
          releaseRing: 'stable',
        },
        {
          preparePayload: preparePayload as never,
          installPayload: installPayload as never,
        },
      );

      const expected = resolveInstalledFirstPartyComponentPaths({
        componentId: 'happier-cli',
        processEnv: {
          ...process.env,
          HAPPIER_HOME_DIR: happyHomeDir,
        },
        releaseRing: 'stable',
      }).binaryPath;

      expect(command).toBe(expected);
      expect(preparePayload).toHaveBeenCalledTimes(1);
      expect(installPayload).toHaveBeenCalledTimes(1);
    } finally {
      process.chdir(previousCwd);
      rmSync(rootDir, { recursive: true, force: true });
    }
  });
});

describe('resolveExplicitOrInstalledLocalFirstPartyCommand provenance', () => {
  it('refuses managed provenance for a binary planted under the install root with no install record', () => {
    // A local process can create `<installRoot>/current/<binary>` before anything was ever
    // acquired. Nothing verified it, so it must never be classified `managed`: the desktop
    // approval owner offers automatic pairing approval only to a managed CLI, and the approved
    // CLI goes on to claim its own account bearer from the Home.
    const rootDir = mkdtempSync(join(tmpdir(), 'cli-common-planted-binary-'));
    const happierHomeDir = join(rootDir, 'home');
    const plantedPath = join(happierHomeDir, 'cli', 'current', 'happier');

    try {
      mkdirSync(dirname(plantedPath), { recursive: true });
      writeFileSync(plantedPath, '#!/usr/bin/env node\n', 'utf8');
      chmodSync(plantedPath, 0o755);

      expect(resolveExplicitOrInstalledLocalFirstPartyCommand({
        componentId: 'happier-cli',
        releaseRing: 'stable',
        processEnv: {
          HAPPIER_HOME_DIR: happierHomeDir,
          HAPPIER_STACK_REPO_DIR: join(rootDir, 'elsewhere'),
        },
      })).toEqual({ command: plantedPath, provenance: 'override' });
    } finally {
      rmSync(rootDir, { recursive: true, force: true });
    }
  });

  it('reports a real managed install as managed and env/repo commands as override', async () => {
    const rootDir = mkdtempSync(join(tmpdir(), 'cli-common-provenance-'));
    const happierHomeDir = join(rootDir, 'home');
    const managedPath = join(happierHomeDir, 'cli', 'current', 'happier');
    const repoRoot = join(rootDir, 'repo');
    const repoPath = join(repoRoot, 'apps', 'cli', 'bin', 'happier.mjs');
    const envPath = join(rootDir, 'env-happier');
    const stagedPayloadRoot = join(rootDir, 'staged');

    try {
      for (const path of [repoPath, envPath]) {
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(path, '#!/usr/bin/env node\n', 'utf8');
        chmodSync(path, 0o755);
      }

      // The real install path: it writes the payload under `versions/<versionId>` and records
      // `current.version` beside it. That record is what `managed` means.
      mkdirSync(stagedPayloadRoot, { recursive: true });
      writeFileSync(join(stagedPayloadRoot, 'happier'), '#!/usr/bin/env node\n', 'utf8');
      chmodSync(join(stagedPayloadRoot, 'happier'), 0o755);
      await installVersionedPayload({
        componentId: 'happier-cli',
        versionId: '0.3.0',
        payloadRoot: stagedPayloadRoot,
        releaseRing: 'stable',
        processEnv: { HAPPIER_HOME_DIR: happierHomeDir },
      });

      expect(resolveExplicitOrInstalledLocalFirstPartyCommand({
        componentId: 'happier-cli',
        releaseRing: 'stable',
        envVarNames: DEFAULT_HAPPIER_CLI_ENV_VAR_NAMES,
        processEnv: {
          HAPPIER_HOME_DIR: happierHomeDir,
          HAPPIER_STACK_REPO_DIR: repoRoot,
          [DEFAULT_HAPPIER_CLI_ENV_VAR_NAMES[0]]: envPath,
        },
      })).toEqual({ command: envPath, provenance: 'override' });

      expect(resolveExplicitOrInstalledLocalFirstPartyCommand({
        componentId: 'happier-cli',
        releaseRing: 'stable',
        processEnv: {
          HAPPIER_HOME_DIR: happierHomeDir,
          HAPPIER_STACK_REPO_DIR: repoRoot,
        },
      })).toEqual({ command: repoPath, provenance: 'override' });

      expect(resolveExplicitOrInstalledLocalFirstPartyCommand({
        componentId: 'happier-cli',
        releaseRing: 'stable',
        processEnv: {
          HAPPIER_HOME_DIR: happierHomeDir,
          HAPPIER_STACK_REPO_DIR: join(rootDir, 'elsewhere'),
        },
      })).toEqual({ command: managedPath, provenance: 'managed' });

      // The binary alone is not enough: with the install record removed the very same runnable
      // payload is `override`, because nothing here recorded an install that was verified.
      rmSync(join(happierHomeDir, 'cli', 'current.version'), { force: true });
      expect(resolveExplicitOrInstalledLocalFirstPartyCommand({
        componentId: 'happier-cli',
        releaseRing: 'stable',
        processEnv: {
          HAPPIER_HOME_DIR: happierHomeDir,
          HAPPIER_STACK_REPO_DIR: join(rootDir, 'elsewhere'),
        },
      })).toEqual({ command: managedPath, provenance: 'override' });
    } finally {
      rmSync(rootDir, { recursive: true, force: true });
    }
  });
});
