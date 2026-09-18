import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { withPatchedProcessEnv } from '../testkit/core/env_scope.mjs';
import { ensureMinimalMonorepoLayout } from '../testkit/core/minimal_monorepo_layout.mjs';
import { runNodeCapture } from '../testkit/core/run_node_capture.mjs';
import { withStackEnv } from './stack_environment.mjs';
import { resolveTransientRepoOverrides } from './transient_repo_overrides.mjs';

const stackRootDir = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const envModulePath = join(stackRootDir, 'scripts', 'utils', 'env', 'env.mjs');

async function readChildEnvironment(env) {
  const result = await runNodeCapture([
    '--input-type=module',
    '-e',
    [
      `await import(${JSON.stringify(envModulePath)});`,
      'process.stdout.write(JSON.stringify({',
      '  envFile: process.env.HAPPIER_STACK_ENV_FILE ?? null,',
      '  stackName: process.env.HAPPIER_STACK_STACK ?? null,',
      '  repoDir: process.env.HAPPIER_STACK_REPO_DIR ?? null,',
      '  transientRepoDir: process.env.HAPPIER_STACK_TRANSIENT_REPO_DIR ?? null,',
      '  cliHomeDir: process.env.HAPPIER_STACK_CLI_HOME_DIR ?? null,',
      '  buildFeaturesAllow: process.env.HAPPIER_BUILD_FEATURES_ALLOW ?? null,',
      '}));',
    ].join('\n'),
  ], { cwd: stackRootDir, env });

  assert.equal(result.code, 0, `stderr:\n${result.stderr}\nstdout:\n${result.stdout}`);
  return JSON.parse(result.stdout);
}

test('transient repo override preserves the selected stack identity and policy in the child environment', async (t) => {
  const tmp = await mkdtemp(join(tmpdir(), 'hstack-transient-repo-env-'));
  t.after(() => rm(tmp, { recursive: true, force: true }));

  const stackName = 'consumer-stack';
  const storageDir = join(tmp, 'storage');
  const stackDir = join(storageDir, stackName);
  const persistedRepoDir = join(tmp, 'persisted-repo');
  const transientRepoDir = join(tmp, 'transient-repo');
  const envPath = join(stackDir, 'env');
  const cliHomeDir = join(stackDir, 'cli');
  await Promise.all([
    ensureMinimalMonorepoLayout(persistedRepoDir),
    ensureMinimalMonorepoLayout(transientRepoDir),
    mkdir(stackDir, { recursive: true }),
  ]);
  await writeFile(envPath, [
    `HAPPIER_STACK_STACK=${stackName}`,
    `HAPPIER_STACK_REPO_DIR=${persistedRepoDir}`,
    `HAPPIER_STACK_CLI_HOME_DIR=${cliHomeDir}`,
    'HAPPIER_BUILD_FEATURES_ALLOW=sessions',
    '',
  ].join('\n'), 'utf8');

  withPatchedProcessEnv(t, {
    HAPPIER_STACK_STORAGE_DIR: storageDir,
    HAPPIER_STACK_HOME_DIR: join(tmp, 'home'),
    HAPPIER_STACK_CLI_ROOT_DISABLE: '1',
  });

  const extraEnv = resolveTransientRepoOverrides({
    rootDir: stackRootDir,
    kv: new Map([['--repo', transientRepoDir]]),
  });
  const wrapped = await withStackEnv({
    stackName,
    extraEnv,
    reconcileDaemonRuntimeState: false,
    fn: async ({ env }) => readChildEnvironment(env),
  });

  assert.deepEqual(wrapped, {
    envFile: envPath,
    stackName,
    repoDir: transientRepoDir,
    transientRepoDir,
    cliHomeDir,
    buildFeaturesAllow: 'sessions',
  });

  const arbitraryForeign = await readChildEnvironment({
    ...process.env,
    HAPPIER_STACK_ENV_FILE: envPath,
    HAPPIER_STACK_STACK: stackName,
    HAPPIER_STACK_REPO_DIR: transientRepoDir,
    HAPPIER_STACK_TRANSIENT_REPO_DIR: persistedRepoDir,
    HAPPIER_STACK_CLI_HOME_DIR: cliHomeDir,
    HAPPIER_BUILD_FEATURES_ALLOW: 'stale-policy',
  });
  assert.deepEqual(arbitraryForeign, {
    envFile: null,
    stackName: null,
    repoDir: transientRepoDir,
    transientRepoDir: null,
    cliHomeDir: null,
    buildFeaturesAllow: null,
  });
});
