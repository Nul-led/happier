import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  BROWSER_IROH_ASSET_MANIFEST,
  BROWSER_IROH_PACKAGED_ASSETS,
  BROWSER_IROH_WASM_BINARY_ASSET,
  BROWSER_IROH_WASM_GLUE_ASSET,
  BROWSER_IROH_WORKER_ASSET,
  materializeBrowserIrohAssets,
  resolveBrowserIrohAssetDir,
  verifyBrowserIrohAssets,
} from './browserIrohAssetPackaging.mjs';

/** A wasm-bindgen `--target web` output directory plus a bundled worker. */
function createProducedInputs(root, { glue = 'export default async () => {};\n', wasm = [0, 97, 115, 109] } = {}) {
  const generatedDir = join(root, 'generated');
  mkdirSync(generatedDir, { recursive: true });
  writeFileSync(join(generatedDir, BROWSER_IROH_WASM_GLUE_ASSET), glue);
  writeFileSync(join(generatedDir, BROWSER_IROH_WASM_BINARY_ASSET), Buffer.from(wasm));
  writeFileSync(join(generatedDir, 'happier_iroh_wasm.d.ts'), 'export declare const x: 1;\n');
  writeFileSync(join(generatedDir, 'happier_iroh_wasm_bg.wasm.d.ts'), 'export declare const y: 1;\n');

  const workerBundlePath = join(root, BROWSER_IROH_WORKER_ASSET);
  writeFileSync(workerBundlePath, 'self.onconnect = () => {};\n');
  return { generatedDir, workerBundlePath };
}

/**
 * A repository-shaped sandbox: the shared source tree the app is built from
 * (`ui/public`, which every Expo export — web, Tauri, native — copies verbatim)
 * next to a per-target web output root.
 */
function withTargets(run) {
  const root = mkdtempSync(join(tmpdir(), 'happier-iroh-assets-'));
  const sourcePublicDir = join(root, 'ui', 'public');
  mkdirSync(sourcePublicDir, { recursive: true });
  const outputRoot = join(root, 'web-dist');
  mkdirSync(outputRoot, { recursive: true });
  try {
    return run({ root, sourcePublicDir, outputRoot });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test('packages every declared asset into the web output root it was given', () => {
  withTargets(({ root, outputRoot }) => {
    const inputs = createProducedInputs(root);
    const { assetDir, manifest } = materializeBrowserIrohAssets({ outputRoot, ...inputs });

    // The output root is the directory served at the app's base URL, so the
    // packaged path is exactly the URL the runtime asset rule resolves.
    assert.equal(assetDir, join(outputRoot, 'vendor', 'iroh'));
    assert.deepEqual(
      manifest.files.map((file) => file.name),
      BROWSER_IROH_PACKAGED_ASSETS,
    );
    assert.equal(verifyBrowserIrohAssets({ outputRoot }).status, 'ok');
  });
});

test('a web build stages nothing into the shared source tree a Tauri/native export copies', () => {
  withTargets(({ root, sourcePublicDir, outputRoot }) => {
    const inputs = createProducedInputs(root);
    materializeBrowserIrohAssets({ outputRoot, ...inputs });

    // Nothing may be written to the source `public/` tree: it is shared by every
    // target and is not cleaned between exports.
    assert.equal(existsSync(join(sourcePublicDir, 'vendor')), false);

    // A later Tauri/native export copies that source tree verbatim into its own
    // output; with nothing staged there it cannot inherit the web assets.
    const tauriOutputRoot = join(root, 'tauri-dist');
    cpSync(sourcePublicDir, tauriOutputRoot, { recursive: true });
    assert.equal(verifyBrowserIrohAssets({ outputRoot: tauriOutputRoot }).status, 'missing');

    // ...while the web output it was actually built for still carries them.
    assert.equal(verifyBrowserIrohAssets({ outputRoot }).status, 'ok');
  });
});

test('two targets packaged back to back each keep their own exact bytes', () => {
  withTargets(({ root }) => {
    const first = join(root, 'first-out');
    const second = join(root, 'second-out');
    const firstInputs = createProducedInputs(join(root, 'a'), { glue: 'export default async () => 1;\n' });
    const secondInputs = createProducedInputs(join(root, 'b'), { glue: 'export default async () => 2;\n' });

    // Interleaved the way two builds sharing one checkout are: neither may
    // observe or clobber the other's assets.
    const firstPackaged = materializeBrowserIrohAssets({ outputRoot: first, ...firstInputs });
    const secondPackaged = materializeBrowserIrohAssets({ outputRoot: second, ...secondInputs });

    assert.equal(verifyBrowserIrohAssets({ outputRoot: first }).status, 'ok');
    assert.equal(verifyBrowserIrohAssets({ outputRoot: second }).status, 'ok');
    assert.notEqual(
      firstPackaged.manifest.files.find((file) => file.name === BROWSER_IROH_WASM_GLUE_ASSET).sha256,
      secondPackaged.manifest.files.find((file) => file.name === BROWSER_IROH_WASM_GLUE_ASSET).sha256,
    );
    assert.equal(
      readFileSync(join(first, 'vendor', 'iroh', BROWSER_IROH_WASM_GLUE_ASSET), 'utf8'),
      'export default async () => 1;\n',
    );
  });
});

test('records the exact packaged bytes so a swapped asset is detectable', () => {
  withTargets(({ root, outputRoot }) => {
    const inputs = createProducedInputs(root);
    materializeBrowserIrohAssets({ outputRoot, ...inputs });

    const glueOnDisk = join(resolveBrowserIrohAssetDir(outputRoot), BROWSER_IROH_WASM_GLUE_ASSET);
    writeFileSync(glueOnDisk, 'export default async () => { /* tampered */ };\n');

    const verification = verifyBrowserIrohAssets({ outputRoot });
    assert.equal(verification.status, 'stale');
    assert.ok(
      verification.problems.some((problem) => problem.includes(BROWSER_IROH_WASM_GLUE_ASSET)),
    );
  });
});

test('is deterministic: the same inputs produce the same manifest', () => {
  withTargets(({ root, outputRoot }) => {
    const inputs = createProducedInputs(root);
    const first = materializeBrowserIrohAssets({ outputRoot, ...inputs });
    const second = materializeBrowserIrohAssets({ outputRoot, ...inputs });

    assert.deepEqual(second.manifest, first.manifest);
  });
});

test('replaces the directory so a renamed asset cannot linger beside a new one', () => {
  withTargets(({ root, outputRoot }) => {
    const inputs = createProducedInputs(root);
    materializeBrowserIrohAssets({ outputRoot, ...inputs });

    const strayPath = join(resolveBrowserIrohAssetDir(outputRoot), 'happier_iroh_wasm_old.js');
    writeFileSync(strayPath, 'export default 1;\n');
    assert.equal(verifyBrowserIrohAssets({ outputRoot }).status, 'stale');

    materializeBrowserIrohAssets({ outputRoot, ...inputs });
    assert.equal(verifyBrowserIrohAssets({ outputRoot }).status, 'ok');
  });
});

test('reports an unpackaged output as missing rather than failing it', () => {
  withTargets(({ outputRoot }) => {
    // Browser Iroh assets are optional at build time; the runtime host check
    // reports the carrier unavailable instead of reaching for an absent module.
    assert.equal(verifyBrowserIrohAssets({ outputRoot }).status, 'missing');
  });
});

test('refuses to package a partially produced build', () => {
  withTargets(({ root, outputRoot }) => {
    const inputs = createProducedInputs(root);
    rmSync(join(inputs.generatedDir, BROWSER_IROH_WASM_BINARY_ASSET));

    assert.throws(
      () => materializeBrowserIrohAssets({ outputRoot, ...inputs }),
      /missing produced inputs/u,
    );
    assert.equal(verifyBrowserIrohAssets({ outputRoot }).status, 'missing');
  });
});

test('refuses to package without an explicit output root', () => {
  withTargets(({ root }) => {
    const inputs = createProducedInputs(root);
    // There is no implicit shared destination to fall back to: a caller that
    // does not name its target cannot package at all.
    assert.throws(
      () => materializeBrowserIrohAssets({ ...inputs }),
      /output root/u,
    );
    assert.throws(() => verifyBrowserIrohAssets({}), /output root/u);
  });
});

test('rejects a manifest that does not describe the packaged asset set', () => {
  withTargets(({ root, outputRoot }) => {
    const inputs = createProducedInputs(root);
    materializeBrowserIrohAssets({ outputRoot, ...inputs });

    const manifestPath = join(resolveBrowserIrohAssetDir(outputRoot), BROWSER_IROH_ASSET_MANIFEST);
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    manifest.files = manifest.files.filter((file) => file.name !== BROWSER_IROH_WORKER_ASSET);
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

    const verification = verifyBrowserIrohAssets({ outputRoot });
    assert.equal(verification.status, 'stale');
  });
});
