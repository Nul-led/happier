import type { PluginContributionIdentityV1 } from '@happier-dev/protocol';
import { buildQualifiedPluginContributionKey } from '@happier-dev/protocol';

import type { IconName } from '@/components/ui/icons/Icon';
import {
    resolvePluginSurfaceDestinationIcon,
    resolvePluginSurfaceDestinationLabel,
} from '@/components/plugins/surfaces/pluginSurfaceDestinations';
import type { SessionPluginRuntimeState } from '@/components/sessions/plugins/useSessionPluginRuntime';
import { createPluginLocalizedTextResolver } from '@/sync/domains/plugins/ui/i18n';
import type { PluginUiPolicyEvaluationContext } from '@/sync/domains/plugins/ui/policy';
import type { PluginUiProjectionModel } from '@/sync/domains/plugins/ui/projection';
import {
    readWidgetHomeDefault,
    selectRenderableWidgetPlacements,
    selectWidgetPlacementsBySurface,
    type WidgetHomeDefault,
    type WidgetPlacement,
    type WidgetTargetKind,
} from '@/sync/domains/plugins/ui/widgetContract';

/**
 * The widgets a host may offer for one target: the Board's **From plugins…**
 * picker (`session`) and Home's sections and Add widgets (`app`).
 *
 * This is a projection over the canonical widget inventory selector — NOT a
 * widget catalog, store or second contribution registry. It adds exactly two
 * decisions the selector cannot make: naming a row for a person, and refusing
 * to offer a qualified identity that the mount resolver would later reject as
 * ambiguous.
 */
export type WidgetCandidate = Readonly<{
    /** Exactly what a placement persists; no renderer, version or generation. */
    surface: PluginContributionIdentityV1;
    /** `pluginId/localId`, the widget's stable qualified key. */
    key: string;
    /** The contribution's own localized title. */
    title: string;
    /** The installed plugin's display name. */
    pluginName: string;
    /** True when another installed plugin presents the same display name. */
    sharedPluginName: boolean;
    icon: IconName;
    /** Whether Home shows it before the person chooses (App target only). */
    homeDefault: WidgetHomeDefault;
}>;

export function selectWidgetCandidates(
    projection: PluginUiProjectionModel | null | undefined,
    target: WidgetTargetKind,
    policyContext?: PluginUiPolicyEvaluationContext,
    placement?: WidgetPlacement,
): readonly WidgetCandidate[] {
    if (!projection) return EMPTY_CANDIDATES;
    const placements = selectRenderableWidgetPlacements(projection, target, policyContext, placement);

    // A duplicate qualified identity is a projection violation. The mount
    // resolver fails closed on it, so offering it here would create an item that
    // can never mount.
    const localize = createPluginLocalizedTextResolver({ projection });
    const displayNameCounts = new Map<string, number>();
    for (const installed of Object.values(projection.installedPackagesById)) {
        const name = installed.displayName.trim();
        displayNameCounts.set(name, (displayNameCounts.get(name) ?? 0) + 1);
    }

    const candidates: WidgetCandidate[] = [];
    for (const placement of placements) {
        const surface = placement.binding.surface;
        const key = buildQualifiedPluginContributionKey(surface);
        if (selectWidgetPlacementsBySurface(projection, surface, target).length !== 1) continue;
        const installed = projection.installedPackagesById[surface.pluginId];
        // A projected contribution whose package row is absent has no truthful
        // provenance to show; the person cannot tell what they are adding.
        if (!installed) continue;
        const pluginName = installed.displayName.trim();
        candidates.push(Object.freeze({
            surface,
            key,
            title: resolvePluginSurfaceDestinationLabel(placement, localize),
            pluginName,
            sharedPluginName: (displayNameCounts.get(pluginName) ?? 0) > 1,
            icon: resolvePluginSurfaceDestinationIcon(placement),
            homeDefault: readWidgetHomeDefault(placement),
        }));
    }
    return candidates.length === 0 ? EMPTY_CANDIDATES : Object.freeze(candidates);
}

/**
 * The one executable creation projection consumed by BOTH the Board's Add
 * visibility and its picker rows. A retained catalog is useful for
 * existing-widget provenance, but it is not current authority to create a new
 * executable reference.
 */
export function selectCurrentSessionWidgetCandidates(input: Readonly<{
    runtime: SessionPluginRuntimeState;
    boardFeatureEnabled: boolean;
    canEdit: boolean;
    policyContext: PluginUiPolicyEvaluationContext;
}>): readonly WidgetCandidate[] {
    if (!input.boardFeatureEnabled || !input.canEdit
        || input.runtime.phase !== 'current'
        || !input.runtime.interactionEnabled) {
        return EMPTY_CANDIDATES;
    }
    return selectWidgetCandidates(input.runtime.pluginUiProjection, 'session', input.policyContext);
}

const EMPTY_CANDIDATES: readonly WidgetCandidate[] = Object.freeze([]);
