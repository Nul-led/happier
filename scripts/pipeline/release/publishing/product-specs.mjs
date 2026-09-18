// @ts-check
import { getReleaseProductPublication } from '@happier-dev/release-runtime/releaseProducts';

/**
 * @typedef {{
 *   id: 'cli' | 'hstack' | 'server' | 'runner';
 *   pipelineLabel: string;
 *   publishSurfaceLabel: string;
 *   minisignRequirementLabel: string;
 *   packageJsonPath: string;
 *   patchPackageVersionOnRolling: boolean;
 *   buildScriptPath: string;
 *   artifactsDir: string;
 *   manifestProduct: 'happier' | 'hstack' | 'happier-server' | 'happier-runner';
 *   manifestOutDir: string;
 *   checksumProductStem: string;
 *   rollingTagPrefix: string;
 *   versionTagPrefix: string;
 *   releaseTitleBase: string;
 *   rollingNotesSubject: string;
 *   versionNotesSubject: string;
 *   notarizationEvidenceSuffix: 'cli' | 'hstack' | 'server' | 'runner';
 * }} BinaryPublishProductSpec
 */

/** @type {ReadonlyArray<BinaryPublishProductSpec['id']>} */
export const BINARY_PUBLISH_PRODUCT_IDS = Object.freeze(['cli', 'hstack', 'server', 'runner']);

/** @type {Readonly<Record<BinaryPublishProductSpec['id'], Readonly<BinaryPublishProductSpec>>>} */
const PRODUCT_SPECS = Object.freeze({
  cli: Object.freeze({
    id: 'cli',
    pipelineLabel: 'cli-binaries',
    publishSurfaceLabel: 'CLI binary publishing',
    minisignRequirementLabel: 'CLI release artifacts',
    packageJsonPath: 'apps/cli/package.json',
    patchPackageVersionOnRolling: false,
    buildScriptPath: 'scripts/pipeline/release/build-cli-binaries.mjs',
    artifactsDir: 'dist/release-assets/cli',
    manifestProduct: 'happier',
    manifestOutDir: 'dist/release-assets/cli/manifests',
    checksumProductStem: 'happier',
    ...getReleaseProductPublication('happier'),
    releaseTitleBase: 'Happier CLI',
    rollingNotesSubject: 'CLI binaries',
    versionNotesSubject: 'CLI',
    notarizationEvidenceSuffix: 'cli',
  }),
  hstack: Object.freeze({
    id: 'hstack',
    pipelineLabel: 'hstack-binaries',
    publishSurfaceLabel: 'hstack binary publishing',
    minisignRequirementLabel: 'hstack release artifacts',
    packageJsonPath: 'apps/stack/package.json',
    patchPackageVersionOnRolling: true,
    buildScriptPath: 'scripts/pipeline/release/build-hstack-binaries.mjs',
    artifactsDir: 'dist/release-assets/stack',
    manifestProduct: 'hstack',
    manifestOutDir: 'dist/release-assets/stack/manifests',
    checksumProductStem: 'hstack',
    ...getReleaseProductPublication('hstack'),
    releaseTitleBase: 'Happier Stack',
    rollingNotesSubject: 'hstack binaries',
    versionNotesSubject: 'hstack',
    notarizationEvidenceSuffix: 'hstack',
  }),
  server: Object.freeze({
    id: 'server',
    pipelineLabel: 'server-runtime',
    publishSurfaceLabel: 'server runtime publishing',
    minisignRequirementLabel: 'server runtime release artifacts',
    packageJsonPath: 'apps/server/package.json',
    patchPackageVersionOnRolling: false,
    buildScriptPath: 'scripts/pipeline/release/build-server-binaries.mjs',
    artifactsDir: 'dist/release-assets/server',
    manifestProduct: 'happier-server',
    manifestOutDir: 'dist/release-assets/server/manifests',
    checksumProductStem: 'happier-server',
    ...getReleaseProductPublication('happier-server'),
    releaseTitleBase: 'Happier Server',
    rollingNotesSubject: 'server runtime release',
    versionNotesSubject: 'Server runtime',
    notarizationEvidenceSuffix: 'server',
  }),
  runner: Object.freeze({
    id: 'runner',
    pipelineLabel: 'runner-binaries',
    publishSurfaceLabel: 'Runner binary publishing',
    minisignRequirementLabel: 'Runner release artifacts',
    packageJsonPath: 'apps/cli/package.json',
    patchPackageVersionOnRolling: false,
    buildScriptPath: 'scripts/pipeline/release/build-runner-binaries.mjs',
    artifactsDir: 'dist/release-assets/runner',
    manifestProduct: 'happier-runner',
    manifestOutDir: 'dist/release-assets/runner/manifests',
    checksumProductStem: 'happier-runner',
    ...getReleaseProductPublication('happier-runner'),
    releaseTitleBase: 'Happier Runner',
    rollingNotesSubject: 'Runner binaries',
    versionNotesSubject: 'Runner',
    notarizationEvidenceSuffix: 'runner',
  }),
});

/**
 * @param {string} productId
 * @returns {Readonly<BinaryPublishProductSpec>}
 */
export function getBinaryPublishProductSpec(productId) {
  const spec = PRODUCT_SPECS[/** @type {BinaryPublishProductSpec['id']} */ (productId)];
  if (!spec) {
    throw new Error(`Unknown binary publish product: ${productId}`);
  }
  return spec;
}
