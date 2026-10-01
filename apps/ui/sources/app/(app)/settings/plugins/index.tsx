import PluginSettingsHomeScreen from '@/components/settings/plugins/PluginSettingsHomeScreen';

export const WorkspaceRouteBody = PluginSettingsHomeScreen;
import { WorkspaceRouteEntry } from '@/components/appShell/workspace/createWorkspaceRouteEntry';
export default function RouteEntry() { return <WorkspaceRouteEntry Body={WorkspaceRouteBody} />; }
