import assert from 'node:assert/strict';
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const bunVersionProbe = spawnSync('bun', ['--version'], { encoding: 'utf8' });
const hasPinnedBun = bunVersionProbe.status === 0 && bunVersionProbe.stdout.trim() === '1.3.5';

test('pinned Bun 1.3.5 standalone hardening disables ambient config but cannot disable BUN_BE_BUN', {
  skip: !hasPinnedBun || process.platform !== 'linux' || process.arch !== 'x64',
}, async () => {
  const root = await mkdtemp(join(tmpdir(), 'happier-runner-bun-hardening-'));
  try {
    const entrypoint = join(root, 'entrypoint.mjs');
    const executablePath = join(root, 'runner');
    await writeFile(
      entrypoint,
      'console.log(process.env.HAPPIER_RUNNER_AMBIENT_DOTENV ?? "runner-entry");\n',
      'utf8',
    );
    await writeFile(join(root, '.env'), 'HAPPIER_RUNNER_AMBIENT_DOTENV=dotenv-loaded\n', 'utf8');
    await writeFile(join(root, 'ambient-preload.mjs'), 'console.log("bunfig-loaded");\n', 'utf8');
    await writeFile(join(root, 'bunfig.toml'), 'preload = ["./ambient-preload.mjs"]\n', 'utf8');

    const compile = spawnSync('bun', [
      'build',
      '--compile',
      '--no-cache',
      '--target=bun-linux-x64-baseline',
      entrypoint,
      '--outfile',
      executablePath,
      '--no-compile-autoload-dotenv',
      '--no-compile-autoload-bunfig',
    ], { encoding: 'utf8' });
    assert.equal(compile.status, 0, compile.stderr);
    await chmod(executablePath, 0o755);

    const ordinary = spawnSync(executablePath, [], { cwd: root, encoding: 'utf8' });
    assert.deepEqual({ status: ordinary.status, stdout: ordinary.stdout.trim() }, {
      status: 0,
      stdout: 'runner-entry',
    });

    const hostile = spawnSync(executablePath, [
      '--eval',
      'process.stdout.write("HAPPIER_RUNNER_BUN_DISPATCH_EXECUTED\\n")',
    ], {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, BUN_BE_BUN: '1' },
    });
    assert.deepEqual({ status: hostile.status, stdout: hostile.stdout.trim() }, {
      status: 0,
      stdout: 'bunfig-loaded\nHAPPIER_RUNNER_BUN_DISPATCH_EXECUTED',
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
