import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { resolveRootScriptWorkspaceTargets } from './rootScriptWorkspaceTargets.ts';
import { selectSharedPackageTestCommands } from './sharedPackageTestCommands.ts';

const rootPackage = JSON.parse(readFileSync('package.json', 'utf8'));

for (const [lane, expectedCommands] of Object.entries({
  unit: [
    ...selectSharedPackageTestCommands('local').map(({ args }) => args),
    ...['@happier-dev/plugin-sdk', '@happier-dev/plugin-ui', '@happier-dev/sdk', '@happier-dev/app']
      .map((name) => ['workspace', name, 'test']),
    ['workspace', '@happier-dev/cli', 'test:unit'],
    ['--cwd', 'apps/server', 'test:unit'],
    ['--cwd', 'apps/stack', 'test:unit'],
  ],
  integration: [
    ['workspace', '@happier-dev/app', 'test:integration'],
    ['workspace', '@happier-dev/cli', 'test:integration'],
    ['--cwd', 'apps/server', 'test:integration'],
    ['--cwd', 'apps/stack', 'test:integration'],
  ],
  'shared-packages': selectSharedPackageTestCommands('ci').map(({ args }) => args),
})) {
  test(`root ${lane} preserves dispatch and attempts every selected command after failures`, () => {
    assert.equal(rootPackage.scripts[`test:${lane}`], `apps/stack/bin/hstack-exec --script=test:${lane}:local`);
    const scriptBody = rootPackage.scripts[`test:${lane}:local`] + (lane === 'shared-packages' ? ' --mode ci' : '');
    assert.deepEqual(
      resolveRootScriptWorkspaceTargets({ ...rootPackage.scripts, [`test:${lane}:local`]: scriptBody }, `test:${lane}`),
      expectedCommands.map(([selector, workspace, scriptName]) => ({
        packageName: selector === 'workspace' ? workspace : null,
        workspaceDirectory: selector === '--cwd' ? workspace : null,
        scriptName,
      })),
      'inventory and workflow parity must see every actually executed workspace',
    );
    const fixture = mkdtempSync(join(tmpdir(), 'happier-root-tests-'));
    try {
      const log = join(fixture, 'calls.jsonl');
      const yarn = join(fixture, 'yarn.cjs');
      // Only the package-manager process is stubbed; exercise the actual dispatched script.
      writeFileSync(yarn, `#!/usr/bin/env node\nconst fs = require('node:fs');\nconst args = process.argv.slice(2);\nfs.appendFileSync(process.env.ROOT_TEST_CALLS, JSON.stringify(args) + '\\n');\nprocess.exit(args.includes('apps/stack') ? 0 : 1);\n`, { mode: 0o755 });
      if (process.platform === 'win32') {
        writeFileSync(join(fixture, 'yarn.cmd'), `@"${process.execPath}" "${yarn}" %*\r\n`);
      } else {
        writeFileSync(join(fixture, 'yarn'), readFileSync(yarn), { mode: 0o755 });
      }
      const result = spawnSync(scriptBody, {
        shell: true,
        encoding: 'utf8',
        env: { ...process.env, PATH: `${fixture}${delimiter}${process.env.PATH}`, npm_execpath: yarn, ROOT_TEST_CALLS: log },
      });
      assert.equal(result.error, undefined);
      assert.notEqual(result.status, 0, result.stdout + result.stderr);
      assert.deepEqual(readFileSync(log, 'utf8').trim().split('\n').map((line) => JSON.parse(line)), expectedCommands);
      assert.match(result.stderr, lane === 'shared-packages' ? /Shared package test suite failures:/ : /Root .* test suite failures:/);
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });
}

test('the shared package entry dispatches through hstack to the canonical runner', () => {
  assert.equal(
    rootPackage.scripts['test:shared-packages'],
    'apps/stack/bin/hstack-exec --script=test:shared-packages:local',
  );
  assert.equal(
    rootPackage.scripts['test:shared-packages:local'],
    'node --experimental-strip-types scripts/testing/runSharedPackageTests.ts',
  );
  assert.deepEqual(
    resolveRootScriptWorkspaceTargets(rootPackage.scripts, 'test:shared-packages'),
    selectSharedPackageTestCommands('local').flatMap(({ args }) =>
      resolveRootScriptWorkspaceTargets({ test: `yarn ${args.join(' ')}` }, 'test')),
  );
});
