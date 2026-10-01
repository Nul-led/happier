import * as React from 'react';
import { Redirect, useLocalSearchParams } from '@/components/appShell/workspace/destinationRoute';

import { mcpServerRoute, newMcpServerRoute, type McpAddMode } from '@/components/settings/mcpServers/collection/mcpServerCollectionModel';

function readParam(value: string | string[] | undefined): string | null {
    const raw = Array.isArray(value) ? value[0] : value;
    const trimmed = typeof raw === 'string' ? raw.trim() : '';
    return trimmed.length > 0 ? trimmed : null;
}

/**
 * `/settings/mcp-server?serverId=…|addMode=…`: the former stand-alone editor. Servers are edited and
 * added inside the MCP collection now; old links land on the same server or add flow there.
 */
export const WorkspaceRouteBody = React.memo(function LegacyMcpServerEditorRoute() {
    const params = useLocalSearchParams<{ serverId?: string | string[]; addMode?: string | string[]; presetId?: string | string[] }>();
    const serverId = readParam(params.serverId);
    const addMode = readParam(params.addMode);
    const href = serverId
        ? mcpServerRoute(serverId)
        : newMcpServerRoute(
            addMode === 'import-json' || addMode === 'quick-install' ? addMode as McpAddMode : 'configure',
            readParam(params.presetId) ?? undefined,
        );
    return <Redirect href={href as never} />;
});
import { WorkspaceRouteEntry } from '@/components/appShell/workspace/createWorkspaceRouteEntry';
export default function RouteEntry() { return <WorkspaceRouteEntry Body={WorkspaceRouteBody} />; }
