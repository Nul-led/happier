import { describe, expect, it } from 'vitest';

import type { PluginProjectionV2 } from '@happier-dev/protocol';
import { normalizePluginUiInlineSurfaceBindingV1 } from '@happier-dev/protocol/plugins/ui';

import { normalizePluginUiProjection } from '@/sync/domains/plugins/ui/projection';
import type { SessionPluginRuntimeState } from '@/components/sessions/plugins/useSessionPluginRuntime';

import {
    resolveInstalledSessionWidgetMount,
    type InstalledSessionWidgetSource,
} from './sessionWidgetInstalledSurface';

function inlineEntry(input: Readonly<{
    pluginId: string;
    localId: string;
    role: 'sessionWidget' | 'sessionSubagentDetails';
    entryId?: string;
}>) {
    const binding = normalizePluginUiInlineSurfaceBindingV1({
        pluginId: input.pluginId,
        surfaceId: input.localId,
        rendererId: 'review-native',
        role: input.role,
        target: { kind: 'session' },
    });
    if (!binding) throw new Error('fixture must use an admitted inline binding');
    return {
        id: input.entryId ?? `surfacePlacement:${input.pluginId}:${input.localId}`,
        pluginId: input.pluginId,
        contributionKind: 'surfacePlacement',
        descriptorId: input.localId,
        binding,
        target: binding.target,
        renderer: { kind: 'declarative', contributionId: 'review-native' },
        display: { title: input.localId },
        availability: { state: 'available', reason: 'available', diagnostics: [] },
    };
}

function projectionOf(entries: readonly ReturnType<typeof inlineEntry>[]) {
    return normalizePluginUiProjection({
        v: 2,
        generation: 1,
        installedPackagesById: {},
        actionsById: {},
        familiesById: {
            pluginUi: {
                entriesById: Object.fromEntries(entries.map((entry) => [entry.id, entry])),
            },
        },
    } as unknown as PluginProjectionV2);
}

function runtime(input: Partial<SessionPluginRuntimeState>): SessionPluginRuntimeState {
    return {
        pluginUiProjection: null,
        pluginBrowserProjection: null,
        phase: 'current',
        interactionEnabled: true,
        machineId: 'machine-a',
        serverId: 'home-a',
        platform: 'web',
        ...input,
    } as SessionPluginRuntimeState;
}

const source: InstalledSessionWidgetSource = {
    kind: 'installedSurface',
    surface: { pluginId: 'acme.review', localId: 'review-status-widget' },
};

describe('installed Session widget correlation', () => {
    it('resolves exactly one admitted placement and the Registry role/presentation pair', () => {
        const resolved = resolveInstalledSessionWidgetMount({
            source,
            presentation: 'fill',
            runtime: runtime({
                pluginUiProjection: projectionOf([
                    inlineEntry({ pluginId: 'acme.review', localId: 'review-status-widget', role: 'sessionWidget' }),
                    inlineEntry({ pluginId: 'acme.ci', localId: 'build-health', role: 'sessionWidget' }),
                ]),
            }),
        });
        expect(resolved.unresolved).toBeNull();
        expect(resolved.placement?.descriptorId).toBe('review-status-widget');
        expect(resolved.inlineMount).toEqual({ role: 'sessionWidget', presentation: 'fill' });
    });

    it('never turns another role with the same local id into a widget', () => {
        const resolved = resolveInstalledSessionWidgetMount({
            source,
            presentation: 'content',
            runtime: runtime({
                pluginUiProjection: projectionOf([
                    inlineEntry({ pluginId: 'acme.review', localId: 'review-status-widget', role: 'sessionSubagentDetails' }),
                ]),
            }),
        });
        expect(resolved.placement).toBeNull();
        expect(resolved.unresolved?.state).toBe('unavailable');
        expect(resolved.unresolved?.reasonCode).toBe('session_widget_surface_absent');
    });

    it('fails closed on a duplicate qualified identity instead of taking the first match', () => {
        const resolved = resolveInstalledSessionWidgetMount({
            source,
            presentation: 'content',
            runtime: runtime({
                pluginUiProjection: projectionOf([
                    inlineEntry({ pluginId: 'acme.review', localId: 'review-status-widget', role: 'sessionWidget' }),
                    inlineEntry({
                        pluginId: 'acme.review',
                        localId: 'review-status-widget',
                        role: 'sessionWidget',
                        entryId: 'surfacePlacement:acme.review:review-status-widget-duplicate',
                    }),
                ]),
            }),
        });
        expect(resolved.placement).toBeNull();
        expect(resolved.unresolved?.reasonCode).toBe('session_widget_surface_ambiguous');
    });

    it('presents an establishing projection as loading, not as a removed surface', () => {
        expect(resolveInstalledSessionWidgetMount({
            source,
            presentation: 'content',
            runtime: runtime({ pluginUiProjection: null, phase: 'establishing' }),
        }).unresolved).toEqual({ state: 'loading', reasonCode: 'session_widget_projection_establishing' });
        expect(resolveInstalledSessionWidgetMount({
            source,
            presentation: 'content',
            runtime: runtime({ pluginUiProjection: null, phase: 'unavailable' }),
        }).unresolved?.state).toBe('unavailable');
    });

    // In-place source-identity substitution is rejected by the ONE owner of that
    // rule, `isSessionSurfaceItemSourceCompatible`, and proved at the Board
    // mutation paths that consume it: `packages/protocol/src/sessions/board/item.test.ts`,
    // `apps/ui/sources/sync/api/session/sessionBoardActions.test.ts` and
    // `apps/cli/src/session/board/sessionBoardActionDeps.test.ts` all pin
    // `session_board_source_conflict`. Restating it here would only pin a second copy.
});
