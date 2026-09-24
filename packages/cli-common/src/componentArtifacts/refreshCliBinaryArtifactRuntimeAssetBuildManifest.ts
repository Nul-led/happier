import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import cliDistBuildManifest from '../../cliDistBuildManifest.cjs';

const EXPECTED_POST_PROJECTION_MANIFEST_FAILURES = new Set([
  'build_manifest_file_count_mismatch',
  'build_manifest_fingerprint_mismatch',
]);

export function refreshCliBinaryArtifactClosureBuildManifest(
  params: Readonly<{ payloadDir: string }>,
): void {
  const entrypoint = join(params.payloadDir, 'package-dist', 'index.mjs');
  const previous = cliDistBuildManifest.readCliDistBuildManifest(entrypoint);
  if (previous.ok) return;
  if (!EXPECTED_POST_PROJECTION_MANIFEST_FAILURES.has(previous.reason)
    || !previous.manifest || !previous.manifestPath) {
    throw new Error(`[cli-dist-manifest] cannot refresh projected artifact manifest: ${previous.reason}`);
  }
  // Projection changes the closure, not its build provenance or runtime identity.
  // The canonical builder validates and recomputes closure fields; keep the
  // admitted artifact metadata, including the recorded managed runtime asset.
  const manifest = {
    ...previous.manifest,
    ...cliDistBuildManifest.buildCliDistManifest(entrypoint, previous.manifest),
  };
  writeFileSync(previous.manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
}

export function writeCliBinaryArtifactRuntimeAssetBuildManifest(
  params: Readonly<{
    payloadDir: string;
    relativePath: string;
    workspaceRuntimeIdentity?: string;
  }>,
): void {
  refreshCliBinaryArtifactClosureBuildManifest(params);
  if (params.workspaceRuntimeIdentity) {
    cliDistBuildManifest.writeCliDistWorkspaceRuntimeIdentity({
      entrypoint: join(params.payloadDir, 'package-dist', 'index.mjs'),
      workspaceRuntimeIdentity: params.workspaceRuntimeIdentity,
    });
  }
  cliDistBuildManifest.writeCliRuntimeAssetBuildManifest({
    runtimeRoot: params.payloadDir,
    entrypoint: join(params.payloadDir, 'package-dist', 'index.mjs'),
    relativePath: params.relativePath,
  });
}

export function refreshCliBinaryArtifactRuntimeAssetBuildManifest(
  params: Readonly<{ payloadDir: string }>,
): void {
  cliDistBuildManifest.refreshCliRuntimeAssetBuildManifest({
    runtimeRoot: params.payloadDir,
    entrypoint: join(params.payloadDir, 'package-dist', 'index.mjs'),
  });
}
