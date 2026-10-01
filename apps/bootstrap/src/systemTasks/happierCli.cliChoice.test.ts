import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { writeHappierCliChoice } from '@happier-dev/cli-common/firstPartyRuntime';
import { SystemTaskExecutionError } from '@happier-dev/cli-common/systemTasks';
import { describe, expect, it, vi } from 'vitest';

import {
  describeUnservedCliChoiceFailure,
  inspectLocalHappierCliChoice,
  readLocalHappierCliChoiceFacts,
} from './happierCli.js';

const posixOnly = process.platform === 'win32' ? describe.skip : describe;

/** The on-disk shape `installVersionedPayload` leaves behind: payload, pointer and version record. */
function writeInstalledPayloadFixture(happierHomeDir: string, versionId: string): void {
  const installRoot = join(happierHomeDir, 'cli');
  for (const dir of [join(installRoot, 'versions', versionId), join(installRoot, 'current')]) {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'happier'), '#!/bin/sh\n', 'utf8');
    chmodSync(join(dir, 'happier'), 0o755);
  }
  writeFileSync(join(installRoot, 'current.version'), `${versionId}\n`, 'utf8');
}

/** An npm global install of the CLI: `<prefix>/bin/happier` → the package's own entry. */
async function withNpmCli(run: (params: Readonly<{ command: string; processEnv: NodeJS.ProcessEnv }>) => Promise<void>): Promise<void> {
  const rootDir = mkdtempSync(join(tmpdir(), 'hsetup-cli-choice-'));
  const packageRoot = join(rootDir, 'npm-global', 'lib', 'node_modules', '@happier-dev', 'cli');
  mkdirSync(join(packageRoot, 'bin'), { recursive: true });
  writeFileSync(join(packageRoot, 'package.json'), JSON.stringify({ name: '@happier-dev/cli' }), 'utf8');
  writeFileSync(join(packageRoot, 'bin', 'happier.mjs'), '#!/bin/sh\n', 'utf8');
  chmodSync(join(packageRoot, 'bin', 'happier.mjs'), 0o755);
  const npmBin = join(rootDir, 'npm-global', 'bin');
  mkdirSync(npmBin, { recursive: true });
  const command = join(npmBin, 'happier');
  symlinkSync(join(packageRoot, 'bin', 'happier.mjs'), command);
  try {
    await run({
      command,
      processEnv: { HAPPIER_HOME_DIR: join(rootDir, 'home'), HAPPIER_STACK_REPO_DIR: join(rootDir, 'elsewhere'), PATH: npmBin },
    });
  } finally {
    rmSync(rootDir, { recursive: true, force: true });
  }
}

// The CLI's `--version` and `server help` are the process boundary; everything else runs for real.
function capableCli(version = '0.3.0', capable = true) {
  return {
    readVersion: vi.fn(async () => version),
    readSetupCapable: vi.fn(async () => capable),
  };
}

posixOnly('the one-CLI question (R12, 0.3)', () => {
  it('asks about a CLI this app did not install, naming its version, path and the commands that remove or update it', async () => {
    await withNpmCli(async ({ command, processEnv }) => {
      await expect(inspectLocalHappierCliChoice({ processEnv }, capableCli())).resolves.toEqual({
        choice: null,
        question: {
          command,
          version: '0.3.0',
          origin: 'npm',
          removalCommand: 'npm uninstall -g @happier-dev/cli',
          updateCommand: 'npm install -g @happier-dev/cli@latest',
          belowSetupFloor: false,
          missing: false,
          keepBlockedBy: null,
        },
      });
    });
  });

  it('counts a CLI that cannot set up a Home without switching the terminal as below the setup floor, and asks again about a kept one', async () => {
    await withNpmCli(async ({ command, processEnv }) => {
      const released02 = capableCli('0.2.13', false);
      await expect(inspectLocalHappierCliChoice({ processEnv }, released02))
        .resolves.toMatchObject({ question: { command, version: '0.2.13', belowSetupFloor: true } });

      await writeHappierCliChoice({ choice: { mode: 'own', command }, processEnv });
      await expect(inspectLocalHappierCliChoice({ processEnv }, released02))
        .resolves.toMatchObject({ question: { command, belowSetupFloor: true } });
      // Once it can, the recorded answer is not asked again.
      await expect(inspectLocalHappierCliChoice({ processEnv }, capableCli()))
        .resolves.toEqual({ choice: { mode: 'own', command }, question: null });
    });
  });

  it('asks once: "Let Happier manage it" is not asked again unless Settings asks to change it', async () => {
    await withNpmCli(async ({ command, processEnv }) => {
      await writeHappierCliChoice({ choice: { mode: 'managed' }, processEnv });
      await expect(inspectLocalHappierCliChoice({ processEnv }, capableCli())).resolves.toEqual({ choice: { mode: 'managed' }, question: null });
      await expect(inspectLocalHappierCliChoice({ processEnv, reconsider: true }, capableCli()))
        .resolves.toMatchObject({ question: { command, origin: 'npm' } });
    });
  });

  it('does not ask an installer user whose terminal runs the managed CLI first; reconsider says what keeping a copy behind it needs (RV3-1)', async () => {
    await withNpmCli(async ({ command, processEnv }) => {
      const happierHomeDir = String(processEnv.HAPPIER_HOME_DIR);
      writeInstalledPayloadFixture(happierHomeDir, '0.3.0');
      mkdirSync(join(happierHomeDir, 'bin'), { recursive: true });
      symlinkSync(join(happierHomeDir, 'cli', 'current', 'happier'), join(happierHomeDir, 'bin', 'happier'));
      const localBin = join(happierHomeDir, '..', 'local-bin');
      mkdirSync(localBin, { recursive: true });
      const installerLink = join(localBin, 'happier');
      symlinkSync(join(happierHomeDir, 'bin', 'happier'), installerLink);
      const env = { ...processEnv, PATH: `${localBin}:${processEnv.PATH}` };

      await expect(inspectLocalHappierCliChoice({ processEnv: env }, capableCli())).resolves.toEqual({ choice: null, question: null });
      await expect(inspectLocalHappierCliChoice({ processEnv: env, reconsider: true }, capableCli()))
        .resolves.toMatchObject({ question: { command, keepBlockedBy: installerLink } });
      // Settings still sees the old copy behind the managed CLI.
      expect(readLocalHappierCliChoiceFacts(env)).toMatchObject({ mode: null, otherCli: { command, origin: 'npm' } });
    });
  });

  it('still asks about a kept CLI that disappeared, by the path it was at, without reading it (R13 b)', async () => {
    await withNpmCli(async ({ command, processEnv }) => {
      await writeHappierCliChoice({ choice: { mode: 'own', command }, processEnv });
      writeInstalledPayloadFixture(String(processEnv.HAPPIER_HOME_DIR), '0.3.0');
      rmSync(command, { force: true });
      const cli = capableCli();

      await expect(inspectLocalHappierCliChoice({ processEnv }, cli)).resolves.toMatchObject({
        choice: { mode: 'own', command },
        question: { command, version: null, missing: true },
      });
      expect(cli.readVersion).not.toHaveBeenCalled();
      const required = new SystemTaskExecutionError('cli_choice_required', 'gone');
      expect(describeUnservedCliChoiceFailure(required, { processEnv })).toBe(required);
    });
  });

  it('never asks while a developer override names the CLI, nor when no other CLI exists', async () => {
    await withNpmCli(async ({ processEnv }) => {
      const cli = capableCli();
      await expect(inspectLocalHappierCliChoice({ processEnv: { ...processEnv, HAPPIER_BOOTSTRAP_CLI_PATH: '/dev/happier' } }, cli))
        .resolves.toMatchObject({ question: null });
      await expect(inspectLocalHappierCliChoice({ processEnv: { ...processEnv, PATH: '' } }, cli))
        .resolves.toEqual({ choice: null, question: null });
      expect(cli.readVersion).not.toHaveBeenCalled();
    });
  });

  it('names a failed read by an unanswered or kept CLI as the question setup still has to ask', async () => {
    await withNpmCli(async ({ command, processEnv }) => {
      const failure = new SystemTaskExecutionError('cli_command_failed', 'Unknown option --server');

      expect(describeUnservedCliChoiceFailure(failure, { processEnv }))
        .toMatchObject({ code: 'cli_choice_required', message: expect.stringContaining(command) });

      await writeHappierCliChoice({ choice: { mode: 'managed' }, processEnv });
      expect(describeUnservedCliChoiceFailure(failure, { processEnv })).toBeNull();

      await writeHappierCliChoice({ choice: { mode: 'own', command }, processEnv });
      expect(describeUnservedCliChoiceFailure(failure, { processEnv })).toMatchObject({ code: 'cli_choice_required' });
      expect(describeUnservedCliChoiceFailure(new SystemTaskExecutionError('cancelled', 'x'), { processEnv })).toBeNull();
      expect(describeUnservedCliChoiceFailure(failure, { processEnv: { ...processEnv, HAPPIER_BOOTSTRAP_CLI_PATH: '/dev/happier' } })).toBeNull();
    });
  });
});
