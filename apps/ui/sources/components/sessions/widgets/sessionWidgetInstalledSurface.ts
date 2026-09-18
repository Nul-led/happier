import type { SessionSurfaceItemV1 } from '@happier-dev/protocol/sessions/board';
import {
    resolvePluginUiInlineSurfaceSlotV1,
    type PluginUiInlineSurfaceMountV1,
} from '@happier-dev/protocol/plugins/ui';

import type { SessionPluginRuntimeState } from '@/components/sessions/plugins/useSessionPluginRuntime';
import type { PluginUiInlineSurfacePlacementProjection } from '@/sync/domains/plugins/ui/projection';
import { selectPluginInlineSurfacePlacementsBySurface } from '@/sync/domains/plugins/ui/surfacePlacementSelectors';
import type { PluginSurfacePresentationState } from '@/sync/domains/surfaces/copy/resolveReasonCopy';

/**
 * The exact persisted installed-plugin source arm of a Board item. The record
 * stores a stable qualified surface identity and nothing else: no plugin
 * version, immutable generation, renderer, machine, Artifact or placement.
 */
export type InstalledSessionWidgetSource = Extract<
    SessionSurfaceItemV1['source'],
    Readonly<{ kind: 'installedSurface' }>
>;

/**
 * The correlation result the widget host consumes.
 *
 * This resolver answers exactly one question: does the stored stable reference
 * name one currently projected `sessionWidget` placement for THIS Session? It
 * deliberately makes no availability, currentness, generation, renderer,
 * Artifact, policy or crash decision — those stay with the incumbent
 * `PluginSurfaceHost`/`boundPluginSurfaceController` path once a placement is
 * handed to it.
 *
 * When no exact placement resolves, it returns the canonical presentation
 * owner's own input vocabulary (`state` + `reasonCode`) rather than a widget
 * availability enum: the caller passes it straight to
 * `resolvePluginSurfaceStatePresentation` and renders `SurfaceStateCard` inside
 * the retained widget shell.
 */
export type InstalledSessionWidgetMount = Readonly<{
    /** Present only when exactly one admitted placement matched. */
    placement: PluginUiInlineSurfacePlacementProjection | null;
    /** The Registry-admitted role/presentation pair for this physical host. */
    inlineMount: PluginUiInlineSurfaceMountV1 | null;
    /** Canonical state-presentation input; `null` once a placement resolved. */
    unresolved: Readonly<{
        state: PluginSurfacePresentationState;
        /** Diagnostic-only; unmapped codes localize to the generic line. */
        reasonCode: string;
    }> | null;
}>;

const SESSION_WIDGET_ROLE = 'sessionWidget' as const;

function unresolved(
    state: PluginSurfacePresentationState,
    reasonCode: string,
): InstalledSessionWidgetMount {
    return Object.freeze({
        placement: null,
        inlineMount: null,
        unresolved: Object.freeze({ state, reasonCode }),
    });
}

/**
 * Resolve one stored installed-widget reference against the exact current
 * Session plugin projection.
 *
 * Fails closed on a missing OR duplicate qualified identity: projection order
 * must never appoint an owner for an executable surface. A destination or
 * another inline role that happens to share the local id is not a widget.
 */
export function resolveInstalledSessionWidgetMount(input: Readonly<{
    source: InstalledSessionWidgetSource;
    /** The public embedded presentation this physical host maps onto. */
    presentation: 'content' | 'fill';
    runtime: SessionPluginRuntimeState;
}>): InstalledSessionWidgetMount {
    const slot = resolvePluginUiInlineSurfaceSlotV1(SESSION_WIDGET_ROLE, input.presentation);
    if (!slot) {
        return unresolved('unavailable', 'session_widget_presentation_unadmitted');
    }
    const projection = input.runtime.pluginUiProjection;
    if (!projection) {
        // An establishing projection is loading, not absent: an unfinished
        // fetch must not present a stored widget as a removed surface.
        return input.runtime.phase === 'establishing'
            ? unresolved('loading', 'session_widget_projection_establishing')
            : unresolved('unavailable', 'session_widget_projection_unavailable');
    }
    const placements = selectPluginInlineSurfacePlacementsBySurface(
        projection,
        input.source.surface,
        SESSION_WIDGET_ROLE,
    );
    if (placements.length !== 1) {
        return unresolved(
            'unavailable',
            placements.length === 0
                ? 'session_widget_surface_absent'
                : 'session_widget_surface_ambiguous',
        );
    }
    // The projection normalizer already parsed this binding through
    // `PluginUiSurfaceBindingV1Schema`, whose inline arm enforces the Registry
    // role/target/placement correspondence, and the selector matched the exact
    // qualified identity and role. Re-checking those here would be a second
    // admission owner, not defence in depth.
    return Object.freeze({
        placement: placements[0]!,
        inlineMount: Object.freeze({
            role: SESSION_WIDGET_ROLE,
            presentation: input.presentation,
        }),
        unresolved: null,
    });
}

// Source-identity immutability is NOT decided here. `isSessionSurfaceItemSourceCompatible`
// in `@happier-dev/protocol/sessions/board` is the one owner of that rule, and the
// UI, CLI and server Board mutation paths all consume it to return
// `session_board_source_conflict`. A second UI-local copy of the same comparison
// would be a competing decision-maker for one concept, and the Add picker never
// substitutes a source in place: it creates a new item.
