import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { resolveRootScriptWorkspaceTargets } from './rootScriptWorkspaceTargets.ts';

const rootPackage = JSON.parse(readFileSync('package.json', 'utf8'));

for (const [lane, expectedCommands] of Object.entries({
  unit: [
    ...['privacy-kit', '@happier-dev/protocol', '@happier-dev/peer-mediation', '@happier-dev/transfers',
      '@happier-dev/voice-modelpacks', '@happier-dev/terminal-native', '@happier-dev/sherpa-native',
      '@happier-dev/agents', '@happier-dev/cli-common', '@happier-dev/support', '@happier-dev/connection-supervisor',
      '@happier-dev/session-core', '@happier-dev/bootstrap', '@happier-dev/plugin-sdk', '@happier-dev/plugin-ui', '@happier-dev/sdk',
      '@happier-dev/channels-protocol', '@happier-dev/triage-protocol', '@happier-dev/triage-sources',
      '@happier-dev/ssh-native', '@happier-dev/audio-stream-native', 'docs', '@happier-dev/app']
      .map((name) => ['workspace', name, 'test']),
    ['workspace', '@happier-dev/cli', 'test:unit'],
    ['--cwd', 'apps/server', 'test:unit'],
    ['--cwd', 'packages/relay-server', 'test'],
    ['--cwd', 'apps/stack', 'test:unit'],
  ],
  integration: [
    ['workspace', '@happier-dev/app', 'test:integration'],
    ['workspace', '@happier-dev/cli', 'test:integration'],
    ['--cwd', 'apps/server', 'test:integration'],
    ['--cwd', 'apps/stack', 'test:integration'],
  ],
})) {
  test(`root ${lane} preserves dispatch and attempts every workspace after failures`, () => {
    assert.equal(rootPackage.scripts[`test:${lane}`], `apps/stack/bin/hstack-exec --script=test:${lane}:local`);
    assert.deepEqual(
      resolveRootScriptWorkspaceTargets(rootPackage.scripts, `test:${lane}`),
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
      const result = spawnSync(rootPackage.scripts[`test:${lane}:local`], {
        shell: true,
        encoding: 'utf8',
        env: { ...process.env, PATH: `${fixture}${delimiter}${process.env.PATH}`, npm_execpath: yarn, ROOT_TEST_CALLS: log },
      });
      assert.equal(result.error, undefined);
      assert.notEqual(result.status, 0, result.stdout + result.stderr);
      assert.deepEqual(readFileSync(log, 'utf8').trim().split('\n').map((line) => JSON.parse(line)), expectedCommands);
      assert.match(result.stderr, /Root .* test suite failures:/);
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });
}
