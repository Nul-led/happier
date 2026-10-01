import type { PluginProjectionV2 } from '@happier-dev/protocol';
import { normalizePluginUiInlineSurfaceBindingV1 } from '@happier-dev/protocol/plugins/ui';

import {
    normalizePluginUiProjection,
    type PluginUiProjectionModel,
} from '@/sync/domains/plugins/ui/projection';
import type { WidgetHomeDefault, WidgetTargetKind } from '@/sync/domains/plugins/ui/widgetContract';
import { WIDGET_ROLE } from '@/sync/domains/plugins/ui/widgetContract';

/**
 * Projected plugin widget placements for host tests (Board picker, Home, the installed-widget arm),
 * through the real Protocol binding normalizer and UI projection normalizer. App widgets carry the
 * `home` default exactly as the daemon projects it onto the row.
 */

export type WidgetFixtureEntry = Readonly<{
    pluginId: string;
    localId: string;
    title?: string;
    target?: WidgetTargetKind;
    homeDefault?: WidgetHomeDefault;
    placements?: readonly ('board' | 'companion' | 'home')[];
    role?: typeof WIDGET_ROLE | 'sessionSubagentDetails';
    entryId?: string;
    availability?: 'available' | 'unavailable';
    featureGate?: string;
    requiredPermissionIds?: readonly string[];
    platforms?: readonly ('web' | 'desktop' | 'ios' | 'android')[];
    occurrenceId?: string;
}>;

function entryId(input: WidgetFixtureEntry): string {
    return input.entryId ?? `surfacePlacement:${input.pluginId}:${input.localId}`;
}

export function widgetProjectionEntry(input: WidgetFixtureEntry) {
    const binding = normalizePluginUiInlineSurfaceBindingV1({
        pluginId: input.pluginId,
        surfaceId: input.localId,
        rendererId: 'widget-native',
        role: input.role ?? WIDGET_ROLE,
        target: { kind: input.target ?? 'session' },
    });
    if (!binding) throw new Error('fixture must use an admitted inline binding');
    return {
        id: entryId(input),
        pluginId: input.pluginId,
        contributionKind: 'surfacePlacement',
        descriptorId: input.localId,
        // The daemon producer stamps every projected UI entry with its exact plugin-slot
        // occurrence; a fixture without one is not a projection the product can produce.
        occurrenceId: input.occurrenceId ?? `${input.pluginId}#1`,
        binding,
        target: binding.target,
        renderer: { kind: 'declarative', contributionId: 'widget-native' },
        display: { title: input.title ?? input.localId },
        ...(input.homeDefault ? { home: { default: input.homeDefault } } : {}),
        ...(input.placements ? { placements: input.placements } : {}),
        ...(input.featureGate ? { featureGate: input.featureGate } : {}),
        ...(input.requiredPermissionIds
            ? { policy: { requiredPermissionIds: input.requiredPermissionIds } }
            : {}),
        ...(input.platforms ? { compatibility: { platforms: input.platforms } } : {}),
        availability: {
            state: input.availability === 'unavailable' ? 'disabled' : 'available',
            reason: input.availability === 'unavailable' ? 'plugin_disabled' : 'available',
            diagnostics: [],
        },
    };
}

export function widgetInstalledPackage(id: string, displayName: string) {
    return { id, displayName, enabled: true, source: { kind: 'local', path: `/plugins/${id}` } };
}

/** A projection holding exactly these widget entries and installed packages. */
export function widgetProjectionOf(
    entries: readonly WidgetFixtureEntry[],
    installedPackagesById: Readonly<Record<string, unknown>> = {},
): PluginUiProjectionModel {
    const raw = entries.map(widgetProjectionEntry);
    return normalizePluginUiProjection({
        v: 2,
        generation: 1,
        installedPackagesById,
        actionsById: {},
        familiesById: {
            pluginUi: { entriesById: Object.fromEntries(raw.map((entry) => [entry.id, entry])) },
        },
    } as unknown as PluginProjectionV2);
}
