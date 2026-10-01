import ToolRenderingSettingsView from '@/components/settings/session/ToolRenderingSettingsView';

export const WorkspaceRouteBody = ToolRenderingSettingsView;
import { WorkspaceRouteEntry } from '@/components/appShell/workspace/createWorkspaceRouteEntry';
export default function RouteEntry() { return <WorkspaceRouteEntry Body={WorkspaceRouteBody} />; }
