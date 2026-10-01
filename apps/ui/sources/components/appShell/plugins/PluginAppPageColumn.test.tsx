import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { normalizePluginUiDestinationBindingV1 } from '@happier-dev/protocol/plugins/ui';

import { renderScreen } from '@/dev/testkit';
import {
    EMPTY_PLUGIN_UI_PROJECTION,
    type PluginUiProjectionModel,
    type PluginUiSurfacePlacementProjection,
} from '@/sync/domains/plugins/ui/projection';

const routeState = vi.hoisted(() => ({ pathname: '/plugins/acme.triage/triage/views/mine' }));
const mountedHosts = vi.hoisted(() => [] as Array<Record<string, unknown>>);

vi.mock('expo-router', async () => {
    const { createExpoRouterMock } = await import('@/dev/testkit/mocks/router');
    return createExpoRouterMock({ pathname: () => routeState.pathname }).module;
});
vi.mock('@/text', async () => {
    const { createTextModuleMock } = await import('@/dev/testkit/mocks/text');
    return createTextModuleMock();
});
// The placement host is where the plugin's own runtime (a React Native bundle or hosted web frame)
// is loaded: the boundary this column hands its mount to. Everything above it stays real.
vi.mock('@/components/plugins/surfaces', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@/components/plugins/surfaces')>()),
    PluginSurfacePlacementHost: (props: Record<string, unknown>) => {
        mountedHosts.push(props);
        return React.createElement('PluginSurfacePlacementHost', props);
    },
}));

function pagePlacement(column?: PluginUiSurfacePlacementProjection['column']): PluginUiSurfacePlacementProjection {
    const binding = normalizePluginUiDestinationBindingV1({
        pluginId: 'acme.triage',
        destinationId: 'triage',
        rendererId: 'list-page',
        container: 'appPage',
        target: { kind: 'app' },
    });
    if (!binding) throw new Error('fixture must be an admitted app-page binding');
    return {
        id: 'surfacePlacement:acme.triage:triage',
        pluginId: 'acme.triage',
        occurrenceId: 'triage-occurrence',
        contributionKind: 'surfacePlacement',
        descriptorId: 'triage',
        binding,
        target: binding.target,
        renderer: { kind: 'reactNative', contributionId: 'list-page' },
        display: { developerFallback: 'PRs & Issues', iconToken: 'action' },
        availability: { state: 'available', reason: 'available', diagnostics: [] },
        headerActions: [],
        ...(column ? { column } : {}),
    } as PluginUiSurfacePlacementProjection;
}

function projectionWith(placement: PluginUiSurfacePlacementProjection): PluginUiProjectionModel {
    return {
        ...EMPTY_PLUGIN_UI_PROJECTION,
        generation: 3,
        surfacePlacementsById: { [placement.id]: placement },
    };
}

async function renderColumn(model: PluginUiProjectionModel) {
    const { AppShellPluginUiProjectionValueProvider } = await import('./AppShellPluginUiProjection');
    const { PluginAppPageColumn } = await import('./PluginAppPageColumn');
    mountedHosts.length = 0;
    return renderScreen(
        <AppShellPluginUiProjectionValueProvider
            value={{
                pluginUiProjection: model,
                pluginBrowserProjection: null,
                phase: 'current',
                interactionEnabled: true,
                machineId: 'machine-1',
                serverId: 'server-1',
                platform: 'web',
                clientExecutableActivation: { status: 'ready' },
                reloadClientExecutables: () => {},
                reloadConnectedAccountProjection: () => {},
            }}
        >
            <PluginAppPageColumn destinationId="plugin:acme.triage:triage" />
        </AppShellPluginUiProjectionValueProvider>,
    );
}

const COLUMN = {
    renderer: { kind: 'reactNative', contributionId: 'views-column' },
    availability: { state: 'available', reason: 'available', diagnostics: [] },
} as const;

describe('PluginAppPageColumn', () => {
    it("mounts the page's column renderer with the page's current location", async () => {
        routeState.pathname = '/plugins/acme.triage/triage/views/mine';
        await renderColumn(projectionWith(pagePlacement(COLUMN)));

        expect(mountedHosts).toHaveLength(1);
        const mount = mountedHosts[0]!;
        expect(mount.subPath).toBe('views/mine');
        expect((mount.placement as PluginUiSurfacePlacementProjection).renderer).toEqual(COLUMN.renderer);
        expect(mount.machineId).toBe('machine-1');
    });

    it('receives the page root as an empty location', async () => {
        routeState.pathname = '/plugins/acme.triage/triage';
        await renderColumn(projectionWith(pagePlacement(COLUMN)));
        expect(mountedHosts.at(-1)?.subPath).toBe('');
    });

    it('mounts nothing when the page declares no column or its renderer is unavailable', async () => {
        await renderColumn(projectionWith(pagePlacement()));
        expect(mountedHosts).toHaveLength(0);

        await renderColumn(projectionWith(pagePlacement({
            ...COLUMN,
            availability: { state: 'disabled', reason: 'artifact_missing', diagnostics: [] },
        })));
        expect(mountedHosts).toHaveLength(0);
    });
});
