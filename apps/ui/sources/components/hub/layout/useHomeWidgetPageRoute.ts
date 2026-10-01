import * as React from 'react';

import {
    useAppShellPluginUiProjection,
    useProjectedPluginLocalizedTextResolver,
} from '@/components/appShell/plugins/AppShellPluginUiProjection';
import { resolvePluginAppPages, selectPluginAppPagePlacements } from '@/components/appShell/plugins/pluginAppPages';

/**
 * The page a widget's "Open" leads to: its plugin's app page, when the plugin has exactly one that
 * can be entered now. With none, or several (which one would "Open" mean?), the menu offers no Open.
 */
export function useHomeWidgetPageRoute(pluginId: string): string | null {
    const projection = useAppShellPluginUiProjection().pluginUiProjection;
    const localize = useProjectedPluginLocalizedTextResolver();
    return React.useMemo(() => {
        const pages = resolvePluginAppPages({
            placements: selectPluginAppPagePlacements(projection),
            localize,
        }).filter((page) => page.pluginId === pluginId && page.disabledReason === null);
        return pages.length === 1 ? pages[0]!.routePath : null;
    }, [localize, pluginId, projection]);
}
