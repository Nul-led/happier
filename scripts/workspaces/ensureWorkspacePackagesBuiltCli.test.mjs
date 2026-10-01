import assert from 'node:assert/strict';
import test from 'node:test';

import {
  parseWorkspaceBuildArgs,
  runWorkspacePackageBuild,
} from './ensureWorkspacePackagesBuiltCli.mjs';

test('the root package-build adapter delegates one package set to the canonical currentness owner', async () => {
  const calls = [];
  const result = await runWorkspacePackageBuild({
    repoRoot: '/repo',
    packageNames: ['alpha', 'beta', 'alpha'],
    ensureWorkspacePackagesBuiltByNameImpl: async (repoRoot, packageNames, options) => {
      calls.push({ repoRoot, packageNames, options });
      return { ok: true, built: ['beta'], skipped: [] };
    },
    publishBundledPluginArtifactsAfterWorkspaceBuildImpl: async () => false,
  });

  assert.deepEqual(calls, [{
    repoRoot: '/repo',
    packageNames: ['alpha', 'beta'],
    options: { publicationMode: 'live' },
  }]);
  assert.deepEqual(result, { ok: true, built: ['beta'], skipped: [] });
});

test('the root package-build adapter rejects an empty package selection', async () => {
  await assert.rejects(
    runWorkspacePackageBuild({ repoRoot: '/repo', packageNames: [] }),
    /requires at least one workspace package name/,
  );
});

test('the root package-build adapter prepares component dependency closures through the canonical owner', async () => {
  const calls = [];
  const result = await runWorkspacePackageBuild({
    repoRoot: '/repo',
    componentDirs: ['apps/cli', 'apps/server', 'apps/cli'],
    ensureWorkspacePackagesBuiltForComponentImpl: async (componentDir, options) => {
      calls.push({ componentDir, options });
      return { ok: true, built: [componentDir.split('/').at(-1)], skipped: [] };
    },
    publishBundledPluginArtifactsAfterWorkspaceBuildImpl: async () => false,
  });

  assert.deepEqual(calls, [
    { componentDir: '/repo/apps/cli', options: { publicationMode: 'live' } },
    { componentDir: '/repo/apps/server', options: { publicationMode: 'live' } },
  ]);
  assert.deepEqual(result, { ok: true, built: ['cli', 'server'], skipped: [] });
});

test('the root package-build adapter publishes the deduplicated rebuilt union once after every build', async () => {
  const events = [];
  const env = { HAPPIER_DEV_TARGET_EXECUTION: '1' };
  const result = await runWorkspacePackageBuild({
    repoRoot: '/repo',
    env,
    componentDirs: ['apps/ui', 'apps/cli'],
    ensureWorkspacePackagesBuiltForComponentImpl: async (componentDir) => {
      events.push(`build:${componentDir}`);
      return componentDir.endsWith('/ui')
        ? {
            ok: true,
            built: ['@happier-dev/plugins-inspector', '@happier-dev/plugin-ui'],
            skipped: [],
          }
        : {
            ok: true,
            built: ['@happier-dev/plugins-inspector', '@happier-dev/plugins-triage'],
            skipped: [],
          };
    },
    publishBundledPluginArtifactsAfterWorkspaceBuildImpl: async (options) => {
      events.push(['publish', options]);
      return true;
    },
    rebuildWorkspacesInvalidatedByBundledPluginPublicationImpl: async (options) => {
      events.push(['rebuild-generated', options]);
      return [];
    },
  });

  assert.deepEqual(events, [
    'build:/repo/apps/ui',
    'build:/repo/apps/cli',
    ['publish', {
      repoRoot: '/repo',
      workspaceNames: [
        '@happier-dev/plugins-inspector',
        '@happier-dev/plugin-ui',
        '@happier-dev/plugins-triage',
      ],
      env,
      bundledPluginArtifactPublication: { mode: 'write', targetOwnedOnly: true },
    }],
    ['rebuild-generated', {
      repoRoot: '/repo',
      workspaceNames: [
        '@happier-dev/plugins-inspector',
        '@happier-dev/plugin-ui',
        '@happier-dev/plugins-triage',
      ],
      env,
    }],
  ]);
  assert.deepEqual(result, {
    ok: true,
    built: [
      '@happier-dev/plugins-inspector',
      '@happier-dev/plugin-ui',
      '@happier-dev/plugins-triage',
    ],
    skipped: [],
  });
});

test('the authoritative root package-build adapter retains full publication', async () => {
  const publications = [];
  await runWorkspacePackageBuild({
    repoRoot: '/repo',
    env: {},
    packageNames: ['@happier-dev/plugins-inspector'],
    ensureWorkspacePackagesBuiltByNameImpl: async () => ({
      ok: true,
      built: ['@happier-dev/plugins-inspector'],
      skipped: [],
    }),
    publishBundledPluginArtifactsAfterWorkspaceBuildImpl: async (options) => {
      publications.push(options);
      return false;
    },
  });

  assert.deepEqual(publications, [{
    repoRoot: '/repo',
    workspaceNames: ['@happier-dev/plugins-inspector'],
    env: {},
    bundledPluginArtifactPublication: { mode: 'write' },
  }]);
});

test('the root package-build CLI separates package names from component preparation paths', () => {
  assert.deepEqual(parseWorkspaceBuildArgs([
    '@happier-dev/protocol',
    '--for-component=apps/cli',
    '--for-component=apps/server',
  ]), {
    packageNames: ['@happier-dev/protocol'],
    componentDirs: ['apps/cli', 'apps/server'],
  });
});
