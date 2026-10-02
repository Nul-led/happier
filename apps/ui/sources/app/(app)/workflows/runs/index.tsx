import * as React from 'react';

import { WorkflowsGate } from '@/components/workflows/gating/WorkflowsGate';
import { SessionsList } from '@/components/sessions/shell/SessionsList';

/** The Runs deep link is the canonical list with its Show control fixed to Runs. */
export function WorkflowsRunsRoute(): React.ReactElement {
    return <WorkflowsGate><SessionsList fixedShow="runs" /></WorkflowsGate>;
}
import { WorkspaceRouteEntry } from '@/components/appShell/workspace/createWorkspaceRouteEntry';
export { WorkflowsRunsRoute as WorkspaceRouteBody };
export default function RouteEntry() { return <WorkspaceRouteEntry Body={WorkflowsRunsRoute} />; }
