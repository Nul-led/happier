import * as React from 'react';

import { WorkflowsDestinationIndex } from '@/components/workflows/library/WorkflowsDestinationIndex';

/** The Workflows destination with nothing selected (FIN 04 §3.3). */
export function WorkflowsRoute(): React.ReactElement {
    return <WorkflowsDestinationIndex />;
}
import { WorkspaceRouteEntry } from '@/components/appShell/workspace/createWorkspaceRouteEntry';
export { WorkflowsRoute as WorkspaceRouteBody };
export default function RouteEntry() { return <WorkspaceRouteEntry Body={WorkflowsRoute} />; }
