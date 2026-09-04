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
// owns the copy and the exact-set verification; `buildBrowserIrohAssets.mjs` owns
// producing the inputs, and it fails loudly rather than best-effort.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** Kept in lockstep with `sources/sync/runtime/browserIroh/assets.ts`. */
export const BROWSER_IROH_ASSET_DIRECTORY = 'vendor/iroh';
export const BROWSER_IROH_WORKER_ASSET = 'happier-iroh-worker.js';
export const BROWSER_IROH_WASM_GLUE_ASSET = 'happier_iroh_wasm.js';
export const BROWSER_IROH_WASM_BINARY_ASSET = 'happier_iroh_wasm_bg.wasm';

/**
 * Everything the app must be able to fetch: the generated wasm binary, the
 * JavaScript glue that loads it, and the SharedWorker bootstrap. Runtime
 * packaging contains bytes only (Lane 06 amendment A9) — the wasm-bindgen
 * declaration files stay build/typecheck artifacts in the wasm build output;
 * nothing fetches them at runtime, so they are not staged into a web output.
 */
export const BROWSER_IROH_PACKAGED_ASSETS = [
  BROWSER_IROH_WORKER_ASSET,
  BROWSER_IROH_WASM_GLUE_ASSET,
  BROWSER_IROH_WASM_BINARY_ASSET,
];

/**
 * The licence and NOTICE texts of the locked Cargo graph the packaged WASM was
 * built from, produced by the one evidence owner in `@happier-dev/iroh-native`
 * (Lane 06 amendment A10). The browser carrier redistributes that graph exactly
 * as the native carriers do, so the obligations ship with the bytes instead of
 * only next to a native artifact. Nothing fetches it at runtime; it is staged,
 * recorded, and verified so a web output cannot be published without it.
 */
export const BROWSER_IROH_NOTICES_ASSET = 'THIRD-PARTY-NOTICES.txt';

/** Everything a complete browser Iroh carrier contains: runtime bytes plus their licence evidence. */
export const BROWSER_IROH_STAGED_FILES = [
  ...BROWSER_IROH_PACKAGED_ASSETS,
  BROWSER_IROH_NOTICES_ASSET,
];

/** The wasm-bindgen runtime outputs copied straight through, keyed by their generated name. */
const GENERATED_ASSETS = [
  BROWSER_IROH_WASM_GLUE_ASSET,
  BROWSER_IROH_WASM_BINARY_ASSET,
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
 * output directory; `workerBundlePath` is the bundled SharedWorker entry;
 * `noticesPath` is the locked-Cargo licence evidence for the graph that WASM was
 * built from. The asset directory is replaced rather than merged, so a renamed
 * or removed asset cannot linger and be served next to a newer one.
 */
export function materializeBrowserIrohAssets({
  outputRoot,
  generatedDir,
  workerBundlePath,
  noticesPath,
}) {
  const assetDir = resolveBrowserIrohAssetDir(outputRoot);

  const sources = new Map([
    [BROWSER_IROH_WORKER_ASSET, workerBundlePath],
    [BROWSER_IROH_NOTICES_ASSET, noticesPath],
  ]);
  for (const name of GENERATED_ASSETS) {
    sources.set(name, join(generatedDir, name));
  }

  const missing = [...sources.entries()]
    .filter(([, path]) => !path || !existsSync(path))
    .map(([name, path]) => `${name} (${path ?? 'no path supplied'})`);
  if (missing.length > 0) {
    throw new Error(
      `browser Iroh packaging is missing produced inputs:\n  ${missing.join('\n  ')}`,
    );
  }

  rmSync(assetDir, { recursive: true, force: true });
  mkdirSync(assetDir, { recursive: true });

  const files = [];
  for (const name of BROWSER_IROH_STAGED_FILES) {
    const bytes = readFileSync(sources.get(name));
    writeFileSync(join(assetDir, name), bytes);
    files.push({ name, bytes: bytes.byteLength, sha256: sha256(bytes) });
  }

  // The digests are returned to the build that produced them — build evidence,
  // not a served file. A hash document published beside the very bytes it
  // describes attests nothing (anything that can replace an asset can replace
  // its record), so Lane 06 amendment A10 removed it rather than keep a
  // self-signed integrity claim in the web output.
  return { assetDir, files };
}

/**
 * Verifies the exact file set packaged into `outputRoot`.
 *
 * `'missing'` means that output was built without browser Iroh assets, which is
 * a valid configuration: the runtime host check reports the carrier unavailable
 * rather than reaching for an absent module. `'stale'` is a failure, because it
 * means the served directory is not the exact set this build produces — a file
 * short, a file empty, or a file the build never wrote.
 */
export function verifyBrowserIrohAssets({ outputRoot }) {
  const assetDir = resolveBrowserIrohAssetDir(outputRoot);
  if (!existsSync(assetDir)) {
    return { status: 'missing', assetDir };
  }

  const problems = [];
  const expectedNames = new Set(BROWSER_IROH_STAGED_FILES);
  for (const name of BROWSER_IROH_STAGED_FILES) {
    const path = join(assetDir, name);
    if (!existsSync(path)) {
      problems.push(`${name} is not present`);
      continue;
    }
    // A zero-byte asset is an interrupted or failed copy, and it 404s nothing:
    // the browser fetches it and fails inside the worker instead.
    if (statSync(path).size === 0) {
      problems.push(`${name} is present but empty`);
    }
  }

  // A file the build did not write is served just as readily as one it did, so
  // a leftover is a failure rather than a curiosity.
  for (const name of readdirSync(assetDir)) {
    if (!expectedNames.has(name)) {
      problems.push(`${name} is present but was not produced by the build`);
    }
  }

  return problems.length > 0
    ? { status: 'stale', assetDir, problems }
    : { status: 'ok', assetDir, files: [...BROWSER_IROH_STAGED_FILES] };
}

export function formatBrowserIrohAssetVerification(result) {
  switch (result.status) {
    case 'ok':
      return `browser Iroh assets verified in ${result.assetDir}`;
    case 'missing':
      return `browser Iroh assets are not packaged in ${result.assetDir}`;
    default:
      return `browser Iroh assets do not match the build in ${result.assetDir}:\n  ${result.problems.join('\n  ')}`;
  }
}
