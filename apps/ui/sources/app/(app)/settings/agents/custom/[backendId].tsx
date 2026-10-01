import * as React from 'react';
import { useLocalSearchParams } from '@/components/appShell/workspace/destinationRoute';

import { AcpBackendEditorScreen } from '@/components/settings/acpCatalog/AcpBackendEditorScreen';

/** `/settings/agents/custom/<id>`: a saved custom ACP agent in the Agents collection. */
export const WorkspaceRouteBody = React.memo(function CustomAcpAgentRoute() {
    const { backendId } = useLocalSearchParams<{ backendId?: string | string[] }>();
    const id = Array.isArray(backendId) ? backendId[0] : backendId;
    return <AcpBackendEditorScreen key={id ?? ''} backendId={id ?? null} />;
});
import { WorkspaceRouteEntry } from '@/components/appShell/workspace/createWorkspaceRouteEntry';
export default function RouteEntry() { return <WorkspaceRouteEntry Body={WorkspaceRouteBody} />; }
