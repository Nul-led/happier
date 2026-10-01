import * as React from 'react';
import { useGlobalSearchParams, usePathname, useRouter } from '@/components/appShell/workspace/destinationRoute';

import { runGuardedNavigation } from '@/utils/navigation/runGuardedNavigation';
import { fireAndForget } from '@/utils/system/fireAndForget';

import {
    buildPluginsHomeRoute,
    isPluginsHomePathname,
    pluginsOpenItemParams,
    readPluginsOpenItem,
    resolvePluginsSurfaceHost,
    type PluginsOpenItem,
} from './pluginsSurfaceRoutes';

type NavigationHref = Parameters<ReturnType<typeof useRouter>['replace']>[0];

/**
 * The one owner of which plugin is open beside the Plugins page. The Plugins column, the grid and the
 * list read and change the same route params (`pluginsOpenItemParams`), so they always mark the same
 * plugin and the detail pane shows it.
 *
 * On the Plugins home the selection changes in place (`setParams`), so the page keeps its view,
 * search, filters and scroll. From another Plugins page (a listing, a plugin's own page) opening a
 * plugin returns to the home of the same host with it open.
 */
export function usePluginsOpenItem() {
    const router = useRouter();
    const pathname = usePathname();
    const params = useGlobalSearchParams<{ view?: string; plugin?: string; source?: string }>();
    const onHome = isPluginsHomePathname(pathname);
    const openItem = onHome ? readPluginsOpenItem(params) : null;
    const view = params.view === 'browse' ? 'browse' as const : 'installed' as const;
    const host = resolvePluginsSurfaceHost(pathname);

    const open = React.useCallback((item: PluginsOpenItem | null) => {
        const result = runGuardedNavigation(() => {
            if (onHome) router.setParams(pluginsOpenItemParams(item));
            else router.replace(buildPluginsHomeRoute(host, { view, open: item }) as NavigationHref);
        });
        if (result !== true) fireAndForget(result, { tag: 'usePluginsOpenItem.open' });
    }, [host, onHome, router, view]);
    const close = React.useCallback(() => open(null), [open]);

    // Stable while the same item stays open, so consumers can depend on it.
    const pluginId = openItem?.pluginId ?? null;
    const sourceId = openItem?.kind === 'listing' ? openItem.sourceId : null;
    const stableOpenItem = React.useMemo((): PluginsOpenItem | null => {
        if (pluginId === null) return null;
        return sourceId === null ? { kind: 'installed', pluginId } : { kind: 'listing', sourceId, pluginId };
    }, [pluginId, sourceId]);
    return { openItem: stableOpenItem, open, close } as const;
}
