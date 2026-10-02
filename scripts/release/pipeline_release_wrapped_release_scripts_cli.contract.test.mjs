import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createReleaseCliDryRunEnv } from './releaseCliDryRunTestkit.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..');

test('release-compute-deploy-plan executes hermetic planning without accessing Keychain', () => {
  const root = mkdtempSync(join(tmpdir(), 'happier-hermetic-deploy-plan-'));
  const credentialAccess = join(root, 'credential-access');
  // Substitute only Git's external remote/process boundary, not the deploy planner.
  const fixture = createReleaseCliDryRunEnv({ ...process.env, GITHUB_OUTPUT: '', GITHUB_STEP_SUMMARY: '' });
  writeFileSync(join(root, 'security'), String.raw`#!${process.execPath}
require('node:fs').appendFileSync(${JSON.stringify(credentialAccess)}, 'invoked\n');
process.stderr.write('TEST_KEYCHAIN_ACCESS_FORBIDDEN\n');
process.exit(86);
`, { mode: 0o755 });
  const env = { ...fixture.env, PATH: `${root}${delimiter}${fixture.env.PATH}` };
  try {
    assert.equal(spawnSync('security', [], { env }).status, 86, 'credential trap must be executable');
    assert.equal(readFileSync(credentialAccess, 'utf8'), 'invoked\n');
    writeFileSync(credentialAccess, '');
    const out = execFileSync(process.execPath, [
      resolve(repoRoot, 'scripts', 'pipeline', 'run.mjs'),
      'release-compute-deploy-plan',
      '--deploy-environment', 'production',
      '--source-ref', 'dev',
      '--force-deploy', 'true',
      '--deploy-ui', 'true',
      '--deploy-server', 'false',
      '--deploy-website', 'false',
      '--deploy-docs', 'true',
      '--secrets-source', 'keychain',
      '--keychain-service', 'test-only-no-secret',
    ], { cwd: repoRoot, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    const plan = JSON.parse(out);
    assert.equal(plan.source_sha, '2222222222222222222222222222222222222222');
    assert.equal(plan.deploy_environment, 'production');
    assert.equal(plan.deploy_ui.needed, true);
    assert.equal(plan.deploy_server.needed, false);
    assert.equal(plan.deploy_docs.needed, true);
    assert.equal(readFileSync(credentialAccess, 'utf8'), '', 'hermetic planning must not access Keychain');
  } finally {
    fixture.cleanup();
    rmSync(root, { recursive: true, force: true });
  }
});

const cases = [
  ['release-sync-installers', 'scripts/pipeline/release/sync-installers.mjs'],
  ['release-bump-version', 'scripts/pipeline/release/bump-version.mjs'],
  ['release-build-cli-binaries', 'scripts/pipeline/release/build-cli-binaries.mjs'],
  ['release-build-hstack-binaries', 'scripts/pipeline/release/build-hstack-binaries.mjs'],
  ['release-build-server-binaries', 'scripts/pipeline/release/build-server-binaries.mjs'],
  ['release-prepare-binary-assets', 'scripts/pipeline/release/prepare-binary-assets.mjs'],
  ['release-publish-manifests', 'scripts/pipeline/release/publish-manifests.mjs'],
  ['release-verify-artifacts', 'scripts/pipeline/release/verify-artifacts.mjs'],
  ['release-compute-changed-components', 'scripts/pipeline/release/compute-changed-components.mjs'],
  ['release-compute-versioned-component-changes', 'scripts/pipeline/release/compute-versioned-component-changes.mjs'],
  ['release-resolve-bump-plan', 'scripts/pipeline/release/resolve-bump-plan.mjs'],
  ['release-compute-deploy-plan', 'scripts/pipeline/release/compute-deploy-plan.mjs'],
  ['release-build-ui-web-bundle', 'scripts/pipeline/release/build-ui-web-bundle.mjs'],
  ['release-validate', 'scripts/pipeline/release-validation/validate-release.mjs'],
];

for (const [subcommand, expectedRelPath] of cases) {
  test(`pipeline CLI supports ${subcommand} dry-run wrapper`, async () => {
    const out = execFileSync(
      process.execPath,
      [resolve(repoRoot, 'scripts', 'pipeline', 'run.mjs'), subcommand, '--dry-run'],
      {
        cwd: repoRoot,
        env: {
          ...process.env,
          GH_TOKEN: '',
          GH_REPO: '',
          GITHUB_REPOSITORY: '',
        },
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 30_000,
      },
    );

    assert.match(out, /\[pipeline\] exec: node /);
    assert.match(out, new RegExp(expectedRelPath.replaceAll('/', '\\/')));
  });
}

test('release-compute-deploy-plan forwards --deploy-environment to the wrapped script', async () => {
  const out = execFileSync(
    process.execPath,
    [
      resolve(repoRoot, 'scripts', 'pipeline', 'run.mjs'),
      'release-compute-deploy-plan',
      '--deploy-environment',
      'production',
      '--source-ref',
      'dev',
      '--force-deploy',
      'false',
      '--deploy-ui',
      'true',
      '--deploy-server',
      'true',
      '--deploy-website',
      'true',
      '--deploy-docs',
      'true',
      '--dry-run',
    ],
    {
      cwd: repoRoot,
      env: {
        ...process.env,
        GH_TOKEN: '',
        GH_REPO: '',
        GITHUB_REPOSITORY: '',
      },
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 30_000,
    },
  );

  assert.match(out, /--deploy-environment/);
  assert.match(out, /production/);
});
