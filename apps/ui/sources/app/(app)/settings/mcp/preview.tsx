import { McpSessionPreviewScreen as WorkspaceRouteBody } from '@/components/settings/mcpServers/McpSessionPreviewScreen';
export { WorkspaceRouteBody };
import { WorkspaceRouteEntry } from '@/components/appShell/workspace/createWorkspaceRouteEntry';
export default function RouteEntry() { return <WorkspaceRouteEntry Body={WorkspaceRouteBody} />; }
