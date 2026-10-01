import { PluginMarketplaceSourcesScreen } from '@/components/settings/plugins/PluginMarketplaceSourcesScreen';

export const WorkspaceRouteBody = PluginMarketplaceSourcesScreen;
import { WorkspaceRouteEntry } from '@/components/appShell/workspace/createWorkspaceRouteEntry';
export default function RouteEntry() { return <WorkspaceRouteEntry Body={WorkspaceRouteBody} />; }
