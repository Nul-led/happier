import PluginSettingsHomeScreen from '@/components/settings/plugins/PluginSettingsHomeScreen';

// The main sidebar's Plugins page: the same screen as Settings → Plugin marketplace, hosted as an
// app page. Links inside it stay in this host (`pluginsSurfaceRoutes`).
export const WorkspaceRouteBody = PluginSettingsHomeScreen;
import { WorkspaceRouteEntry } from '@/components/appShell/workspace/createWorkspaceRouteEntry';
export default function RouteEntry() { return <WorkspaceRouteEntry Body={WorkspaceRouteBody} />; }
