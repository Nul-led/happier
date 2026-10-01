import React from 'react';

import { WorkflowsGate } from '@/components/workflows/gating/WorkflowsGate';
import { WorkflowRunScreen } from '@/components/workflows/screens/WorkflowRunScreen';

/**
 * The exact managed Run route: `/workflows/runs/<runId>`.
 *
 * This is the destination a `workflow_run_update` notification tap, a list row
 * and an agent result all address. It is a thin adapter: the screen resolves
 * the Run from the one Account-scoped row owner by `runId`, so it needs no
 * Automation context and works for a direct Run whose originating Session is
 * gone.
 */
export function WorkflowRunDetailRoute() {
    return (
        <WorkflowsGate>
            <WorkflowRunScreen />
        </WorkflowsGate>
    );
}
import { WorkspaceRouteEntry } from '@/components/appShell/workspace/createWorkspaceRouteEntry';
export { WorkflowRunDetailRoute as WorkspaceRouteBody };
export default function RouteEntry() { return <WorkspaceRouteEntry Body={WorkflowRunDetailRoute} />; }
