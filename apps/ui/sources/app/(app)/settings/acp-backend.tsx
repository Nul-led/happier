import * as React from 'react';
import { Redirect, useLocalSearchParams } from '@/components/appShell/workspace/destinationRoute';

import { createCustomAcpAgentSettingsRoute } from '@/agents/catalog/agentSettingsRoutes';

/**
 * Older links to the stand-alone ACP backend editor. Custom ACP agents are edited inside the Agents
 * collection now, so these open the same agent (or a new draft) there.
 */
export const WorkspaceRouteBody = React.memo(function AcpBackendEditorRoute() {
    const { backendId } = useLocalSearchParams<{ backendId?: string | string[] }>();
    const id = (Array.isArray(backendId) ? backendId[0] : backendId)?.trim() || null;
    return <Redirect href={createCustomAcpAgentSettingsRoute(id) as never} />;
});
import { WorkspaceRouteEntry } from '@/components/appShell/workspace/createWorkspaceRouteEntry';
export default function RouteEntry() { return <WorkspaceRouteEntry Body={WorkspaceRouteBody} />; }
