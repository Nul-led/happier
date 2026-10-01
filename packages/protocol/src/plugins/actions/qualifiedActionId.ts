import {
  PluginContributionIdentityV1Schema,
  type PluginContributionIdentityV1,
} from '../contributionIdentity.js';

/** Canonical durable/settings key for one contributed Action. */
export type QualifiedPluginActionId = `${string}/actions/${string}`;

/** Settings, discovery and invocation share this one qualified-identity grammar. */
export function formatQualifiedPluginActionId(
  identity: PluginContributionIdentityV1,
): QualifiedPluginActionId {
  const parsed = PluginContributionIdentityV1Schema.parse(identity);
  return `${parsed.pluginId}/actions/${parsed.localId}`;
}

/** Reads only the canonical qualified contributed-Action spelling. */
export function parseQualifiedPluginActionId(value: unknown): PluginContributionIdentityV1 | null {
  if (typeof value !== 'string') return null;
  const separator = '/actions/';
  const separatorIndex = value.indexOf(separator);
  if (separatorIndex <= 0) return null;
  const parsed = PluginContributionIdentityV1Schema.safeParse({
    pluginId: value.slice(0, separatorIndex),
    localId: value.slice(separatorIndex + separator.length),
  });
  if (!parsed.success || formatQualifiedPluginActionId(parsed.data) !== value) return null;
  return parsed.data;
}
