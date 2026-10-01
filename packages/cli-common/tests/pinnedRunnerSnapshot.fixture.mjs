import assert from 'node:assert/strict';
import { existsSync, mkdirSync, renameSync, utimesSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import cliDistBuildManifest from '../cliDistBuildManifest.cjs';
import { CLI_RUNTIME_SIDECAR_ENTRIES } from '../cliRuntimeSidecars.mjs';
import { BUNDLED_PLUGIN_PUBLICATION_FAILURES_RELATIVE_PATH } from '../bundledPluginPublicationPolicy.mjs';
import {
  PINNED_RUNNER_LAYOUT_VERSION,
  PINNED_RUNNER_MANAGED_PROVIDER_RUNTIME_RELATIVE_PATH,
  readPinnedRunnerSnapshotPublicationIdentity,
  resolvePinnedRunnerSnapshotManagedProviderRuntimeIdentity,
} from '../pinnedRunnerSnapshot.mjs';

// Test-only publication: callers stage their domain-specific bytes first; this owner fills
// the common runtime scaffold and publishes exactly one canonical snapshot identity.
export function publishPinnedRunnerSnapshotFixture({
  stagingRoot,
  snapshotsDir = dirname(stagingRoot),
  workspaceRuntimeIdentity,
  workspaceRuntimePackages,
  publicationFailuresBytes = '[]\n',
  layoutVersion = PINNED_RUNNER_LAYOUT_VERSION,
  builtAt = '2026-08-14T00:00:00.000Z',
  mtimeMs,
}) {
  const stagingEntrypoint = join(stagingRoot, 'package-dist', 'index.mjs');
  mkdirSync(dirname(stagingEntrypoint), { recursive: true });
  if (!existsSync(stagingEntrypoint)) writeFileSync(stagingEntrypoint, 'export {};\n', 'utf8');
  const packageJsonPath = join(stagingRoot, 'package.json');
  if (!existsSync(packageJsonPath)) writeFileSync(packageJsonPath, '{"name":"@happier-dev/cli"}\n', 'utf8');
  for (const sidecar of CLI_RUNTIME_SIDECAR_ENTRIES) {
    const target = join(stagingRoot, 'scripts', ...sidecar);
    if (sidecar.length === 1 && (sidecar[0] === 'runtime' || sidecar[0] === 'shims')) {
      mkdirSync(target, { recursive: true });
    } else if (!existsSync(target)) {
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, 'module.exports = {};\n', 'utf8');
    }
  }
  mkdirSync(join(stagingRoot, 'tools', 'unpacked'), { recursive: true });
  const failuresPath = join(stagingRoot, BUNDLED_PLUGIN_PUBLICATION_FAILURES_RELATIVE_PATH);
  mkdirSync(dirname(failuresPath), { recursive: true });
  writeFileSync(failuresPath, publicationFailuresBytes, 'utf8');
  let { manifest } = cliDistBuildManifest.writeCliDistBuildManifest(stagingEntrypoint, {
    outputDir: dirname(stagingEntrypoint),
    builtAt,
    workspaceRuntimeIdentity,
    ...(workspaceRuntimePackages ? { workspaceRuntimePackages } : {}),
  });
  const managedRuntimeRelativePath = PINNED_RUNNER_MANAGED_PROVIDER_RUNTIME_RELATIVE_PATH.join('/');
  if (existsSync(join(stagingRoot, ...PINNED_RUNNER_MANAGED_PROVIDER_RUNTIME_RELATIVE_PATH))) {
    ({ manifest } = cliDistBuildManifest.writeCliRuntimeAssetBuildManifest({
      runtimeRoot: stagingRoot,
      entrypoint: stagingEntrypoint,
      relativePath: managedRuntimeRelativePath,
    }));
  }
  const runtimeAssetIdentity = resolvePinnedRunnerSnapshotManagedProviderRuntimeIdentity({
    runtimeRoot: stagingRoot,
    entrypoint: stagingEntrypoint,
    manifest,
  });
  const publicationIdentity = readPinnedRunnerSnapshotPublicationIdentity(stagingRoot);
  assert.notEqual(runtimeAssetIdentity, null);
  assert.notEqual(publicationIdentity, null);
  const fingerprint = manifest.fingerprint;
  const snapshotIdentity = `${fingerprint}-${runtimeAssetIdentity}-${workspaceRuntimeIdentity}-${publicationIdentity}-${layoutVersion}`;
  const snapshotRoot = join(snapshotsDir, snapshotIdentity);
  writeFileSync(join(stagingRoot, '.fingerprint'), `${fingerprint}\n`, 'utf8');
  writeFileSync(join(stagingRoot, '.workspace-runtime-identity'), `${workspaceRuntimeIdentity}\n`, 'utf8');
  mkdirSync(snapshotsDir, { recursive: true });
  renameSync(stagingRoot, snapshotRoot);
  if (mtimeMs !== undefined) utimesSync(snapshotRoot, mtimeMs / 1000, mtimeMs / 1000);
  return {
    snapshotsDir,
    snapshotIdentity,
    snapshotRoot,
    snapshotEntrypoint: join(snapshotRoot, 'package-dist', 'index.mjs'),
    fingerprint,
    runtimeAssetIdentity,
    workspaceRuntimeIdentity,
  };
}
