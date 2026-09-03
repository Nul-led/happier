import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const repoRoot = path.resolve(import.meta.dirname, '..', '..');

const SCRIPT_PATH = path.join(
  repoRoot,
  'scripts',
  'pipeline',
  'release',
  'build-ui-web-bundle.mjs',
);

function readScript() {
  return fs.readFileSync(SCRIPT_PATH, 'utf8');
}

test('a fresh ui web release packages the browser Iroh assets into its own export output', () => {
  // Lane 06 A8: the browser Iroh SharedWorker and generated wasm boundary are
  // staged into the selected web output, never into the shared source
  // `apps/ui/public` tree that every other Expo export (Tauri, native) also
  // copies. `expo export` therefore has to run FIRST and produce the output
  // root, and the packaging step writes into that output afterwards.
  const script = readScript();

  const freshPath = script.indexOf('if (!skipBuild) {');
  assert.notEqual(freshPath, -1, 'expected a fresh-build path guarded by skip-build');

  const expoExport = script.indexOf("'expo', 'export'");
  assert.notEqual(expoExport, -1, 'expected the expo web export step');
  assert.ok(expoExport > freshPath, 'the expo export must run inside the fresh-build path');

  const irohPackaging = script.indexOf('buildBrowserIrohAssets.mjs');
  assert.notEqual(irohPackaging, -1, 'expected the browser Iroh asset packaging step');
  assert.ok(
    irohPackaging > expoExport,
    'the browser Iroh assets must be packaged into the export output, after the export produced it',
  );

  assert.ok(
    /buildBrowserIrohAssets\.mjs['"],\s*['"]--output-dir['"],\s*distDir/u.test(script),
    'the packaging step must be given the explicit web output root it packages into',
  );
  assert.ok(
    /['"]expo['"],\s*['"]export['"][\s\S]*?['"]--output-dir['"],\s*distDir/u.test(script),
    'Expo and browser-Iroh packaging must receive the same exact output root',
  );
  assert.ok(
    /mkdtemp\([\s\S]*?ui-web-dist-/u.test(script),
    'a fresh build without --dist-dir must own a unique temporary output root',
  );
  assert.match(
    script,
    /requestedDistDir\s*\? resolve\(repoRoot, requestedDistDir\)/u,
    'relative caller targets must resolve once at the release owner before Yarn and Node consumers use them',
  );
  assert.ok(
    /finally\s*\{[\s\S]*?rm\(distDir,\s*\{\s*recursive:\s*true,\s*force:\s*true\s*\}\)/u.test(script),
    'the release owner must remove its temporary output after materializing the artifact',
  );
});

test('the release builder never stages browser Iroh assets into the shared source tree', () => {
  // A packaging target under `apps/ui/public` would be inherited by the next
  // Tauri or native export from the same checkout.
  const script = readScript();
  assert.ok(
    !/public['"/\\]/u.test(script.slice(script.indexOf('Iroh'))),
    'the release builder must not reference a source public/ packaging target',
  );
});

test('--skip-build requires complete verified browser Iroh assets without rebuilding or mutating them', () => {
  // --skip-build means the caller supplies a prebuilt web output; the browser
  // Iroh assets are whatever that output already carries. The wasm build must
  // run at most once — only on the fresh path — and the skip path may only
  // read: it verifies that the prebuilt output is self-consistent and fails on
  // bytes the build did not produce. Missing assets are incomplete rather than
  // an implicit second browser-disabled release shape.
  const script = readScript();
  assert.equal(script.split('buildBrowserIrohAssets.mjs').length - 1, 1);

  assert.ok(
    script.includes('verifyBrowserIrohAssets'),
    'expected the prebuilt output to be verified',
  );
  const skipPath = script.indexOf('} else {');
  assert.notEqual(skipPath, -1, 'expected an explicit skip-build branch');
  assert.ok(
    script.indexOf('verifyBrowserIrohAssets({ outputRoot: distDir })') > skipPath,
    'the skip-build branch must verify the caller-supplied dist',
  );
  assert.ok(
    /verification\.status !== 'ok'/u.test(script),
    'every non-ok verification result, including missing, must fail the release',
  );
});
