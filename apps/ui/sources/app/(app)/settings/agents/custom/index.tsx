import * as React from 'react';

import { AcpBackendEditorScreen } from '@/components/settings/acpCatalog/AcpBackendEditorScreen';

/** `/settings/agents/custom`: a new custom ACP agent, as a draft in the Agents collection. */
export const WorkspaceRouteBody = React.memo(function NewCustomAcpAgentRoute() {
    return <AcpBackendEditorScreen backendId={null} />;
});
import { WorkspaceRouteEntry } from '@/components/appShell/workspace/createWorkspaceRouteEntry';
export default function RouteEntry() { return <WorkspaceRouteEntry Body={WorkspaceRouteBody} />; }
