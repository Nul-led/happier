import * as React from 'react';
import { useLocalSearchParams } from '@/components/appShell/workspace/destinationRoute';

import { McpServerEditorScreen } from '@/components/settings/mcpServers/McpServerEditorScreen';

/** `/settings/mcp/<id>`: a saved MCP server in the collection. A different server is a fresh editor. */
export const WorkspaceRouteBody = React.memo(function McpServerRoute() {
    const { serverId } = useLocalSearchParams<{ serverId?: string | string[] }>();
    const id = Array.isArray(serverId) ? serverId[0] : serverId;
    return <McpServerEditorScreen key={id ?? ''} />;
});
import { WorkspaceRouteEntry } from '@/components/appShell/workspace/createWorkspaceRouteEntry';
export default function RouteEntry() { return <WorkspaceRouteEntry Body={WorkspaceRouteBody} />; }
