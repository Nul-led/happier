import assert from 'node:assert/strict';
import test from 'node:test';
import { validateExactRollingPublishVersion } from '../lib/rolling-version-allocation.mjs';
import { getBinaryPublishProductSpec } from './product-specs.mjs';

test('Runner publication is a separate immutable ZIP product rooted at its scoped entrypoint', () => {
  assert.deepEqual(getBinaryPublishProductSpec('runner'), {
    id: 'runner', pipelineLabel: 'runner-binaries', publishSurfaceLabel: 'Runner binary publishing',
    minisignRequirementLabel: 'Runner release artifacts', packageJsonPath: 'apps/cli/package.json',
    patchPackageVersionOnRolling: false, buildScriptPath: 'scripts/pipeline/release/build-runner-binaries.mjs',
    artifactsDir: 'dist/release-assets/runner', manifestProduct: 'happier-runner',
    manifestOutDir: 'dist/release-assets/runner/manifests', checksumProductStem: 'happier-runner',
    rollingTagPrefix: 'runner', versionTagPrefix: 'runner-v', releaseTitleBase: 'Happier Runner',
    rollingNotesSubject: 'Runner binaries', versionNotesSubject: 'Runner', notarizationEvidenceSuffix: 'runner',
  });
});

test('Runner publication participates in canonical rolling version validation', () => {
  assert.equal(validateExactRollingPublishVersion({
    productId: 'runner',
    channel: 'publicdev',
    baseVersion: '0.3.0',
    version: '0.3.0-dev.7',
  }), '0.3.0-dev.7');
});
