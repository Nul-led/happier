import type { PluginContributionIdentityV1 } from '@happier-dev/protocol';
import { buildQualifiedPluginContributionKey } from '@happier-dev/protocol';

import type { IconName } from '@/components/ui/icons/Icon';
import {
    resolvePluginSurfaceDestinationIcon,
    resolvePluginSurfaceDestinationLabel,
} from '@/components/plugins/surfaces/pluginSurfaceDestinations';
import { createPluginLocalizedTextResolver } from '@/sync/domains/plugins/ui/i18n';
import type { PluginUiPolicyEvaluationContext } from '@/sync/domains/plugins/ui/policy';
import type { PluginUiProjectionModel } from '@/sync/domains/plugins/ui/projection';
import { selectRenderablePluginInlineSurfacePlacementsForRole } from '@/sync/domains/plugins/ui/surfacePlacementSelectors';
import type { SessionPluginRuntimeState } from '@/components/sessions/plugins/useSessionPluginRuntime';

/**
 * What the Board's **From plugins…** picker may offer.
 *
 * This is a projection over the canonical `sessionWidget` inventory selector —
 * NOT a widget catalog, store or second contribution registry. It adds exactly
 * two decisions the selector cannot make: naming a row for a person, and
 * refusing to offer a qualified identity that the mount resolver would later
 * reject as ambiguous.
 */

const SESSION_WIDGET_ROLE = 'sessionWidget' as const;

export type SessionWidgetCandidate = Readonly<{
    /** Exactly what the created item persists; no renderer, version or generation. */
    surface: PluginContributionIdentityV1;
    /** The contribution's own localized title, used as the new item's title. */
    title: string;
    /** The installed plugin's display name. */
    pluginName: string;
    /** True when another installed plugin presents the same display name. */
    sharedPluginName: boolean;
    icon: IconName;
}>;

export function selectSessionWidgetCandidates(
    projection: PluginUiProjectionModel | null | undefined,
    policyContext?: PluginUiPolicyEvaluationContext,
): readonly SessionWidgetCandidate[] {
    if (!projection) return EMPTY_CANDIDATES;
    const placements = selectRenderablePluginInlineSurfacePlacementsForRole(
        projection,
        SESSION_WIDGET_ROLE,
        policyContext,
    );

    // A duplicate qualified identity is a projection violation. The mount
    // resolver fails closed on it, so offering it here would create an item that
    // can never mount.
    const occurrences = new Map<string, number>();
    for (const placement of placements) {
        const key = buildQualifiedPluginContributionKey(placement.binding.surface);
        occurrences.set(key, (occurrences.get(key) ?? 0) + 1);
    }

    const localize = createPluginLocalizedTextResolver({ projection });
    const displayNameCounts = new Map<string, number>();
    for (const installed of Object.values(projection.installedPackagesById)) {
        const name = installed.displayName.trim();
        displayNameCounts.set(name, (displayNameCounts.get(name) ?? 0) + 1);
    }

    const candidates: SessionWidgetCandidate[] = [];
    for (const placement of placements) {
        const surface = placement.binding.surface;
        if (occurrences.get(buildQualifiedPluginContributionKey(surface)) !== 1) continue;
        const installed = projection.installedPackagesById[surface.pluginId];
        // A projected contribution whose package row is absent has no truthful
        // provenance to show; the person cannot tell what they are adding.
        if (!installed) continue;
        const pluginName = installed.displayName.trim();
        candidates.push(Object.freeze({
            surface,
            title: resolvePluginSurfaceDestinationLabel(placement, localize),
            pluginName,
            sharedPluginName: (displayNameCounts.get(pluginName) ?? 0) > 1,
            icon: resolvePluginSurfaceDestinationIcon(placement),
        }));
    }
    return Object.freeze(candidates);
}

/**
 * The one executable creation projection consumed by BOTH Add visibility and
 * the picker rows. A retained catalog is useful for existing-widget provenance,
 * but it is not current authority to create a new executable reference.
 */
export function selectCurrentSessionWidgetCandidates(input: Readonly<{
    runtime: SessionPluginRuntimeState;
    boardFeatureEnabled: boolean;
    canEdit: boolean;
    policyContext: PluginUiPolicyEvaluationContext;
}>): readonly SessionWidgetCandidate[] {
    if (!input.boardFeatureEnabled || !input.canEdit
        || input.runtime.phase !== 'current'
        || !input.runtime.interactionEnabled) {
        return EMPTY_CANDIDATES;
    }
    return selectSessionWidgetCandidates(
        input.runtime.pluginUiProjection,
        input.policyContext,
    );
}

const EMPTY_CANDIDATES: readonly SessionWidgetCandidate[] = Object.freeze([]);
