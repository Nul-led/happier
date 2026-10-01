import { describe, expect, it } from 'vitest';

import {
    buildPluginDetailRoute,
    buildPluginListingRoute,
    buildPluginsHomeRoute,
    pluginsHomeTitleKey,
    pluginsOpenItemParams,
    readPluginDetailRoutePluginId,
    readPluginsOpenItem,
    readPluginListingRouteParams,
    resolvePluginsSurfaceHost,
} from './pluginsSurfaceRoutes';

describe('plugins surface routes', () => {
    it('keeps the user in the host they are in: Settings or the app page', () => {
        expect(resolvePluginsSurfaceHost('/settings/plugins')).toBe('settings');
        expect(resolvePluginsSurfaceHost('/settings/plugins/listing')).toBe('settings');
        expect(resolvePluginsSurfaceHost('/plugins')).toBe('app');
        expect(resolvePluginsSurfaceHost('/plugins/listing')).toBe('app');
        // A sibling prefix is not Settings.
        expect(resolvePluginsSurfaceHost('/settingsx/plugins')).toBe('app');
    });

    it('builds home, Browse and listing routes within each host', () => {
        expect(buildPluginsHomeRoute('settings')).toBe('/settings/plugins');
        expect(buildPluginsHomeRoute('settings', { view: 'browse' })).toBe('/settings/plugins?view=browse');
        expect(buildPluginsHomeRoute('app')).toBe('/plugins');
        expect(buildPluginsHomeRoute('app', { view: 'browse' })).toBe('/plugins?view=browse');

        const listing = { sourceId: 'marketplace:curated', pluginId: 'acme.tools' };
        expect(buildPluginListingRoute('settings', listing).pathname).toBe('/(app)/settings/plugins/listing');
        expect(buildPluginListingRoute('app', listing).pathname).toBe('/(app)/plugins/listing');
    });

    it('opens a plugin page within the host, and reads its id back from either spelling', () => {
        expect(buildPluginDetailRoute('settings', 'acme.tools')).toEqual({
            pathname: '/(app)/settings/plugins/[pluginId]',
            params: { pluginId: 'acme.tools' },
        });
        expect(buildPluginDetailRoute('app', 'acme.tools')).toEqual({
            pathname: '/(app)/plugins/[pluginId]',
            params: { pluginId: 'acme.tools' },
        });
        expect(readPluginDetailRoutePluginId([' acme.tools '])).toBe('acme.tools');
        expect(readPluginDetailRoutePluginId('  ')).toBeNull();
    });

    it('names the home by the host it is in, for the listing breadcrumb', () => {
        expect(pluginsHomeTitleKey('settings')).toBe('settingsPlugins.title');
        expect(pluginsHomeTitleKey('app')).toBe('settingsPlugins.surfaces.navigationTitle');
    });

    it('round-trips a source-qualified listing through its route params', () => {
        const route = buildPluginListingRoute('app', { sourceId: 'marketplace:curated', pluginId: 'acme.tools' });
        expect(readPluginListingRouteParams(route.params)).toEqual({ sourceId: 'marketplace:curated', pluginId: 'acme.tools' });
    });

    it('names the plugin open beside the Plugins page in the home route, and reads it back', () => {
        const installed = { kind: 'installed', pluginId: 'acme.tools' } as const;
        const listing = { kind: 'listing', sourceId: 'marketplace:curated', pluginId: 'acme.notes' } as const;
        expect(buildPluginsHomeRoute('app', { view: 'installed', open: installed })).toBe('/plugins?view=installed&plugin=acme.tools');
        expect(buildPluginsHomeRoute('settings', { view: 'browse', open: listing }))
            .toBe('/settings/plugins?view=browse&plugin=acme.notes&source=marketplace%3Acurated');

        expect(readPluginsOpenItem(pluginsOpenItemParams(installed))).toEqual(installed);
        expect(readPluginsOpenItem(pluginsOpenItemParams(listing))).toEqual(listing);
        // Closing clears both params, so a later Installed selection never inherits a listing's source.
        expect(pluginsOpenItemParams(null)).toEqual({ plugin: undefined, source: undefined });
        expect(readPluginsOpenItem({ plugin: ['  '] })).toBeNull();
        expect(readPluginsOpenItem({ view: 'browse' })).toBeNull();
    });

    it('rejects a deep link that does not name both the source and the plugin', () => {
        expect(readPluginListingRouteParams({ pluginId: 'acme.tools' })).toBeNull();
        expect(readPluginListingRouteParams({ sourceId: ['s1'], pluginId: ['  '] })).toBeNull();
    });
});
