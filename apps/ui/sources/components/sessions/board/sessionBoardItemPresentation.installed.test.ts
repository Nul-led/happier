import { describe, expect, it } from 'vitest';

import type { PluginProjectionV2 } from '@happier-dev/protocol';
import { normalizePluginUiInlineSurfaceBindingV1 } from '@happier-dev/protocol/plugins/ui';
import type { SessionSurfaceItemV1 } from '@happier-dev/protocol/sessions/board';

import type { SessionPluginRuntimeState } from '@/components/sessions/plugins/useSessionPluginRuntime';
import { normalizePluginUiProjection } from '@/sync/domains/plugins/ui/projection';

import {
    createSessionBoardSourceAvailabilityResolver,
    resolveSessionBoardItemPresentation,
} from './sessionBoardItemPresentation';

const source = {
    kind: 'installedSurface',
    surface: { pluginId: 'acme.review', localId: 'review-status-widget' },
} as const;

function runtime(input: Readonly<{
    availability?: 'available' | 'unavailable';
    featureGate?: string;
}>): SessionPluginRuntimeState {
    const binding = normalizePluginUiInlineSurfaceBindingV1({
        pluginId: source.surface.pluginId,
        surfaceId: source.surface.localId,
        rendererId: 'review-native',
        role: 'widget',
        target: { kind: 'session' },
    });
    if (!binding) throw new Error('fixture must use an admitted inline binding');
    const id = `surfacePlacement:${source.surface.pluginId}:${source.surface.localId}`;
    return {
        pluginUiProjection: normalizePluginUiProjection({
            v: 2,
            generation: 1,
            installedPackagesById: {
                [source.surface.pluginId]: {
                    id: source.surface.pluginId,
                    displayName: 'Review Assistant',
                    enabled: input.availability !== 'unavailable',
                    source: { kind: 'local', path: '/plugins/acme-review' },
                },
            },
            actionsById: {},
            familiesById: {
                pluginUi: {
                    entriesById: {
                        [id]: {
                            id,
                            pluginId: source.surface.pluginId,
                            contributionKind: 'surfacePlacement',
                            descriptorId: source.surface.localId,
                            binding,
                            target: binding.target,
                            renderer: { kind: 'declarative', contributionId: 'review-native' },
                            display: { title: 'Review status' },
                            ...(input.featureGate ? { featureGate: input.featureGate } : {}),
                            availability: {
                                state: input.availability ?? 'available',
                                reason: input.availability === 'unavailable' ? 'plugin_disabled' : 'available',
                                diagnostics: [],
                            },
                        },
                    },
                },
            },
        } as unknown as PluginProjectionV2),
        pluginBrowserProjection: null,
        phase: 'current',
        interactionEnabled: true,
        machineId: 'machine-a',
        serverId: 'home-a',
        platform: 'web',
    };
}

function presentation(pluginRuntime: SessionPluginRuntimeState) {
    const item = {
        v: 1,
        title: 'Review status',
        frame: 'card',
        height: { mode: 'auto', fallback: 'regular' },
        source,
    } as SessionSurfaceItemV1;
    return resolveSessionBoardItemPresentation({
        state: { kind: 'ready', item },
        mountMode: 'preview',
        canEdit: true,
        canOpenElsewhere: true,
        resolveSourceAvailability: createSessionBoardSourceAvailabilityResolver(pluginRuntime, {
            policyContext: { platform: 'web', isFeatureEnabled: () => false },
        }),
    });
}

describe('installed Session widget lifecycle presentation', () => {
    it.each([
        ['disabled package', runtime({ availability: 'unavailable' })],
        ['policy-denied contribution', runtime({ featureGate: 'sessions.reviewWidget' })],
    ])('offers only lifecycle recovery for a %s', (_label, pluginRuntime) => {
        expect(presentation(pluginRuntime)).toMatchObject({
            kind: 'state',
            card: {
                actionKinds: ['managePlugin', 'remove'],
            },
        });
    });
});
