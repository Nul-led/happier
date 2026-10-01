import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';

import { renderScreen } from '@/dev/testkit';

const appScopeRightSidebarSpy = vi.hoisted(() => vi.fn());
const routeParams = vi.hoisted(() => ({ pluginId: undefined as string | undefined, destinationId: undefined as string | undefined }));

vi.mock('expo-router', async () => {
    const { createExpoRouterMock } = await import('@/dev/testkit/mocks/router');
    return createExpoRouterMock({
        params: () => routeParams,
    }).module;
});

vi.mock('@/components/appShell/rightSidebar/AppScopeRightSidebar', () => ({
    AppScopeRightSidebar: (props: Record<string, unknown>) => {
        appScopeRightSidebarSpy(props);
        return React.createElement('AppScopeRightSidebar', props);
    },
}));

describe('App panels route (under Plugins)', () => {
    it('mounts the canonical app-scoped right-sidebar host', async () => {
        const { default: PluginPanelsRoute } = await import(
            '@/app/(app)/plugins/panels'
        );
        const screen = await renderScreen(<PluginPanelsRoute />);

        expect(screen.findByTestId('plugins.panels.host')).toBeTruthy();
        expect(appScopeRightSidebarSpy).toHaveBeenCalledWith(expect.objectContaining({
            testID: 'plugins.panels.host',
        }));
    });

    it('hands an exact qualified catalog destination to the canonical sidebar host', async () => {
        routeParams.pluginId = 'acme.review';
        routeParams.destinationId = 'review-panel';
        const { default: PluginPanelsRoute } = await import(
            '@/app/(app)/plugins/panels'
        );

        await renderScreen(<PluginPanelsRoute />);

        expect(appScopeRightSidebarSpy).toHaveBeenCalledWith(expect.objectContaining({
            requestedDestination: { pluginId: 'acme.review', localId: 'review-panel' },
        }));
    });
});
