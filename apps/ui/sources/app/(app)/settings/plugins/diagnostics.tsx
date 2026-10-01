import { PluginDiagnosticsScreen } from '@/components/settings/plugins/diagnostics/PluginDiagnosticsScreen';

export const WorkspaceRouteBody = PluginDiagnosticsScreen;
import { WorkspaceRouteEntry } from '@/components/appShell/workspace/createWorkspaceRouteEntry';
export default function RouteEntry() { return <WorkspaceRouteEntry Body={WorkspaceRouteBody} />; }
