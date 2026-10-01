import * as React from 'react';

import { WorkflowsGate } from '@/components/workflows/gating/WorkflowsGate';
import { WorkflowsHistoryScreen } from '@/components/workflows/history/WorkflowsHistoryScreen';

/** History: every run you started (FIN 07 S3), from the column's **All runs**. */
export function WorkflowsHistoryRoute(): React.ReactElement {
    return <WorkflowsGate><WorkflowsHistoryScreen /></WorkflowsGate>;
}
import { WorkspaceRouteEntry } from '@/components/appShell/workspace/createWorkspaceRouteEntry';
export { WorkflowsHistoryRoute as WorkspaceRouteBody };
export default function RouteEntry() { return <WorkspaceRouteEntry Body={WorkflowsHistoryRoute} />; }
