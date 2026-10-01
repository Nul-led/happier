import { PluginDevelopmentScreen } from '@/components/settings/plugins/development/PluginDevelopmentScreen';

export const WorkspaceRouteBody = PluginDevelopmentScreen;
import { WorkspaceRouteEntry } from '@/components/appShell/workspace/createWorkspaceRouteEntry';
export default function RouteEntry() { return <WorkspaceRouteEntry Body={WorkspaceRouteBody} />; }
