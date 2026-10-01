import semver from 'semver';
import { PLUGIN_UI_HOST_API_VERSION_V1 } from './hostApiDefinition.js';

export * from './hostApiDefinition.js';

/**
 * Compares one explicitly supplied host version with an authored Host API
 * range using ordinary semver prerelease rules.
 */
export function isPluginUiHostApiVersionCompatibleWithVersionV1(
  hostVersion: unknown,
  range: unknown,
): boolean {
  if (typeof hostVersion !== 'string' || typeof range !== 'string') return false;
  const normalizedHostVersion = hostVersion.trim();
  const normalizedRange = range.trim();
  if (
    semver.valid(normalizedHostVersion) === null
    || normalizedRange.length === 0
    || semver.validRange(normalizedRange) === null
  ) return false;
  return semver.satisfies(normalizedHostVersion, normalizedRange);
}

/**
 * The sole range-satisfaction decision for Host API negotiation.
 *
 * The wire carries a semver range, not one spelling of the current range. A
 * host with this initial API therefore accepts every valid range containing
 * the canonical version and refuses malformed or incompatible ranges before
 * advertising any methods.
 */
export function isPluginUiHostApiVersionCompatibleV1(range: unknown): boolean {
  return isPluginUiHostApiVersionCompatibleWithVersionV1(
    PLUGIN_UI_HOST_API_VERSION_V1,
    range,
  );
}
