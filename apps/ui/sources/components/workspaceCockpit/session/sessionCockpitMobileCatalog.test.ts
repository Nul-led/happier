import { describe, expect, it } from 'vitest';
import { normalizePluginUiDestinationBindingV1 } from '@happier-dev/protocol/plugins/ui';

import type { PluginUiSurfacePlacementProjection } from '@/sync/domains/plugins/ui/projection';

import {
    resolveSessionCockpitMobileCatalog,
    resolveSessionCockpitMobileNavigatorSurfaces,
    resolveSessionCockpitMobileTabVisibility,
} from './sessionCockpitMobileCatalog';

function createMobilePluginPlacement(input: Readonly<{
    pluginId: string;
    destinationId: string;
    label: string;
    platforms?: readonly ('ios' | 'android' | 'desktop' | 'web')[];
}>): PluginUiSurfacePlacementProjection {
    const normalizedBinding = normalizePluginUiDestinationBindingV1({
        pluginId: input.pluginId,
        destinationId: input.destinationId,
        rendererId: `${input.destinationId}-panel`,
        container: 'rightSidebarTab',
        target: { kind: 'session', sessionIdPath: '/session/id' },
    });
    if (!normalizedBinding) {
        throw new Error('fixture must produce an admitted V2 session right-sidebar binding');
    }
    const binding = {
        ...normalizedBinding,
        ...(input.platforms === undefined ? {} : { platforms: input.platforms }),
    };

    return {
        id: `surfacePlacement:${input.pluginId}:${input.destinationId}`,
        pluginId: input.pluginId,
        contributionKind: 'surfacePlacement',
        descriptorId: input.destinationId,
        binding,
        target: binding.target,
        renderer: { kind: 'host', rendererId: `${input.destinationId}-panel` },
        display: { developerFallback: input.label },
        availability: { state: 'available', reason: 'available', diagnostics: [] },
        headerActions: [],
    } satisfies PluginUiSurfacePlacementProjection;
}

describe('sessionCockpitMobileCatalog', () => {
    it('publishes Board on mobile only when the exact Home enables it', () => {
        expect(resolveSessionCockpitMobileCatalog({
            terminalTabAvailable: false,
        }).map((entry) => entry.id)).not.toContain('board');

        expect(resolveSessionCockpitMobileCatalog({
            terminalTabAvailable: false,
            boardFeatureEnabled: true,
        }).map((entry) => entry.id)).toContain('board');
    });

    it('publishes the Companion destination on every Home while Board stays behind its decision', () => {
        // Companion is host-owned like Chat and Tabs: its first-party Session
        // Summary needs no Board record, so a missing or refused `sessions.board`
        // answer hides only the Board destination.
        for (const input of [
            { terminalTabAvailable: false },
            { terminalTabAvailable: false, boardFeatureEnabled: false },
        ] as const) {
            const catalog = resolveSessionCockpitMobileCatalog(input);
            expect(catalog.map((entry) => entry.id)).toContain('companion');
            expect(catalog.map((entry) => entry.id)).not.toContain('board');
            expect(resolveSessionCockpitMobileNavigatorSurfaces({ catalog }))
                .toContain('companion');
        }

        const enabledCatalog = resolveSessionCockpitMobileCatalog({
            terminalTabAvailable: false,
            boardFeatureEnabled: true,
        });
        expect(enabledCatalog.map((entry) => entry.id)).toContain('companion');
        expect(enabledCatalog.map((entry) => entry.id)).toContain('board');
        expect(resolveSessionCockpitMobileNavigatorSurfaces({ catalog: enabledCatalog }))
            .toContain('companion');
    });

    it('keeps a plugin in host-owned discovery and reveals an explicitly pinned plugin in the inline cap', () => {
        const plugin = createMobilePluginPlacement({
            pluginId: 'acme.review',
            destinationId: 'session-review',
            label: 'Review',
        });
        const catalog = resolveSessionCockpitMobileCatalog({
            terminalTabAvailable: true,
            boardFeatureEnabled: true,
            pluginPlacements: [plugin],
            projectionGeneration: 7,
        });

        expect(catalog.map((entry) => entry.id)).toEqual([
            'chat',
            'browse',
            'git',
            'tabs',
            'companion',
            'navigation',
            'board',
            'browser',
            'services',
            'plugin:acme.review:session-review',
            'terminal',
        ]);

        expect(resolveSessionCockpitMobileTabVisibility({
            catalog,
            pinnedSurfaceIds: [],
        })).toMatchObject({
            visible: [
                { id: 'chat' },
                { id: 'browse' },
                { id: 'git' },
                { id: 'tabs' },
            ],
            overflow: expect.arrayContaining([
                expect.objectContaining({ id: 'plugin:acme.review:session-review' }),
            ]),
        });

        expect(resolveSessionCockpitMobileTabVisibility({
            catalog,
            pinnedSurfaceIds: ['plugin:acme.review:session-review'],
        })).toMatchObject({
            visible: [
                { id: 'chat' },
                { id: 'plugin:acme.review:session-review' },
                { id: 'browse' },
                { id: 'git' },
            ],
        });
    });

    it('never turns unavailable or unknown pinned values into a visible catalog entry', () => {
        const catalog = resolveSessionCockpitMobileCatalog({
            terminalTabAvailable: false,
        });

        expect(resolveSessionCockpitMobileTabVisibility({
            catalog,
            pinnedSurfaceIds: ['plugin:removed:panel', 'not-a-surface'],
        })).toMatchObject({
            visible: [
                { id: 'chat' },
                { id: 'browse' },
                { id: 'git' },
                { id: 'tabs' },
            ],
        });
    });

    it('admits a conservative Android-only destination only to the Android phone catalog', () => {
        const androidOnlyPlugin = createMobilePluginPlacement({
            pluginId: 'acme.android',
            destinationId: 'session-review',
            label: 'Android review',
            platforms: ['android'],
        });
        const iosInput = {
            terminalTabAvailable: true,
            pluginPlacements: [androidOnlyPlugin],
            projectionGeneration: 7,
            runtimeAdmission: { platform: 'ios' as const, formFactor: 'phone' as const },
        };
        const androidInput = {
            ...iosInput,
            runtimeAdmission: { platform: 'android' as const, formFactor: 'phone' as const },
        };

        expect(resolveSessionCockpitMobileCatalog(iosInput).map((entry) => entry.id))
            .not.toContain('plugin:acme.android:session-review');
        expect(resolveSessionCockpitMobileCatalog(androidInput).map((entry) => entry.id))
            .toContain('plugin:acme.android:session-review');
    });
});
