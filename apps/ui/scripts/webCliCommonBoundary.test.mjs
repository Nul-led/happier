import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { Script } from 'node:vm';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { buildProductionProofPageBundle } from '../tools/iroh/buildProductionProofPageBundle.mjs';

const scriptsDir = dirname(fileURLToPath(import.meta.url));
const uiDir = resolve(scriptsDir, '..');
const runtimeControlSource = resolve(
  uiDir,
  'sources/components/settings/server/localControl/PersonalHomeRuntimeControlSection.tsx',
);

test('the web UI runtime-path helper stays on a browser-safe cli-common leaf graph', async () => {
  const source = readFileSync(runtimeControlSource, 'utf8');
  const importMatch = source.match(
    /import\s*\{\s*isHappierRuntimePathWithinRoot\s*\}\s*from\s*['"]([^'"]+)['"]/u,
  );
  assert.ok(importMatch, 'the Personal Home runtime controls must import the canonical path predicate');

  const generatedDir = resolve(uiDir, '.expo', `web-cli-common-boundary-${process.pid}`);
  const outputDir = mkdtempSync(join(tmpdir(), 'happier-web-cli-common-boundary-'));
  const entryFile = join(generatedDir, 'entry.ts');
  try {
    mkdirSync(generatedDir, { recursive: true });
    writeFileSync(
      entryFile,
      `import { isHappierRuntimePathWithinRoot } from ${JSON.stringify(importMatch[1])};\n`
        + `globalThis.__happierRuntimePathBoundary = isHappierRuntimePathWithinRoot('/runtime/bin', '/runtime');\n`,
      'utf8',
    );

    const built = await buildProductionProofPageBundle({
      entryFile,
      outFile: join(outputDir, 'boundary.js'),
      minify: false,
    });
    const normalizedGraph = built.graphFiles.map((file) => file.replaceAll('\\', '/'));
    assert.ok(
      normalizedGraph.some((file) => file.endsWith('/packages/cli-common/src/happierRuntime/runtimePathMatching.ts')),
      'Metro must resolve the canonical cli-common runtime-path owner',
    );
    assert.equal(
      normalizedGraph.some((file) => (
        file.includes('/packages/cli-common/src/firstPartyRuntime/withFirstPartyPayloadMutationLock.')
        || file.includes('/node_modules/proper-lockfile/')
      )),
      false,
      'the browser graph must not reach the Node-only first-party payload lock',
    );

    const bundle = readFileSync(built.bundleFile, 'utf8');
    assert.doesNotThrow(() => new Script(bundle), 'the emitted classic-script bundle must parse');
    for (const forbidden of ['node:module', 'node:fs', 'proper-lockfile']) {
      assert.equal(bundle.includes(forbidden), false, `the emitted web bundle must not contain ${forbidden}`);
    }
  } finally {
    rmSync(generatedDir, { recursive: true, force: true });
    rmSync(outputDir, { recursive: true, force: true });
  }
});
