import { PluginListingRoute } from '@/components/settings/plugins/listing/PluginListingRoute';

export const WorkspaceRouteBody = PluginListingRoute;
import { WorkspaceRouteEntry } from '@/components/appShell/workspace/createWorkspaceRouteEntry';
export default function RouteEntry() { return <WorkspaceRouteEntry Body={WorkspaceRouteBody} />; }
