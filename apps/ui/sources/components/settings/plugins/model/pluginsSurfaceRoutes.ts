import { usePathname } from 'expo-router';

import { SETTINGS_ROUTES } from '@/components/settings/catalog/routes';

/**
 * The Plugins screens (home with Installed | Browse, and a marketplace listing) have two hosts: the
 * Settings shell (`/settings/plugins…`) and the app page reached from the main sidebar
 * (`/plugins…`). The screens are the same; only their routes differ. This module is the one owner of
 * those routes, so a link inside the screens keeps the user in the host they are in.
 *
 * A plugin's page follows the host too. The "Sources and tools" pages are configuration and stay
 * Settings pages in both hosts.
 */
export type PluginsSurfaceHost = 'settings' | 'app';

/** The app-page host: the main sidebar's Plugins destination. */
export const PLUGINS_APP_ROUTE = '/plugins' as const;
/**
 * The app host's own pages as route patterns (`[param]` = one segment): the listing and a plugin's
 * page. Plugin-contributed app pages (`/plugins/<pluginId>/<localId>…`) are not among them.
 */
export const PLUGINS_APP_PAGE_PATTERNS = ['/plugins/listing', '/plugins/[pluginId]'] as const;

const LISTING_PATHNAMES = {
    settings: '/(app)/settings/plugins/listing',
    app: '/(app)/plugins/listing',
} as const;

const DETAIL_PATHNAMES = {
    settings: '/(app)/settings/plugins/[pluginId]',
    app: '/(app)/plugins/[pluginId]',
} as const;

export type PluginsHomeView = 'browse';

/** The host a pathname belongs to. Anything outside `/settings` is the app page. */
export function resolvePluginsSurfaceHost(pathname: string | null | undefined): PluginsSurfaceHost {
    if (typeof pathname !== 'string') return 'settings';
    return pathname === '/settings' || pathname.startsWith('/settings/') ? 'settings' : 'app';
}

/** The Plugins home in `host`; `view: 'browse'` opens it on Browse (the home screen honours `?view=browse`). */
export function buildPluginsHomeRoute(host: PluginsSurfaceHost, options?: Readonly<{ view?: PluginsHomeView }>) {
    const base = host === 'settings' ? SETTINGS_ROUTES.plugins : PLUGINS_APP_ROUTE;
    return options?.view ? `${base}?view=${options.view}` : base;
}

/** The home's name in `host`: Settings calls it "Plugin marketplace", the sidebar "Plugins". */
export function pluginsHomeTitleKey(host: PluginsSurfaceHost) {
    return host === 'settings' ? 'settingsPlugins.title' as const : 'settingsPlugins.surfaces.navigationTitle' as const;
}

export type PluginListingRouteParams = Readonly<{ sourceId: string; pluginId: string }>;

/**
 * A marketplace listing before install, addressed by its source and plugin id so the page can be
 * reloaded or deep-linked: the listing is re-read from that exact source on arrival.
 */
export function buildPluginListingRoute(host: PluginsSurfaceHost, params: PluginListingRouteParams) {
    return {
        pathname: LISTING_PATHNAMES[host],
        params: { sourceId: params.sourceId, pluginId: params.pluginId },
    } as const;
}

/** One installed plugin's page (settings, updates, machines, leave actions) in `host`. */
export function buildPluginDetailRoute(host: PluginsSurfaceHost, pluginId: string) {
    return {
        pathname: DETAIL_PATHNAMES[host],
        params: { pluginId },
    } as const;
}

export function readPluginDetailRoutePluginId(value: unknown): string | null {
    return readParam(value);
}

function readParam(value: unknown): string | null {
    if (Array.isArray(value)) return readParam(value[0]);
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
}

export function readPluginListingRouteParams(params: Readonly<Record<string, unknown>>): PluginListingRouteParams | null {
    const sourceId = readParam(params.sourceId);
    const pluginId = readParam(params.pluginId);
    return sourceId && pluginId ? { sourceId, pluginId } : null;
}

/** The host the current screen is rendered in. */
export function usePluginsSurfaceHost(): PluginsSurfaceHost {
    return resolvePluginsSurfaceHost(usePathname());
}
