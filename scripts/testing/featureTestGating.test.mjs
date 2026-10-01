import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

test('Vitest config feature gating consumes authored Protocol policy without externalized dist', async () => {
  // Vite bundles config inputs before installing the test source resolver.
  const result = await build({
    entryPoints: [fileURLToPath(new URL('./featureTestGating.ts', import.meta.url))],
    bundle: true, packages: 'external', platform: 'node', format: 'esm',
    write: false, metafile: true,
  });
  const imports = Object.values(result.metafile.outputs).flatMap(output => output.imports);
  assert.equal(imports.some(entry => entry.path === '@happier-dev/protocol'), false);
  assert.ok(Object.keys(result.metafile.inputs).some(path => path.endsWith('packages/protocol/src/features/catalog.ts')));
  const policy = await import('data:text/javascript;base64,' + Buffer.from(result.outputFiles[0].text).toString('base64'));
  assert.ok(policy.resolveDisabledFeatureIdsForTests({ HAPPIER_TEST_FEATURES_DENY: 'automations' }).has('workflows'));
  assert.equal(policy.resolveDisabledFeatureIdsForTests({}).size, 0);
});
