// Deterministic packaging of the browser Iroh assets (Lane 06 amendments A7.2/A7.5, A8).
//
// The generated wasm-bindgen boundary and the SharedWorker bootstrap are served
// from the app's own origin as static files under `vendor/iroh/`, relative to
// the web output root the build produced.
//
// That root is always named explicitly by the caller — the web export's own
// output directory, or an isolated temporary root for a proof run. It is never
// the shared source `apps/ui/public` tree: every Expo export copies that tree
// verbatim, so assets staged there would be inherited by the next Tauri,
// Electron, or native export from the same checkout, which have no use for a
// browser wasm endpoint and ship the native Iroh implementation instead.
//
// Nothing at runtime reads Cargo's ignored `target/` directory, fetches from a
// CDN, shells out to a system tool, or generates an asset on demand. This module
// owns the copy and the manifest; `buildBrowserIrohAssets.mjs` owns producing the
// inputs, and it fails loudly rather than best-effort.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** Kept in lockstep with `sources/sync/runtime/browserIroh/assets.ts`. */
export const BROWSER_IROH_ASSET_DIRECTORY = 'vendor/iroh';
export const BROWSER_IROH_WORKER_ASSET = 'happier-iroh-worker.js';
export const BROWSER_IROH_WASM_GLUE_ASSET = 'happier_iroh_wasm.js';
export const BROWSER_IROH_WASM_BINARY_ASSET = 'happier_iroh_wasm_bg.wasm';
export const BROWSER_IROH_WASM_TYPES_ASSET = 'happier_iroh_wasm.d.ts';
export const BROWSER_IROH_WASM_BINARY_TYPES_ASSET = 'happier_iroh_wasm_bg.wasm.d.ts';
export const BROWSER_IROH_ASSET_MANIFEST = 'manifest.json';

/**
 * Everything the app must be able to fetch. The wasm-bindgen `.d.ts` files are
 * packaged deliberately: they are the generated boundary's own description of
 * the API the worker consumes, and shipping them beside the module keeps the
 * asset set self-describing rather than requiring a rebuild to inspect it.
 */
export const BROWSER_IROH_PACKAGED_ASSETS = [
  BROWSER_IROH_WORKER_ASSET,
  BROWSER_IROH_WASM_GLUE_ASSET,
  BROWSER_IROH_WASM_BINARY_ASSET,
  BROWSER_IROH_WASM_TYPES_ASSET,
  BROWSER_IROH_WASM_BINARY_TYPES_ASSET,
];

/** The wasm-bindgen outputs copied straight through, keyed by their generated name. */
const GENERATED_ASSETS = [
  BROWSER_IROH_WASM_GLUE_ASSET,
  BROWSER_IROH_WASM_BINARY_ASSET,
  BROWSER_IROH_WASM_TYPES_ASSET,
  BROWSER_IROH_WASM_BINARY_TYPES_ASSET,
];

/**
 * The packaged asset directory inside a web output root — the directory served
 * at the app's base URL, so this path is exactly what the runtime asset URL rule
 * resolves against that origin.
 */
export function resolveBrowserIrohAssetDir(outputRoot) {
  return join(requireOutputRoot(outputRoot), ...BROWSER_IROH_ASSET_DIRECTORY.split('/'));
}

/**
 * There is no implicit destination to fall back to. A caller that cannot name
 * the target it is building for has no business writing browser assets, because
 * the only shared place to put them is the one every other target inherits.
 */
function requireOutputRoot(outputRoot) {
  const root = typeof outputRoot === 'string' ? outputRoot.trim() : '';
  if (!root) {
    throw new Error('browser Iroh packaging requires an explicit web output root');
  }
  return root;
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

/**
 * Copies the produced assets into `outputRoot` and records exactly which bytes
 * were packaged.
 *
 * `outputRoot` is the web output this build owns — the export's output directory
 * or an isolated temporary root. `generatedDir` is a wasm-bindgen `--target web`
 * output directory; `workerBundlePath` is the bundled SharedWorker entry. The
 * asset directory is replaced rather than merged, so a renamed or removed asset
 * cannot linger and be served next to a newer one.
 */
export function materializeBrowserIrohAssets({ outputRoot, generatedDir, workerBundlePath }) {
  const assetDir = resolveBrowserIrohAssetDir(outputRoot);

  const sources = new Map([[BROWSER_IROH_WORKER_ASSET, workerBundlePath]]);
  for (const name of GENERATED_ASSETS) {
    sources.set(name, join(generatedDir, name));
  }

  const missing = [...sources.entries()]
    .filter(([, path]) => !existsSync(path))
    .map(([name, path]) => `${name} (${path})`);
  if (missing.length > 0) {
    throw new Error(
      `browser Iroh packaging is missing produced inputs:\n  ${missing.join('\n  ')}`,
    );
  }

  rmSync(assetDir, { recursive: true, force: true });
  mkdirSync(assetDir, { recursive: true });

  const files = [];
  for (const name of BROWSER_IROH_PACKAGED_ASSETS) {
    const bytes = readFileSync(sources.get(name));
    writeFileSync(join(assetDir, name), bytes);
    files.push({ name, bytes: bytes.byteLength, sha256: sha256(bytes) });
  }

  const manifest = { v: 1, files };
  writeFileSync(
    join(assetDir, BROWSER_IROH_ASSET_MANIFEST),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );

  return { assetDir, manifest };
}

/**
 * Verifies the assets packaged into `outputRoot` against their own manifest.
 *
 * `'missing'` means that output was built without browser Iroh assets, which is
 * a valid configuration: the runtime host check reports the carrier unavailable
 * rather than reaching for an absent module. `'stale'` and `'corrupt'` are
 * failures, because they mean something is being served that the build did not
 * produce.
 */
export function verifyBrowserIrohAssets({ outputRoot }) {
  const assetDir = resolveBrowserIrohAssetDir(outputRoot);
  const manifestPath = join(assetDir, BROWSER_IROH_ASSET_MANIFEST);
  if (!existsSync(manifestPath)) {
    return { status: 'missing', assetDir };
  }

  let manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  } catch (error) {
    return { status: 'corrupt', assetDir, reason: `unreadable manifest: ${error.message}` };
  }
  if (manifest?.v !== 1 || !Array.isArray(manifest.files)) {
    return { status: 'corrupt', assetDir, reason: 'unsupported manifest shape' };
  }

  const recorded = new Map(manifest.files.map((file) => [file.name, file]));
  const problems = [];
  for (const name of BROWSER_IROH_PACKAGED_ASSETS) {
    const file = recorded.get(name);
    if (!file) {
      problems.push(`${name} is not recorded in the manifest`);
      continue;
    }
    const path = join(assetDir, name);
    if (!existsSync(path)) {
      problems.push(`${name} is recorded but not present`);
      continue;
    }
    const bytes = readFileSync(path);
    if (bytes.byteLength !== file.bytes || sha256(bytes) !== file.sha256) {
      problems.push(`${name} does not match the bytes the build recorded`);
    }
  }

  // An asset the manifest does not know about is served just as readily as one
  // it does, so a leftover file is a failure rather than a curiosity.
  const unexpected = readdirSync(assetDir).filter(
    (name) => name !== BROWSER_IROH_ASSET_MANIFEST && !recorded.has(name),
  );
  for (const name of unexpected) {
    problems.push(`${name} is present but was not produced by the build`);
  }

  return problems.length > 0
    ? { status: 'stale', assetDir, problems }
    : { status: 'ok', assetDir, manifest };
}

export function formatBrowserIrohAssetVerification(result) {
  switch (result.status) {
    case 'ok':
      return `browser Iroh assets verified in ${result.assetDir}`;
    case 'missing':
      return `browser Iroh assets are not packaged in ${result.assetDir}`;
    case 'corrupt':
      return `browser Iroh asset manifest is unusable in ${result.assetDir}: ${result.reason}`;
    default:
      return `browser Iroh assets do not match the build in ${result.assetDir}:\n  ${result.problems.join('\n  ')}`;
  }
}
