import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

import { ensureWorkspacePackagesBuiltByName } from '../../../../scripts/workspaces/ensureWorkspacePackagesBuilt.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');

function resolveCurrentBunTarget() {
  const os = process.platform === 'win32' ? 'windows' : process.platform;
  return `bun-${os}-${process.arch}`;
}

function compileServer({ entrypoint, outfile }) {
  const result = spawnSync(
    process.env.HAPPIER_BUN_PATH || 'bun',
    [
      join(repoRoot, 'packages', 'cli-common', 'scripts', 'buildServerBunBinary.mjs'),
      `--target=${resolveCurrentBunTarget()}`,
      `--entrypoint=${entrypoint}`,
      `--outfile=${outfile}`,
      '--external=redis',
    ],
    { cwd: repoRoot, encoding: 'utf8' },
  );
  assert.equal(
    result.status,
    0,
    `server Bun graph must stay server-safe without an Expo/React Native external\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
  );
  assert.ok(statSync(outfile).size > 0, `compiled server binary is empty: ${outfile}`);
}

test('the server and daemon Bun graphs do not reach Expo or React Native source', async () => {
  const outputDir = mkdtempSync(join(tmpdir(), 'happier-node-bundle-import-boundary-'));
  try {
    await ensureWorkspacePackagesBuiltByName(
      repoRoot,
      ['@happier-dev/iroh-native', '@happier-dev/cli-common'],
      { quiet: false, env: process.env },
    );

    const componentArtifacts = await import(pathToFileURL(join(
      repoRoot,
      'packages',
      'cli-common',
      'dist',
      'componentArtifacts',
      'index.js',
    )).href);
    // The canonical workspace owner has prepared the two changed package roots. Keep
    // the real installed-workspace synchronization below, but do not turn the
    // probe into a second whole-workspace build/publisher: the remaining
    // package roots are the already-prepared inputs to this boundary.
    const usePreparedWorkspacePackageRoots = async (_repoRoot, packageNames) => ({
      ok: true,
      built: [],
      skipped: packageNames,
    });
    const preparedWorkspacePublication = await componentArtifacts
      .prepareCliBinaryArtifactWorkspacePublication({
        repoRoot,
        ensureWorkspacePackagesBuiltByName: usePreparedWorkspacePackageRoots,
      });

    const packageNodeEntry = join(repoRoot, 'packages', 'iroh-native', 'dist', 'nodeNative.js');
    const installedNodeEntry = join(
      repoRoot,
      'apps',
      'cli',
      'node_modules',
      '@happier-dev',
      'iroh-native',
      'dist',
      'nodeNative.js',
    );
    assert.equal(
      readFileSync(installedNodeEntry, 'utf8'),
      readFileSync(packageNodeEntry, 'utf8'),
      'CLI workspace preparation must publish the current Node-only Iroh entry',
    );

    for (const entrypointName of ['main.light.ts', 'main.ts']) {
      compileServer({
        entrypoint: join(repoRoot, 'apps', 'server', 'sources', entrypointName),
        outfile: join(outputDir, `happier-server-${entrypointName}`),
      });
    }

    const daemonPayloadDir = join(outputDir, 'daemon-payload');
    const daemonTarget = componentArtifacts.resolveCurrentBinaryTarget({
      availableTargets: componentArtifacts.CLI_BINARY_TARGETS,
    });
    const daemon = await componentArtifacts.buildCliBinaryArtifactCodePayload({
      repoRoot,
      payloadDir: daemonPayloadDir,
      target: daemonTarget,
      externals: [],
      preparedWorkspacePublication,
      ensureWorkspacePackagesBuiltByName: usePreparedWorkspacePackageRoots,
    });
    assert.ok(
      statSync(join(daemonPayloadDir, daemon.executableName)).size > 0,
      'compiled daemon binary must be non-empty',
    );
  } finally {
    rmSync(outputDir, { recursive: true, force: true });
  }
});
