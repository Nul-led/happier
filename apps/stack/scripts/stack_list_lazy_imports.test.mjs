import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';

const execFileAsync = promisify(execFile);

test('stack list does not load Protocol before listing stacks', async () => {
  const fixtureDir = await mkdtemp(join(tmpdir(), 'hstack-list-imports-'));
  try {
    const loaderPath = join(fixtureDir, 'reject-protocol.mjs');
    await writeFile(loaderPath, `
export async function resolve(specifier, context, nextResolve) {
  if (specifier.includes('@happier-dev/protocol')) {
    throw new Error('stack list loaded Protocol: ' + specifier);
  }
  return nextResolve(specifier, context);
}
`);
    for (const args of [['list', '--json'], ['--json', 'list'], ['list']]) {
      const { stdout } = await execFileAsync(process.execPath, [
        '--no-warnings',
        '--experimental-loader', loaderPath,
        join(import.meta.dirname, 'stack.mjs'),
        ...args,
      ], {
        cwd: join(import.meta.dirname, '..'),
        env: { ...process.env, HAPPIER_STACK_STORAGE_DIR: fixtureDir },
      });
      if (args.includes('--json')) {
        assert.deepEqual(JSON.parse(stdout), { stacks: [] });
      } else {
        assert.equal(stdout, '[stack] no stacks found\n');
      }
    }
  } finally {
    await rm(fixtureDir, { recursive: true, force: true });
  }
});
