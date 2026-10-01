import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { SystemTaskExecutionRunner } from '@happier-dev/cli-common/systemTasks';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createDaemonServiceStatusHandler } from './daemonService.js';

async function collectResult(handler: SystemTaskExecutionRunner, params: unknown) {
  const iterator = handler(params, { taskId: 'test-task', signal: new AbortController().signal, now: Date.now, emit: () => undefined });
  for (;;) {
    const next = await iterator.next();
    if (next.done) return next.value;
  }
}

/**
 * A real npm-layout `happier` on PATH (the process boundary): `<prefix>/bin/happier` → the
 * package's entry, answering `daemon status --json` with `statusScript`.
 */
function installNpmCli(rootDir: string, statusScript: string): string {
  const packageRoot = join(rootDir, 'npm-global', 'lib', 'node_modules', '@happier-dev', 'cli');
  mkdirSync(join(packageRoot, 'bin'), { recursive: true });
  writeFileSync(join(packageRoot, 'package.json'), JSON.stringify({ name: '@happier-dev/cli' }), 'utf8');
  writeFileSync(join(packageRoot, 'bin', 'happier.mjs'), `#!/usr/bin/env node\n${statusScript}\n`, 'utf8');
  chmodSync(join(packageRoot, 'bin', 'happier.mjs'), 0o755);
  const npmBin = join(rootDir, 'npm-global', 'bin');
  mkdirSync(npmBin, { recursive: true });
  const command = join(npmBin, 'happier');
  symlinkSync(join(packageRoot, 'bin', 'happier.mjs'), command);
  vi.stubEnv('PATH', `${npmBin}:${process.env.PATH ?? ''}`);
  return command;
}

const tempDirs: string[] = [];
afterEach(() => {
  vi.unstubAllEnvs();
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function createComputer(): string {
  const rootDir = mkdtempSync(join(tmpdir(), 'hsetup-status-cli-choice-'));
  tempDirs.push(rootDir);
  vi.stubEnv('HAPPIER_HOME_DIR', join(rootDir, 'home'));
  // Outside any checkout, so no repo-local developer CLI answers.
  vi.stubEnv('HAPPIER_STACK_REPO_DIR', join(rootDir, 'elsewhere'));
  vi.stubEnv('HAPPIER_BOOTSTRAP_CLI_PATH', '');
  vi.stubEnv('HAPPIER_BOOTSTRAP_HAPPIER_PATH', '');
  return rootDir;
}

(process.platform === 'win32' ? describe.skip : describe)('daemon.service.status.v1 and the one-CLI choice (R12, 0.3)', () => {
  it('reads with the CLI a new terminal runs until the question is answered, and reports that CLI with its removal command', async () => {
    const rootDir = createComputer();
    const command = installNpmCli(rootDir, "process.stdout.write(JSON.stringify({ daemon: { running: true }, service: { installed: true }, auth: { machineId: 'm-1', needsAuth: false } }));");

    const result = await collectResult(createDaemonServiceStatusHandler(), { target: { kind: 'local' }, surface: 'desktop.ui' });

    expect(result).toMatchObject({
      machineId: 'm-1',
      cliChoice: {
        mode: null,
        otherCli: { command, origin: 'npm', removalCommand: 'npm uninstall -g @happier-dev/cli', updateCommand: 'npm install -g @happier-dev/cli@latest' },
      },
    });
  });

  it('names a status read that fails on a CLI nobody chose yet as the question setup has to ask', async () => {
    const rootDir = createComputer();
    const command = installNpmCli(rootDir, "process.stderr.write('Unknown command'); process.exit(3);");

    await expect(collectResult(createDaemonServiceStatusHandler(), { target: { kind: 'local' }, surface: 'desktop.ui' }))
      .rejects.toMatchObject({ code: 'cli_choice_required', message: expect.stringContaining(command) });
  });
});
