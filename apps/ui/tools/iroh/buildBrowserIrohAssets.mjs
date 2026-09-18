#!/usr/bin/env node
// The one producer of the packaged browser Iroh assets (Lane 06 A7.2/A7.5).
//
// Reuses the A7.1 build owner (`packages/iroh-native/scripts/verify-browser-iroh-wasm.mjs`)
// for the wasm32 build, the transport-contract deny-list, and the wasm-bindgen
// generation, then bundles the SharedWorker entry and materializes both into the
// app's web static root.
//
// This is deliberately NOT best-effort: an enabled build that cannot produce the
// assets fails, because a half-packaged asset directory would be served.
// A build that does not run this step leaves the directory absent, and the
// runtime host check reports the browser Iroh carrier unavailable.
//
// The web output root is always explicit (Lane 06 A8). There is no default
// source destination: the assets belong to the one web output that asked for
// them, so that a Tauri, Electron, or native export from the same checkout
// cannot inherit a browser wasm endpoint it has no use for.
//
// Usage:
//   node apps/ui/tools/iroh/buildBrowserIrohAssets.mjs --output-dir <web output>
//   node apps/ui/tools/iroh/buildBrowserIrohAssets.mjs --check --output-dir <web output>
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import esbuild from 'esbuild';

import { generateIrohNativeReleaseEvidence } from '../../../../packages/iroh-native/scripts/generate-native-release-evidence.mjs';
import { buildBrowserIrohWasm } from '../../../../packages/iroh-native/scripts/verify-browser-iroh-wasm.mjs';
import {
  BROWSER_IROH_NOTICES_ASSET,
  BROWSER_IROH_SBOM_ASSET,
  BROWSER_IROH_WORKER_ASSET,
  formatBrowserIrohAssetVerification,
  materializeBrowserIrohAssets,
  verifyBrowserIrohAssets,
} from './browserIrohAssetPackaging.mjs';

const toolsIrohDir = dirname(fileURLToPath(import.meta.url));
const uiDir = resolve(toolsIrohDir, '..', '..');

const WORKER_ENTRY = resolve(
  uiDir,
  'sources',
  'sync',
  'runtime',
  'browserIroh',
  'worker',
  'entry.ts',
);

/**
 * Bundles the SharedWorker entry as a browser ES module.
 *
 * The generated wasm boundary is loaded at runtime by URL from the same
 * packaged directory, so it must stay out of this bundle: the entry imports it
 * through a computed specifier, which esbuild leaves untouched.
 */
export async function bundleBrowserIrohWorker({ outFile }) {
  const result = await esbuild.build({
    entryPoints: [WORKER_ENTRY],
    outfile: outFile,
    bundle: true,
    format: 'esm',
    platform: 'browser',
    target: 'es2022',
    // Deterministic bytes: no timestamped banner, no absolute paths in output.
    sourcemap: false,
    legalComments: 'none',
    minify: false,
    metafile: true,
    absWorkingDir: uiDir,
    tsconfig: join(uiDir, 'tsconfig.json'),
  });

  // A worker that quietly pulled `react-native` or the app graph in would ship a
  // second copy of the app inside the endpoint owner.
  const inputs = Object.keys(result.metafile.inputs);
  const leaked = inputs.filter((input) => input.includes('node_modules'));
  if (leaked.length > 0) {
    throw new Error(
      `browser Iroh worker bundle pulled in dependencies it must not carry:\n  ${leaked.join('\n  ')}`,
    );
  }
  return { outFile, inputs };
}

/** Builds the wasm boundary and the worker bundle, then packages both into `outputRoot`. */
export async function buildBrowserIrohAssets({ outputRoot }) {
  const built = buildBrowserIrohWasm();

  const stagingDir = mkdtempSync(join(tmpdir(), 'happier-iroh-worker-'));
  try {
    const workerBundlePath = join(stagingDir, BROWSER_IROH_WORKER_ASSET);
    await bundleBrowserIrohWorker({ outFile: workerBundlePath });

    // The WASM this build just produced redistributes the same locked Cargo
    // graph as the native carriers, so it carries the same SBOM, licence, and
    // NOTICE evidence. They come from the one evidence owner rather than a
    // browser-specific inventory of the same dependencies.
    const noticesPath = join(stagingDir, BROWSER_IROH_NOTICES_ASSET);
    const sbomPath = join(stagingDir, BROWSER_IROH_SBOM_ASSET);
    const evidence = await generateIrohNativeReleaseEvidence({});
    writeFileSync(noticesPath, evidence.notices, 'utf8');
    writeFileSync(sbomPath, evidence.sbom, 'utf8');

    const packaged = materializeBrowserIrohAssets({
      outputRoot,
      generatedDir: built.outDir,
      workerBundlePath,
      noticesPath,
      sbomPath,
    });
    return { ...packaged, measurements: built.measurements };
  } finally {
    rmSync(stagingDir, { recursive: true, force: true });
  }
}

function readOutputRoot(argv) {
  // Last wins, so a caller can override the target a wrapper script supplied.
  const index = argv.lastIndexOf('--output-dir');
  const raw = index === -1 ? '' : String(argv[index + 1] ?? '').trim();
  if (!raw || raw.startsWith('--')) {
    throw new Error(
      '--output-dir <web output> is required: browser Iroh assets are packaged into the web output '
      + 'that build owns, never into a shared source tree other export targets copy',
    );
  }
  return resolve(process.cwd(), raw);
}

async function main() {
  const outputRoot = readOutputRoot(process.argv);
  const checkOnly = process.argv.includes('--check');
  if (checkOnly) {
    const verification = verifyBrowserIrohAssets({ outputRoot });
    process.stdout.write(`${formatBrowserIrohAssetVerification(verification)}\n`);
    if (verification.status !== 'ok') process.exitCode = 1;
    return;
  }

  const packaged = await buildBrowserIrohAssets({ outputRoot });
  const verification = verifyBrowserIrohAssets({ outputRoot });
  if (verification.status !== 'ok') {
    throw new Error(formatBrowserIrohAssetVerification(verification));
  }
  process.stdout.write(
    `${JSON.stringify(
      { assetDir: packaged.assetDir, files: packaged.files, measurements: packaged.measurements },
      null,
      2,
    )}\n`,
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
