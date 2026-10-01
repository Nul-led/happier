import { describe, expect, it } from 'vitest';

import {
    widgetInstalledPackage as installedPackage,
    widgetProjectionOf as projectionOf,
    type WidgetFixtureEntry,
} from '@/dev/testkit/fixtures/pluginWidgetProjectionFixtures';
import type { PluginUiPolicyEvaluationContext } from '@/sync/domains/plugins/ui/policy';
import type { PluginUiProjectionModel } from '@/sync/domains/plugins/ui/projection';

import type { SessionPluginRuntimeState } from '@/components/sessions/plugins/useSessionPluginRuntime';
import {
    selectCurrentSessionWidgetCandidates,
    selectWidgetCandidates,
} from './widgetCatalog';

/**
 * What a widget host may offer: the Board's Add picker (Session target) and Home's sections and
 * Add widgets (App target).
 *
 * The failures pinned here are the ones a person cannot see: an offered
 * candidate that can never mount because its qualified identity is ambiguous, a
 * row that names the wrong plugin, two same-named plugins that sound identical
 * to a screen reader, and a widget offered to a host it was not made for.
 */

const inlineEntry = (input: WidgetFixtureEntry): WidgetFixtureEntry => input;

function selectSessionWidgetCandidates(
    projection: PluginUiProjectionModel | null,
    policyContext?: PluginUiPolicyEvaluationContext,
) {
    return selectWidgetCandidates(projection, 'session', policyContext);
}

describe('Widget Add candidates', () => {
    it('offers compact Companion glances only when declared, preserving default Board and Home placements', () => {
        const projection = projectionOf([
            { pluginId: 'acme.review', localId: 'legacy-board' },
            { pluginId: 'acme.review', localId: 'shared', placements: ['board', 'companion'] },
            { pluginId: 'acme.review', localId: 'glance', placements: ['companion'] },
            { pluginId: 'acme.review', localId: 'legacy-home', target: 'app' },
        ], { 'acme.review': installedPackage('acme.review', 'Review') });
        const keys = (target: 'session' | 'app', placement?: 'board' | 'companion' | 'home') =>
            selectWidgetCandidates(projection, target, undefined, placement).map((candidate) => candidate.surface.localId);
        expect(keys('session')).toEqual(['legacy-board', 'shared']);
        expect(keys('session', 'board')).toEqual(['legacy-board', 'shared']);
        expect(keys('session', 'companion')).toEqual(['glance', 'shared']);
        expect(keys('app', 'home')).toEqual(['legacy-home']);
        expect(keys('app', 'companion')).toEqual([]);
    });

    it('rejects malformed explicit placements without reviving omitted-placement defaults', () => {
        const projection = projectionOf([
            { pluginId: 'acme.review', localId: 'wrong-target', placements: ['home'] },
        ], { 'acme.review': installedPackage('acme.review', 'Review') });
        expect(selectWidgetCandidates(projection, 'session')).toEqual([]);
    });

    it('offers each host only the widgets made for its target, with the Home default each declares', () => {
        const projection = projectionOf(
            [
                inlineEntry({ pluginId: 'acme.review', localId: 'board-status', title: 'Board status' }),
                inlineEntry({ pluginId: 'acme.review', localId: 'latest', title: 'Latest', target: 'app', homeDefault: 'shown' }),
                inlineEntry({ pluginId: 'acme.review', localId: 'queue', title: 'Queue', target: 'app' }),
            ],
            { 'acme.review': installedPackage('acme.review', 'Review Assistant') },
        );
        expect(selectWidgetCandidates(projection, 'session').map((candidate) => candidate.key))
            .toEqual(['acme.review/board-status']);
        expect(selectWidgetCandidates(projection, 'app').map((candidate) => [candidate.key, candidate.homeDefault]))
            .toEqual([['acme.review/latest', 'shown'], ['acme.review/queue', 'available']]);
    });

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

    it('rejects duplicate identities even when placement or availability hides one from the picker', () => {
        const projection = projectionOf([
            { pluginId: 'acme.review', localId: 'split', placements: ['board'] },
            { pluginId: 'acme.review', localId: 'split', placements: ['companion'], entryId: 'split-companion' },
            { pluginId: 'acme.review', localId: 'hidden' },
            { pluginId: 'acme.review', localId: 'hidden', availability: 'unavailable', entryId: 'hidden-unavailable' },
        ], { 'acme.review': installedPackage('acme.review', 'Review') });
        expect(selectWidgetCandidates(projection, 'session')).toEqual([]);
        expect(selectWidgetCandidates(projection, 'session', undefined, 'companion')).toEqual([]);
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
        entry: WidgetFixtureEntry;
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
