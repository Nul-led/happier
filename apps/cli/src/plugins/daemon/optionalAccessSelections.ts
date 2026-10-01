import type { PluginManifestHostAccessV2 } from '@happier-dev/protocol';

import { createDefaultPluginAccessScopeRegistry } from '@/plugins/store/install/accessScopeRegistry';

import type { PluginResourceSelection } from './changeContract';
import type { CanonicalPluginManifest } from '@/plugins/manifest/types';
import type { PluginAccessSelection } from '@/plugins/store/install/accessScopeRegistry';
import { preserveValidPluginOptionalSelections } from './updateReviewPolicy';

export function createSelectedPluginOptionalAccess(params: Readonly<{
  pluginId: string;
  declarations: PluginManifestHostAccessV2['optional'];
  decisions: readonly PluginResourceSelection[];
  selectedAtMs: number;
}>) {
  const declarations = new Map(params.declarations.map((request) => [request.id, request]));
  const seen = new Set<string>();
  const registry = createDefaultPluginAccessScopeRegistry();

  return Object.freeze(params.decisions.flatMap((decision) => {
    if (seen.has(decision.accessId)) throw new Error(`Duplicate optional access decision '${decision.accessId}'`);
    seen.add(decision.accessId);
    const declaration = declarations.get(decision.accessId);
    if (!declaration) throw new Error(`Unknown optional access decision '${decision.accessId}'`);
    if (!decision.selected) return [];
    return [registry.createSelection({
      pluginId: params.pluginId,
      accessId: declaration.id,
      capability: declaration.capability,
      scope: declaration.scope,
      selectedAtMs: params.selectedAtMs,
    })];
  }));
}

/**
 * Applies only the optional-resource choices present in one decision and
 * preserves every still-valid incumbent choice the decision did not mention.
 * Delta-only authority review therefore cannot silently revoke an unrelated
 * optional grant merely because that category was not shown.
 */
export function updateSelectedPluginOptionalAccess(params: Readonly<{
  pluginId: string;
  manifest: CanonicalPluginManifest;
  existing: readonly PluginAccessSelection[];
  decisions: readonly PluginResourceSelection[];
  selectedAtMs: number;
}>): readonly PluginAccessSelection[] | null {
  const preserved = preserveValidPluginOptionalSelections(
    params.pluginId,
    params.manifest,
    params.existing,
  );
  if (!preserved) return null;
  const decidedAccessIds = new Set(params.decisions.map((decision) => decision.accessId));
  const selected = createSelectedPluginOptionalAccess({
    pluginId: params.pluginId,
    declarations: params.manifest.hostAccess.optional,
    decisions: params.decisions,
    selectedAtMs: params.selectedAtMs,
  });
  return Object.freeze([
    ...preserved.filter((selection) => !decidedAccessIds.has(selection.accessId)),
    ...selected,
  ]);
}
