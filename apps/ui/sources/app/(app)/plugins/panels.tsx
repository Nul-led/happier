import { useLocalSearchParams } from '@/components/appShell/workspace/destinationRoute';

import { AppScopeRightSidebar } from '@/components/appShell/rightSidebar/AppScopeRightSidebar';
import { APP_PANE_SCOPE_ID } from '@/components/appShell/rightSidebar/appScopeRightSidebarNavigation';

/** An App panel as its own page (phones, or opened from a page without a right sidebar). */
export function PluginPanelsRoute() {
    const params = useLocalSearchParams<{ pluginId?: string; destinationId?: string }>();
    const pluginId = typeof params.pluginId === 'string' ? params.pluginId.trim() : '';
    const localId = typeof params.destinationId === 'string' ? params.destinationId.trim() : '';
    const requestedDestination = pluginId.length > 0 && localId.length > 0
        ? { pluginId, localId }
        : undefined;
    return (
        <AppScopeRightSidebar
            scopeId={APP_PANE_SCOPE_ID}
            requestedDestination={requestedDestination}
            testID="plugins.panels.host"
        />
    );
}
import { WorkspaceRouteEntry } from '@/components/appShell/workspace/createWorkspaceRouteEntry';
export { PluginPanelsRoute as WorkspaceRouteBody };
export default function RouteEntry() { return <WorkspaceRouteEntry Body={PluginPanelsRoute} />; }
