import { describe, expect, it } from 'vitest';

import type { PluginProjectionV2 } from '@happier-dev/protocol';
import { normalizePluginUiInlineSurfaceBindingV1 } from '@happier-dev/protocol/plugins/ui';

import { normalizePluginUiProjection } from '@/sync/domains/plugins/ui/projection';
import type { PluginUiPolicyEvaluationContext } from '@/sync/domains/plugins/ui/policy';

import type { SessionPluginRuntimeState } from '@/components/sessions/plugins/useSessionPluginRuntime';
import {
    selectCurrentSessionWidgetCandidates,
    selectSessionWidgetCandidates,
} from './sessionWidgetCatalog';

/**
 * What the Add picker may offer.
 *
 * The failures pinned here are the ones a person cannot see: an offered
 * candidate that can never mount because its qualified identity is ambiguous, a
 * row that names the wrong plugin, and two same-named plugins that sound
 * identical to a screen reader.
 */

function inlineEntry(input: Readonly<{
    pluginId: string;
    localId: string;
    role?: 'sessionWidget' | 'sessionSubagentDetails';
    title?: string;
    entryId?: string;
    availability?: 'available' | 'unavailable';
    featureGate?: string;
    requiredPermissionIds?: readonly string[];
    platforms?: readonly ('web' | 'desktop' | 'ios' | 'android')[];
}>) {
    const binding = normalizePluginUiInlineSurfaceBindingV1({
        pluginId: input.pluginId,
        surfaceId: input.localId,
        rendererId: 'review-native',
        role: input.role ?? 'sessionWidget',
        target: { kind: 'session' },
    });
    if (!binding) throw new Error('fixture must use an admitted inline binding');
    return {
        id: input.entryId ?? `surfacePlacement:${input.pluginId}:${input.localId}`,
        pluginId: input.pluginId,
        contributionKind: 'surfacePlacement',
        descriptorId: input.localId,
        // The daemon producer stamps every projected UI entry with its exact plugin-slot
        // occurrence; a fixture without one is not a projection the product can produce.
        occurrenceId: `${input.pluginId}#1`,
        binding,
        target: binding.target,
        renderer: { kind: 'declarative', contributionId: 'review-native' },
        display: { title: input.title ?? input.localId },
        ...(input.featureGate ? { featureGate: input.featureGate } : {}),
        ...(input.requiredPermissionIds
            ? { policy: { requiredPermissionIds: input.requiredPermissionIds } }
            : {}),
        ...(input.platforms ? { compatibility: { platforms: input.platforms } } : {}),
        availability: {
            state: input.availability ?? 'available',
            reason: input.availability === 'unavailable' ? 'plugin_disabled' : 'available',
            diagnostics: [],
        },
    };
}

function projectionOf(
    entries: readonly ReturnType<typeof inlineEntry>[],
    installedPackagesById: Readonly<Record<string, unknown>> = {},
) {
    return normalizePluginUiProjection({
        v: 2,
        generation: 1,
        installedPackagesById,
        actionsById: {},
        familiesById: {
            pluginUi: {
                entriesById: Object.fromEntries(entries.map((entry) => [entry.id, entry])),
            },
        },
    } as unknown as PluginProjectionV2);
}

function installedPackage(id: string, displayName: string) {
    return { id, displayName, enabled: true, source: { kind: 'local', path: `/plugins/${id}` } };
}

describe('Session widget Add candidates', () => {
    it('names each candidate by its contribution title and installed plugin', () => {
        const candidates = selectSessionWidgetCandidates(projectionOf(
            [inlineEntry({ pluginId: 'acme.review', localId: 'review-status-widget', title: 'Review status' })],
            { 'acme.review': installedPackage('acme.review', 'Review Assistant') },
        ));
        expect(candidates).toHaveLength(1);
        expect(candidates[0]).toMatchObject({
            surface: { pluginId: 'acme.review', localId: 'review-status-widget' },
            title: 'Review status',
            pluginName: 'Review Assistant',
            sharedPluginName: false,
        });
    });

    it('never offers a role that merely shares the local id', () => {
        expect(selectSessionWidgetCandidates(projectionOf(
            [inlineEntry({ pluginId: 'acme.review', localId: 'review-status-widget', role: 'sessionSubagentDetails' })],
            { 'acme.review': installedPackage('acme.review', 'Review Assistant') },
        ))).toEqual([]);
    });

    it('refuses an unavailable surface as a NEW creation candidate', () => {
        const projection = projectionOf(
            [inlineEntry({ pluginId: 'acme.review', localId: 'review-status-widget', availability: 'unavailable' })],
            { 'acme.review': installedPackage('acme.review', 'Review Assistant') },
        );
        expect(selectSessionWidgetCandidates(projection)).toEqual([]);
        expect(selectSessionWidgetCandidates(projection)).toEqual([]);
    });

    it('drops an ambiguous qualified identity instead of offering an item that cannot mount', () => {
        // The mount resolver fails closed on a duplicate identity. Offering one
        // here would create a Board item that is permanently unavailable.
        const candidates = selectSessionWidgetCandidates(projectionOf(
            [
                inlineEntry({ pluginId: 'acme.review', localId: 'review-status-widget' }),
                inlineEntry({
                    pluginId: 'acme.review',
                    localId: 'review-status-widget',
                    entryId: 'surfacePlacement:acme.review:review-status-widget-duplicate',
                }),
                inlineEntry({ pluginId: 'acme.ci', localId: 'build-health', title: 'Build health' }),
            ],
            {
                'acme.review': installedPackage('acme.review', 'Review Assistant'),
                'acme.ci': installedPackage('acme.ci', 'CI Tools'),
            },
        ));
        expect(candidates.map((candidate) => candidate.surface.localId)).toEqual(['build-health']);
    });

    it('marks a colliding plugin display name so rows stay distinguishable', () => {
        const candidates = selectSessionWidgetCandidates(projectionOf(
            [
                inlineEntry({ pluginId: 'acme.review', localId: 'status', title: 'Status' }),
                inlineEntry({ pluginId: 'other.review', localId: 'status', title: 'Status' }),
            ],
            {
                'acme.review': installedPackage('acme.review', 'Review'),
                'other.review': installedPackage('other.review', 'Review'),
            },
        ));
        expect(candidates.map((candidate) => candidate.sharedPluginName)).toEqual([true, true]);
    });

    it('omits a projected contribution whose installed package row is absent', () => {
        // Without a package row there is no truthful provenance, so the person
        // cannot tell what they would be adding.
        expect(selectSessionWidgetCandidates(projectionOf(
            [inlineEntry({ pluginId: 'acme.review', localId: 'review-status-widget' })],
        ))).toEqual([]);
    });

    it('reports no candidates at all without a projection', () => {
        expect(selectSessionWidgetCandidates(null)).toEqual([]);
    });

    it.each([
        {
            gate: 'the exact Home feature decision',
            entry: inlineEntry({
                pluginId: 'acme.review',
                localId: 'feature-widget',
                featureGate: 'sessions.board',
            }),
            admitted: { platform: 'web', isFeatureEnabled: (id: string) => id === 'sessions.board' },
            refused: { platform: 'web', isFeatureEnabled: () => false },
        },
        {
            gate: 'the exact Session permission decision',
            entry: inlineEntry({
                pluginId: 'acme.review',
                localId: 'permission-widget',
                requiredPermissionIds: ['session.records.read'],
            }),
            admitted: { platform: 'web', isPermissionGranted: (id: string) => id === 'session.records.read' },
            refused: { platform: 'web', isPermissionGranted: () => false },
        },
        {
            gate: 'the current host platform',
            entry: inlineEntry({
                pluginId: 'acme.review',
                localId: 'platform-widget',
                platforms: ['web'],
            }),
            admitted: { platform: 'web' },
            refused: { platform: 'ios' },
        },
    ] satisfies readonly Readonly<{
        gate: string;
        entry: ReturnType<typeof inlineEntry>;
        admitted: PluginUiPolicyEvaluationContext;
        refused: PluginUiPolicyEvaluationContext;
    }>[])('keeps Add entry visibility identical to the picker for $gate', ({ entry, admitted, refused }) => {
        const projection = projectionOf(
            [entry],
            { 'acme.review': installedPackage('acme.review', 'Review Assistant') },
        );

        const admittedCandidates = selectSessionWidgetCandidates(projection, admitted);
        const refusedCandidates = selectSessionWidgetCandidates(projection, refused);
        expect(admittedCandidates).toHaveLength(1);
        expect(refusedCandidates).toEqual([]);
    });

    it.each([
        { label: 'Board feature is disabled', boardFeatureEnabled: false, canEdit: true, phase: 'current', interactionEnabled: true },
        { label: 'Session editor permission is absent', boardFeatureEnabled: true, canEdit: false, phase: 'current', interactionEnabled: true },
        { label: 'plugin projection is retained offline', boardFeatureEnabled: true, canEdit: true, phase: 'retainedOffline', interactionEnabled: false },
        { label: 'plugin projection is establishing', boardFeatureEnabled: true, canEdit: true, phase: 'establishing', interactionEnabled: false },
    ] as const)('returns the exact empty Add/picker array when $label', (state) => {
        const pluginUiProjection = projectionOf(
            [inlineEntry({ pluginId: 'acme.review', localId: 'review-status-widget' })],
            { 'acme.review': installedPackage('acme.review', 'Review Assistant') },
        );
        const runtime = {
            pluginUiProjection,
            pluginBrowserProjection: null,
            machineId: 'machine-a',
            serverId: 'home-a',
            platform: 'web',
            phase: state.phase,
            interactionEnabled: state.interactionEnabled,
        } satisfies SessionPluginRuntimeState;

        expect(selectCurrentSessionWidgetCandidates({
            runtime,
            boardFeatureEnabled: state.boardFeatureEnabled,
            canEdit: state.canEdit,
            policyContext: { platform: 'web' },
        })).toEqual([]);
    });
});
