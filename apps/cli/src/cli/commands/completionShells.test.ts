import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { captureStdout } from '@/testkit/logger/captureOutput';
import { createTempDirSync, removeTempDirSync } from '@/testkit/fs/tempDir';

import { handleCompletionCliCommand } from './completion';

/**
 * Real shell integration for `happier completion candidates`.
 *
 * Every shell must hand Happier the caller's exact argv words. A word with an
 * embedded space is the discriminating case: a shell integration that rebuilds
 * the command line by joining on spaces splits it and silently completes against
 * the wrong command, which no assertion over a space-joined string can catch.
 * The shim below therefore records argv NUL-delimited.
 */
const SHIM = `#!/usr/bin/env bash
printf '%s\\0' "$@" > "$HAPPIER_ARGV_FILE"
printf 'send session\\n*\\n'
`;

function quoteForPosixShell(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

function shellAvailable(shell: string): boolean {
  const args = shell === 'pwsh' || shell === 'powershell.exe'
    ? ['-NoProfile', '-Command', '$null']
    : ['--version'];
  const result = spawnSync(shell, args, { encoding: 'utf8' });
  return result.error === undefined && result.status === 0;
}

async function readCompletionScript(shell: string): Promise<string> {
  const output = captureStdout();
  try {
    await handleCompletionCliCommand({
      args: ['completion', shell],
      rawArgv: ['happier', 'completion', shell],
      terminalRuntime: null,
    });
    return output.text();
  } finally {
    output.restore();
  }
}

describe('generated shell completion hands Happier exact argv words', () => {
  let workspace = '';
  let binDir = '';
  let argvFile = '';

  beforeEach(() => {
    workspace = createTempDirSync('happier-completion-shells');
    binDir = join(workspace, 'bin');
    mkdirSync(binDir, { recursive: true });
    const shim = join(binDir, 'happier');
    writeFileSync(shim, SHIM, 'utf8');
    chmodSync(shim, 0o755);
    argvFile = join(workspace, 'argv');
  });

  afterEach(() => {
    removeTempDirSync(workspace);
  });

  function recordedArgv(): readonly string[] {
    const raw = readFileSync(argvFile, 'utf8');
    return raw.split('\0').filter((value) => value.length > 0);
  }

  it('preserves a word containing spaces through the bash integration', async () => {
    const script = await readCompletionScript('bash');
    const scriptPath = join(workspace, 'completion.bash');
    writeFileSync(scriptPath, script, 'utf8');

    const result = execFileSync('bash', ['-c', [
      `source ${JSON.stringify(scriptPath)}`,
      'COMP_WORDS=(happier session send "sess 1" "hello world")',
      'COMP_CWORD=4',
      '_happier_completion',
      'printf "%s\\n" "${COMPREPLY[@]}"',
    ].join('\n')], {
      encoding: 'utf8',
      env: { ...process.env, PATH: `${binDir}:${process.env.PATH ?? ''}`, HAPPIER_ARGV_FILE: argvFile },
    });

    expect(recordedArgv()).toEqual(['completion', 'candidates', '--', 'session', 'send', 'sess 1', 'hello world']);
    expect(result.trim().split('\n')).toEqual(['send session', '*']);
  });

  it('preserves shell metacharacters and Unicode through the bash integration', async () => {
    const script = await readCompletionScript('bash');
    const scriptPath = join(workspace, 'completion.bash');
    writeFileSync(scriptPath, script, 'utf8');

    const sentinel = join(workspace, 'sentinel');
    const literal = `$(touch ${sentinel}) ; & | < > "q" \\ 🙂 中文`;
    execFileSync('bash', ['-c', [
      `source ${JSON.stringify(scriptPath)}`,
      `COMP_WORDS=(happier session send ${quoteForPosixShell(literal)} ${quoteForPosixShell('--not-a-flag')})`,
      'COMP_CWORD=3',
      '_happier_completion',
    ].join('\n')], {
      encoding: 'utf8',
      env: { ...process.env, PATH: `${binDir}:${process.env.PATH ?? ''}`, HAPPIER_ARGV_FILE: argvFile },
    });

    expect(recordedArgv().slice(-2)).toEqual([literal, '--not-a-flag']);
    // Happier never re-evaluates shell syntax: the sentinel must not exist.
    expect(() => readFileSync(sentinel)).toThrow();
  });

  const zshAvailable = shellAvailable('zsh');
  it.runIf(zshAvailable)('preserves a word containing spaces through the zsh integration', async () => {
    const script = await readCompletionScript('zsh');
    const scriptPath = join(workspace, 'completion.zsh');
    writeFileSync(scriptPath, script, 'utf8');

    execFileSync('zsh', ['-c', [
      `source ${JSON.stringify(scriptPath)}`,
      `words=(happier session send ${quoteForPosixShell('sess 1')} ${quoteForPosixShell('slash\\🙂 中文')} -- ${quoteForPosixShell('--not-a-flag')})`,
      'compadd() { :; }',
      '_happier_completion',
    ].join('\n')], {
      encoding: 'utf8',
      env: { ...process.env, PATH: `${binDir}:${process.env.PATH ?? ''}`, HAPPIER_ARGV_FILE: argvFile },
    });

    expect(recordedArgv()).toEqual([
      'completion', 'candidates', '--', 'session', 'send', 'sess 1', 'slash\\🙂 中文', '--', '--not-a-flag',
    ]);
  });

  it.skipIf(shellAvailable('fish') === false)('preserves a word containing spaces through the fish integration', async () => {
    const script = await readCompletionScript('fish');
    const scriptPath = join(workspace, 'completion.fish');
    writeFileSync(scriptPath, script, 'utf8');

    execFileSync('fish', ['-c', [
      `source ${JSON.stringify(scriptPath)}`,
      'commandline -r \'happier session send "sess 1" "slash\\\\🙂 中文" -- "--not-a-flag" \'',
      '__happier_completion',
    ].join('\n')], {
      encoding: 'utf8',
      env: { ...process.env, PATH: `${binDir}:${process.env.PATH ?? ''}`, HAPPIER_ARGV_FILE: argvFile },
    });

    expect(recordedArgv()).toEqual([
      'completion', 'candidates', '--', 'session', 'send', 'sess 1', 'slash\\🙂 中文', '--', '--not-a-flag',
    ]);
  });

  it.skipIf(shellAvailable('pwsh') === false)('preserves a word containing spaces through the PowerShell integration', async () => {
    const script = await readCompletionScript('powershell');
    const scriptPath = join(workspace, 'completion.ps1');
    writeFileSync(scriptPath, script, 'utf8');

    execFileSync('pwsh', ['-NoProfile', '-Command', [
      `. ${JSON.stringify(scriptPath)}`,
      `$line = 'happier session send "sess 1" ''slash\\🙂 中文'' -- ''--not-a-flag'' '`,
      'TabExpansion2 $line $line.Length | Out-Null',
    ].join('\n')], {
      encoding: 'utf8',
      env: { ...process.env, PATH: `${binDir}:${process.env.PATH ?? ''}`, HAPPIER_ARGV_FILE: argvFile },
    });

    expect(recordedArgv()).toEqual([
      'completion', 'candidates', '--', 'session', 'send', 'sess 1', 'slash\\🙂 中文', '--', '--not-a-flag',
    ]);
  });
});
