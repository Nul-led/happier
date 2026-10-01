import { McpDetectedServersScreen as WorkspaceRouteBody } from '@/components/settings/mcpServers/McpDetectedServersScreen';
export { WorkspaceRouteBody };
import { WorkspaceRouteEntry } from '@/components/appShell/workspace/createWorkspaceRouteEntry';
export default function RouteEntry() { return <WorkspaceRouteEntry Body={WorkspaceRouteBody} />; }
