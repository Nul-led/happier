// @ts-check

/**
 * Single owner of the internal dependency versions an SDK publication run can
 * promise to a shipped example manifest.
 *
 * Shipped example manifests keep the workspace source placeholder in the
 * repository; publication rewrites them to versions this run actually
 * publishes. The SDK pair publishes version-locked with the candidate, so only
 * those two are known here. `channels-protocol` publishes on its own optional
 * flag and `triage-protocol` has no publication path at all, so this run can
 * promise no version of either. An example bound to one of them fails the pack
 * rewrite until the release owner publishes that package or removes the
 * example from the published selection.
 *
 * Two consumers read this map, and they must not diverge: the release pipeline
 * feeds it to the pack sandbox that rewrites published example manifests, and
 * the Plugin SDK package inventory test uses it to prove the package `files`
 * selection never ships an example whose placeholder dependency has no
 * rewrite.
 *
 * @param {string} version exact version this publication run publishes for the
 *   version-locked plugin SDK pair
 * @returns {Record<string, string>}
 */
export function publicSdkExampleDependencyVersions(version) {
  return {
    '@happier-dev/plugin-sdk': version,
    '@happier-dev/plugin-ui': version,
  };
}
